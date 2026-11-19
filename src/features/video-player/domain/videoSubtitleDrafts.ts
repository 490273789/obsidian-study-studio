import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
	type VideoSubtitleJobs,
} from "./shadowSubtitlesJobs";
import type { ShadowingWorkspaceState, ShadowingWorkspaceViewAction } from "./types";

type Editor = NonNullable<ShadowingWorkspaceState["editor"]>;
type DeletedDraft = ShadowingWorkspaceState["deletedDrafts"][number];
type DraftSnapshot = Pick<ShadowingWorkspaceState, "editor" | "deletedDrafts">;
type DraftAction = Extract<
	ShadowingWorkspaceViewAction,
	{
		type:
			| "set-cue-field"
			| "save-cue-edit"
			| "request-cue-reload"
			| "cancel-cue-reload"
			| "confirm-cue-reload"
			| "discard-deleted-draft";
	}
>;

interface Draft {
	target: ShadowSubtitleEditTarget;
	text: string;
	translation: string;
	busy: boolean;
	saveConflict: boolean;
	failure: string | null;
	confirmingReload: boolean;
}

interface SourceDrafts {
	readonly id: string;
	readonly drafts: Map<string, Draft>;
	/** Each presentation gets a distinct object, even when it reuses the same draft. */
	opened: { readonly draft: Draft } | null;
}

const EMPTY_SNAPSHOT: DraftSnapshot = { editor: null, deletedDrafts: Object.freeze([]) };

/** Owns subtitle correction drafts for the lifetime of a shadowing workspace. */
export class VideoSubtitleDrafts {
	private readonly sources = new Map<string, SourceDrafts>();
	private source: SourceDrafts | null = null;
	private snapshot = EMPTY_SNAPSHOT;
	private jobsSnapshot: ReturnType<VideoSubtitleJobs["getSnapshot"]> | null = null;
	private disposed = false;

	constructor(
		private readonly jobs: Pick<
			VideoSubtitleJobs,
			"getSnapshot" | "getCueEditTarget" | "saveCueEdit" | "reloadSource"
		>,
		private readonly onChange: () => void,
		private readonly reportDetachedFailure?: (error: unknown) => void,
	) {}

	activate(sourceId: string | null): void {
		this.source = null;
		this.snapshot = EMPTY_SNAPSHOT;
		this.jobsSnapshot = null;
		if (!sourceId || this.disposed) return;
		let source = this.sources.get(sourceId);
		if (!source) {
			source = { id: sourceId, drafts: new Map(), opened: null };
			this.sources.set(sourceId, source);
		}
		if (source.opened) source.opened = { draft: source.opened.draft };
		this.source = source;
	}

	select(cueId: string | null): void {
		if (!this.source) return;
		this.open(this.source, cueId === null ? undefined : this.source.drafts.get(cueId));
	}

	toggle(cueId: string | null): void {
		const source = this.source;
		if (!source) return;
		if (source.opened) {
			this.open(source);
		} else {
			if (cueId === null) return;
			let draft = source.drafts.get(cueId);
			if (!draft) {
				const target = this.jobs.getCueEditTarget(source.id, cueId);
				if (!target) return;
				draft = {
					target,
					text: target.text,
					translation: target.translation,
					busy: false,
					saveConflict: false,
					failure: null,
					confirmingReload: false,
				};
				source.drafts.set(cueId, draft);
			}
			this.open(source, draft);
		}
		this.onChange();
	}

	snapshotForView(): DraftSnapshot {
		const source = this.source;
		if (!source) return EMPTY_SNAPSHOT;
		const jobs = this.jobs.getSnapshot();
		if (this.jobsSnapshot === jobs) return this.snapshot;
		this.jobsSnapshot = jobs;

		const { editor: previousEditor, deletedDrafts: previousDeleted } = this.snapshot;
		const deletedDrafts: DeletedDraft[] = [];
		let editor: Editor | null = null;
		for (const draft of source.drafts.values()) {
			const isOpen = source.opened?.draft === draft;
			// A write can publish its new version before the save promise delivers it.
			if (!isOpen && draft.busy) continue;
			const latest = draft.busy
				? draft.target
				: this.jobs.getCueEditTarget(source.id, draft.target.cueId);
			if (!latest) {
				const row = {
					sourceId: source.id,
					cueId: draft.target.cueId,
					text: draft.text,
					translation: draft.translation,
				};
				const previous = previousDeleted.find((item) => item.cueId === row.cueId);
				deletedDrafts.push(
					previous &&
						previous.text === row.text &&
						previous.translation === row.translation
						? previous
						: Object.freeze(row),
				);
			}
			if (isOpen) editor = this.projectEditor(draft, latest, previousEditor);
		}
		this.snapshot = {
			editor,
			deletedDrafts:
				deletedDrafts.length === previousDeleted.length &&
				deletedDrafts.every((row, index) => row === previousDeleted[index])
					? previousDeleted
					: Object.freeze(deletedDrafts),
		};
		return this.snapshot;
	}

