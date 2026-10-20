import {
	audioFailure,
	toAudioFailure,
	type AudioFailure,
	type SubtitleProblem,
} from "../domain/failures";
import type { SubtitleCue } from "../domain/types";
import { alignReference, mergeTranscripts } from "./alignment";
import { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_SECONDS } from "./limits";
import { transcriptionConfigFingerprint } from "./transcriptionConfig";
import type {
	DraftCue,
	GenerationDraft,
	GenerationDraftStore,
	GenerationInput,
	GenerationNotice,
	PrepareAudio,
	TimedWord,
	TranscribeAudio,
	Transcript,
} from "./types";

export type { DraftCue, GenerationDraftStore, GenerationInput, TranscriptionConfig } from "./types";

async function sourceFingerprint(audio: ArrayBuffer, referenceText: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", audio);
	return `${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}:${referenceText}`;
}

export interface GenerationSnapshot {
	status: "idle" | "preparing" | "transcribing" | "aligning" | "review" | "cancelled" | "error";
	cues: DraftCue[];
	completedChunks: number;
	totalChunks: number;
	duration: number;
	failure: AudioFailure | null;
	notice: GenerationNotice | null;
	taskKey: string | null;
}

export class SubtitleGeneration {
	private snapshot: GenerationSnapshot = {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		notice: null,
		taskKey: null,
	};
	private listeners = new Set<() => void>();
	private controller: AbortController | null = null;
	private input: GenerationInput | null = null;
	private draft: GenerationDraft | null = null;
	private writes: Promise<void> = Promise.resolve();
	private restoreRevision = 0;
	private disposed = false;

	constructor(
		private readonly ports: {
			prepare: PrepareAudio;
			transcribe: TranscribeAudio;
			drafts?: GenerationDraftStore;
		},
	) {}

	getSnapshot = (): GenerationSnapshot => this.snapshot;
	getTimedWords = (): readonly TimedWord[] =>
		this.snapshot.status === "review" ? (this.draft?.words ?? []) : [];
	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	async matchesSource(audio: ArrayBuffer, referenceText: string): Promise<boolean> {
		const draft = this.draft;
		const revision = this.restoreRevision;
		if (this.disposed || !draft || this.controller) return false;
		const fingerprint = await sourceFingerprint(audio, referenceText);
		return (
			draft === this.draft &&
			revision === this.restoreRevision &&
			!this.controller &&
			draft.fingerprint === fingerprint
		);
	}
	private publish(patch: Partial<GenerationSnapshot>): void {
		if (this.disposed) return;
		this.snapshot = { ...this.snapshot, ...patch };
		for (const listener of this.listeners) listener();
	}

	private persist(): Promise<void> {
		const draft = this.draft;
		if (!draft || !this.ports.drafts) return Promise.resolve();
		const saved = JSON.parse(JSON.stringify(draft)) as GenerationDraft;
		const store = this.ports.drafts;
		const write = this.writes.catch(() => {}).then(() => store.save(saved));
		this.writes = write;
		return write;
	}

	async restore(taskKey: string): Promise<boolean> {
		if (this.disposed || this.controller) return false;
		const revision = ++this.restoreRevision;
		this.input = null;
		this.draft = null;
		this.publish({
			status: "idle",
			cues: [],
			taskKey,
			duration: 0,
			completedChunks: 0,
			totalChunks: 0,
			failure: null,
			notice: null,
		});
		await this.writes.catch(() => {});
		const draft = normalizeGenerationDraft(await this.ports.drafts?.load(taskKey));
		if (revision !== this.restoreRevision || this.controller) return false;
		if (!draft) return false;
		this.draft = draft;
		this.publish({
			taskKey,
			duration: draft.duration,
			cues: draft.cues,
			completedChunks: draft.results.length,
			totalChunks: 0,
			failure: null,
			notice: draft.complete ? draft.notice : null,
			status: draft.complete ? "review" : "cancelled",
		});
		return true;
	}

