import { AbstractInputSuggest, type App } from "obsidian";

/**
 * Vault path autocomplete suggest attached to a text input.
 * Replaces native HTML datalist with Obsidian's PopoverSuggest to avoid
 * native OS menu positioning loops and detached popup overlays.
 */
export class PathInputSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly textInputEl: HTMLInputElement,
		private readonly getItems: (query: string) => string[],
		private readonly onSelected?: (value: string) => void,
	) {
		super(app, textInputEl);
	}

	protected override getSuggestions(query: string): string[] {
		return this.getItems(query);
	}

	override renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	override selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(value);
		this.textInputEl.dispatchEvent(new Event("input", { bubbles: true }));
		this.onSelected?.(value);
		this.close();
		this.textInputEl.focus();
	}
}
