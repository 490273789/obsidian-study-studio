import type { VideoPlayerRuntime } from "./videoPlayerRuntime";
import type { ShadowVideoSource, VideoSubtitleJobs } from "./shadowSubtitlesJobs";
import { VideoSubtitleDrafts } from "./videoSubtitleDrafts";
import type {
	ShadowPracticeRecord,
	ShadowPracticeRecords,
} from "../obsidian/shadowPracticeRecords";
import type {
	ShadowingCueRow,
	ShadowingMode,
	ShadowingRange,
	ShadowingRecordRow,
	ShadowingTake,
	ShadowingWorkspaceViewAction,
	ShadowingWorkspaceState,
	ShadowRecorderPort,
	TakeAudioPlayerPort,
	VideoPlaybackRate,
} from "./types";

export interface ShadowingWorkspaceSessionOptions {
	readonly runtime: VideoPlayerRuntime;
	readonly jobs: VideoSubtitleJobs;
	readonly records: ShadowPracticeRecords;
	readonly recorder: ShadowRecorderPort;
	readonly audioPlayer?: TakeAudioPlayerPort;
	readonly now?: () => number;
	readEnabled(sourceId: string): boolean;
	writeEnabled(sourceId: string, enabled: boolean): void;
	reportDetachedFailure?(error: unknown): void;
}

interface SourceSelection {
	anchor: string | null;
	end: string | null;
	start: number;
	finish: number;
}

/**
 * Deep domain authority for video shadowing.
 * Owns subtitle jobs coordination, cue range selection and drafts, practice loop/recording state,
 * saved takes persistence, audio replay, and race tokens behind a small snapshot + act interface.
 */
export class ShadowingWorkspaceSession {
	private readonly subtitleDrafts: VideoSubtitleDrafts;
	private readonly sources = new Map<string, SourceSelection>();
	private snapshot: ShadowingWorkspaceState;
	private readonly listeners = new Set<() => void>();
	private readonly cleanup: Array<() => void> = [];
	private sourceId: string | null;
	private records: ShadowPracticeRecord[] = [];
	private recordsView: readonly ShadowingRecordRow[] = Object.freeze([]);
	private error: string | null = null;
	private loadToken = 0;
	private activityToken = 0;
	private disposed = false;
	private readonly audioPlayer?: TakeAudioPlayerPort;

	private practicePhase: ShadowingWorkspaceState["practicePhase"] = "idle";
	private practiceRange: ShadowingRange | null = null;
	private practiceMode: ShadowingMode = "shadow";
	private countdown = 0;
	private restSeconds = 2;
	private responseMultiplier = 1;
	private temporaryTake: ShadowingTake | null = null;
	private practiceError: string | null = null;
	private readonly savingTakes = new Map<string, Promise<void>>();
	private readonly failedTakeSaves = new Map<string, ShadowingTake>();
	private failedSavesView: ShadowingWorkspaceState["failedSaves"] = Object.freeze([]);
	private practiceGeneration = 0;
	private practiceTimer: ReturnType<typeof setTimeout> | null = null;
	private cancelPracticeWait: (() => void) | null = null;
	private watchRate: VideoPlaybackRate;

	constructor(private readonly options: ShadowingWorkspaceSessionOptions) {
		const current = options.runtime.getSnapshot();
		this.sourceId = current.currentSourceId;
		this.watchRate = current.playbackRate;
		this.audioPlayer = options.audioPlayer;
		this.subtitleDrafts = new VideoSubtitleDrafts(
			options.jobs,
			() => this.publish(),
			(error) => options.reportDetachedFailure?.(error),
		);
		this.subtitleDrafts.activate(this.sourceId);

		this.snapshot = this.makeSnapshot();
		this.cleanup.push(options.runtime.subscribe(() => this.onRuntimeChanged()));
		this.cleanup.push(
			options.runtime.subscribeInterruptions(() => {
				if (["playing", "resting", "countdown", "recording"].includes(this.practicePhase)) {
					this.stopPractice();
				}
			}),
		);
		this.cleanup.push(options.jobs.subscribe(() => this.publish()));

		if (this.sourceId && options.readEnabled(this.sourceId)) {
			void this.loadSource(this.sourceId);
		}
	}

