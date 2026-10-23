import { audioFailure, toAudioFailure, type AudioFailure, type SubtitleProblem } from "./failures";
import type { AudioMaterial, SubtitleCue } from "./types";
import {
	MAX_AUDIO_BYTES,
	MAX_AUDIO_DURATION_SECONDS,
	type AudioSourceFiles,
	type AudioSourceStat,
	type DraftCue,
	type GenerationDraft,
	type GenerationDraftStore,
	type GenerationInput,
	type GenerationNotice,
	type PrepareAudio,
	type TimedTextWord,
	type TimedWord,
	type TranscribeAudio,
	type Transcript,
} from "./transcriptionTypes";
import type { TranscriptionConfiguration } from "./transcriptionConfiguration";
import {
	matchesLegacyBailianFingerprint,
	transcriptionConfigFingerprint,
} from "./transcription/transcriptionConfig";

import {
	tokenizeUnicodeWords,
	mergeTranscripts,
	alignTimedWords,
} from "../../../core/media/transcripts";
export {
	tokenizeUnicodeWords,
	mergeTranscripts,
	alignTimedWords,
} from "../../../core/media/transcripts";

export function alignReference(reference: string, transcript: Transcript): DraftCue[] {
	const sentences = reference
		.split(/\r?\n/)
		.flatMap((line) => line.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) ?? [])
		.map((text) => text.trim())
		.filter(Boolean);
	const target = sentences.flatMap((s) => tokenizeUnicodeWords(s).map((t) => t.text));
	const timed = transcript.words.flatMap((word) =>
		tokenizeUnicodeWords(word.text).map((token) => ({ ...word, text: token.text })),
	);
	if (target.length > 5000 || timed.length > 5000)
		return sentences.map((text, index) => ({
			id: `reference-${index}`,
			text,
			start: null,
			end: null,
			needsReview: true,
		}));
	const width = timed.length + 1;
	const table = new Uint16Array((target.length + 1) * width);
	for (let i = target.length - 1; i >= 0; i--)
		for (let j = timed.length - 1; j >= 0; j--)
			table[i * width + j] =
				target[i] === timed[j]?.text
					? 1 + (table[(i + 1) * width + j + 1] ?? 0)
					: Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
	const matches = new Map<number, number>();
	for (let i = 0, j = 0; i < target.length && j < timed.length;) {
		if (target[i] === timed[j]?.text) {
			matches.set(i, j);
			i++;
			j++;
		} else if ((table[(i + 1) * width + j] ?? 0) > (table[i * width + j + 1] ?? 0)) i++;
		else j++;
	}
	let offset = 0;
	return sentences.map((text, index) => {
		const sentenceTokens = tokenizeUnicodeWords(text).map((t) => t.text);
		const found = sentenceTokens.flatMap((_, position) =>
			matches.has(offset + position) ? [matches.get(offset + position)!] : [],
		);
		let occurrences = 0;
		for (let position = 0; position <= timed.length - sentenceTokens.length; position++)
			if (
				sentenceTokens.length &&
				sentenceTokens.every((token, n) => token === timed[position + n]?.text)
			)
				occurrences++;
		const first = matches.get(offset);
		const last = matches.get(offset + sentenceTokens.length - 1);
		const sourceSpan =
			first !== undefined && last !== undefined ? timed.slice(first, last + 1) : [];
		const dense = sourceSpan.length > 0 && found.length / sourceSpan.length >= 0.9;
		const noLongGaps = sourceSpan.every(
			(word, position) =>
				position === 0 || word.start - (sourceSpan[position - 1]?.end ?? word.start) <= 2,
		);
		const reliable =
			sentenceTokens.length > 0 &&
			found.length / sentenceTokens.length >= 0.9 &&
			first !== undefined &&
			last !== undefined &&
			occurrences <= 1 &&
			dense &&
			noLongGaps;
		offset += sentenceTokens.length;
		return {
			id: `reference-${index}`,
			text,
			start: reliable ? (timed[first!]?.start ?? null) : null,
			end: reliable ? (timed[last!]?.end ?? null) : null,
			needsReview: !reliable,
		};
	});
}

export async function sourceFingerprint(
	audio: ArrayBuffer,
	referenceText: string,
): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", audio);
	return `${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}:${referenceText}`;
}

export type SubtitleDraftAction =
	| {
			readonly type: "edit-cue";
			readonly id: string;
			readonly patch: Partial<Pick<DraftCue, "text" | "start" | "end" | "needsReview">>;
	  }
	| { readonly type: "add-cue" }
	| { readonly type: "remove-cue"; readonly id: string }
	| { readonly type: "confirm-all-cues" };

export interface SubtitleDraftCue extends DraftCue {
	/** Precomputed word-level timestamp alignment and readiness. */
	readonly highlightable: boolean;
}

