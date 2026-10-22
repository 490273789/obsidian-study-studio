import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { dictionaryStrings } from "../../strings/dictionary";
import { promptLocalDictionaryName } from "../modals";

interface NameKeyEvent {
	key: string;
	isComposing: boolean;
	keyCode: number;
	preventDefault(): void;
}

const ui = vi.hoisted(() => ({
	change: null as ((value: string) => void) | null,
	keydown: null as ((event: NameKeyEvent) => void) | null,
	closed: 0,
}));

vi.mock("obsidian", () => ({
	Modal: class {
		contentEl = { empty: vi.fn() };
		setTitle() {}
		open() {
			this.onOpen();
		}
		close() {
			ui.closed += 1;
			this.onClose();
		}
		onOpen() {}
		onClose() {}
	},
	Setting: class {
		setName() {
			return this;
		}
		addText(callback: (text: object) => void) {
			const text = {
				inputEl: {
					maxLength: 0,
					addEventListener: (_type: string, listener: (event: NameKeyEvent) => void) => {
						ui.keydown = listener;
					},
					focus: vi.fn(),
					select: vi.fn(),
				},
				setValue() {
					return this;
				},
				onChange(listener: (value: string) => void) {
					ui.change = listener;
					return this;
				},
			};
			callback(text);
			return this;
		}
		addButton(callback: (button: object) => void) {
			const button = {
				setButtonText() {
					return this;
				},
				setDisabled() {
					return this;
				},
				setCta() {
					return this;
				},
				onClick() {
					return this;
				},
			};
			callback(button);
			return this;
		}
	},
}));

describe("local dictionary name modal", () => {
	beforeEach(() => {
		ui.change = null;
		ui.keydown = null;
		ui.closed = 0;
	});

	it("ignores IME confirmation and saves on a later plain Enter", async () => {
		const pending = promptLocalDictionaryName({} as App, dictionaryStrings("zh"), "Old");
		const preventDefault = vi.fn();
		ui.change?.("我的词典");
		ui.keydown?.({ key: "Enter", isComposing: true, keyCode: 13, preventDefault });
		expect(ui.closed).toBe(0);
		ui.keydown?.({ key: "Enter", isComposing: false, keyCode: 229, preventDefault });
		expect(ui.closed).toBe(0);
		ui.keydown?.({ key: "Enter", isComposing: false, keyCode: 13, preventDefault });
		expect(await pending).toBe("我的词典");
		expect(ui.closed).toBe(1);
		expect(preventDefault).toHaveBeenCalledOnce();
	});
});
