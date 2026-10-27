import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import type { FavoriteBatchController, FavoriteBatchSnapshot } from "../../domain/favorite-batch";
import { DictionaryFavoriteBatchModal } from "../favoriteBatchModal";

const ui = vi.hoisted(() => ({
	buttons: [] as { label: string; disabled: boolean; click: () => void }[],
	texts: [] as { value: string; disabled: boolean; change: (value: string) => void }[],
	paragraphs: [] as { text: string }[],
	closes: 0,
}));

vi.mock("obsidian", () => {
	interface FakeElement {
		tag: string;
		text: string;
		children: FakeElement[];
		createEl(childTag: string, options?: { text?: string }): FakeElement;
		createSpan(options?: { text?: string }): FakeElement;
		setText(value: string): void;
		empty(): void;
	}
	function element(tag = "div", initial = ""): FakeElement {
		const node: FakeElement = {
			tag,
			text: initial,
			children: [],
			createEl(childTag: string, options?: { text?: string }) {
				const child = element(childTag, options?.text ?? "");
				this.children.push(child);
				if (childTag === "p") ui.paragraphs.push(child);
				return child;
			},
			createSpan(options?: { text?: string }) {
				return this.createEl("span", options);
			},
			setText(value: string) {
				this.text = value;
			},
			empty() {
				this.children.length = 0;
			},
		};
		return node;
	}
	return {
		Modal: class {
			modalEl = { addClass: vi.fn() };
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
				const item = {
					value: "",
					disabled: false,
					change: (_value: string): void => undefined,
				};
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
					setDisabled(value: boolean) {
						item.disabled = value;
					},
					inputEl: { setAttribute() {}, focus() {} },
				});
				return this;
			}
			addDropdown(callback: (control: unknown) => void) {
				callback({
					addOption() {},
					setValue() {
						return this;
					},
					onChange() {},
					setDisabled() {},
				});
				return this;
			}
			addButton(callback: (control: unknown) => void) {
				const item = { label: "", disabled: false, click: (): void => undefined };
				ui.buttons.push(item);
				callback({
					setCta() {
						return this;
					},
					setButtonText(value: string) {
						item.label = value;
						return this;
					},
					setDisabled(value: boolean) {
						item.disabled = value;
					},
					onClick(click: () => void) {
						item.click = click;
					},
				});
				return this;
			}
		},
	};
});

function controller() {
	let snapshot: FavoriteBatchSnapshot = {
		status: "idle",
		targetPath: "",
		total: 0,
		processed: 0,
		saved: 0,
		skipped: 0,
		failed: 0,
		currentWord: "",
		message: "",
		failures: [],
	};
	let listener: () => void = () => undefined;
	const fake = {
		getSnapshot: () => snapshot,
		subscribe: (callback: () => void) => {
			listener = callback;
			return () => undefined;
		},
		categories: [{ id: "target", name: "默认收藏", path: "words.md" }],
		selectedCategoryId: "target",
		pathSuggestions: () => ["list.txt"],
		start: vi.fn(async () => undefined),
		stop: vi.fn(),
		openTarget: vi.fn(async () => true),
		dispose: vi.fn(),
	};
	return {
		fake: fake as unknown as FavoriteBatchController,
		update: (next: FavoriteBatchSnapshot) => {
			snapshot = next;
			listener();
		},
		spies: fake,
	};
}

describe("batch favorite modal", () => {
	beforeEach(() => {
		ui.buttons.length = 0;
		ui.texts.length = 0;
		ui.paragraphs.length = 0;
		ui.closes = 0;
	});

	it("shows progress and results, blocks close while running, and opens the target", async () => {
		const { fake, update, spies } = controller();
		const dismissed = vi.fn();
		const modal = new DictionaryFavoriteBatchModal({} as App, fake, () => "zh", dismissed);
		modal.open();
		expect(ui.buttons[0]!.disabled).toBe(true);
		ui.texts[0]!.change("list.txt");
		expect(ui.buttons[0]!.disabled).toBe(false);
		ui.buttons[0]!.click();
		expect(spies.start).toHaveBeenCalledWith("list.txt", "target");
		update({
			status: "running",
			targetPath: "words.md",
			total: 3,
			processed: 1,
			saved: 1,
			skipped: 0,
			failed: 0,
			currentWord: "banana",
			message: "",
			failures: [],
		});
		modal.close();
		expect(ui.closes).toBe(0);
		expect(ui.paragraphs.map((item) => item.text)).toContain("已处理 1/3");
		expect(ui.paragraphs.map((item) => item.text)).toContain("当前：banana");
		ui.buttons[1]!.click();
		expect(spies.stop).toHaveBeenCalledOnce();
		update({
			status: "partial",
			targetPath: "words.md",
			total: 3,
			processed: 3,
			saved: 1,
			skipped: 1,
			failed: 1,
			currentWord: "",
			message: "",
			failures: [{ line: 3, word: "carrot", reason: "AI 错误" }],
		});
		expect(ui.paragraphs.map((item) => item.text)).toContain("批量收藏部分完成。");
		expect(JSON.stringify(modal.contentEl)).toContain("第 3 行 · carrot");
		expect(ui.buttons[2]!.disabled).toBe(false);
		ui.buttons[2]!.click();
		await vi.waitFor(() => expect(spies.openTarget).toHaveBeenCalledOnce());
		modal.close();
		expect(ui.closes).toBe(1);
		expect(dismissed).toHaveBeenCalledOnce();
	});
});
