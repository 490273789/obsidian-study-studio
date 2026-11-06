import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import type { ShadowingWorkspaceSession } from "../domain/shadowingWorkspaceSession";
import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
	type VideoSubtitleJobs,
} from "../domain/shadowSubtitlesJobs";

export interface SubtitleEditingSessionSnapshot {
	readonly sourceId: string | null;
	readonly selectedCueIds: readonly string[];
	readonly rangeStart: number;
	readonly rangeEnd: number;
	readonly canPractice: boolean;
	readonly editor: null | {
		readonly cueId: string;
		readonly text: string;
		readonly translation: string;
		readonly busy: boolean;
		readonly conflict: boolean;
		readonly failure: string | null;
		readonly confirmingReload: boolean;
		readonly canSave: boolean;
	};
}

type RenderedEditor = SubtitleEditingSessionSnapshot["editor"];

interface SubtitleEditingSessionOptions {
	readonly runtime: Pick<VideoPlayerRuntime, "getSnapshot" | "subscribe" | "seekTo">;
	readonly workspace: Pick<ShadowingWorkspaceSession, "getSnapshot" | "subscribe" | "act">;
	readonly edits: Pick<VideoSubtitleJobs, "getCueEditTarget" | "saveCueEdit" | "reloadSource">;
	reportDetachedFailure(error: unknown): void;
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

/** A view owns drafts and presentation; accepted writes remain owned by subtitle jobs. */
export class SubtitleEditingSession {
	private readonly sources = new Map<string, SourceSelection>();
	private readonly listeners = new Set<() => void>();
	private readonly cleanup: Array<() => void>;
	private sourceId: string | null = null;
	private disposed = false;
	private snapshot: SubtitleEditingSessionSnapshot = Object.freeze({
		sourceId: null,
		selectedCueIds: Object.freeze([]),
		rangeStart: 0,
		rangeEnd: 0,
		canPractice: false,
		editor: null,
	});

	constructor(private readonly options: SubtitleEditingSessionOptions) {
		this.cleanup = [
			options.runtime.subscribe(this.refresh),
			options.workspace.subscribe(this.refresh),
		];
		this.refresh();
	}