export interface SubtitleDraftSnapshot {
	readonly status:
		| "idle"
		| "preparing"
		| "transcribing"
		| "aligning"
		| "review"
		| "saving"
		| "cancelled"
		| "error";
	readonly cues: readonly SubtitleDraftCue[];
	readonly completedChunks: number;
	readonly totalChunks: number;
	readonly duration: number;
	readonly failure: AudioFailure | null;
	readonly error: AudioFailure | null;
	readonly notice: GenerationNotice | null;
	readonly taskKey: string | null;
	readonly hasReviewWordTimings: boolean;
}

export type SubtitleDraftCommitHandler = (
	materialId: string,
	cues: readonly SubtitleCue[],
	wordTimings: ReadonlyMap<string, readonly TimedTextWord[]>,
) => Promise<unknown>;

export interface SubtitleDraftEngineOptions {
	readonly prepare: PrepareAudio;
	readonly transcribe: TranscribeAudio;
	readonly drafts?: GenerationDraftStore;
	readonly source?: AudioSourceFiles;
	readonly transcription?: TranscriptionConfiguration;
	readonly commitSubtitles?: SubtitleDraftCommitHandler;
}

function sameFileStat(a: AudioSourceStat | null, b: AudioSourceStat | null): boolean {
	if (!a || !b) return false;
	return a.size === b.size && a.mtime === b.mtime;
}

/**
 * Deep domain module managing chunked audio transcription, reference text alignment,
 * word-level timing matching, and atomic draft editing operations.
 */
export class SubtitleDraftEngine {
	private snapshot: SubtitleDraftSnapshot = {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		error: null,
		notice: null,
		taskKey: null,
		hasReviewWordTimings: false,
	};
	private readonly listeners = new Set<() => void>();
	private readonly hostOptions: Partial<SubtitleDraftEngineOptions> = {};
	private sourceValidated = true;
	private validationToken = 0;
	private saving = false;
	private draftError: AudioFailure | null = null;
	private controller: AbortController | null = null;
	private input: GenerationInput | null = null;
	private draft: GenerationDraft | null = null;
	private writes: Promise<void> = Promise.resolve();
	private restoreRevision = 0;
	private disposed = false;

	constructor(private readonly options: SubtitleDraftEngineOptions) {}

	private get source(): AudioSourceFiles | undefined {
		return this.hostOptions.source ?? this.options.source;
	}

	private get transcription(): TranscriptionConfiguration | undefined {
		return this.hostOptions.transcription ?? this.options.transcription;
	}

	private get commitSubtitles(): SubtitleDraftCommitHandler | undefined {
		return this.hostOptions.commitSubtitles ?? this.options.commitSubtitles;
	}

	bindHost(
		host: Partial<
			Pick<SubtitleDraftEngineOptions, "source" | "transcription" | "commitSubtitles">
		>,
	): void {
		Object.assign(this.hostOptions, host);
	}

	isSourceValidated(): boolean {
		return this.sourceValidated;
	}

	invalidateValidation(): void {
		this.validationToken++;
		this.sourceValidated = false;
		this.publish({});
	}

	dismissFailure(): void {
		this.draftError = null;
		this.publish({ failure: null });
	}

	getSnapshot = (): SubtitleDraftSnapshot => this.snapshot;

	getTimedWords = (): readonly TimedWord[] =>
		["review", "saving"].includes(this.snapshot.status) ? (this.draft?.words ?? []) : [];

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

	syncWithMaterial(material: AudioMaterial | null): void {
		if (this.disposed || this.saving) return;
		if (["preparing", "transcribing", "aligning"].includes(this.snapshot.status)) return;
		if (!material) {
			this.validationToken++;
			this.sourceValidated = true;
			this.draftError = null;
			if (this.snapshot.status !== "idle" || this.snapshot.taskKey !== null) {
				this.publish({ status: "idle", cues: [], taskKey: null, failure: null });
			}
			return;
		}
		if (this.snapshot.taskKey === material.id && this.sourceValidated) {
			return;
		}
		const token = ++this.validationToken;
		this.sourceValidated = false;
		this.publish({});
		void (async () => {
			const restored =
				this.snapshot.taskKey === material.id || (await this.restore(material.id));
			if (token !== this.validationToken) return;
			const currentSnap = this.snapshot;
			if (
				!restored ||
				!this.source ||
				currentSnap.taskKey !== material.id ||
				currentSnap.status !== "review"
			) {
				this.sourceValidated = true;
				this.publish({});
				return;
			}
			const stat = this.source.stat(material.audioPath);
			if (!stat) {
				this.publish({});
				return;
			}
			const audio = await this.source.readBinary(material.audioPath);
			const matches = await this.matchesSource(audio, material.originalText);
			if (
				token === this.validationToken &&
				this.snapshot.taskKey === material.id &&
				sameFileStat(stat, this.source.stat(material.audioPath))
			) {
				this.sourceValidated = matches;
				this.publish({});
			}
		})().catch(() => {});
	}

