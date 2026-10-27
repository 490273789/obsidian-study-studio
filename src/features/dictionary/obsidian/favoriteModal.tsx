import { Modal, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { ReactViewErrorBoundary } from "../../../core/host/reactItemView";
import { I18nProvider } from "../../../core/ui/context/I18nContext";
import type { Language } from "../../../core/shared/types";
import type { DictionaryFavoriteSession } from "../domain/favoriteSession";
import { dictionaryStrings } from "../strings/dictionary";
import { DictionaryFavoriteView } from "../ui/DictionaryFavoriteView";
import styles from "../ui/Dictionary.module.scss";

/** Native modal owns focus, dismissal, and the favorite form's React lifetime. */
export class DictionaryFavoriteModal extends Modal {
	private root: Root | null = null;
	private closing = false;

	constructor(
		app: App,
		private readonly session: DictionaryFavoriteSession,
		private readonly language: () => Language,
		private readonly onClosing: () => void,
		private readonly onCreateCategory: () => void = () => undefined,
	) {
		super(app);
	}

	override onOpen(): void {
		this.closing = false;
		this.modalEl.addClass(styles.favoriteModal);
		this.contentEl.addClass("flashcard-container");
		this.root = createRoot(this.contentEl.createDiv({ cls: "flashcard-root" }));
		this.updateSettings();
	}

	updateSettings(): void {
		const language = this.language();
		const strings = dictionaryStrings(language);
		this.modalEl.setAttribute("aria-label", strings.favoriteSidebarTitle);
		this.root?.render(
			<I18nProvider language={language}>
				<ReactViewErrorBoundary
					viewType="dictionary-favorite-modal"
					message={strings.favoriteRenderFailed}
				>
					<DictionaryFavoriteView
						session={this.session}
						language={language}
						onCreateCategory={this.onCreateCategory}
					/>
				</ReactViewErrorBoundary>
			</I18nProvider>,
		);
	}

	override close(): void {
		this.reportClosing();
		super.close();
	}

	override onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
		this.reportClosing();
	}

	private reportClosing(): void {
		if (this.closing) return;
		this.closing = true;
		this.onClosing();
	}
}
