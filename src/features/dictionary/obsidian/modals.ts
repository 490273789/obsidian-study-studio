import { App, Modal, Setting } from "obsidian";
import type { DictionaryStrings } from "../strings/dictionary";

/** Confirmation modal for deleting the in-plugin copy of a local dictionary. */
class LocalDictionaryDeleteModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly dictionaryName: string,
		private readonly strings: DictionaryStrings,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.classList.add("mod-warning");
		this.setTitle(this.strings.localDelete);
		this.contentEl.createEl("p", {
			text: this.strings.localDeleteConfirm(this.dictionaryName),
		});
		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText(this.strings.localDeleteCancel)
					.onClick(() => this.finish(false)),
			)
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(this.strings.localDeleteAction)
					.onClick(() => this.finish(true)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.resolve(false);
	}

	private finish(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(confirmed);
		this.close();
	}
}

/** Resolves `true` when the user confirms deleting the named local dictionary. */
export function confirmLocalDictionaryDeletion(
	app: App,
	strings: DictionaryStrings,
	dictionaryName: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new LocalDictionaryDeleteModal(app, dictionaryName, strings, resolve).open();
	});
}

/** Prompts for a display name without changing the dictionary package or files. */
class LocalDictionaryNameModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly currentName: string,
		private readonly strings: DictionaryStrings,
		private readonly resolve: (name: string | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.strings.localRename);
		let name = this.currentName;
		let updateSaveButton = (_value: string): void => undefined;
		new Setting(this.contentEl).setName(this.strings.localRenameName).addText((text) => {
			text.setValue(name).onChange((value) => {
				name = value;
				updateSaveButton(value);
			});
			text.inputEl.maxLength = 120;
			text.inputEl.addEventListener("keydown", (event) => {
				if (
					event.key !== "Enter" ||
					event.isComposing ||
					event.keyCode === 229 ||
					!name.trim()
				)
					return;
				event.preventDefault();
				this.finish(name.trim());
			});
			text.inputEl.focus();
			text.inputEl.select();
		});
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(this.strings.cancel).onClick(() => this.finish(null)),
			)
			.addButton((button) => {
				updateSaveButton = (value) => button.setDisabled(!value.trim());
				button
					.setCta()
					.setButtonText(this.strings.localRenameSave)
					.onClick(() => {
						if (name.trim()) this.finish(name.trim());
					});
				updateSaveButton(name);
			});
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.resolve(null);
	}

	private finish(name: string | null): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(name);
		this.close();
	}
}

export function promptLocalDictionaryName(
	app: App,
	strings: DictionaryStrings,
	currentName: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		new LocalDictionaryNameModal(app, currentName, strings, resolve).open();
	});
}
