import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import type { VideoSubtitleJobs } from "../domain/shadowSubtitlesJobs";
import type { ShadowingSession } from "../domain/shadowingSession";
import type {
	ShadowPracticeRecord,
	ShadowPracticeRecords,
} from "../obsidian/shadowPracticeRecords";
import type { ShadowingViewBridge } from "./VideoPlayerView";
import type {
	ShadowingCueRow,
	ShadowingRecordRow,
	ShadowingWorkspaceActions,
	ShadowingWorkspaceState,
} from "./ShadowingWorkspace";

export interface ShadowingBridgeOptions {
	runtime: VideoPlayerRuntime;
	jobs: VideoSubtitleJobs;
	session: ShadowingSession;
	records: ShadowPracticeRecords;
	readEnabled(sourceId: string): boolean;
	writeEnabled(sourceId: string, enabled: boolean): void;
	startGeneration(sourceId: string): Promise<void>;
	translateImported(sourceId: string): Promise<void>;
}

/** The view only reads a stable snapshot and sends semantic intents. */
export class ShadowingBridge implements ShadowingViewBridge {
	private snapshot: ShadowingWorkspaceState;
	private readonly listeners = new Set<() => void>();
	private readonly cleanup: Array<() => void> = [];
	private sourceId: string | null;
	private records: ShadowPracticeRecord[] = [];
	private error: string | null = null;
	private loadToken = 0;
	private activityToken = 0;
	private savedAudio: HTMLAudioElement | null = null;
	private savedAudioUrl: string | null = null;

	constructor(private readonly options: ShadowingBridgeOptions) {
		this.sourceId = options.runtime.getSnapshot().currentSourceId;
		this.snapshot = this.makeSnapshot();
		this.cleanup.push(options.runtime.subscribe(() => this.onRuntimeChanged()));
		this.cleanup.push(options.jobs.subscribe(() => this.publish()));
		this.cleanup.push(options.session.subscribe(() => this.publish()));
		if (this.sourceId && options.readEnabled(this.sourceId))
			void this.loadSource(this.sourceId);
	}

	getSnapshot = (): ShadowingWorkspaceState => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	setEnabled(enabled: boolean): void {
		const id = this.sourceId;
		if (!id || this.options.readEnabled(id) === enabled) return;
		this.options.writeEnabled(id, enabled);
		if (enabled) {
			void this.loadSource(id);
		} else {
			this.loadToken++;
			this.activityToken++;
			this.releaseSavedAudio();
			if (this.options.session.getSnapshot().range) {
				const wasPlaying = this.options.runtime.getSnapshot().playing;
				this.options.session.leave({ seekToEnd: false });
				if (wasPlaying)
					void this.options.runtime
						.play()
						.catch((error: unknown) => this.showError(error));
			}
			this.records = [];
			this.error = null;
		}
		this.publish();
	}