	getSnapshot = (): SubtitleEditingSessionSnapshot => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const release of this.cleanup) release();
		this.sources.clear();
		this.snapshot = Object.freeze({
			sourceId: null,
			selectedCueIds: Object.freeze([]),
			rangeStart: 0,
			rangeEnd: 0,
			canPractice: false,
			editor: null,
		});
		this.listeners.clear();
	}

	choose(cueId: string, extend: boolean): void {
		const state = this.current();
		const cues = this.options.workspace.getSnapshot().cues;
		const cue = cues.find((item) => item.id === cueId);
		if (this.disposed || !state || !cue) return;
		const anchor = extend ? cues.find((item) => item.id === state.anchor) : null;
		state.anchor = anchor?.id ?? cueId;
		state.end = cueId;
		state.start = Math.min(anchor?.start ?? cue.start, cue.start);
		state.finish = Math.max(anchor?.end ?? cue.end, cue.end);
		state.editor = state.anchor === state.end ? (state.drafts.get(cueId) ?? null) : null;
		if (state.editor) state.editor.openToken = {};
		if (!anchor) this.options.runtime.seekTo(cue.start);
		this.refresh();
	}

	setRange(edge: "start" | "end", value: number): void {
		const state = this.current();
		if (this.disposed || !state) return;
		if (edge === "start") state.start = value;
		else state.finish = value;
		this.refresh();
	}

	practice(): void {
		if (this.disposed || !this.snapshot.canPractice) return;
		const ids = new Set(this.snapshot.selectedCueIds);
		void this.options.workspace.act({
			type: "select-range",
			start: this.snapshot.rangeStart,
			end: this.snapshot.rangeEnd,
			text: this.options.workspace
				.getSnapshot()
				.cues.filter((cue) => ids.has(cue.id))
				.map((cue) => cue.text)
				.join(" "),
		});
	}

	toggleEditor(): void {
		const state = this.current();
		if (this.disposed || !state) return;
		if (state.editor) state.editor = null;
		else if (this.snapshot.selectedCueIds.length === 1 && this.sourceId) {
			const cueId = this.snapshot.selectedCueIds[0]!;
			let draft = state.drafts.get(cueId);
			if (!draft) {
				const target = this.options.edits.getCueEditTarget(this.sourceId, cueId);
				if (!target) return;
				draft = this.newDraft(target);
				state.drafts.set(cueId, draft);
			}
			draft.openToken = {};
			state.editor = draft;
		}
		this.refresh();
	}

	setField(field: "text" | "translation", value: string, expectedEditor?: RenderedEditor): void {
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.current()?.editor;
		if (this.disposed || !draft || draft.busy) return;
		draft[field] = value;
		draft.failure = null;
		this.refresh();
	}

	async submit(expectedEditor?: RenderedEditor): Promise<void> {
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const state = this.current();
		const draft = state?.editor;
		if (this.disposed || !state || !draft || !this.snapshot.editor?.canSave) return;
		const openToken = draft.openToken;
		draft.busy = true;
		draft.failure = null;
		this.refresh();
		try {
			await this.options.edits.saveCueEdit(draft.target, {
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
				this.options.reportDetachedFailure(error);
				return;
			}
			draft.busy = false;
			if (error instanceof ShadowSubtitleEditConflict) draft.conflict = true;
			else draft.failure = error instanceof Error ? error.message : String(error);
		}
		this.refresh();
	}

	requestReload(expectedEditor?: RenderedEditor): void {
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.current()?.editor;
		if (this.disposed || !draft || draft.busy || (!draft.conflict && !draft.failure)) return;
		draft.confirmingReload = true;
		this.refresh();
	}

	cancelReload(expectedEditor?: RenderedEditor): void {
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const draft = this.current()?.editor;
		if (this.disposed || !draft || draft.busy) return;
		draft.confirmingReload = false;
		this.refresh();
	}

	async confirmReload(expectedEditor?: RenderedEditor): Promise<void> {
		if (expectedEditor !== undefined && expectedEditor !== this.snapshot.editor) return;
		const state = this.current();
		const draft = state?.editor;
		if (this.disposed || !state || !draft?.confirmingReload || draft.busy) return;
		const openToken = draft.openToken;
		draft.busy = true;
		draft.failure = null;
		this.refresh();
		try {
			await this.options.edits.reloadSource(draft.target.sourceId);
			if (this.disposed) return;
			const target = this.options.edits.getCueEditTarget(
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
				this.options.reportDetachedFailure(error);
				return;
			}
			draft.busy = false;
			draft.confirmingReload = false;
			draft.failure = error instanceof Error ? error.message : String(error);
		}
		this.refresh();
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

	private current(): SourceSelection | null {
		return this.sourceId ? (this.sources.get(this.sourceId) ?? null) : null;
	}

	private readonly refresh = (): void => {
		if (this.disposed) return;
		const runtime = this.options.runtime.getSnapshot();
		this.sourceId = runtime.currentSourceId;
		if (this.sourceId && !this.sources.has(this.sourceId))
			this.sources.set(this.sourceId, {
				anchor: null,
				end: null,
				start: 0,
				finish: 0,
				editor: null,
				drafts: new Map(),
			});
		const state = this.current();
		const cues = this.options.workspace.getSnapshot().cues;
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
			const latest = this.options.edits.getCueEditTarget(
				draft.target.sourceId,
				draft.target.cueId,
			);
			if (!latest || latest.version !== draft.target.version) draft.conflict = true;
		}
		const start = state?.start ?? 0;
		const end = state?.finish ?? 0;
		const next: SubtitleEditingSessionSnapshot = {
			sourceId: this.sourceId,
			selectedCueIds: selected.map((cue) => cue.id),
			rangeStart: start,
			rangeEnd: end,
			canPractice:
				selected.length > 0 &&
				Number.isFinite(start) &&
				Number.isFinite(end) &&
				start >= 0 &&
				end > start &&
				(runtime.duration === null || end <= runtime.duration),
			editor: draft
				? {
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
					}
				: null,
		};
		if (sameSnapshot(this.snapshot, next)) return;
		this.snapshot = Object.freeze({
			...next,
			selectedCueIds: Object.freeze(next.selectedCueIds),
			editor: next.editor ? Object.freeze(next.editor) : null,
		});
		for (const listener of this.listeners) listener();
	};
}

function sameSnapshot(
	a: SubtitleEditingSessionSnapshot,
	b: SubtitleEditingSessionSnapshot,
): boolean {
	return (
		a.sourceId === b.sourceId &&
		Object.is(a.rangeStart, b.rangeStart) &&
		Object.is(a.rangeEnd, b.rangeEnd) &&
		a.canPractice === b.canPractice &&
		a.selectedCueIds.length === b.selectedCueIds.length &&
		a.selectedCueIds.every((id, index) => id === b.selectedCueIds[index]) &&
		(a.editor === b.editor ||
			(!!a.editor &&
				!!b.editor &&
				Object.keys(a.editor).every(
					(key) =>
						a.editor![key as keyof NonNullable<typeof a.editor>] ===
						b.editor![key as keyof NonNullable<typeof b.editor>],
				)))
	);
}
