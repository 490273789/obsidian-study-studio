import { describe, expect, it } from "vite-plus/test";
import { hasDuplicateShortcuts, matchesKeyboardShortcut } from "../keyboardShortcut";

const event = (
	key: string,
	modifiers: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
) => ({
	key,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	metaKey: false,
	...modifiers,
});

describe("video player keyboard shortcuts", () => {
	it("matches normalized single keys and chords", () => {
		expect(matchesKeyboardShortcut(event("ArrowLeft"), "ArrowLeft")).toBe(true);
		expect(matchesKeyboardShortcut(event("p", { shiftKey: true }), "Shift+P")).toBe(true);
		expect(matchesKeyboardShortcut(event("p"), "Shift+P")).toBe(false);
	});

	it("detects assigned duplicates", () => {
		expect(
			hasDuplicateShortcuts({
				togglePlayback: "Space",
				seekBackward: "ArrowLeft",
				seekForward: "ArrowLeft",
			}),
		).toBe(true);
		expect(
			hasDuplicateShortcuts({
				togglePlayback: "",
				seekBackward: "",
				seekForward: "ArrowRight",
			}),
		).toBe(false);
	});
});
