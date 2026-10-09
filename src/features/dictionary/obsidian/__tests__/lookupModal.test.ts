import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import { dictionaryStrings } from "../../strings/dictionary";
import { DictionaryLookupModal } from "../modals";

vi.mock("obsidian", () => {
	class MockModal {
		containerEl = {
			addClass: vi.fn(),
			removeClass: vi.fn(),
		};
		modalEl = {
			addClass: vi.fn(),
			createDiv: vi.fn((cls?: string) => {
				const div = {
					cls,
					createDiv: vi.fn(() => div),
					createSpan: vi.fn(() => ({})),
					createEl: vi.fn(() => ({
						addEventListener: vi.fn(),
						setAttribute: vi.fn(),
						focus: vi.fn(),
						select: vi.fn(),
					})),
					appendChild: vi.fn(),
				};
				return div;
			}),
			querySelector: vi.fn(),
		};
		contentEl = {
			hide: vi.fn(),
			empty: vi.fn(),
		};
		titleEl = {
			remove: vi.fn(),
		};
		close() {
			this.onClose();
		}
		onClose() {}
	}

	return {
		Modal: MockModal,
		setIcon: vi.fn(),
	};
});

describe("DictionaryLookupModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies container class on open and removes it on close", () => {
		const onSubmit = vi.fn();
		const strings = dictionaryStrings("zh");
		const modal = new DictionaryLookupModal({} as App, onSubmit, strings, "test");

		modal.onOpen();

		expect(modal.containerEl.addClass).toHaveBeenCalledWith(
			"study-studio-dictionary-prompt-container",
		);
		expect(modal.modalEl.addClass).toHaveBeenCalledWith("prompt");
		expect(modal.modalEl.addClass).toHaveBeenCalledWith("study-studio-dictionary-prompt");

		modal.close();

		expect(modal.containerEl.removeClass).toHaveBeenCalledWith(
			"study-studio-dictionary-prompt-container",
		);
	});

	it("submits query when non-empty value is submitted", () => {
		const onSubmit = vi.fn();
		const strings = dictionaryStrings("zh");
		const modal = new DictionaryLookupModal({} as App, onSubmit, strings, "hello");

		modal.onOpen();
		// Call submit via reflection or keyboard event
		(modal as unknown as { submit: (val: string) => void }).submit("world");

		expect(onSubmit).toHaveBeenCalledWith("world");
	});

	it("does not submit when value is empty or only whitespace", () => {
		const onSubmit = vi.fn();
		const strings = dictionaryStrings("zh");
		const modal = new DictionaryLookupModal({} as App, onSubmit, strings, "");

		modal.onOpen();
		(modal as unknown as { submit: (val: string) => void }).submit("   ");

		expect(onSubmit).not.toHaveBeenCalled();
	});
});
