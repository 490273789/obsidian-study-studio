import type { SubtitleCue } from "../domain/types";
import { alignReference, mergeTranscripts } from "./alignment";
import type {
	DraftCue,
	GenerationDraft,
	GenerationDraftStore,
	GenerationInput,
	PrepareAudio,
	TranscribeAudio,
	Transcript,
} from "./types";

export type { DraftCue, GenerationDraftStore, GenerationInput, SpeechConfig } from "./types";

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
	error: string | null;
	taskKey: string | null;
}

export class SubtitleGeneration {
	private snapshot: GenerationSnapshot = {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		error: null,
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
			error: null,
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
			error: null,
			status: draft.complete ? "review" : "cancelled",
		});
		return true;
	}

	async generate(input: GenerationInput, options: { force?: boolean } = {}): Promise<void> {
		if (this.disposed) throw new Error("字幕生成服务已关闭。");
		if (this.controller) throw new Error("已有字幕生成任务正在运行，请先取消。");
		this.restoreRevision++;
		this.input = input;
		const controller = new AbortController();
		this.controller = controller;
		const { signal } = controller;
		this.publish({
			status: "preparing",
			error: null,
			cues: [],
			taskKey: input.taskKey,
			completedChunks: 0,
			totalChunks: 0,
		});
		try {
			if (input.audio.byteLength > 50 * 1024 * 1024)
				throw new Error("生成字幕仅支持 50 MiB 以内的音频。");
			const fingerprint = await sourceFingerprint(input.audio, input.referenceText ?? "");
			await this.writes.catch(() => {});
			const saved = options.force
				? null
				: this.draft?.taskKey === input.taskKey
					? this.draft
					: normalizeGenerationDraft(await this.ports.drafts?.load(input.taskKey));
			signal.throwIfAborted();
			const prepared = await this.ports.prepare(input.audio, signal);
			signal.throwIfAborted();
			if (prepared.duration <= 0 || prepared.duration > 600)
				throw new Error("生成字幕仅支持 10 分钟以内的音频。");
			const results: Transcript[] =
				saved?.fingerprint === fingerprint ? [...saved.results] : [];
			this.draft = {
				taskKey: input.taskKey,
				fingerprint,
				duration: prepared.duration,
				results,
				cues: [],
				complete: false,
			};
			if (saved?.fingerprint === fingerprint && saved.complete) {
				this.draft = saved;
				this.publish({
					status: "review",
					duration: prepared.duration,
					completedChunks: results.length,
					totalChunks: prepared.chunks.length,
					cues: saved.cues,
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
			const cues = input.referenceText?.trim()
				? alignReference(input.referenceText, transcript)
				: transcript.cues;
			this.draft.cues = cues;
			this.draft.complete = true;
			await this.persist();
			signal.throwIfAborted();
			this.publish({
				status: "review",
				cues,
				error: cues.length === 0 ? "音频中没有识别到可用语音，可手动补建片段。" : null,
			});
		} catch (error) {
			this.publish({
				status: signal.aborted ? "cancelled" : "error",
				error: signal.aborted
					? null
					: error instanceof Error
						? error.message
						: "字幕生成失败，请手动重试。",
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
		if (this.controller) this.publish({ status: "cancelled", error: null });
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
		void this.persist().catch(() =>
			this.publish({ error: "本地草稿保存失败，请保留页面并重试。" }),
		);
	}
	editCue(
		id: string,
		patch: Partial<Pick<DraftCue, "text" | "start" | "end" | "needsReview">>,
	): void {
		this.change(this.snapshot.cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
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
		if (this.controller) throw new Error("请等待生成结束后保存。");
		if (this.snapshot.cues.length === 0) throw new Error("请至少添加一个字幕片段。");
		return this.snapshot.cues
			.map((cue) => {
				if (cue.needsReview) throw new Error("请确认待校对的字幕片段后保存。");
				if (
					!cue.text.trim() ||
					cue.start === null ||
					cue.end === null ||
					!Number.isFinite(cue.start) ||
					!Number.isFinite(cue.end) ||
					cue.start < 0 ||
					cue.end <= cue.start ||
					cue.end > this.snapshot.duration
				)
					throw new Error("请补全字幕文字与有效时间，或删除未使用的片段。");
				return { ...cue, start: cue.start, end: cue.end };
			})
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
		draft.duration > 600 ||
		typeof draft.complete !== "boolean" ||
		!Array.isArray(draft.cues) ||
		!draft.cues.every(cueValid) ||
		!Array.isArray(draft.results) ||
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
	return draft;
}
