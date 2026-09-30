import React from "react";
import { Modal, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { ReactViewErrorBoundary } from "../../../core/host/reactItemView";
import { I18nProvider } from "../../../core/ui/context/I18nContext";
import type { Language } from "../../../core/shared/types";
import type { DictionaryFavoriteController } from "../domain/favorite-controller";
import { dictionaryStrings } from "../strings/dictionary";
import { DictionaryFavoriteView } from "../ui/DictionaryFavoriteView";
import styles from "../ui/Dictionary.module.scss";

/** Native modal owns focus, dismissal, and the favorite form's React lifetime. */
export class DictionaryFavoriteModal extends Modal {
	private root: Root | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		app: App,
		private readonly controller: DictionaryFavoriteController,
		private readonly language: () => Language,
		private readonly onClosed: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass(styles.favoriteModal);
		this.contentEl.addClass("flashcard-container");
		this.root = createRoot(this.contentEl.createDiv({ cls: "flashcard-root" }));
		let previousStatus = this.controller.getSnapshot().status;
		this.unsubscribe = this.controller.subscribe(() => {
			const status = this.controller.getSnapshot().status;
			const saved = previousStatus === "saving" && status === "success";
			previousStatus = status;
			if (saved) this.close();
		});
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
					<DictionaryFavoriteView controller={this.controller} language={language} />
				</ReactViewErrorBoundary>
			</I18nProvider>,
		);
	}

	override onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
		this.onClosed();
	}
}
