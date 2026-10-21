import type { DictionaryFavoriteController } from "../domain/favorite-controller";
import type { DictionaryFavoriteOpenMode, DictionaryFavoriteViewState } from "../domain/types";

interface DictionaryFavoriteModalHandle {
	open(): void;
	close(): void;
	updateSettings(): void;
}

interface DictionaryFavoritePresentationOptions {
	controller: DictionaryFavoriteController;
	mode(): DictionaryFavoriteOpenMode;
	sidebar: {
		open(): Promise<void>;
	};
	/** Reports dismissal when close starts, independently of native animation cleanup. */
	createModal(onClosing: () => void): DictionaryFavoriteModalHandle;
	reportOpenFailure(error: unknown): void;
}

/** Coordinates both favorite surfaces without becoming a second draft authority. */
export class DictionaryFavoritePresentation {
	private modal: DictionaryFavoriteModalHandle | null = null;
	private readonly sidebars = new Set<object>();
	private openRevision = 0;
	private disposed = false;
	private previousStatus: DictionaryFavoriteViewState["status"];
	private readonly unsubscribe: () => void;

	constructor(private readonly options: DictionaryFavoritePresentationOptions) {
		this.previousStatus = options.controller.getSnapshot().status;
		this.unsubscribe = options.controller.subscribe(() => {
			const status = options.controller.getSnapshot().status;
			const saved = this.previousStatus === "saving" && status === "success";
			// Closing the last surface resets the controller synchronously.
			this.previousStatus = status;
			if (!this.disposed && saved) this.modal?.close();
		});
	}

	async open(word: string): Promise<void> {
		if (this.disposed) return;
		const revision = ++this.openRevision;
		try {
			if (this.options.mode() === "sidebar") {
				await this.options.sidebar.open();
				if (!this.isCurrent(revision)) return;
				this.modal?.close();
			} else if (!this.modal) {
				const modal = this.options.createModal(() => {
					if (this.modal !== modal) return;
					this.modal = null;
					this.releaseIfHidden();
				});
				this.modal = modal;
				modal.open();
			}
			if (this.isCurrent(revision)) await this.options.controller.prefill(word);
		} catch (error) {
			if (this.isCurrent(revision)) this.options.reportOpenFailure(error);
		}
	}

	/** One lease per mounted view; host leaf membership can lag behind its teardown. */
	attachSidebar(): () => void {
		if (this.disposed) return () => undefined;
		const sidebar = {};
		this.sidebars.add(sidebar);
		return () => {
			if (!this.sidebars.delete(sidebar)) return;
			this.releaseIfHidden();
		};
	}

	refresh(): void {
		if (!this.disposed) this.modal?.updateSettings();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.openRevision += 1;
		this.unsubscribe();
		this.sidebars.clear();
		const modal = this.modal;
		this.modal = null;
		try {
			modal?.close();
		} finally {
			this.options.controller.resetSession();
		}
	}

	private isCurrent(revision: number): boolean {
		return !this.disposed && revision === this.openRevision;
	}

	private releaseIfHidden(): void {
		if (this.disposed || this.modal || this.sidebars.size > 0) return;
		this.openRevision += 1;
		this.options.controller.resetSession();
	}
}
