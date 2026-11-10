import type { VideoPlayerRuntime } from "./videoPlayerRuntime";
import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
	type VideoSubtitleJobs,
} from "./shadowSubtitlesJobs";
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
	reportDetachedFailure?(error: unknown): void;
}

interface Draft {
	openToken: object;
	target: ShadowSubtitleEditTarget;
	text: string;
	translation: string;
	busy: boolean;
	conflict: boolean;
	failure: string | null;
	confirmingReload: boolean;
}

interface SourceSelection {
	anchor: string | null;
	end: string | null;
	start: number;
	finish: number;
	editor: Draft | null;
	readonly drafts: Map<string, Draft>;
}

/**
 * Deep domain authority for video shadowing.
 * Owns subtitle jobs coordination, cue range selection and drafts, practice session,
 * saved takes persistence, audio replay, and race tokens behind a small snapshot + act interface.
 */
export class ShadowingWorkspaceSession {
	private readonly sources = new Map<string, SourceSelection>();
	private snapshot: ShadowingWorkspaceState;
	private readonly listeners = new Set<() => void>();
	private readonly cleanup: Array<() => void> = [];
	private sourceId: string | null;
	private records: ShadowPracticeRecord[] = [];
	private error: string | null = null;
	private loadToken = 0;
	private activityToken = 0;
	private disposed = false;
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
			case "select-range":
				if (this.sourceId)
					this.session.selectRange(this.sourceId, action.start, action.end, action.text);
				return;
			case "choose-cue":
				this.chooseCue(action.cueId, action.extend);
				return;
			case "set-cue-range":
				this.setCueRange(action.edge, action.seconds);
				return;
			case "toggle-cue-editor":
				this.toggleCueEditor();
				return;
			case "set-cue-field":
				this.setCueField(action.field, action.value, action.expectedEditor);
				return;
			case "save-cue-edit":
				return this.saveCueEdit(action.expectedEditor);
			case "request-cue-reload":
				this.requestCueReload(action.expectedEditor);
				return;
			case "cancel-cue-reload":
				this.cancelCueReload(action.expectedEditor);
				return;
			case "confirm-cue-reload":
				return this.confirmCueReload(action.expectedEditor);
			case "start-practice-selected":
				this.startPracticeSelected();
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
		if (this.disposed) return;
		this.disposed = true;
		this.loadToken++;
		this.activityToken++;
		for (const release of this.cleanup) release();
		this.session.dispose?.();
		this.audioPlayer?.dispose?.();
		this.sources.clear();
		this.listeners.clear();
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
		state.editor = state.anchor === state.end ? (state.drafts.get(cueId) ?? null) : null;
		if (state.editor) state.editor.openToken = {};
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
		this.session.selectRange(
			this.sourceId,
			this.snapshot.rangeStart,
			this.snapshot.rangeEnd,
			text,
		);
	}

	private toggleCueEditor(): void {
		if (this.disposed || !this.sourceId) return;
		const state = this.currentSelection();
		if (!state) return;
		if (state.editor) {
			state.editor = null;
		} else if (this.snapshot.selectedCueIds.length === 1) {
			const cueId = this.snapshot.selectedCueIds[0]!;
			let draft = state.drafts.get(cueId);
			if (!draft) {
				const target = this.options.jobs.getCueEditTarget(this.sourceId, cueId);
				if (!target) return;
				draft = this.newDraft(target);
				state.drafts.set(cueId, draft);
			}
			draft.openToken = {};
			state.editor = draft;
		}
		this.publish();
	}

	private setCueField(
		field: "text" | "translation",
		value: string,
		expectedEditor?: ShadowingWorkspaceState["editor"],
	): void {
		if (this.disposed) return;
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.currentSelection()?.editor;
		if (!draft || draft.busy) return;
		draft[field] = value;
		draft.failure = null;
		this.publish();
	}

	private async saveCueEdit(expectedEditor?: ShadowingWorkspaceState["editor"]): Promise<void> {
		if (this.disposed) return;
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const state = this.currentSelection();
		const draft = state?.editor;
		if (!state || !draft || !this.snapshot.editor?.canSave) return;
		const openToken = draft.openToken;
		draft.busy = true;
		draft.failure = null;
		this.publish();
		try {
			await this.options.jobs.saveCueEdit(draft.target, {
				text: draft.text,
				translation: draft.translation,
			});
			if (this.disposed) return;
			draft.busy = false;
			if (openToken === draft.openToken && state.editor === draft) {
				state.editor = null;
				state.drafts.delete(draft.target.cueId);
			} else if (state.editor !== draft) {
				state.drafts.delete(draft.target.cueId);
			}
		} catch (error) {
			if (this.disposed) {
				this.options.reportDetachedFailure?.(error);
				return;
			}
			draft.busy = false;
			if (error instanceof ShadowSubtitleEditConflict) draft.conflict = true;
			else draft.failure = error instanceof Error ? error.message : String(error);
		}
		this.publish();
	}

	private requestCueReload(expectedEditor?: ShadowingWorkspaceState["editor"]): void {
		if (this.disposed) return;
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.currentSelection()?.editor;
		if (!draft || draft.busy || (!draft.conflict && !draft.failure)) return;
		draft.confirmingReload = true;
		this.publish();
	}

	private cancelCueReload(expectedEditor?: ShadowingWorkspaceState["editor"]): void {
		if (this.disposed) return;
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.currentSelection()?.editor;
		if (!draft || draft.busy) return;
		draft.confirmingReload = false;
		this.publish();
	}

	private async confirmCueReload(
		expectedEditor?: ShadowingWorkspaceState["editor"],
	): Promise<void> {
		if (this.disposed) return;
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const state = this.currentSelection();
		const draft = state?.editor;
		if (!state || !draft?.confirmingReload || draft.busy) return;
		const openToken = draft.openToken;
		draft.busy = true;
		draft.failure = null;
		this.publish();
		try {
			await this.options.jobs.reloadSource(draft.target.sourceId);
			if (this.disposed) return;
			const target = this.options.jobs.getCueEditTarget(
				draft.target.sourceId,
				draft.target.cueId,
			);
			if (target) {
				Object.assign(draft, this.newDraft(target), { openToken: draft.openToken });
			} else {
				draft.busy = false;
				draft.confirmingReload = false;
				if (state.editor !== draft || openToken === draft.openToken) {
					state.drafts.delete(draft.target.cueId);
					if (state.editor === draft) state.editor = null;
				}
			}
		} catch (error) {
			if (this.disposed) {
				this.options.reportDetachedFailure?.(error);
				return;
			}
			draft.busy = false;
			draft.confirmingReload = false;
			draft.failure = error instanceof Error ? error.message : String(error);
		}
		this.publish();
	}

	private newDraft(target: ShadowSubtitleEditTarget): Draft {
		return {
			openToken: {},
			target,
			text: target.text,
			translation: target.translation ?? "",
			busy: false,
			conflict: false,
			failure: null,
			confirmingReload: false,
		};
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
				editor: null,
				drafts: new Map(),
			};
			this.sources.set(this.sourceId, state);
		}
		return state;
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
		const session = this.session.getSnapshot();
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
		const draft = state?.editor;
		if (draft) {
			const latest = this.options.jobs.getCueEditTarget(
				draft.target.sourceId,
				draft.target.cueId,
			);
			if (!latest || latest.version !== draft.target.version) draft.conflict = true;
		}
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
			selectedCueIds: Object.freeze(selected.map((cue) => cue.id)),
			rangeStart: start,
			rangeEnd: end,
			canPractice,
			editor: draft
				? Object.freeze({
						cueId: draft.target.cueId,
						text: draft.text,
						translation: draft.translation,
						busy: draft.busy,
						conflict: draft.conflict,
						failure: draft.failure,
						confirmingReload: draft.confirmingReload,
						canSave:
							!draft.busy &&
							!draft.conflict &&
							!draft.confirmingReload &&
							draft.text.trim().length > 0,
					})
				: null,
		};
	}
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
		(a.editor === b.editor ||
			(!!a.editor &&
				!!b.editor &&
				a.editor.cueId === b.editor.cueId &&
				a.editor.text === b.editor.text &&
				a.editor.translation === b.editor.translation &&
				a.editor.busy === b.editor.busy &&
				a.editor.conflict === b.editor.conflict &&
				a.editor.failure === b.editor.failure &&
				a.editor.confirmingReload === b.editor.confirmingReload &&
				a.editor.canSave === b.editor.canSave))
	);
}
