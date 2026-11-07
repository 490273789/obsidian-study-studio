import { App, Modal, Setting } from "obsidian";

export interface AiDeleteModalStrings {
	title: string;
	message: string;
	cancel: string;
	action: string;
}

/** Confirmation modal for deleting an AI engine configuration. */
export class AiEngineDeleteModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly engineName: string,
		private readonly isDefault: boolean,
		private readonly strings: AiDeleteModalStrings,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.classList.add("mod-warning");
		this.setTitle(this.strings.title);
		const message = this.contentEl.createEl("p", {
			text: `${this.strings.message}（${this.engineName}）`,
		});
		if (this.isDefault) {
			message.addClass("mod-warning");
		}
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(this.strings.cancel).onClick(() => this.finish(false)),
			)
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(this.strings.action)
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

/** Resolves `true` when the user confirms deleting the AI engine. */
export function confirmAiEngineDeletion(
	app: App,
	engineName: string,
	isDefault: boolean,
	strings: AiDeleteModalStrings,
): Promise<boolean> {
	return new Promise((resolve) => {
		new AiEngineDeleteModal(app, engineName, isDefault, strings, resolve).open();
	});
}