	async generateForMaterial(
		material: AudioMaterial | null,
		options: { force?: boolean } = {},
	): Promise<boolean> {
		if (this.disposed || this.saving) return false;
		if (["preparing", "transcribing", "aligning"].includes(this.snapshot.status)) return false;
		const source = this.source;
		const transcription = this.transcription;
		if (!material) {
			this.draftError = { kind: "missing-file" };
			this.publish({});
			return false;
		}
		if (!transcription || !source) return false;
		this.draftError = null;
		let config: import("./transcriptionTypes").TranscriptionConfig;
		try {
			config = transcription.prepare();
		} catch (error) {
			this.draftError = toAudioFailure(error);
			this.publish({});
			return false;
		}
		const stat = source.stat(material.audioPath);
		if (!stat) {
			this.draftError = { kind: "missing-file" };
			this.publish({});
			return false;
		}
		if (stat.size > MAX_AUDIO_BYTES) {
			this.draftError = { kind: "audio-too-large", maxBytes: MAX_AUDIO_BYTES };
			this.publish({});
			return false;
		}
		try {
			const audio = await source.readBinary(material.audioPath);
			const input: GenerationInput = {
				audio,
				name: material.audioPath.split("/").slice(-1)[0] || "audio",
				taskKey: material.id,
				referenceText: material.originalText,
				config,
			};
			const token = ++this.validationToken;
			this.sourceValidated = false;
			await this.generate(input, options);
			if (
				token === this.validationToken &&
				this.snapshot.taskKey === material.id &&
				sameFileStat(stat, source.stat(material.audioPath))
			) {
				this.sourceValidated = true;
				this.publish({});
			}
			return true;
		} catch (error) {
			this.draftError = toAudioFailure(error);
			this.publish({});
			return false;
		}
	}

	async commitForMaterial(material: AudioMaterial | null): Promise<boolean> {
		if (this.disposed || this.saving) return false;
		if (["preparing", "transcribing", "aligning"].includes(this.snapshot.status)) return false;
		if (!material) return false;
		if (this.snapshot.taskKey !== material.id) {
			this.draftError = { kind: "stale-material" };
			this.publish({});
			return false;
		}
		if (!this.sourceValidated) {
			this.draftError = { kind: "source-changed" };
			this.publish({});
			return false;
		}
		const source = this.source;
		const commit = this.commitSubtitles;
		if (!source || !commit) return false;
		this.saving = true;
		this.draftError = null;
		this.publish({ status: "saving" });
		try {
			const stat = source.stat(material.audioPath);
			if (!stat) throw audioFailure({ kind: "missing-file" });
			const mtime = stat.mtime;
			const audio = await source.readBinary(material.audioPath);
			const matches = await this.matchesSource(audio, material.originalText);
			const afterStat = source.stat(material.audioPath);
			if (!matches || this.snapshot.taskKey !== material.id || afterStat?.mtime !== mtime) {
				throw audioFailure({ kind: "source-changed" });
			}
			const cues = this.validatedCues();
			const wordTimingsObj = this.getValidatedWordTimings();
			const timings = new Map<string, readonly TimedTextWord[]>();
			for (const [cueId, cueTimings] of Object.entries(wordTimingsObj)) {
				timings.set(cueId, cueTimings);
			}
			await commit(material.id, cues, timings);
			return true;
		} catch (error) {
			this.draftError = toAudioFailure(error);
			return false;
		} finally {
			this.saving = false;
			this.publish({});
		}
	}

	private publish(patch: Partial<SubtitleDraftSnapshot>): void {
		if (this.disposed) return;
		const nextStatus = patch.status ?? this.snapshot.status;
		const timedWords =
			nextStatus === "review" || nextStatus === "saving" ? (this.draft?.words ?? []) : [];
		const hasReviewWordTimings = timedWords.length > 0;
		const sourceCues = patch.cues ?? this.draft?.cues ?? this.snapshot.cues;
		const cues: SubtitleDraftCue[] = sourceCues.map((cue) => {
			const highlightable =
				cue.start !== null &&
				cue.end !== null &&
				hasReviewWordTimings &&
				alignTimedWords(cue.text.trim(), cue.start, cue.end, timedWords) !== null;
			return {
				...cue,
				highlightable,
			};
		});
		this.snapshot = {
			...this.snapshot,
			...patch,
			error: this.draftError,
			cues,
			hasReviewWordTimings,
		};
		for (const listener of this.listeners) listener();
	}

