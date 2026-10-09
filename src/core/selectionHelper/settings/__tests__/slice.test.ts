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

	it("clones settings without mutating original", () => {
		const original = {
			selectionPopup: {
				enabled: true,
				modifier: "alt" as const,
				selectedDictionaries: ["youdao"],
			},
		};
		const cloned = selectionPopupSettingsSlice.clone(original);
		expect(cloned).toEqual(original);
		cloned.selectionPopup.enabled = false;
		cloned.selectionPopup.selectedDictionaries.push("cambridge");
		expect(original.selectionPopup.enabled).toBe(true);
		expect(original.selectionPopup.selectedDictionaries).toEqual(["youdao"]);
	});

	it("normalizes selectedDictionaries correctly", () => {
		expect(
			normalizeSelectionPopupSettings({
				selectedDictionaries: ["youdao", 123, "cambridge"],
			}).selectedDictionaries,
		).toEqual(["youdao", "cambridge"]);
	});
});