	async act(action: DraftAction): Promise<void> {
		const source = this.source;
		if (!source) return;
		const snapshot = this.snapshotForView();
		if (action.type === "discard-deleted-draft") {
			if (!snapshot.deletedDrafts.includes(action.draft)) return;
			const draft = source.drafts.get(action.draft.cueId);
			if (draft) {
				this.remove(source, draft);
				this.changed();
			}
			return;
		}
		const opened = source.opened;
		const editor = snapshot.editor;
		if (!opened || !editor || editor.busy) return;
		if (action.expectedEditor !== undefined && action.expectedEditor !== editor) return;
		const draft = opened.draft;
		switch (action.type) {
			case "set-cue-field":
				if (editor.deleted) return;
				draft[action.field] = action.value;
				draft.failure = null;
				break;
			case "request-cue-reload":
				if (!editor.deleted && !editor.conflict && !editor.failure) return;
				draft.confirmingReload = true;
				break;
			case "cancel-cue-reload":
				draft.confirmingReload = false;
				break;
			case "save-cue-edit":
				if (!editor.canSave) return;
				return this.run(source, draft, async () => {
					const saved = await this.jobs.saveCueEdit(draft.target, {
						text: draft.text,
						translation: draft.translation,
					});
					if (this.sources.get(source.id) !== source) return;
					if (source.opened !== opened && source.opened?.draft === draft) {
						this.reset(draft, saved);
					} else {
						this.remove(source, draft);
					}
				});
			case "confirm-cue-reload":
				if (!draft.confirmingReload) return;
				return this.run(source, draft, async () => {
					await this.jobs.reloadSource(source.id, draft.target.cueId);
					if (this.sources.get(source.id) !== source) return;
					const target = this.jobs.getCueEditTarget(source.id, draft.target.cueId);
					if (target) this.reset(draft, target);
				});
		}
		this.changed();
	}

	clear(): void {
		const active = this.source?.id ?? null;
		this.sources.clear();
		this.activate(active);
	}

	dispose(): void {
		this.disposed = true;
		this.activate(null);
		this.sources.clear();
	}

	private open(source: SourceDrafts, draft?: Draft): void {
		source.opened = draft ? { draft } : null;
		this.snapshot = { ...this.snapshot, editor: null };
		this.jobsSnapshot = null;
	}

	private remove(source: SourceDrafts, draft: Draft): void {
		source.drafts.delete(draft.target.cueId);
		if (source.opened?.draft === draft) source.opened = null;
	}

	private reset(draft: Draft, target: ShadowSubtitleEditTarget): void {
		draft.target = target;
		draft.text = target.text;
		draft.translation = target.translation;
		draft.saveConflict = false;
	}

	private changed(): void {
		this.jobsSnapshot = null;
		this.onChange();
	}

	private async run(
		source: SourceDrafts,
		draft: Draft,
		work: () => Promise<void>,
	): Promise<void> {
		draft.busy = true;
		draft.failure = null;
		draft.confirmingReload = false;
		this.changed();
		if (this.sources.get(source.id) !== source) return;
		try {
			await work();
		} catch (error) {
			if (this.sources.get(source.id) !== source) {
				this.reportDetachedFailure?.(error);
			} else if (error instanceof ShadowSubtitleEditConflict) {
				draft.saveConflict = true;
			} else {
				draft.failure = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (this.sources.get(source.id) === source) {
				draft.busy = false;
				this.changed();
			}
		}
	}

	private projectEditor(
		draft: Draft,
		latest: ShadowSubtitleEditTarget | null,
		previous: Editor | null,
	): Editor {
		const deleted = latest === null;
		const conflict =
			!deleted && (draft.saveConflict || latest.version !== draft.target.version);
		const editor: Editor = {
			cueId: draft.target.cueId,
			text: draft.text,
			translation: draft.translation,
			busy: draft.busy,
			deleted,
			conflict,
			failure: draft.failure,
			confirmingReload: draft.confirmingReload,
			canSave:
				!deleted &&
				!conflict &&
				!draft.busy &&
				!draft.confirmingReload &&
				draft.text.trim().length > 0,
		};
		if (
			previous &&
			previous.cueId === editor.cueId &&
			previous.text === editor.text &&
			previous.translation === editor.translation &&
			previous.busy === editor.busy &&
			previous.deleted === editor.deleted &&
			previous.conflict === editor.conflict &&
			previous.failure === editor.failure &&
			previous.confirmingReload === editor.confirmingReload &&
			previous.canSave === editor.canSave
		) {
			return previous;
		}
		return Object.freeze(editor);
	}
}
