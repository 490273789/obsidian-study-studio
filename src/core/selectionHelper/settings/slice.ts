import type { SelectionHelperModifier, SelectionHelperSettings } from "../domain/types";
import { settingsRecord, type SettingsSlice } from "../../settings/slice";

export interface SelectionPopupSliceSettings {
	selectionPopup: SelectionHelperSettings;
}

export const DEFAULT_SELECTION_POPUP_SETTINGS: SelectionHelperSettings = {
	enabled: true,
	modifier: "none",
	selectedDictionaries: [],
	dictionaryOrder: [],
};

export function normalizeSelectionPopupModifier(value: unknown): SelectionHelperModifier {
	if (value === "alt" || value === "shift" || value === "ctrl") {
		return value;
	}
	return "none";
}

export function normalizeSelectionPopupSettings(value: unknown): SelectionHelperSettings {
	if (typeof value !== "object" || value === null) {
		return {
			...DEFAULT_SELECTION_POPUP_SETTINGS,
			selectedDictionaries: [],
			dictionaryOrder: [],
		};
	}
	const candidate = value as Record<string, unknown>;
	const selectedDictionaries = Array.isArray(candidate.selectedDictionaries)
		? candidate.selectedDictionaries.filter((item): item is string => typeof item === "string")
		: [];

	return {
		enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
		modifier: normalizeSelectionPopupModifier(candidate.modifier),
		selectedDictionaries,
		dictionaryOrder: Array.isArray(candidate.dictionaryOrder)
			? [
					...new Set(
						candidate.dictionaryOrder.filter(
							(item): item is string => typeof item === "string" && item.length > 0,
						),
					),
				]
			: [],
	};
}

export const selectionPopupSettingsSlice: SettingsSlice<SelectionPopupSliceSettings> = {
	id: "selectionPopup",
	keys: ["selectionPopup"],

	defaults: () => ({
		selectionPopup: {
			...DEFAULT_SELECTION_POPUP_SETTINGS,
			selectedDictionaries: [...DEFAULT_SELECTION_POPUP_SETTINGS.selectedDictionaries],
			dictionaryOrder: [...DEFAULT_SELECTION_POPUP_SETTINGS.dictionaryOrder],
		},
	}),

	normalize: (raw) => ({
		selectionPopup: normalizeSelectionPopupSettings(settingsRecord(raw).selectionPopup),
	}),

	clone: (document) => ({
		selectionPopup: {
			...document.selectionPopup,
			selectedDictionaries: [...document.selectionPopup.selectedDictionaries],
			dictionaryOrder: [...document.selectionPopup.dictionaryOrder],
		},
	}),
};