	getSnapshot = (): ShadowingWorkspaceState => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	async setEnabled(enabled: boolean): Promise<void> {
		const id = this.sourceId;
		if (!id || this.options.readEnabled(id) === enabled) return;
		this.options.writeEnabled(id, enabled);
		if (enabled) {
			void this.loadSource(id);
		} else {
			this.loadToken++;
			this.activityToken++;
			this.audioPlayer?.stop();
			if (this.practiceRange) {
				const wasPlaying = this.options.runtime.getSnapshot().playing;
				this.leavePractice({ seekToEnd: false, publish: false });
				if (wasPlaying) {
					await this.options.runtime
						.play()
						.catch((error: unknown) => this.showError(error));
				}
			}
			this.setRecords([]);
			this.error = null;
		}
		this.publish();
	}

	clearSubtitleDrafts(): void {
		this.subtitleDrafts.clear();
		this.publish();
	}

	async stopForPresenterLoss(): Promise<void> {
		this.activityToken++;
		if (this.practicePhase !== "idle" && this.practicePhase !== "paused") {
			this.stopPractice();
		}
		this.audioPlayer?.stop();
	}

	async refreshRecords(sourceId: string): Promise<void> {
		await this.reloadRecords(sourceId);
	}

	/** One view intent surface; completion includes immediate work, not an ongoing practice loop. */
	async act(action: ShadowingWorkspaceViewAction): Promise<void> {
		switch (action.type) {
			case "generate":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.start(this.sourceFor(this.sourceId));
				});
			case "translate-imported":
				return this.run(async () => {
					if (this.sourceId) {
						await this.options.jobs.translateSubtitles(this.sourceFor(this.sourceId));
					}
				});
			case "retry-translation":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.retryTranslation(this.sourceId);
				});
			case "reload-subtitles":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.reloadSource(this.sourceId);
				});
			case "pause-generation":
				if (this.sourceId) this.options.jobs.pause(this.sourceId);
				return;
			case "resume-generation":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.resume(this.sourceId);
				});
			case "import-file":
				return this.run(async () => {
					const id = this.sourceId;
					if (!id) return;
					const format = action.file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
					await this.options.jobs.importSubtitles(
						id,
						await action.file.text(),
						format,
						action.role,
					);
				});
			case "adopt-candidate":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.adoptCandidate(this.sourceId);
				});
			case "restore-previous":
				return this.run(async () => {
					if (this.sourceId) await this.options.jobs.restorePrevious(this.sourceId);
				});
			case "select-range":
				if (this.sourceId) {
					this.selectPracticeRange(this.sourceId, action.start, action.end, action.text);
				}
				return;
			case "choose-cue":
				this.chooseCue(action.cueId, action.extend);
				return;
			case "set-cue-range":
				this.setCueRange(action.edge, action.seconds);
				return;
			case "toggle-cue-editor":
				this.subtitleDrafts.toggle(
					this.snapshot.selectedCueIds.length === 1
						? this.snapshot.selectedCueIds[0]!
						: null,
				);
				return;
			case "set-cue-field":
			case "save-cue-edit":
			case "request-cue-reload":
			case "cancel-cue-reload":
			case "confirm-cue-reload":
			case "discard-deleted-draft":
				return this.subtitleDrafts.act(action);
			case "start-practice-selected":
				this.startPracticeSelected();
				return;
			case "seek-to":
				this.options.runtime.seekTo(action.seconds);
				return;
			case "set-mode":
				this.setMode(action.mode);
				return;
			case "set-rest-seconds":
				this.setRestSeconds(action.seconds);
				return;
			case "set-response-multiplier":
				this.setResponseMultiplier(action.multiplier);
				return;
			case "continue-early":
				this.continueEarly();
				return;
			case "start-loop":
				this.startLoop();
				return;
			case "stop-practice":
				this.stopPractice();
				return;
			case "record-once":
				this.recordOnce();
				return;
			case "replay-take":
				this.replayTake();
				return;
			case "replay-original":
				this.replayOriginal();
				return;
			case "save-take":
				return this.run(() => this.saveTake());
			case "retry-save":
				return this.run(() =>
					this.saveTake(this.failedTakeSaves.get(action.takeId) ?? null),
				);
			case "continue-watching":
				this.leavePractice();
				return this.options.runtime.play().catch((error: unknown) => this.showError(error));
			case "mark-difficult":
				return this.run(async () => {
					const range = this.practiceRange;
					if (!range) return;
					await this.options.records.markDifficult(
						range.sourceId,
						range.start,
						range.end,
						range.text ?? "",
					);
					await this.reloadRecords(range.sourceId);
				});
			case "open-record":
				return this.run(() => this.openRecord(action.record));
			case "delete-record":
				return this.run(async () => {
					if (!this.sourceId) return;
					await this.options.records.remove(this.sourceId, action.record.id);
					await this.reloadRecords(this.sourceId);
				});
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.loadToken++;
		this.activityToken++;
		for (const release of this.cleanup) release();
		this.leavePractice({ publish: false });
		this.options.recorder.dispose();
		this.audioPlayer?.dispose?.();
		this.subtitleDrafts.dispose();
		this.sources.clear();
		this.listeners.clear();
	}

	private sourceFor(sourceId: string): ShadowVideoSource {
		const source = this.options.runtime
			.getSnapshot()
			.sources.find((item) => item.id === sourceId);
		if (!source) throw new Error("请先选择视频。");
		return source;
	}

	private chooseCue(cueId: string, extend: boolean): void {
		if (this.disposed || !this.sourceId) return;
		const state = this.currentSelection();
		const cues = this.snapshot.cues;
		const cue = cues.find((item) => item.id === cueId);
		if (!state || !cue) return;
		const anchor = extend ? cues.find((item) => item.id === state.anchor) : null;
		state.anchor = anchor?.id ?? cueId;
		state.end = cueId;
		state.start = Math.min(anchor?.start ?? cue.start, cue.start);
		state.finish = Math.max(anchor?.end ?? cue.end, cue.end);
		this.subtitleDrafts.select(state.anchor === state.end ? cueId : null);
		if (!anchor) this.options.runtime.seekTo(cue.start);
		this.publish();
	}

	private setCueRange(edge: "start" | "end", seconds: number): void {
		if (this.disposed) return;
		const state = this.currentSelection();
		if (!state) return;
		if (edge === "start") state.start = seconds;
		else state.finish = seconds;
		this.publish();
	}

	private startPracticeSelected(): void {
		if (this.disposed || !this.snapshot.canPractice || !this.sourceId) return;
		const ids = new Set(this.snapshot.selectedCueIds);
		const text = this.snapshot.cues
			.filter((cue) => ids.has(cue.id))
			.map((cue) => cue.text)
			.join(" ");
		this.selectPracticeRange(
			this.sourceId,
			this.snapshot.rangeStart,
			this.snapshot.rangeEnd,
			text,
		);
	}

	private currentSelection(): SourceSelection | null {
		if (!this.sourceId) return null;
		let state = this.sources.get(this.sourceId);
		if (!state) {
			state = {
				anchor: null,
				end: null,
				start: 0,
				finish: 0,
			};
			this.sources.set(this.sourceId, state);
		}
		return state;
	}

	private onRuntimeChanged(): void {
		const current = this.options.runtime.getSnapshot();
		if (current.currentSourceId !== this.sourceId) {
			this.loadToken++;
			this.activityToken++;
			this.audioPlayer?.stop();
			this.sourceId = current.currentSourceId;
			this.leavePractice({ publish: false });
			this.subtitleDrafts.activate(this.sourceId);
			this.setRecords([]);
			this.error = null;
			if (this.sourceId && this.options.readEnabled(this.sourceId)) {
				void this.loadSource(this.sourceId);
			}
		}
		if (current.error && this.practicePhase !== "idle" && this.practicePhase !== "paused") {
			this.stopPractice({ publish: false });
			this.practiceError = "视频播放失败，请重试";
		}
		this.publish();
	}

	private async loadSource(sourceId: string): Promise<void> {
		const token = ++this.loadToken;
		try {
			await this.options.jobs.restore(sourceId);
			const records = await this.options.records.list(sourceId);
			if (this.disposed || token !== this.loadToken || sourceId !== this.sourceId) return;
			this.setRecords(records);
			this.publish();
		} catch (error) {
			if (!this.disposed && token === this.loadToken) this.showError(error);
		}
	}

	private async reloadRecords(sourceId: string): Promise<void> {
		const records = await this.options.records.reload(sourceId);
		if (this.disposed || sourceId !== this.sourceId) return;
		this.setRecords(records);
		this.publish();
	}

	private setRecords(records: ShadowPracticeRecord[]): void {
		this.records = records;
		this.recordsView = Object.freeze(
			records.map((item): ShadowingRecordRow => ({
				id: item.id,
				start: item.start,
				end: item.end,
				text: item.text,
				kind: item.kind,
				createdAt: item.createdAt,
				playbackRate: item.playbackRate,
			})),
		);
	}

	private refreshFailedSaves(): void {
		this.failedSavesView = Object.freeze(
			[...this.failedTakeSaves.values()].map((take) => ({
				id: take.id,
				sourceId: take.range.sourceId,
				start: take.range.start,
				end: take.range.end,
				text: take.range.text ?? "",
			})),
		);
	}

	private async openRecord(record: ShadowingRecordRow): Promise<void> {
		const sourceId = this.sourceId;
		if (!sourceId) return;
		const token = ++this.activityToken;
		const saved = this.records.find((item) => item.id === record.id);
		if (!saved) return;
		this.selectPracticeRange(saved.sourceId, saved.start, saved.end, saved.text);
		this.options.runtime.seekTo(saved.start);
		if (saved.kind !== "recording") return;
		const data = await this.options.records.readTake(saved);
		if (token !== this.activityToken || sourceId !== this.sourceId) return;
		if (this.audioPlayer) {
			await this.audioPlayer.play(data, saved.mimeType ?? "audio/webm");
		}
	}

	private selectPracticeRange(sourceId: string, start: number, end: number, text?: string): void {
		if (this.disposed) return;
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
			this.practiceError = "请选择有效的练习范围";
			this.publish();
			return;
		}
		if (!this.practiceRange) {
			this.watchRate = this.options.runtime.getSnapshot().playbackRate;
		}
		this.stopPractice({ publish: false });
		this.practiceRange = { sourceId, start, end, text };
		this.practicePhase = "paused";
		this.practiceError = null;
		this.publish();
	}

	private setMode(mode: ShadowingMode): void {
		if (mode === this.practiceMode) return;
		this.stopPractice({ publish: false });
		this.practiceMode = mode;
		this.publish();
	}

	private setRestSeconds(seconds: number): void {
		if (!Number.isFinite(seconds)) return;
		this.restSeconds = Math.max(0, Math.min(60, seconds));
		this.publish();
	}

	private setResponseMultiplier(multiplier: number): void {
		if (!Number.isFinite(multiplier)) return;
		this.responseMultiplier = Math.max(0.25, Math.min(4, multiplier));
		this.publish();
	}

	/** Finish the current response/rest window early, without interrupting active media. */
	private continueEarly(): void {
		if (this.practicePhase !== "resting") return;
		if (this.practiceTimer !== null) clearTimeout(this.practiceTimer);
		this.practiceTimer = null;
		this.cancelPracticeWait?.();
		this.cancelPracticeWait = null;
	}

	private startLoop(): void {
		const range = this.validPracticeRange();
		if (!range) return;
		this.stopPractice({ publish: false });
		const token = this.practiceGeneration;
		this.practiceError = null;
		this.publish();
		void this.runPracticeLoop(token, range).catch((error: unknown) =>
			this.failPractice(token, error),
		);
	}

	private stopPractice({ publish = true }: { publish?: boolean } = {}): void {
		this.practiceGeneration++;
		if (this.practiceTimer !== null) clearTimeout(this.practiceTimer);
		this.practiceTimer = null;
		this.cancelPracticeWait?.();
		this.cancelPracticeWait = null;
		// Update phase before runtime.pause() so synchronous interruption callbacks do not re-enter.
		this.practicePhase = this.practiceRange ? "paused" : "idle";
		this.countdown = 0;
		this.options.recorder.cancel();
		this.options.runtime.stopRange();
		this.options.runtime.pause();
		this.practicePhase = this.practiceRange ? "paused" : "idle";
		this.countdown = 0;
		if (publish) this.publish();
	}

	private recordOnce(): void {
		const range = this.validPracticeRange();
		if (!range) return;
		this.stopPractice({ publish: false });
		const token = this.practiceGeneration;
		this.temporaryTake = null;
		this.practiceError = null;
		this.publish();
		void this.runRecording(token, range).catch((error: unknown) =>
			this.failPractice(token, error),
		);
	}

	private replayTake(): void {
		const take = this.temporaryTake;
		if (!take) return;
		this.stopPractice({ publish: false });
		const token = this.practiceGeneration;
		this.practicePhase = "review";
		this.practiceError = null;
		this.publish();
		void this.options.recorder
			.play(take.blob)
			.catch((error: unknown) => this.failPractice(token, error));
	}

	private replayOriginal(): void {
		const take = this.temporaryTake;
		const range = take?.range ?? this.validPracticeRange();
		if (!range || range.sourceId !== this.options.runtime.getSnapshot().currentSourceId) return;
		this.stopPractice({ publish: false });
		if (take) this.options.runtime.setPlaybackRate(take.playbackRate);
		const token = this.practiceGeneration;
		this.practicePhase = "playing";
		this.publish();
		void this.options.runtime
			.playRange(range.start, range.end)
			.then(() => {
				if (!this.isPracticeActive(token)) return;
				this.practicePhase = this.temporaryTake ? "review" : "paused";
				this.publish();
			})
			.catch((error: unknown) => this.failPractice(token, error));
	}

	private saveTake(take: ShadowingTake | null = this.temporaryTake): Promise<void> {
		if (!take) return Promise.resolve();
		const existing = this.savingTakes.get(take.id);
		if (existing) return existing;
		// Capture the take before starting I/O: leave/switch/discard cannot revoke an accepted save.
		const save = Promise.resolve()
			.then(async () => {
				await this.options.records.saveTake(take);
				await this.reloadRecords(take.range.sourceId);
			})
			.then(
				() => {
					this.failedTakeSaves.delete(take.id);
				},
				(error: unknown) => {
					this.failedTakeSaves.set(take.id, take);
					this.practiceError = errorMessage(error);
				},
			)
			.finally(() => {
				this.savingTakes.delete(take.id);
				this.refreshFailedSaves();
				this.publish();
			});
		this.savingTakes.set(take.id, save);
		this.practiceError = null;
		this.publish();
		return save;
	}

	private leavePractice({
		seekToEnd = true,
		publish = true,
	}: { seekToEnd?: boolean; publish?: boolean } = {}): void {
		const range = this.practiceRange;
		this.stopPractice({ publish: false });
		this.practiceRange = null;
		this.temporaryTake = null;
		this.practicePhase = "idle";
		this.practiceError = null;
		if (range?.sourceId === this.options.runtime.getSnapshot().currentSourceId) {
			this.options.runtime.setPlaybackRate(this.watchRate);
			if (seekToEnd) this.options.runtime.seekTo(range.end);
		}
		if (publish) this.publish();
	}

	private validPracticeRange(): ShadowingRange | null {
		if (this.disposed) return null;
		const range = this.practiceRange;
		if (!range || range.sourceId !== this.options.runtime.getSnapshot().currentSourceId) {
			this.practiceError = "请先选择当前视频的练习片段";
			this.publish();
			return null;
		}
		return range;
	}

	private async runPracticeLoop(token: number, range: ShadowingRange): Promise<void> {
		while (this.isPracticeActive(token)) {
			this.practicePhase = "playing";
			this.publish();
			const rate = this.options.runtime.getSnapshot().playbackRate;
			const result = await this.options.runtime.playRange(range.start, range.end);
			if (!this.isPracticeActive(token)) return;
			if (result !== "completed") {
				this.stopPractice();
				return;
			}
			this.practicePhase = "resting";
			this.publish();
			const seconds =
				this.practiceMode === "repeat-after"
					? ((range.end - range.start) / rate) * this.responseMultiplier + 1
					: this.restSeconds;
			await this.waitPractice(seconds * 1000);
		}
	}

	private async runRecording(token: number, range: ShadowingRange): Promise<void> {
		for (let countdown = 3; countdown > 0; countdown--) {
			this.practicePhase = "countdown";
			this.countdown = countdown;
			this.publish();
			await this.waitPractice(1000);
			if (!this.isPracticeActive(token)) return;
		}
		const mode = this.practiceMode;
		const playbackRate = this.options.runtime.getSnapshot().playbackRate;
		if (mode === "repeat-after") {
			this.practicePhase = "playing";
			this.countdown = 0;
			this.publish();
			if (
				(await this.options.runtime.playRange(range.start, range.end)) !== "completed" ||
				!this.isPracticeActive(token)
			) {
				if (this.isPracticeActive(token)) this.stopPractice();
				return;
			}
		}
		await this.options.recorder.start();
		if (!this.isPracticeActive(token)) {
			this.options.recorder.cancel();
			return;
		}
		this.practicePhase = "recording";
		this.countdown = 0;
		this.publish();
		if (mode === "shadow") {
			if (
				(await this.options.runtime.playRange(range.start, range.end)) !== "completed" ||
				!this.isPracticeActive(token)
			) {
				if (this.isPracticeActive(token)) this.stopPractice();
				return;
			}
		} else {
			await this.waitPractice(
				(((range.end - range.start) / playbackRate) * this.responseMultiplier + 1) * 1000,
			);
		}
		if (!this.isPracticeActive(token)) return;
		const blob = await this.options.recorder.stop();
		if (!this.isPracticeActive(token)) return;
		if (!blob.size) throw new Error("未录到声音，请检查麦克风后重试");
		const createdAt = (this.options.now ?? Date.now)();
		this.practicePhase = "review";
		this.temporaryTake = {
			id: `take-${createdAt}-${this.practiceGeneration}`,
			range: { ...range },
			mode,
			playbackRate,
			createdAt,
			blob,
			mimeType: blob.type,
		};
		this.publish();
	}

	private waitPractice(milliseconds: number): Promise<void> {
		return new Promise((resolve) => {
			this.cancelPracticeWait = resolve;
			this.practiceTimer = setTimeout(() => {
				this.practiceTimer = null;
				this.cancelPracticeWait = null;
				resolve();
			}, milliseconds);
		});
	}

	private isPracticeActive(token: number): boolean {
		return !this.disposed && this.practiceGeneration === token;
	}

	private failPractice(token: number, error: unknown): void {
		if (!this.isPracticeActive(token)) return;
		this.stopPractice({ publish: false });
		this.practiceError = errorMessage(error);
		this.publish();
	}

	private async run(work: () => Promise<unknown>): Promise<void> {
		try {
			await work();
			this.error = null;
			this.publish();
		} catch (error) {
			this.showError(error);
		}
	}

	private showError(error: unknown): void {
		this.error = errorMessage(error);
		this.publish();
	}

	private publish(): void {
		if (this.disposed) return;
		const next = this.makeSnapshot();
		if (this.snapshot && sameSnapshot(this.snapshot, next)) return;
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}

	private makeSnapshot(): ShadowingWorkspaceState {
		const id = this.sourceId;
		const jobs = this.options.jobs.getSnapshot();
		const document = id ? jobs.documents[id] : undefined;
		const task = id ? jobs.tasks.find((item) => item.source.id === id) : undefined;
		const status =
			task?.status === "running"
				? "transcribing"
				: task?.status === "failed"
					? "error"
					: (task?.status ?? "idle");

		const state = id ? this.sources.get(id) : undefined;
		const runtime = this.options.runtime.getSnapshot();
		const cues = (document?.cues ?? []) as readonly ShadowingCueRow[];
		const first = cues.findIndex((cue) => cue.id === state?.anchor);
		const last = cues.findIndex((cue) => cue.id === state?.end);
		const selected =
			first < 0
				? []
				: cues.slice(
						Math.min(first, last < 0 ? first : last),
						Math.max(first, last < 0 ? first : last) + 1,
					);
		const start = state?.start ?? 0;
		const end = state?.finish ?? 0;
		const duration = runtime.duration;
		const canPractice =
			selected.length > 0 &&
			Number.isFinite(start) &&
			Number.isFinite(end) &&
			start >= 0 &&
			end > start &&
			(duration === null || end <= duration);

		return {
			enabled: !!(id && this.options.readEnabled(id)),
			status,
			processedSeconds: task?.nextOffset ?? 0,
			totalSeconds: task?.totalDuration || null,
			taskError:
				this.error ?? task?.error ?? (id ? jobs.translationFailures[id] : null) ?? null,
			translationFailed: !!(id && jobs.translationFailures[id]),
			cues,
			records: this.recordsView,
			hasCandidate: !!document?.candidate,
			hasPrevious: !!document?.previous,
			practicePhase: this.practicePhase,
			practiceMode: this.practiceMode,
			practiceStart: this.practiceRange?.start ?? null,
			practiceEnd: this.practiceRange?.end ?? null,
			countdown: this.countdown,
			restSeconds: this.restSeconds,
			responseMultiplier: this.responseMultiplier,
			hasTemporaryTake: !!this.temporaryTake,
			savingTake: this.savingTakes.size > 0,
			practiceError: this.practiceError,
			failedSaves: this.failedSavesView,
			selectedCueIds: Object.freeze(selected.map((cue) => cue.id)),
			rangeStart: start,
			rangeEnd: end,
			canPractice,
			...this.subtitleDrafts.snapshotForView(),
		};
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sameSnapshot(a: ShadowingWorkspaceState, b: ShadowingWorkspaceState): boolean {
	return (
		a.enabled === b.enabled &&
		a.status === b.status &&
		a.processedSeconds === b.processedSeconds &&
		a.totalSeconds === b.totalSeconds &&
		a.taskError === b.taskError &&
		a.translationFailed === b.translationFailed &&
		a.cues === b.cues &&
		a.records === b.records &&
		a.hasCandidate === b.hasCandidate &&
		a.hasPrevious === b.hasPrevious &&
		a.practicePhase === b.practicePhase &&
		a.practiceMode === b.practiceMode &&
		a.practiceStart === b.practiceStart &&
		a.practiceEnd === b.practiceEnd &&
		a.countdown === b.countdown &&
		a.restSeconds === b.restSeconds &&
		a.responseMultiplier === b.responseMultiplier &&
		a.hasTemporaryTake === b.hasTemporaryTake &&
		a.savingTake === b.savingTake &&
		a.practiceError === b.practiceError &&
		a.failedSaves === b.failedSaves &&
		Object.is(a.rangeStart, b.rangeStart) &&
		Object.is(a.rangeEnd, b.rangeEnd) &&
		a.canPractice === b.canPractice &&
		a.selectedCueIds.length === b.selectedCueIds.length &&
		a.selectedCueIds.every((id, index) => id === b.selectedCueIds[index]) &&
		a.editor === b.editor &&
		a.deletedDrafts === b.deletedDrafts
	);
}
