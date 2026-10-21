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
