import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { copyTextToClipboard } from "../clipboard";

describe("copyTextToClipboard", () => {
	const originalClipboard = navigator.clipboard;

	afterEach(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			writable: true,
			configurable: true,
		});
		vi.restoreAllMocks();
	});

	it("returns false for empty string", async () => {
		const result = await copyTextToClipboard("");
		expect(result).toBe(false);
	});

	it("uses navigator.clipboard.writeText when available and successful", async () => {
		const writeTextMock = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: writeTextMock },
			writable: true,
			configurable: true,
		});

		const result = await copyTextToClipboard("Hello world");
		expect(result).toBe(true);
		expect(writeTextMock).toHaveBeenCalledWith("Hello world");
	});

	it("falls back to document.execCommand when navigator.clipboard fails", async () => {
		const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: writeTextMock },
			writable: true,
			configurable: true,
		});

		const mockTextArea = {
			value: "",
			style: {},
			setAttribute: vi.fn(),
			focus: vi.fn(),
			select: vi.fn(),
			remove: vi.fn(),
		};
		const execCommandMock = vi.fn().mockReturnValue(true);
		const mockDocument = {
			createElement: vi.fn().mockReturnValue(mockTextArea),
			body: {
				appendChild: vi.fn(),
			},
			execCommand: execCommandMock,
		};

		const originalDocument = globalThis.document;
		// @ts-expect-error mock document in node
		globalThis.document = mockDocument;

		try {
			const result = await copyTextToClipboard("Fallback text");
			expect(result).toBe(true);
			expect(execCommandMock).toHaveBeenCalledWith("copy");
			expect(mockTextArea.value).toBe("Fallback text");
		} finally {
			globalThis.document = originalDocument;
		}
	});
});
