import {
	Modal,
	Setting,
	type App,
	type ButtonComponent,
	type DropdownComponent,
	type TextComponent,
} from "obsidian";
import type { Language } from "../../../core/shared/types";
import { FavoriteBatchController } from "../domain/favorite-batch";
import { dictionaryStrings } from "../strings/dictionary";
import { PathInputSuggest } from "./pathInputSuggest";
import styles from "../ui/Dictionary.module.scss";

/** Native vault-path form and progress surface for one batch task. */
export class DictionaryFavoriteBatchModal extends Modal {
	private sourcePath = "";
	private categoryId = "";
	private sourceInput: TextComponent | null = null;
	private sourceSuggest: PathInputSuggest | null = null;
	private categoryDropdown: DropdownComponent | null = null;
	private targetSetting: Setting | null = null;
	private startButton: ButtonComponent | null = null;
	private stopButton: ButtonComponent | null = null;
	private openButton: ButtonComponent | null = null;
	private progressEl: HTMLElement | null = null;
	private countsEl: HTMLElement | null = null;
	private currentEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private failuresEl: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private forceClosing = false;

	constructor(
		app: App,
		private readonly controller: FavoriteBatchController,
		private readonly language: () => Language,
		private readonly onDismissed: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const t = dictionaryStrings(this.language());
		this.setTitle(t.favoriteBatchOpen);
		this.modalEl.addClass(styles.batchModal);
		this.categoryId = this.controller.selectedCategoryId;
		new Setting(this.contentEl)
			.setName(t.favoriteBatchSource)
			.setDesc(t.favoriteBatchSourceHint)
			.addText((text) => {
				this.sourceInput = text;
				text.setValue(this.sourcePath).onChange((value) => {
					this.sourcePath = value;
					this.render();
				});
				this.sourceSuggest = new PathInputSuggest(
					this.app,
					text.inputEl,
					(query) => this.controller.pathSuggestions(query),
					(selected) => {
						this.sourcePath = selected;
						this.render();
					},
				);
				text.inputEl.focus();
			});
		new Setting(this.contentEl).setName(t.favoriteCategory).addDropdown((dropdown) => {
			this.categoryDropdown = dropdown;
			for (const category of this.controller.categories)
				dropdown.addOption(category.id, category.name);
			dropdown.setValue(this.categoryId).onChange((id) => {
				this.categoryId = id;
				this.render();
			});
		});
		this.targetSetting = new Setting(this.contentEl).setName(t.favoriteBatchTarget);
		new Setting(this.contentEl)
			.addButton((button) => {
				this.startButton = button;
				button
					.setCta()
					.setButtonText(t.favoriteBatchStart)
					.onClick(() => {
						void this.controller.start(this.sourcePath, this.categoryId);
					});
			})
			.addButton((button) => {
				this.stopButton = button;
				button.setButtonText(t.favoriteBatchStop).onClick(() => this.controller.stop());
			})
			.addButton((button) => {
				this.openButton = button;
				button.setButtonText(t.favoriteBatchOpenTarget).onClick(() => {
					void this.openTarget();
				});
			});
		this.progressEl = this.contentEl.createEl("p", {
			cls: styles.batchProgress,
			attr: { role: "status", "aria-live": "polite" },
		});
		this.countsEl = this.contentEl.createEl("p", { cls: styles.batchCounts });
		this.currentEl = this.contentEl.createEl("p", { cls: styles.batchCurrent });
		this.statusEl = this.contentEl.createEl("p", {
			cls: styles.batchStatus,
			attr: { role: "status", "aria-live": "polite" },
		});
		this.failuresEl = this.contentEl.createEl("section", { cls: styles.batchFailures });
		this.unsubscribe = this.controller.subscribe(() => this.render());
		this.render();
	}

	override close(): void {
		if (!this.forceClosing && this.controller.getSnapshot().status === "running") return;
		super.close();
	}

	/** Feature teardown also stops the active request. Accepted writes settle independently. */
	forceClose(): void {
		this.controller.dispose();
		this.forceClosing = true;
		super.close();
	}

	override onClose(): void {
		this.sourceSuggest?.close();
		this.sourceSuggest = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.controller.dispose();
		this.contentEl.empty();
		this.onDismissed();
	}

	private render(): void {
		const t = dictionaryStrings(this.language());
		const state = this.controller.getSnapshot();
		const running = state.status === "running";
		const category = this.controller.categories.find((item) => item.id === this.categoryId);
		this.targetSetting?.setDesc(category?.path ?? "");
		this.sourceInput?.setDisabled(running);
		this.categoryDropdown?.setDisabled(running);
		this.startButton?.setDisabled(running || !this.sourcePath.trim() || !category);
		this.stopButton?.setDisabled(!running || state.message === t.favoriteBatchStopping);
		this.openButton?.setDisabled(running || state.status === "idle" || !state.targetPath);
		this.progressEl?.setText(
			state.status === "idle" ? "" : t.favoriteBatchProgress(state.processed, state.total),
		);
		this.countsEl?.setText(
			state.status === "idle"
				? ""
				: t.favoriteBatchCounts(state.saved, state.skipped, state.failed),
		);
		this.currentEl?.setText(
			running && state.currentWord ? t.favoriteBatchCurrent(state.currentWord) : "",
		);
		const result = {
			idle: "",
			running: "",
			success: t.favoriteBatchResultSuccess,
			partial: t.favoriteBatchResultPartial,
			failed: t.favoriteBatchResultFailed,
			stopped: t.favoriteBatchResultStopped,
		}[state.status];
		this.statusEl?.setText([result, state.message].filter(Boolean).join(" "));
		if (this.failuresEl) {
			this.failuresEl.empty();
			if (state.failures.length) {
				this.failuresEl.createEl("h3", { text: t.favoriteBatchFailures });
				const list = this.failuresEl.createEl("ol");
				for (const failure of state.failures) {
					const item = list.createEl("li");
					item.createEl("strong", {
						text: t.favoriteBatchFailureLine(failure.line, failure.word),
					});
					item.createSpan({ text: `：${failure.reason}` });
				}
			}
		}
	}

	private async openTarget(): Promise<void> {
		const t = dictionaryStrings(this.language());
		try {
			if (await this.controller.openTarget()) return;
		} catch {
			// The same message covers a target removed after completion.
		}
		this.statusEl?.setText(t.favoriteBatchOpenTargetFailed);
	}
}
