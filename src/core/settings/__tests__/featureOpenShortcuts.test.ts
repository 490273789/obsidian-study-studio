import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_FEATURE_OPEN_SHORTCUTS,
	featureOpenHotkeys,
	featureOpenShortcutsSlice,
	normalizeFeatureOpenShortcut,
} from "../featureOpenShortcuts";

describe("feature open shortcuts", () => {
	it("uses the agreed five defaults and converts an Obsidian command hotkey", () => {
		expect(featureOpenShortcutsSlice.defaults().featureOpenShortcuts).toEqual(
			DEFAULT_FEATURE_OPEN_SHORTCUTS,
		);
		expect(featureOpenHotkeys("Ctrl+Alt+K")).toEqual([
			{ modifiers: ["Ctrl", "Alt"], key: "K" },
		]);
		expect(featureOpenHotkeys("")).toEqual([]);
	});

	it("rejects typing keys and repairs persisted duplicates without replacing custom values", () => {
		expect(normalizeFeatureOpenShortcut("A")).toBeNull();
		expect(normalizeFeatureOpenShortcut("Shift+1")).toBeNull();
		expect(normalizeFeatureOpenShortcut("Alt+Escape")).toBeNull();
		const normalized = featureOpenShortcutsSlice.normalize({
			featureOpenShortcuts: {
				selectionHelper: "Alt+K",
				videoPlayer: "Alt+K",
				dictionary: "Ctrl+K",
				flashcards: "",
				audioPractice: "invalid",
			},
		}).featureOpenShortcuts;
		expect(normalized).toEqual({
			selectionHelper: "Alt+K",
			videoPlayer: "",
			dictionary: "Ctrl+K",
			flashcards: "",
			audioPractice: "Alt+5",
		});
	});
});