	private persist(): Promise<void> {
		const draft = this.draft;
		if (!draft || !this.options.drafts) return Promise.resolve();
		const saved = JSON.parse(JSON.stringify(draft)) as GenerationDraft;
		const store = this.options.drafts;
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
		const draft = normalizeGenerationDraft(await this.options.drafts?.load(taskKey));
		if (revision !== this.restoreRevision || this.controller) return false;
		if (!draft) return false;
		this.draft = draft;
		this.publish({
			taskKey,
			duration: draft.duration,
			cues: draft.cues.map((c) => ({ ...c, highlightable: false })),
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
			const configFingerprint = await transcriptionConfigFingerprint(input.config);
			await this.writes.catch(() => {});
			const saved = options.force
				? null
				: this.draft?.taskKey === input.taskKey
					? this.draft
					: normalizeGenerationDraft(await this.options.drafts?.load(input.taskKey));
			signal.throwIfAborted();
			const prepared = await this.options.prepare(input.audio, signal);
			signal.throwIfAborted();
			if (prepared.duration <= 0 || prepared.duration > MAX_AUDIO_DURATION_SECONDS)
				throw audioFailure({
					kind: "audio-too-long",
					maxSeconds: MAX_AUDIO_DURATION_SECONDS,
				});
			const legacyReuse =
				saved?.fingerprint === fingerprint &&
				matchesLegacyBailianFingerprint(saved.configFingerprint, input.config);
			const reuse =
				saved?.fingerprint === fingerprint &&
				(saved.configFingerprint === configFingerprint || legacyReuse);
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
				this.draft = { ...saved, configFingerprint };
				if (legacyReuse) await this.persist();
				this.publish({
					status: "review",
					duration: prepared.duration,
					completedChunks: results.length,
					totalChunks: prepared.chunks.length,
					cues: saved.cues.map((c) => ({ ...c, highlightable: false })),
					notice: saved.notice,
				});
				return;
			}
			if (legacyReuse) await this.persist();
			this.publish({
				status: "transcribing",
				duration: prepared.duration,
				completedChunks: results.length,
				totalChunks: prepared.chunks.length,
			});
			for (let index = results.length; index < prepared.chunks.length; index++) {
				const chunk = prepared.chunks[index];
				if (!chunk) continue;
				const result = await this.options.transcribe(chunk, input.config, signal);
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
				cues: cues.map((c) => ({ ...c, highlightable: false })),
				notice,
				failure: cues.length === 0 ? { kind: "no-speech" } : null,
			});
		} catch (error) {
			if (this.snapshot.taskKey === input.taskKey)
				this.publish({
					status: signal.aborted ? "cancelled" : "error",
					failure: signal.aborted ? null : toAudioFailure(error),
					cues:
						this.draft?.taskKey === input.taskKey
							? this.draft.cues.map((c) => ({ ...c, highlightable: false }))
							: [],
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
		const store = this.options.drafts;
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
		this.publish({ cues: cues.map((c) => ({ ...c, highlightable: false })) });
		void this.persist().catch(() => this.publish({ failure: { kind: "draft-save-failed" } }));
	}

	/**
	 * Single semantic action dispatch to mutate draft cues, managing updates,
	 * additions, removals, and confirmations in one place.
	 */
	act(action: SubtitleDraftAction): void {
		if (this.disposed || this.controller || !this.draft) return;
		switch (action.type) {
			case "edit-cue": {
				this.change(
					this.draft.cues.map((cue) =>
						cue.id === action.id ? { ...cue, ...action.patch } : cue,
					),
				);
				break;
			}
			case "add-cue": {
				const id = `manual-${crypto.randomUUID()}`;
				this.change([
					...this.draft.cues,
					{ id, text: "", start: null, end: null, needsReview: true },
				]);
				break;
			}
			case "remove-cue": {
				this.change(this.draft.cues.filter((cue) => cue.id !== action.id));
				break;
			}
			case "confirm-all-cues": {
				if (!this.draft.cues.some((cue) => cue.needsReview)) return;
				this.change(
					this.draft.cues.map((cue) =>
						cue.needsReview ? { ...cue, needsReview: false } : cue,
					),
				);
				break;
			}
		}
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

	/** Validates and aligns recognized words to finalized cues for persistent word-level playback. */
	getValidatedWordTimings(): Record<string, TimedTextWord[]> {
		const recognizedWords = this.getTimedWords();
		const timings: Record<string, TimedTextWord[]> = {};
		for (const cue of this.validatedCues()) {
			const matched = alignTimedWords(cue.text.trim(), cue.start, cue.end, recognizedWords);
			if (matched) timings[cue.id] = matched;
		}
		return timings;
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
		configFingerprint:
			typeof draft.configFingerprint === "string" ? draft.configFingerprint : "",
		notice: draft.notice === "no-word-timestamps" ? "no-word-timestamps" : null,
	};
}
