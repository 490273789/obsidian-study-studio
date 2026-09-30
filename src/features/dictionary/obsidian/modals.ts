import { App, Modal, Setting, setIcon } from "obsidian";
import { normalizeDictionaryQuery } from "../domain/configuration";
import type { DictionaryStrings } from "../strings/dictionary";

/**
 * Prompt modal used by the dictionary commands (open with a word, look up the
 * current selection). The input mirrors the view's 128-character query limit and
 * rejects an empty query after normalization.
 */
export class DictionaryLookupModal extends Modal {
	private input: HTMLInputElement | null = null;
	private settled = false;

	constructor(
		app: App,
		private readonly onSubmit: (query: string) => void,
		private readonly strings: DictionaryStrings,
		private readonly initialValue = "",
	) {
		super(app);
	}

	override onOpen(): void {
		// Use Obsidian's built-in prompt classes to mimic the command palette style
		this.modalEl.addClass("prompt");
		this.modalEl.addClass("study-studio-dictionary-prompt");

		// Clean up default Modal DOM to mimic SuggestModal
		if (this.titleEl) {
			this.titleEl.remove();
		}
		if (this.contentEl) {
			this.contentEl.hide();
		}

		// 1. Header: Brand title on left, close button on right
		const header = this.modalEl.createDiv("study-studio-prompt-header");
		const brandLabel = header.createDiv("study-studio-prompt-brand");
		const brandIcon = brandLabel.createSpan("study-studio-prompt-brand-icon");
		setIcon(brandIcon, "book-open");
		brandLabel.createSpan({ text: this.strings.displayName });

		const closeButton =
			(this as unknown as { closeButtonEl?: HTMLElement }).closeButtonEl ??
			this.modalEl.querySelector<HTMLElement>(".modal-close-button");
		if (closeButton) {
			header.appendChild(closeButton);
		}

		// 2. Compact Search Input Box
		const inputContainer = this.modalEl.createDiv("prompt-input-container");
		const searchIcon = inputContainer.createSpan("prompt-input-icon");
		setIcon(searchIcon, "search");

		this.input = inputContainer.createEl("input", {
			cls: "prompt-input",
			type: "text",
			placeholder: this.strings.inputPlaceholder,
			value: this.initialValue,
		});
		this.input.autocomplete = "off";
		this.input.spellcheck = false;
		this.input.maxLength = 128;
		this.input.setAttribute("aria-label", this.strings.inputLabel);

		let value = this.initialValue;
		this.input.addEventListener("input", (e) => {
			value = (e.target as HTMLInputElement).value;
		});

		this.input.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			this.submit(value);
		});

		// 3. Footer with shortcut instructions
		const footer = this.modalEl.createDiv("study-studio-prompt-footer");
		const instructions = footer.createDiv("prompt-instructions");

		const enterInstruction = instructions.createDiv("prompt-instruction");
		enterInstruction.createSpan({ cls: "prompt-instruction-command", text: "↵" });
		enterInstruction.createSpan({ text: this.strings.query });

		const escInstruction = instructions.createDiv("prompt-instruction");
		escInstruction.createSpan({ cls: "prompt-instruction-command", text: "esc" });
		escInstruction.createSpan({ text: this.strings.cancel });

		requestAnimationFrame(() => {
			this.input?.focus();
			this.input?.select();
		});
	}

	override onClose(): void {
		if (this.contentEl) this.contentEl.empty();
		this.input = null;
	}

	private submit(value: string): void {
		if (this.settled) return;
		const query = normalizeDictionaryQuery(value);
		if (!query) return;
		this.settled = true;
		// Open the view before closing so Obsidian's focus restoration on close
		// cannot race the leaf activation; the modal always closes afterwards.
		try {
			this.onSubmit(query);
		} finally {
			this.close();
		}
	}
}

/** Confirmation modal for deleting the in-plugin copy of a local dictionary. */
export class LocalDictionaryDeleteModal extends Modal {
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
