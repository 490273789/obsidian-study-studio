import { Modal, Setting, type App } from "obsidian";
import {
	FavoriteCategoryError,
	type FavoriteCategoryFailure,
	type FavoriteCategoryManager,
} from "../domain/favorite-categories";
import type { FavoriteCategory } from "../domain/types";
import type { DictionaryStrings } from "../strings/dictionary";
import { PathInputSuggest } from "./pathInputSuggest";

type CategoryModalMode =
	| { kind: "create"; select: boolean }
	| { kind: "edit"; category: FavoriteCategory };

function categoryError(reason: FavoriteCategoryFailure, t: DictionaryStrings): string {
	switch (reason) {
		case "busy":
			return t.favoriteCategoryBusy;
		case "invalid-name":
			return t.favoriteCategoryInvalidName;
		case "duplicate-name":
			return t.favoriteCategoryDuplicateName;
		case "invalid-path":
			return t.favoriteCategoryInvalidPath;
		case "duplicate-path":
			return t.favoriteCategoryDuplicatePath;
		case "last-category":
			return t.favoriteCategoryLast;
		case "file-failed":
			return t.favoriteCategoryFileFailed;
		case "recovery-incomplete":
			return t.favoriteCategoryRecoveryIncomplete;
		default:
			return t.favoriteCategorySaveFailed;
	}
}

/** Shared native form for creating and editing favorite categories. */
export class FavoriteCategoryModal extends Modal {
	private saving = false;
	private pathSuggest: PathInputSuggest | null = null;

	constructor(
		app: App,
		private readonly manager: FavoriteCategoryManager,
		private readonly strings: DictionaryStrings,
		private readonly mode: CategoryModalMode,
		private readonly onSaved: () => void = () => undefined,
	) {
		super(app);
	}

	override onOpen(): void {
		const { strings: t } = this;
		this.setTitle(
			this.mode.kind === "create" ? t.favoriteCategoryCreate : t.favoriteCategoryEdit,
		);
		let name = this.mode.kind === "edit" ? this.mode.category.name : "";
		let path = this.mode.kind === "edit" ? this.mode.category.path : "";
		new Setting(this.contentEl).setName(t.favoriteCategoryName).addText((text) => {
			text.setValue(name).onChange((value) => {
				name = value;
				updateSave();
			});
			text.inputEl.maxLength = 120;
			text.inputEl.focus();
		});
		new Setting(this.contentEl)
			.setName(t.favoriteCategoryPath)
			.setDesc(t.favoriteCategoryPathHint)
			.addText((text) => {
				text.setValue(path).onChange((value) => {
					path = value;
					updateSave();
				});
				text.inputEl.maxLength = 500;
				this.pathSuggest = new PathInputSuggest(
					this.app,
					text.inputEl,
					(query) => this.manager.pathSuggestions(query),
					(selected) => {
						path = selected;
						updateSave();
					},
				);
			});
		const errorEl = this.contentEl.createEl("p", { attr: { role: "alert" } });
		let cancelButton: { setDisabled(disabled: boolean): unknown } | null = null;
		let saveButton: { setDisabled(disabled: boolean): unknown } | null = null;
		const updateSave = () => {
			cancelButton?.setDisabled(this.saving);
			saveButton?.setDisabled(this.saving || !name.trim() || !path.trim());
		};
		new Setting(this.contentEl)
			.addButton((button) => {
				cancelButton = button;
				button.setButtonText(t.cancel).onClick(() => this.close());
			})
			.addButton((button) => {
				saveButton = button;
				button
					.setCta()
					.setButtonText(t.favoriteCategorySave)
					.onClick(() => {
						if (this.saving) return;
						this.saving = true;
						updateSave();
						void (async () => {
							try {
								if (this.mode.kind === "create")
									await this.manager.create(name, path, this.mode.select);
								else await this.manager.edit(this.mode.category.id, name, path);
								this.saving = false;
								this.close();
								this.onSaved();
							} catch (error) {
								errorEl.setText(
									error instanceof FavoriteCategoryError
										? categoryError(error.reason, t)
										: t.favoriteCategorySaveFailed,
								);
							} finally {
								this.saving = false;
								updateSave();
							}
						})();
					});
				updateSave();
			});
	}

	override close(): void {
		if (this.saving) return;
		super.close();
	}

	override onClose(): void {
		this.pathSuggest?.close();
		this.pathSuggest = null;
		this.contentEl.empty();
	}
}

class FavoriteCategoryDeleteModal extends Modal {
	constructor(
		app: App,
		private readonly category: FavoriteCategory,
		private readonly manager: FavoriteCategoryManager,
		private readonly t: DictionaryStrings,
		private readonly onSaved: () => void,
	) {
		super(app);
	}
	override onOpen(): void {
		this.setTitle(this.t.favoriteCategoryDelete);
		this.contentEl.createEl("p", {
			text: this.t.favoriteCategoryDeleteConfirm(this.category.name),
		});
		const errorEl = this.contentEl.createEl("p", { attr: { role: "alert" } });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.t.cancel).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(this.t.favoriteCategoryDelete)
					.onClick(() => {
						button.setDisabled(true);
						void this.manager
							.remove(this.category.id)
							.then(() => {
								this.onSaved();
								this.close();
							})
							.catch((error: unknown) => {
								errorEl.setText(
									error instanceof FavoriteCategoryError
										? categoryError(error.reason, this.t)
										: this.t.favoriteCategorySaveFailed,
								);
								button.setDisabled(false);
							});
					}),
			);
	}
	override onClose(): void {
		this.contentEl.empty();
	}
}

export function confirmFavoriteCategoryDelete(
	app: App,
	category: FavoriteCategory,
	manager: FavoriteCategoryManager,
	strings: DictionaryStrings,
	onSaved: () => void,
): void {
	new FavoriteCategoryDeleteModal(app, category, manager, strings, onSaved).open();
}
