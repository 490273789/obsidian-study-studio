import {
	emptyShadowDocument,
	makeShadowCue,
	parseShadowSubtitleImport,
	type ShadowSubtitleCue,
	type ShadowSubtitleDocument,
	type ShadowTranscriptionCue,
} from "./shadowSubtitles";

export interface ShadowVideoSource {
	id: string;
	path: string;
	name?: string;
}
export interface ShadowSubtitleJobConfig {
	serviceSignature: string;
	sourceSignature: string;
}
export interface ShadowAudioChunk {
	audio: ArrayBuffer;
	duration: number;
	totalDuration: number;
	sourceSignature: string;
}
export interface ShadowSubtitleCheckpoint {
	source: ShadowVideoSource;
	config: ShadowSubtitleJobConfig;
	nextOffset: number;
	totalDuration: number;
	status: "queued" | "running" | "paused" | "failed" | "complete";
	error: string | null;
}
export interface ShadowSubtitleStore {
	load(sourceId: string): Promise<ShadowSubtitleDocument | null>;
	save(document: ShadowSubtitleDocument): Promise<void>;
	loadCheckpoints(): ShadowSubtitleCheckpoint[];
	saveCheckpoints(checkpoints: ShadowSubtitleCheckpoint[]): void;
}
export interface VideoSubtitleJobsPorts {
	extract(
		source: ShadowVideoSource,
		offset: number,
		signal: AbortSignal,
	): Promise<ShadowAudioChunk>;
	transcribe(
		audio: ArrayBuffer,
		task: ShadowSubtitleCheckpoint,
		signal: AbortSignal,
	): Promise<readonly ShadowTranscriptionCue[]>;
	translate?(text: string, task: ShadowSubtitleCheckpoint, signal: AbortSignal): Promise<string>;
	store: ShadowSubtitleStore;
	serviceSignature?(source: ShadowVideoSource): string | Promise<string>;
	reportError?(error: unknown): void;
}
export interface VideoSubtitleJobsSnapshot {
	documents: Readonly<Record<string, ShadowSubtitleDocument>>;
	tasks: readonly ShadowSubtitleCheckpoint[];
	translationFailures: Readonly<Record<string, string>>;
}
/** A detached snapshot. Its version is meaningful only to the jobs owner that issued it. */
export interface ShadowSubtitleEditTarget {
	readonly sourceId: string;
	readonly cueId: string;
	readonly text: string;
	readonly translation: string;
	readonly version: string;
}
export class ShadowSubtitleEditConflict extends Error {
	constructor() {
		super("字幕已变化，请重新打开修正。");
		this.name = "ShadowSubtitleEditConflict";
	}
}
interface CueState {
	readonly identity: object;
	readonly version: string;
}
type CueEditPatch = Partial<Pick<ShadowSubtitleCue, "text" | "translation">>;
/** Plugin-lifetime owner. No view or DOM ownership; callbacks receive cancellable work. */
export class VideoSubtitleJobs {
	private documents: Record<string, ShadowSubtitleDocument> = {};
	private tasks: ShadowSubtitleCheckpoint[];
	private listeners = new Set<() => void>();
	private controller: AbortController | null = null;
	private activeId: string | null = null;
	private activeDone: Promise<void> | null = null;
	private finishActive: (() => void) | null = null;
	private disposed = false;
	private documentTransactions = new Map<string, Promise<unknown>>();
	private cueStates = new WeakMap<ShadowSubtitleCue, CueState>();
	private nextCueVersion = 0;
	private translations: Promise<void> = Promise.resolve();
	private translationFailures: Record<string, string> = {};
	private lifetimeController = new AbortController();
	private snapshot: VideoSubtitleJobsSnapshot;
	constructor(private readonly ports: VideoSubtitleJobsPorts) {
		this.tasks = ports.store.loadCheckpoints().map((task) => ({
			...task,
			status: task.status === "complete" ? "complete" : "paused",
		}));
		this.snapshot = {
			documents: {},
			tasks: structuredClone(this.tasks),
			translationFailures: {},
		};
	}
	getSnapshot = (): VideoSubtitleJobsSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	getCues(id: string): readonly ShadowSubtitleCue[] {
		return this.snapshot.documents[id]?.cues ?? [];
	}
	getCueEditTarget(sourceId: string, cueId: string): ShadowSubtitleEditTarget | null {
		const cue = this.documents[sourceId]?.cues.find((item) => item.id === cueId);
		if (!cue) return null;
		return Object.freeze({
			sourceId,
			cueId,
			text: cue.text,
			translation: cue.translation,
			version: this.cueStates.get(cue)!.version,
		});
	}
	async restore(id: string): Promise<void> {
		await this.documentTransaction(id, async () => {
			if (this.documents[id]) return;
			const document = await this.ports.store.load(id);
			if (!this.disposed) {
				this.acceptDocument(id, structuredClone(document ?? emptyShadowDocument(id)));
				this.publish();
			}
		});
	}
	/** Reconcile an external vault edit after pausing this source's current work. */
	async reloadSource(id: string): Promise<void> {
		this.pause(id);
		if (this.activeId === id) await this.activeDone;
		await this.translations;
		await this.documentTransaction(id, async () => {
			if (this.disposed) return;
			const document = (await this.ports.store.load(id)) ?? emptyShadowDocument(id);
			if (this.disposed) return;
			this.acceptDocument(id, structuredClone(document));
			delete this.translationFailures[id];
			this.tasks = this.tasks.filter(
				(item) => item.source.id !== id || item.status === "complete",
			);
			this.publish();
		});
	}
	async start(source: ShadowVideoSource, config: ShadowSubtitleJobConfig): Promise<void> {
		await this.restore(source.id);
		await this.documentTransaction(source.id, async () => {
			if (this.disposed) return;
			const existing = this.tasks.find((task) => task.source.id === source.id);
			if (existing && (existing.status === "running" || existing.status === "queued")) return;
			const document = this.cloneDocument(this.documents[source.id]!);
			document.candidate = document.cues.length ? [] : null;
			await this.saveDocument(source.id, document);
			if (existing) this.tasks = this.tasks.filter((task) => task !== existing);
			this.tasks.push({
				source: { ...source },
				config: { ...config },
				nextOffset: 0,
				totalDuration: 0,
				status: this.disposed ? "paused" : "queued",
				error: null,
			});
			this.publish();
		});
		void this.pump();
	}
	pause(id: string): void {
		const task = this.tasks.find((item) => item.source.id === id);
		if (!task || task.status === "complete") return;
		task.status = "paused";
		if (this.activeId === id) this.controller?.abort();
		this.publish();
	}
	async resume(id: string): Promise<void> {
		const task = this.tasks.find((item) => item.source.id === id);
		if (!task || task.status === "complete" || task.status === "running") return;
		if (
			this.ports.serviceSignature &&
			(await this.ports.serviceSignature(task.source)) !== task.config.serviceSignature
		) {
			task.status = "failed";
			task.error = "转写或翻译服务配置已变化，请重新生成字幕。";
			this.publish();
			return;
		}
		if (this.disposed) return;
		task.status = "queued";
		task.error = null;
		this.publish();
		void this.pump();
	}
	async importSubtitles(
		id: string,
		text: string,
		format: "srt" | "vtt",
		role: "original" | "translation" | "bilingual" = "original",
	): Promise<void> {
		await this.restore(id);
		this.pause(id);
		const imported = parseShadowSubtitleImport(text, format);
		if (role === "bilingual") {
			for (const cue of imported) {
				const lines = cue.text.split("\n").map((line) => line.trim());
				if (
					lines.length !== 2 ||
					!/[A-Za-z]/.test(lines[0]!) ||
					/[\u3400-\u9FFF]/.test(lines[0]!) ||
					!/[\u3400-\u9FFF]/.test(lines[1]!)
				)
					throw new Error(
						"双语字幕须每条恰有两行：第一行英文，第二行中文；请先手动整理字幕。",
					);
				cue.text = lines[0]!;
				cue.translation = lines[1]!;
				cue.translationEdited = true;
			}
		}
		await this.documentTransaction(id, async () => {
			const document = this.cloneDocument(this.documents[id]!);
			if (role !== "translation") document.candidate = imported;
			else {
				if (!document.cues.length) throw new Error("请先导入原文字幕，再导入翻译。");
				if (
					imported.some(
						(item) =>
							!document.cues.some(
								(cue) =>
									Math.abs(item.start - cue.start) < 0.25 &&
									Math.abs(item.end - cue.end) < 0.25,
							),
					)
				)
					throw new Error("部分翻译字幕无法按时间匹配，请先调整时间。");
				document.candidate = structuredClone(document.cues);
				for (const cue of document.candidate) {
					const match = imported.find(
						(item) =>
							Math.abs(item.start - cue.start) < 0.25 &&
							Math.abs(item.end - cue.end) < 0.25,
					);
					if (match) {
						cue.translation = match.text;
						cue.translationEdited = true;
					}
				}
			}
			document.revision++;
			await this.saveDocument(id, document);
		});
	}
	async adoptCandidate(id: string): Promise<void> {
		await this.documentTransaction(id, async () => {
			const current = this.documents[id];
			if (!current?.candidate) return;
			const task = this.tasks.find((item) => item.source.id === id);
			if (task && (task.status === "running" || task.status === "queued"))
				throw new Error("请等待生成结束或暂停后采用字幕。");
			const document = this.cloneDocument(current);
			document.previous = document.cues;
			document.cues = document.candidate!;
			document.candidate = null;
			document.revision++;
			await this.saveDocument(id, document, true);
		});
	}
	async restorePrevious(id: string): Promise<void> {
		await this.documentTransaction(id, async () => {
			const current = this.documents[id];
			if (!current?.previous) return;
			this.pause(id);
			const document = this.cloneDocument(current);
			const cues = document.cues;
			document.cues = document.previous!;
			document.previous = cues;
			document.revision++;
			await this.saveDocument(id, document, true);
		});
	}
	async saveCueEdit(target: ShadowSubtitleEditTarget, patch: CueEditPatch): Promise<void> {
		const { sourceId, cueId, version } = target;
		const acceptedPatch = { ...patch };
		await this.documentTransaction(sourceId, async () => {
			const current = this.documents[sourceId];
			const currentCue = current?.cues.find((item) => item.id === cueId);
			if (!currentCue || this.cueStates.get(currentCue)?.version !== version)
				throw new ShadowSubtitleEditConflict();
			const document = this.cloneDocument(current!);
			const cue = document.cues.find((item) => item.id === cueId)!;
			if (acceptedPatch.text !== undefined) {
				cue.text = acceptedPatch.text;
				if (!cue.translationEdited && acceptedPatch.translation === undefined)
					cue.translation = "";
				cue.textEdited = true;
				cue.revision++;
			}
			if (acceptedPatch.translation !== undefined) {
				cue.translation = acceptedPatch.translation;
				cue.translationEdited = true;
			}
			document.revision++;
			await this.saveDocument(sourceId, document);
		});
	}
	async translateSubtitles(
		source: ShadowVideoSource,
		config: ShadowSubtitleJobConfig,
	): Promise<void> {
		await this.restore(source.id);
		const existing = this.tasks.find((task) => task.source.id === source.id);
		if (existing && existing.config.serviceSignature !== config.serviceSignature) {
			if (existing.status !== "complete")
				throw new Error("服务配置已变化，请完成或重新生成字幕任务。");
			existing.config = { ...config };
		}
		if (!existing)
			this.tasks.push({
				source: { ...source },
				config: { ...config },
				nextOffset: 0,
				totalDuration: 0,
				status: "complete",
				error: null,
			});
		this.publish();
		await this.retryTranslation(source.id);
	}
	async retryTranslation(id: string): Promise<void> {
		await this.restore(id);
		const document = this.documents[id]!;
		const task = this.tasks.find((item) => item.source.id === id);
		if (!task) throw new Error("请先选择翻译配置。");
		if (
			this.ports.serviceSignature &&
			(await this.ports.serviceSignature(task.source)) !== task.config.serviceSignature
		)
			throw new Error("翻译服务配置已变化，请重新选择配置。");
		for (const cue of document.candidate ?? document.cues)
			if (!cue.translation && !cue.translationEdited)
				this.queueTranslation(id, cue, task, this.lifetimeController.signal);
		await this.translations;
	}
	dispose(): void {
		this.disposed = true;
		this.lifetimeController.abort();
		this.controller?.abort();
		for (const task of this.tasks)
			if (task.status === "running" || task.status === "queued") task.status = "paused";
		this.publish();
		this.listeners.clear();
	}
	private publish(): void {
		try {
			this.ports.store.saveCheckpoints(structuredClone(this.tasks));
		} catch (error) {
			this.reportPublicationError(error);
		}
		this.snapshot = structuredClone({
			documents: this.documents,
			tasks: this.tasks,
			translationFailures: this.translationFailures,
		});
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				this.reportPublicationError(error);
			}
		}
	}
	private reportPublicationError(error: unknown): void {
		try {
			if (this.ports.reportError) this.ports.reportError(error);
			else console.error("Video subtitle publication failed", error);
		} catch (reportError) {
			console.error("Video subtitle error reporting failed", reportError, error);
		}
	}
	/** Holds the source's committed document stable through disk I/O, including failed writes. */
	private documentTransaction<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const next = (this.documentTransactions.get(id) ?? Promise.resolve())
			.catch(() => undefined)
			.then(operation);
		this.documentTransactions.set(id, next);
		return next;
	}
	private cloneDocument(document: ShadowSubtitleDocument): ShadowSubtitleDocument {
		const clone = structuredClone(document);
		for (const key of ["cues", "candidate", "previous"] as const) {
			const original = document[key];
			const copied = clone[key];
			if (!original || !copied) continue;
			for (let index = 0; index < original.length; index++) {
				const state = this.cueStates.get(original[index]!);
				if (state) this.cueStates.set(copied[index]!, state);
			}
		}
		return clone;
	}
	private allCues(document: ShadowSubtitleDocument): ShadowSubtitleCue[] {
		return [...document.cues, ...(document.candidate ?? []), ...(document.previous ?? [])];
	}
	private acceptDocument(
		id: string,
		document: ShadowSubtitleDocument,
		replaceActive = false,
	): void {
		const previous = this.documents[id];
		const originals = new Map(
			(previous ? this.allCues(previous) : []).map((cue) => [
				this.cueStates.get(cue)!.identity,
				cue,
			]),
		);
		const replaced = new Set(replaceActive ? document.cues : []);
		for (const cue of new Set(this.allCues(document))) {
			const state = this.cueStates.get(cue);
			const original = state && originals.get(state.identity);
			if (!original || !sameCue(original, cue) || replaced.has(cue))
				this.cueStates.set(cue, {
					identity: state?.identity ?? {},
					version: String(++this.nextCueVersion),
				});
		}
		this.documents[id] = document;
	}
	/** Only call inside documentTransaction; an uncommitted draft never enters shared state. */
	private async saveDocument(
		id: string,
		document: ShadowSubtitleDocument,
		replaceActive = false,
	): Promise<void> {
		await this.ports.store.save(document);
		this.acceptDocument(id, document, replaceActive);
		this.publish();
	}
	private async pump(): Promise<void> {
		if (this.activeId || this.disposed) return;
		const task = this.tasks.find((item) => item.status === "queued");
		if (!task) return;
		this.activeId = task.source.id;
		this.activeDone = new Promise<void>((resolve) => {
			this.finishActive = resolve;
		});
		const controller = new AbortController();
		this.controller = controller;
		task.status = "running";
		this.publish();
		try {
			await this.restore(task.source.id);
			while (!controller.signal.aborted && !this.disposed) {
				const chunk = await this.retry(
					() => this.ports.extract(task.source, task.nextOffset, controller.signal),
					controller.signal,
				);
				if (chunk.sourceSignature !== task.config.sourceSignature)
					throw new Error("视频文件已变化，请重新生成字幕。");
				const cues = await this.retry(
					() => this.ports.transcribe(chunk.audio, task, controller.signal),
					controller.signal,
				);
				if (controller.signal.aborted || this.disposed) break;
				const complete = await this.documentTransaction(task.source.id, async () => {
					if (controller.signal.aborted || this.disposed) return false;
					const document = this.cloneDocument(this.documents[task.source.id]!);
					const target = document.candidate ?? document.cues;
					const added: ShadowSubtitleCue[] = [];
					for (const raw of cues) {
						if (
							!Number.isFinite(raw.start) ||
							!Number.isFinite(raw.end) ||
							raw.start < 0 ||
							raw.end <= raw.start ||
							!raw.text.trim()
						)
							continue;
						const start = task.nextOffset + raw.start;
						const end = Math.min(task.nextOffset + raw.end, chunk.totalDuration);
						if (
							end <= start ||
							target.some(
								(cue) =>
									Math.abs(cue.start - start) < 1 &&
									cue.text.trim() === raw.text.trim(),
							)
						)
							continue;
						const cue = makeShadowCue(`generated-${task.nextOffset}-${target.length}`, {
							start,
							end,
							text: raw.text,
						});
						target.push(cue);
						added.push(cue);
					}
					target.sort((a, b) => a.start - b.start);
					document.revision++;
					await this.saveDocument(task.source.id, document);
					for (const cue of added)
						this.queueTranslation(task.source.id, cue, task, controller.signal);
					task.totalDuration = chunk.totalDuration;
					const done = task.nextOffset + chunk.duration >= chunk.totalDuration - 0.01;
					task.nextOffset = done
						? chunk.totalDuration
						: task.nextOffset + Math.max(1, chunk.duration - 1);
					this.publish();
					return done;
				});
				if (complete) {
					await this.translations;
					task.status = "complete";
					break;
				}
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				task.status = "failed";
				task.error = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (task.status === "running") task.status = "paused";
			this.activeId = null;
			this.controller = null;
			this.finishActive?.();
			this.finishActive = null;
			this.activeDone = null;
			this.publish();
			void this.pump();
		}
	}
	private queueTranslation(
		id: string,
		cue: ShadowSubtitleCue,
		task: ShadowSubtitleCheckpoint,
		signal: AbortSignal,
	): void {
		if (!this.ports.translate) return;
		const identity = this.cueStates.get(cue)!.identity;
		const revision = cue.revision;
		const text = cue.text;
		this.translations = this.translations.then(async () => {
			if (signal.aborted || this.disposed) return;
			try {
				const translation = await this.ports.translate!(text, task, signal);
				if (!translation.trim()) throw new Error("翻译服务返回了空内容，请重试。");
				await this.documentTransaction(id, async () => {
					if (signal.aborted || this.disposed) return;
					const document = this.cloneDocument(this.documents[id]!);
					const currentCue = this.allCues(document).find(
						(item) => this.cueStates.get(item)?.identity === identity,
					);
					if (
						!currentCue ||
						currentCue.revision !== revision ||
						currentCue.translationEdited
					)
						return;
					currentCue.translation = translation;
					document.revision++;
					await this.saveDocument(id, document);
					const remaining = document.candidate ?? document.cues;
					if (remaining.every((item) => !!item.translation || item.translationEdited)) {
						delete this.translationFailures[id];
						this.publish();
					}
				});
			} catch (error) {
				if (!signal.aborted && !this.disposed) {
					this.translationFailures[id] =
						error instanceof Error ? error.message : String(error);
					this.publish();
				}
			}
		});
	}
	private async retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			if (signal.aborted) throw new Error("已取消");
			try {
				return await operation();
			} catch (error) {
				const status = (error as { status?: number })?.status;
				if (
					signal.aborted ||
					attempt >= 2 ||
					(status !== undefined && status !== 408 && status !== 429 && status < 500)
				)
					throw error;
			}
		}
	}
}

function sameCue(left: ShadowSubtitleCue, right: ShadowSubtitleCue): boolean {
	return (
		left.id === right.id &&
		left.start === right.start &&
		left.end === right.end &&
		left.text === right.text &&
		left.translation === right.translation &&
		left.revision === right.revision &&
		left.textEdited === right.textEdited &&
		left.translationEdited === right.translationEdited
	);
}
