import { describe, expect, it } from "vitest";
import {
	hasDuplicateShortcuts,
	keyboardShortcutFromEvent,
	matchesKeyboardShortcut,
} from "../keyboardShortcut";

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
	it("records and matches normalized single keys and chords", () => {
		expect(keyboardShortcutFromEvent(event(" "))).toBe("Space");
		expect(keyboardShortcutFromEvent(event("p", { ctrlKey: true, metaKey: true }))).toBe(
			"Ctrl+Meta+P",
		);
		expect(matchesKeyboardShortcut(event("ArrowLeft"), "ArrowLeft")).toBe(true);
		expect(matchesKeyboardShortcut(event("p", { shiftKey: true }), "Shift+P")).toBe(true);
		expect(matchesKeyboardShortcut(event("p"), "Shift+P")).toBe(false);
	});

	it("ignores modifier-only input and detects assigned duplicates", () => {
		expect(keyboardShortcutFromEvent(event("Shift", { shiftKey: true }))).toBeNull();
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
