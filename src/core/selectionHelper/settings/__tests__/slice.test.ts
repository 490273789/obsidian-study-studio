import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_SELECTION_POPUP_SETTINGS,
	normalizeSelectionPopupModifier,
	normalizeSelectionPopupSettings,
	selectionPopupSettingsSlice,
} from "../slice";

describe("selectionPopupSettingsSlice", () => {
	it("returns default settings", () => {
		expect(selectionPopupSettingsSlice.defaults()).toEqual({
			selectionPopup: DEFAULT_SELECTION_POPUP_SETTINGS,
		});
	});

	it("normalizes valid settings", () => {
		expect(
			normalizeSelectionPopupSettings({
				enabled: false,
				modifier: "alt",
				selectedDictionaries: ["youdao"],
			}),
		).toEqual({
			enabled: false,
			modifier: "alt",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: ["youdao"],
		});
	});

	it("falls back to defaults on invalid inputs", () => {
		expect(normalizeSelectionPopupSettings(null)).toEqual(DEFAULT_SELECTION_POPUP_SETTINGS);
		expect(normalizeSelectionPopupSettings(undefined)).toEqual(
			DEFAULT_SELECTION_POPUP_SETTINGS,
		);
		expect(normalizeSelectionPopupSettings({ enabled: "yes", modifier: "invalid" })).toEqual({
			enabled: true,
			modifier: "none",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		});
	});

	it("normalizes modifiers correctly", () => {
		expect(normalizeSelectionPopupModifier("none")).toBe("none");
		expect(normalizeSelectionPopupModifier("alt")).toBe("alt");
		expect(normalizeSelectionPopupModifier("shift")).toBe("shift");
		expect(normalizeSelectionPopupModifier("ctrl")).toBe("ctrl");
		expect(normalizeSelectionPopupModifier("unknown")).toBe("none");
	});

	it("keeps a valid custom main-tab shortcut and repairs legacy or invalid values", () => {
		expect(
			normalizeSelectionPopupSettings({ openMainShortcut: "Meta+Shift+K" }).openMainShortcut,
		).toBe("Shift+Meta+K");
		expect(normalizeSelectionPopupSettings({}).openMainShortcut).toBe("Ctrl+Enter");
		expect(
			normalizeSelectionPopupSettings({ openMainShortcut: "Enter" }).openMainShortcut,
		).toBe("Ctrl+Enter");
	});

	it("clones settings without mutating original", () => {
		const original = {
			selectionPopup: {
				enabled: true,
				modifier: "alt" as const,
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: ["youdao"],
				selectedDictionaries: ["youdao"],
			},
		};
		const cloned = selectionPopupSettingsSlice.clone(original);
		expect(cloned).toEqual(original);
		cloned.selectionPopup.enabled = false;
		cloned.selectionPopup.selectedDictionaries.push("cambridge");
		cloned.selectionPopup.dictionaryOrder.push("cambridge");
		expect(original.selectionPopup.enabled).toBe(true);
		expect(original.selectionPopup.selectedDictionaries).toEqual(["youdao"]);
		expect(original.selectionPopup.dictionaryOrder).toEqual(["youdao"]);
	});

	it("restores valid popup order and safely normalizes legacy or malformed values", () => {
		expect(
			normalizeSelectionPopupSettings({ selectedDictionaries: ["youdao"] }).dictionaryOrder,
		).toEqual([]);
		expect(
			normalizeSelectionPopupSettings({
				dictionaryOrder: ["local", "youdao", "local", "", 1],
			}).dictionaryOrder,
		).toEqual(["local", "youdao"]);
		expect(
			normalizeSelectionPopupSettings({ dictionaryOrder: "local" }).dictionaryOrder,
		).toEqual([]);
	});

	it("normalizes selectedDictionaries correctly", () => {
		expect(
			normalizeSelectionPopupSettings({
				selectedDictionaries: ["youdao", 123, "cambridge"],
			}).selectedDictionaries,
		).toEqual(["youdao", "cambridge"]);
	});
});
