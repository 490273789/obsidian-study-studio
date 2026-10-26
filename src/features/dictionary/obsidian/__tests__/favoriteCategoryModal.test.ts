/* oxlint-disable typescript/unbound-method */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import { FavoriteCategoryModal } from "../favoriteCategoryModal";
import { dictionaryStrings } from "../../strings/dictionary";
import {
	FavoriteCategoryError,
	type FavoriteCategoryManager,
} from "../../domain/favorite-categories";

const ui = vi.hoisted(() => ({
	buttons: [] as { label: string; disabled: boolean; click: () => void }[],
	texts: [] as { value: string; change: (value: string) => void }[],
	errors: [] as { text: string }[],
	closes: 0,
}));

vi.mock("obsidian", () => {
	function element() {
		return {
			createEl(_tag: string, options?: { attr?: { role?: string } }) {
				const child = element();
				if (options?.attr?.role === "alert") ui.errors.push(child);
				return child;
			},
			setText(value: string) {
				this.text = value;
			},
			text: "",
			empty() {},
		};
	}
	return {
		Modal: class {
			contentEl = element();
			setTitle() {}
			open() {
				this.onOpen();
			}
			close() {
				ui.closes += 1;
				this.onClose();
			}
			onOpen() {}
			onClose() {}
		},
		Setting: class {
			constructor(_parent: unknown) {}
			setName() {
				return this;
			}
			setDesc() {
				return this;
			}
			addText(callback: (control: unknown) => void) {
				const item = { value: "", change: (_value: string): void => undefined };
				ui.texts.push(item);
				callback({
					setValue(value: string) {
						item.value = value;
						return this;
					},
					onChange(change: (value: string) => void) {
						item.change = change;
						return this;
					},
					inputEl: { focus() {}, setAttribute() {}, maxLength: 0 },
				});
				return this;
			}
			addButton(callback: (control: unknown) => void) {
				const item = { label: "", disabled: false, click: (): void => undefined };
				ui.buttons.push(item);
				callback({
					setButtonText(value: string) {
						item.label = value;
						return this;
					},
					setDisabled(value: boolean) {
						item.disabled = value;
						return this;
					},
					setCta() {
						return this;
					},
					onClick(click: () => void) {
						item.click = click;
						return this;
					},
				});
				return this;
			}
		},
	};
});

function manager() {
	return {
		pathSuggestions: vi.fn(() => ["folder/", "folder/words.md"]),
		create: vi.fn(async () => ({ id: "new", name: "new", path: "folder/words.md" })),
		edit: vi.fn(async () => undefined),
	} as unknown as FavoriteCategoryManager;
}

describe("favorite category modal", () => {
	beforeEach(() => {
		ui.buttons.length = 0;
		ui.texts.length = 0;
		ui.errors.length = 0;
		ui.closes = 0;
	});

	it("saves both fields, closes on success and selects when opened from the form", async () => {
		const categories = manager();
		new FavoriteCategoryModal({} as App, categories, dictionaryStrings("zh"), {
			kind: "create",
			select: true,
		}).open();
		ui.texts[0]!.change("四级");
		ui.texts[1]!.change("folder/words.md");
		expect(ui.buttons[1]!.disabled).toBe(false);
		ui.buttons[1]!.click();
		await vi.waitFor(() => expect(ui.closes).toBe(1));
		expect(categories.create).toHaveBeenCalledWith("四级", "folder/words.md", true);
	});

	it("keeps settings creation unselected and cancel leaves settings alone", async () => {
		const categories = manager();
		new FavoriteCategoryModal({} as App, categories, dictionaryStrings("zh"), {
			kind: "create",
			select: false,
		}).open();
		ui.buttons[0]!.click();
		expect(ui.closes).toBe(1);
		expect(categories.create).not.toHaveBeenCalled();
		ui.buttons.length = 0;
		ui.texts.length = 0;
		new FavoriteCategoryModal({} as App, categories, dictionaryStrings("zh"), {
			kind: "create",
			select: false,
		}).open();
		ui.texts[0]!.change("settings");
		ui.texts[1]!.change("settings.md");
		ui.buttons[1]!.click();
		await vi.waitFor(() =>
			expect(categories.create).toHaveBeenCalledWith("settings", "settings.md", false),
		);
	});

	it("keeps the form open and shows a specific error on failure", async () => {
		const categories = manager();
		vi.mocked(categories.create).mockRejectedValueOnce(
			new FavoriteCategoryError("duplicate-path"),
		);
		new FavoriteCategoryModal({} as App, categories, dictionaryStrings("zh"), {
			kind: "create",
			select: true,
		}).open();
		ui.texts[0]!.change("new");
		ui.texts[1]!.change("word.md");
		ui.buttons[1]!.click();
		await vi.waitFor(() => expect(ui.errors[0]!.text).toContain("已有分类"));
		expect(ui.closes).toBe(0);
	});
});
