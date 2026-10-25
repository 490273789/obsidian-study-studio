import type { VideoPlayerRuntime } from "./videoPlayerRuntime";
import type { VideoSubtitleJobs } from "./shadowSubtitlesJobs";
import { ShadowingSession, type ShadowRecorderPort, type ShadowingTake } from "./shadowingSession";
import type {
	ShadowPracticeRecord,
	ShadowPracticeRecords,
} from "../obsidian/shadowPracticeRecords";
import type {
	ShadowingCueRow,
	ShadowingRecordRow,
	ShadowingWorkspaceViewAction,
	ShadowingWorkspaceState,
	TakeAudioPlayerPort,
} from "./types";

export interface ShadowingWorkspaceSessionOptions {
	readonly runtime: VideoPlayerRuntime;
	readonly jobs: VideoSubtitleJobs;
	readonly records: ShadowPracticeRecords;
	readonly session?: ShadowingSession;
	readonly recorder?: ShadowRecorderPort;
	readonly audioPlayer?: TakeAudioPlayerPort;
	readEnabled(sourceId: string): boolean;
	writeEnabled(sourceId: string, enabled: boolean): void;
	startGeneration(sourceId: string): Promise<void>;
	translateImported(sourceId: string): Promise<void>;
}

/**
 * Deep domain authority for video shadowing.
 * Owns subtitle jobs coordination, practice session, saved takes persistence,
 * audio replay, and race tokens behind a small snapshot + act interface.
 */
export class ShadowingWorkspaceSession {
	private snapshot: ShadowingWorkspaceState;
	private readonly listeners = new Set<() => void>();
	private readonly cleanup: Array<() => void> = [];
	private sourceId: string | null;
	private records: ShadowPracticeRecord[] = [];
	private error: string | null = null;
	private loadToken = 0;
	private activityToken = 0;
	private readonly session: ShadowingSession;
	private readonly audioPlayer?: TakeAudioPlayerPort;

	constructor(private readonly options: ShadowingWorkspaceSessionOptions) {
		this.sourceId = options.runtime.getSnapshot().currentSourceId;
		this.audioPlayer = options.audioPlayer;

		if (options.session) {
			this.session = options.session;
		} else if (options.recorder) {
			this.session = new ShadowingSession({
				runtime: options.runtime,
				recorder: options.recorder,
				saveTake: async (take: ShadowingTake) => {
					await options.records.saveTake(take);
					await this.reloadRecords(take.range.sourceId);
				},
			});
		} else {
			throw new Error("ShadowingWorkspaceSession requires either session or recorder.");
		}

		this.snapshot = this.makeSnapshot();
		this.cleanup.push(options.runtime.subscribe(() => this.onRuntimeChanged()));
		this.cleanup.push(options.jobs.subscribe(() => this.publish()));
		this.cleanup.push(this.session.subscribe(() => this.publish()));

		if (this.sourceId && options.readEnabled(this.sourceId)) {
			void this.loadSource(this.sourceId);
		}
	}