	async generate(input: GenerationInput, options: { force?: boolean } = {}): Promise<void> {
		if (this.disposed) throw audioFailure({ kind: "cancelled" });
		if (this.controller) throw audioFailure({ kind: "unknown" });
		this.restoreRevision++;
		this.input = input;
		const controller = new AbortController();
		this.controller = controller;
		const { signal } = controller;
		this.publish({
			status: "preparing",
			failure: null,
			cues: [],
			notice: null,
			taskKey: input.taskKey,
			completedChunks: 0,
			totalChunks: 0,
		});
		try {
			if (input.audio.byteLength > MAX_AUDIO_BYTES)
				throw audioFailure({ kind: "audio-too-large", maxBytes: MAX_AUDIO_BYTES });
			const fingerprint = await sourceFingerprint(input.audio, input.referenceText ?? "");
			const configFingerprint = transcriptionConfigFingerprint(input.config);
			await this.writes.catch(() => {});
			const saved = options.force
				? null
				: this.draft?.taskKey === input.taskKey
					? this.draft
					: normalizeGenerationDraft(await this.ports.drafts?.load(input.taskKey));
			signal.throwIfAborted();
			const prepared = await this.ports.prepare(input.audio, signal);
			signal.throwIfAborted();
			if (prepared.duration <= 0 || prepared.duration > MAX_AUDIO_DURATION_SECONDS)
				throw audioFailure({
					kind: "audio-too-long",
					maxSeconds: MAX_AUDIO_DURATION_SECONDS,
				});
			const reuse =
				saved?.fingerprint === fingerprint && saved.configFingerprint === configFingerprint;
			const results: Transcript[] = reuse && saved ? [...saved.results] : [];
			this.draft = {
				taskKey: input.taskKey,
				fingerprint,
				configFingerprint,
				duration: prepared.duration,
				results,
				cues: [],
				complete: false,
				notice: null,
			};
			if (reuse && saved?.complete) {
				this.draft = saved;
				this.publish({
					status: "review",
					duration: prepared.duration,
					completedChunks: results.length,
					totalChunks: prepared.chunks.length,
					cues: saved.cues,
					notice: saved.notice,
				});
				return;
			}
			this.publish({
				status: "transcribing",
				duration: prepared.duration,
				completedChunks: results.length,
				totalChunks: prepared.chunks.length,
			});
			for (let index = results.length; index < prepared.chunks.length; index++) {
				const chunk = prepared.chunks[index];
				if (!chunk) continue;
				const result = await this.ports.transcribe(chunk, input.config, signal);
				signal.throwIfAborted();
				results.push(result);
				this.draft.cues = mergeTranscripts(results, prepared.chunks).cues;
				await this.persist();
				signal.throwIfAborted();
				this.publish({ completedChunks: results.length });
			}
			this.publish({ status: "aligning" });
			const transcript = mergeTranscripts(results, prepared.chunks);
			this.draft.words = transcript.words;
			const wantsReference = Boolean(input.referenceText?.trim());
			const cues =
				wantsReference && transcript.words.length > 0
					? alignReference(input.referenceText!, transcript)
					: transcript.cues;
			const notice: GenerationNotice | null =
				transcript.words.length === 0 && cues.length > 0 ? "no-word-timestamps" : null;
			this.draft.cues = cues;
			this.draft.complete = true;
			this.draft.notice = notice;
			await this.persist();
			signal.throwIfAborted();
			this.publish({
				status: "review",
				cues,
				notice,
				failure: cues.length === 0 ? { kind: "no-speech" } : null,
			});
		} catch (error) {
			if (this.snapshot.taskKey === input.taskKey)
				this.publish({
					status: signal.aborted ? "cancelled" : "error",
					failure: signal.aborted ? null : toAudioFailure(error),
					cues: this.draft?.taskKey === input.taskKey ? this.draft.cues : [],
				});
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	retry(): Promise<void> {
		if (!this.input) return Promise.resolve();
		return this.generate(this.input);
	}
	cancel(): void {
		this.controller?.abort();
		if (this.controller) this.publish({ status: "cancelled", failure: null });
	}
	async discard(taskKey: string): Promise<void> {
		if (this.snapshot.taskKey === taskKey) {
			this.restoreRevision++;
			this.cancel();
			this.input = null;
			this.draft = null;
			this.publish({
				status: "idle",
				cues: [],
				completedChunks: 0,
				totalChunks: 0,
				duration: 0,
				failure: null,
				notice: null,
				taskKey: null,
			});
		}
		const store = this.ports.drafts;
		if (!store?.remove) return;
		const write = this.writes.catch(() => {}).then(() => store.remove!(taskKey));
		this.writes = write;
		await write;
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.restoreRevision++;
		this.cancel();
		this.listeners.clear();
	}

	private change(cues: DraftCue[]): void {
		if (this.disposed || this.controller || !this.draft) return;
		this.draft = { ...this.draft, cues };
		this.publish({ cues });
		void this.persist().catch(() => this.publish({ failure: { kind: "draft-save-failed" } }));
	}
	editCue(
		id: string,
		patch: Partial<Pick<DraftCue, "text" | "start" | "end" | "needsReview">>,
	): void {
		this.change(this.snapshot.cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
	}
	/** Confirms the whole draft at once; individual timing errors still block saving. */
	confirmAllCues(): void {
		if (!this.snapshot.cues.some((cue) => cue.needsReview)) return;
		this.change(
			this.snapshot.cues.map((cue) =>
				cue.needsReview ? { ...cue, needsReview: false } : cue,
			),
		);
	}
	addCue(): string {
		const id = `manual-${crypto.randomUUID()}`;
		this.change([
			...this.snapshot.cues,
			{ id, text: "", start: null, end: null, needsReview: true },
		]);
		return id;
	}
	removeCue(id: string): void {
		this.change(this.snapshot.cues.filter((cue) => cue.id !== id));
	}
	validatedCues(): SubtitleCue[] {
		if (this.controller) throw audioFailure({ kind: "unknown" });
		const drafts = this.snapshot.cues;
		const problems: SubtitleProblem[] = [];
		if (drafts.length === 0) problems.push({ kind: "no-cues" });
		const ids = new Set<string>();
		for (const [cueIndex, cue] of drafts.entries()) {
			if (!cue.id || ids.has(cue.id)) problems.push({ kind: "duplicate-id", cueIndex });
			ids.add(cue.id);
			if (!cue.text.trim()) problems.push({ kind: "empty-text", cueIndex });
			if (/\n[ \t\r]*\n/.test(cue.text)) problems.push({ kind: "blank-line", cueIndex });
			if (
				cue.start === null ||
				cue.end === null ||
				!Number.isFinite(cue.start) ||
				!Number.isFinite(cue.end) ||
				cue.start < 0 ||
				cue.end <= cue.start ||
				cue.end > this.snapshot.duration
			)
				problems.push({ kind: "bad-timing", cueIndex });
			if (cue.needsReview) problems.push({ kind: "needs-review", cueIndex });
		}
		if (problems.length) throw audioFailure({ kind: "subtitle-invalid", problems });
		return drafts
			.map((cue) => ({ ...cue, start: cue.start!, end: cue.end! }))
			.sort((a, b) => a.start - b.start);
	}
}

/** Local storage is untrusted across upgrades or interrupted writes. */
export function normalizeGenerationDraft(value: unknown): GenerationDraft | null {
	if (!value || typeof value !== "object") return null;
	const draft = value as GenerationDraft;
	const cueValid = (cue: DraftCue) =>
		cue &&
		typeof cue.id === "string" &&
		typeof cue.text === "string" &&
		(cue.start === null || Number.isFinite(cue.start)) &&
		(cue.end === null || Number.isFinite(cue.end)) &&
		typeof cue.needsReview === "boolean";
	if (
		typeof draft.taskKey !== "string" ||
		typeof draft.fingerprint !== "string" ||
		!Number.isFinite(draft.duration) ||
		draft.duration <= 0 ||
		draft.duration > MAX_AUDIO_DURATION_SECONDS ||
		typeof draft.complete !== "boolean" ||
		!Array.isArray(draft.cues) ||
		!draft.cues.every(cueValid) ||
		!Array.isArray(draft.results) ||
		(draft.words !== undefined &&
			(!Array.isArray(draft.words) ||
				draft.words.length > 5000 ||
				!draft.words.every(
					(word) =>
						word &&
						typeof word.text === "string" &&
						Number.isFinite(word.start) &&
						Number.isFinite(word.end) &&
						word.start >= 0 &&
						word.end > word.start,
				))) ||
		draft.results.length > 11
	)
		return null;
	for (const result of draft.results) {
		if (
			!result ||
			!Array.isArray(result.cues) ||
			!result.cues.every(cueValid) ||
			!Array.isArray(result.words) ||
			!result.words.every(
				(word) =>
					word &&
					typeof word.text === "string" &&
					Number.isFinite(word.start) &&
					Number.isFinite(word.end) &&
					word.start >= 0 &&
					word.end > word.start,
			)
		)
			return null;
	}
	return {
		...draft,
		// Drafts written before provider configurability have no service identity; they
		// can still be reviewed and saved but never resume transcription.
		configFingerprint:
			typeof draft.configFingerprint === "string" ? draft.configFingerprint : "",
		notice: draft.notice === "no-word-timestamps" ? "no-word-timestamps" : null,
	};
}
