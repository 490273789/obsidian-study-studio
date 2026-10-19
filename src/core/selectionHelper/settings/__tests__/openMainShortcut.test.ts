import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_OPEN_MAIN_SHORTCUT,
	matchesOpenMainShortcut,
	normalizeOpenMainShortcut,
	parseOpenMainShortcut,
} from "../openMainShortcut";

describe("lookup popup main-tab shortcut", () => {
	it("accepts modifier chords and rejects typing and close keys", () => {
		expect(parseOpenMainShortcut("Meta+Shift+K")).toBe("Shift+Meta+K");
		expect(parseOpenMainShortcut("Ctrl+Enter")).toBe(DEFAULT_OPEN_MAIN_SHORTCUT);
		expect(parseOpenMainShortcut("Enter")).toBeNull();
		expect(parseOpenMainShortcut("Shift+Enter")).toBeNull();
		expect(parseOpenMainShortcut("Ctrl+Escape")).toBeNull();
		expect(parseOpenMainShortcut("Ctrl+Ctrl+K")).toBeNull();
		expect(normalizeOpenMainShortcut("bad")).toBe(DEFAULT_OPEN_MAIN_SHORTCUT);
	});

	it("matches the configured modifiers and key exactly", () => {
		const eventFields = {
			key: "k",
			ctrlKey: false,
			altKey: true,
			shiftKey: false,
			metaKey: false,
		};
		const event = eventFields as KeyboardEvent;
		expect(matchesOpenMainShortcut(event, "Alt+K")).toBe(true);
		expect(matchesOpenMainShortcut(event, "Ctrl+K")).toBe(false);
		expect(
			matchesOpenMainShortcut({ ...eventFields, shiftKey: true } as KeyboardEvent, "Alt+K"),
		).toBe(false);
	});
});
