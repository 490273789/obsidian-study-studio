import { defineSettings, type SettingsPresentation } from "../../settings/presentation";
import type { Language } from "../../shared/types";
import type { SelectionHelperModifier, SelectionHelperSettings } from "../domain/types";
import { selectionHelperStrings } from "../strings/selectionPopup";
import { orderSelectionDictionaries } from "../domain/dictionaryOrder";

export interface AvailableDictionaryItem {
	id: string;
	label: string;
}

export interface SelectionHelperSettingsActions {
	setEnabled: (enabled: boolean) => Promise<void>;
	setModifier: (modifier: SelectionHelperModifier) => Promise<void>;
	toggleDictionary: (id: string, enabled: boolean) => Promise<void>;
	moveDictionary: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function buildSelectionHelperSettingsViewModel(
	settings: SelectionHelperSettings,
	availableDictionaries: readonly AvailableDictionaryItem[],
	actions: SelectionHelperSettingsActions,
	language: Language,
	webStatus: "idle" | "available" | "unavailable" | "mobile" = "idle",
	saving = false,
): SettingsPresentation {
	const strings = selectionHelperStrings(language);

	return defineSettings("selection-helper", (page) => {
		page.group("general", strings.settingsHeading, (group) => {
			group.toggle(
				"enabled",
				{ name: strings.enablePopup, description: strings.enablePopupDesc },
				{ value: settings.enabled, disabled: saving, onChange: actions.setEnabled },
			);
			group.select(
				"modifier",
				{ name: strings.modifier, description: strings.modifierDesc },
				{
					value: settings.modifier,
					disabled: saving,
					options: [
						{ value: "none", label: strings.modifierNone },
						{ value: "alt", label: strings.modifierAlt },
						{ value: "shift", label: strings.modifierShift },
						{ value: "ctrl", label: strings.modifierCtrl },
					],
					onChange: (value) => actions.setModifier(value as SelectionHelperModifier),
				},
			);

			group.row("web-compatibility", {
				name: strings.webCompatibility,
				description: strings.webStatus[webStatus],
			});

			if (availableDictionaries.length === 0) return;
			const selectedSet = new Set(
				settings.selectedDictionaries.length > 0
					? settings.selectedDictionaries
					: availableDictionaries.map((dictionary) => dictionary.id),
			);
			group.reorderable(
				"dictionary-selection",
				{
					name: strings.dictSelectionHeading,
					description: strings.dictSelectionDesc,
				},
				{
					allowDrag: true,
					disabled: saving,
					items: orderSelectionDictionaries(
						availableDictionaries,
						settings.dictionaryOrder,
					).map((dictionary) => ({
						id: dictionary.id,
						label: dictionary.label,
						kindLabel: "",
						enabled: selectedSet.has(dictionary.id),
						onToggle: (enabled) => actions.toggleDictionary(dictionary.id, enabled),
					})),
					onMove: actions.moveDictionary,
					tooltips: {
						drag: strings.dictDrag,
						moveUp: strings.dictMoveUp,
						moveDown: strings.dictMoveDown,
					},
				},
			);
		});
	});
}