	getSnapshot = (): ShadowingWorkspaceState => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
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
			if (this.session.getSnapshot().range) {
				const wasPlaying = this.options.runtime.getSnapshot().playing;
				this.session.leave({ seekToEnd: false });
				if (wasPlaying) {
					await this.options.runtime
						.play()
						.catch((error: unknown) => this.showError(error));
				}
			}
			this.records = [];
			this.error = null;
		}
		this.publish();
	}

	async stopForPresenterLoss(): Promise<void> {
		this.activityToken++;
		const phase = this.session.getSnapshot().phase;
		if (phase !== "idle" && phase !== "paused") this.session.stop();
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
					if (this.sourceId) await this.options.startGeneration(this.sourceId);
				});
			case "translate-imported":
				return this.run(async () => {
					if (this.sourceId) await this.options.translateImported(this.sourceId);
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
			case "edit-cue":
				return this.run(async () => {
					if (this.sourceId)
						await this.options.jobs.editCue(this.sourceId, action.cueId, {
							text: action.text,
							translation: action.translation,
						});
				});
			case "select-range":
				if (this.sourceId)
					this.session.selectRange(this.sourceId, action.start, action.end, action.text);
				return;
			case "seek-to":
				this.options.runtime.seekTo(action.seconds);
				return;
			case "set-mode":
				this.session.setMode(action.mode);
				return;
			case "set-rest-seconds":
				this.session.setRestSeconds(action.seconds);
				return;
			case "set-response-multiplier":
				this.session.setResponseMultiplier(action.multiplier);
				return;
			case "continue-early":
				this.session.continueEarly();
				return;
			case "start-loop":
				this.session.startLoop();
				return;
			case "stop-practice":
				this.session.stop();
				return;
			case "record-once":
				this.session.recordOnce();
				return;
			case "replay-take":
				this.session.replayTake();
				return;
			case "replay-original":
				this.session.replayOriginal();
				return;
			case "save-take":
				return this.run(() => this.session.saveTake());
			case "retry-save":
				return this.run(() => this.session.retrySave(action.takeId));
			case "continue-watching":
				this.session.leave();
				return this.options.runtime.play().catch((error: unknown) => this.showError(error));
			case "mark-difficult":
				return this.run(async () => {
					const range = this.session.getSnapshot().range;
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
		this.loadToken++;
		this.activityToken++;
		for (const release of this.cleanup) release();
		this.session.dispose?.();
		this.audioPlayer?.dispose?.();
		this.listeners.clear();
	}

	private onRuntimeChanged(): void {
		const next = this.options.runtime.getSnapshot().currentSourceId;
		if (next !== this.sourceId) {
			this.loadToken++;
			this.activityToken++;
			this.audioPlayer?.stop();
			this.sourceId = next;
			this.records = [];
			this.error = null;
			if (next && this.options.readEnabled(next)) void this.loadSource(next);
		}
		this.publish();
	}

	private async loadSource(sourceId: string): Promise<void> {
		const token = ++this.loadToken;
		try {
			await this.options.jobs.restore(sourceId);
			const records = await this.options.records.list(sourceId);
			if (token !== this.loadToken || sourceId !== this.sourceId) return;
			this.records = records;
			this.publish();
		} catch (error) {
			if (token === this.loadToken) this.showError(error);
		}
	}

	private async reloadRecords(sourceId: string): Promise<void> {
		const records = await this.options.records.reload(sourceId);
		if (sourceId !== this.sourceId) return;
		this.records = records;
		this.publish();
	}

	private async openRecord(record: ShadowingRecordRow): Promise<void> {
		const sourceId = this.sourceId;
		if (!sourceId) return;
		const token = ++this.activityToken;
		const saved = this.records.find((item) => item.id === record.id);
		if (!saved) return;
		this.session.selectRange(saved.sourceId, saved.start, saved.end, saved.text);
		this.options.runtime.seekTo(saved.start);
		if (saved.kind !== "recording") return;
		const data = await this.options.records.readTake(saved);
		if (token !== this.activityToken || sourceId !== this.sourceId) return;
		if (this.audioPlayer) {
			await this.audioPlayer.play(data, saved.mimeType ?? "audio/webm");
		}
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
		this.error = error instanceof Error ? error.message : String(error);
		this.publish();
	}

	private publish(): void {
		this.snapshot = this.makeSnapshot();
		for (const listener of this.listeners) listener();
	}

	private makeSnapshot(): ShadowingWorkspaceState {
		const id = this.sourceId;
		const jobs = this.options.jobs.getSnapshot();
		const document = id ? jobs.documents[id] : undefined;
		const task = id ? jobs.tasks.find((item) => item.source.id === id) : undefined;
		const session = this.session.getSnapshot();
		const status =
			task?.status === "running"
				? "transcribing"
				: task?.status === "failed"
					? "error"
					: (task?.status ?? "idle");
		return {
			enabled: !!(id && this.options.readEnabled(id)),
			status,
			processedSeconds: task?.nextOffset ?? 0,
			totalSeconds: task?.totalDuration || null,
			taskError:
				this.error ?? task?.error ?? (id ? jobs.translationFailures[id] : null) ?? null,
			translationFailed: !!(id && jobs.translationFailures[id]),
			cues: (document?.cues ?? []) as readonly ShadowingCueRow[],
			records: this.records.map((item): ShadowingRecordRow => ({
				id: item.id,
				start: item.start,
				end: item.end,
				text: item.text,
				kind: item.kind,
				createdAt: item.createdAt,
				playbackRate: item.playbackRate,
			})),
			hasCandidate: !!document?.candidate,
			hasPrevious: !!document?.previous,
			practicePhase: session.phase,
			practiceMode: session.mode,
			practiceStart: session.range?.start ?? null,
			practiceEnd: session.range?.end ?? null,
			countdown: session.countdown,
			restSeconds: session.restSeconds,
			responseMultiplier: session.responseMultiplier,
			hasTemporaryTake: !!session.take,
			savingTake: session.saving,
			practiceError: session.error,
			failedSaves: session.failedSaves.map((take) => ({
				id: take.id,
				sourceId: take.range.sourceId,
				start: take.range.start,
				end: take.range.end,
				text: take.range.text ?? "",
			})),
		};
	}
}