	readonly actions: ShadowingWorkspaceActions = {
		generate: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.startGeneration(this.sourceId);
			}),
		translateImported: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.translateImported(this.sourceId);
			}),
		retryTranslation: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.jobs.retryTranslation(this.sourceId);
			}),
		reloadSubtitles: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.jobs.reloadSource(this.sourceId);
			}),
		pauseGeneration: () => {
			if (this.sourceId) this.options.jobs.pause(this.sourceId);
		},
		resumeGeneration: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.jobs.resume(this.sourceId);
			}),
		importFile: (file, role) =>
			this.run(async () => {
				const id = this.sourceId;
				if (!id) return;
				const format = file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
				await this.options.jobs.importSubtitles(id, await file.text(), format, role);
			}),
		adoptCandidate: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.jobs.adoptCandidate(this.sourceId);
			}),
		restorePrevious: () =>
			this.run(async () => {
				if (this.sourceId) await this.options.jobs.restorePrevious(this.sourceId);
			}),
		editCue: (cueId, text, translation) =>
			this.run(async () => {
				if (this.sourceId)
					await this.options.jobs.editCue(this.sourceId, cueId, { text, translation });
			}),
		selectRange: (start, end, text) => {
			if (this.sourceId) this.options.session.selectRange(this.sourceId, start, end, text);
		},
		seekTo: (seconds) => this.options.runtime.seekTo(seconds),
		setMode: (mode) => this.options.session.setMode(mode),
		setRestSeconds: (seconds) => this.options.session.setRestSeconds(seconds),
		setResponseMultiplier: (multiplier) =>
			this.options.session.setResponseMultiplier(multiplier),
		continueEarly: () => this.options.session.continueEarly(),
		startLoop: () => this.options.session.startLoop(),
		stopPractice: () => this.options.session.stop(),
		recordOnce: () => this.options.session.recordOnce(),
		replayTake: () => this.options.session.replayTake(),
		replayOriginal: () => this.options.session.replayOriginal(),
		saveTake: () => this.run(() => this.options.session.saveTake()),
		retrySave: (takeId) => this.run(() => this.options.session.retrySave(takeId)),
		continueWatching: () => {
			this.options.session.leave();
			void this.options.runtime.play().catch((error: unknown) => this.showError(error));
		},
		markDifficult: () =>
			this.run(async () => {
				const range = this.options.session.getSnapshot().range;
				if (!range) return;
				await this.options.records.markDifficult(
					range.sourceId,
					range.start,
					range.end,
					range.text ?? "",
				);
				await this.reloadRecords(range.sourceId);
			}),
		openRecord: (record) => this.run(() => this.openRecord(record)),
		deleteRecord: (record) =>
			this.run(async () => {
				if (!this.sourceId) return;
				await this.options.records.remove(this.sourceId, record.id);
				await this.reloadRecords(this.sourceId);
			}),
	};

	async refreshRecords(sourceId: string): Promise<void> {
		await this.reloadRecords(sourceId);
	}

	stopForPresenterLoss(): void {
		this.activityToken++;
		const phase = this.options.session.getSnapshot().phase;
		if (phase !== "idle" && phase !== "paused") this.options.session.stop();
		this.releaseSavedAudio();
	}

	dispose(): void {
		this.loadToken++;
		this.activityToken++;
		for (const release of this.cleanup) release();
		this.releaseSavedAudio();
		this.listeners.clear();
	}

	private onRuntimeChanged(): void {
		const next = this.options.runtime.getSnapshot().currentSourceId;
		if (next !== this.sourceId) {
			this.loadToken++;
			this.activityToken++;
			this.releaseSavedAudio();
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
		this.options.session.selectRange(saved.sourceId, saved.start, saved.end, saved.text);
		this.options.runtime.seekTo(saved.start);
		if (saved.kind !== "recording") return;
		const data = await this.options.records.readTake(saved);
		if (token !== this.activityToken || sourceId !== this.sourceId) return;
		this.releaseSavedAudio();
		const url = URL.createObjectURL(new Blob([data], { type: saved.mimeType ?? "audio/webm" }));
		const audio = new Audio(url);
		this.savedAudio = audio;
		this.savedAudioUrl = url;
		audio.addEventListener(
			"ended",
			() => {
				if (this.savedAudio === audio) this.releaseSavedAudio();
			},
			{ once: true },
		);
		audio.addEventListener(
			"error",
			() => {
				if (this.savedAudio === audio) this.releaseSavedAudio();
			},
			{ once: true },
		);
		await audio.play();
	}

	private releaseSavedAudio(): void {
		this.savedAudio?.pause();
		this.savedAudio = null;
		if (this.savedAudioUrl) URL.revokeObjectURL(this.savedAudioUrl);
		this.savedAudioUrl = null;
	}

	private run(work: () => Promise<unknown>): void {
		void work()
			.then(() => {
				this.error = null;
				this.publish();
			})
			.catch((error: unknown) => this.showError(error));
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
		const session = this.options.session.getSnapshot();
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
