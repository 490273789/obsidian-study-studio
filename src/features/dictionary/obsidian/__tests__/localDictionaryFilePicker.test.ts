import { describe, expect, it, vi } from "vite-plus/test";
import { pickLocalDictionaryFiles } from "../localDictionaryFilePicker";

interface FakeInput {
	accept: string;
	multiple: boolean;
	style: { display: string };
	type: string;
	addEventListener: ReturnType<typeof vi.fn>;
	click: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
	setAttribute: ReturnType<typeof vi.fn>;
}

function createPickerDocument() {
	const listeners = new Map<string, () => void>();
	const append = vi.fn();
	const createElement = vi.fn();
	const input: FakeInput = {
		accept: "",
		multiple: false,
		style: { display: "" },
		type: "",
		addEventListener: vi.fn((type: string, listener: () => void) => {
			listeners.set(type, listener);
		}),
		click: vi.fn(),
		remove: vi.fn(),
		setAttribute: vi.fn(),
	};
	createElement.mockReturnValue(input);
	const document = {
		body: { append },
		createElement,
	} as unknown as Document;
	return { append, createElement, document, input, listeners };
}

describe("pickLocalDictionaryFiles", () => {
	it("opens the file picker in the active Obsidian document", () => {
		const picker = createPickerDocument();
		(globalThis as unknown as { activeDocument: Document }).activeDocument = picker.document;

		void pickLocalDictionaryFiles("files", "导入本地词典");

		expect(picker.createElement).toHaveBeenCalledWith("input");
		expect(picker.append).toHaveBeenCalledWith(picker.input);
		expect(picker.input.click).toHaveBeenCalledOnce();
		expect(picker.input.accept).toBe(".eudic,.mdx,.mdd,.css,.js");
	});

	it("configures directory selection and resolves cancellation", async () => {
		const picker = createPickerDocument();
		const result = pickLocalDictionaryFiles("folder", "导入词典目录", picker.document);

		expect(picker.input.setAttribute).toHaveBeenCalledWith("webkitdirectory", "");
		picker.listeners.get("cancel")?.();

		await expect(result).resolves.toEqual([]);
		expect(picker.input.remove).toHaveBeenCalledOnce();
	});
});
