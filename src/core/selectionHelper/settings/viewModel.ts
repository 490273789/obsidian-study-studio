import {
	defineSettings,
	settingsKey,
	type SettingsPresentation,
} from "../../settings/presentation";
import type { Language } from "../../shared/types";
import type { SelectionHelperModifier, SelectionHelperSettings } from "../domain/types";
import { selectionHelperStrings } from "../strings/selectionPopup";

export interface AvailableDictionaryItem {
	id: string;
	label: string;
}

export interface SelectionHelperSettingsActions {
	setEnabled: (enabled: boolean) => Promise<void>;
	setModifier: (modifier: SelectionHelperModifier) => Promise<void>;
	toggleDictionary: (id: string, enabled: boolean) => Promise<void>;
}

export function buildSelectionHelperSettingsViewModel(
	settings: SelectionHelperSettings,
	availableDictionaries: readonly AvailableDictionaryItem[],
	actions: SelectionHelperSettingsActions,
	language: Language,
): SettingsPresentation {
	const strings = selectionHelperStrings(language);

	return defineSettings("selection-helper", (page) => {
		page.group("general", strings.settingsHeading, (group) => {
			group.toggle(
				"enabled",
				{ name: strings.enablePopup, description: strings.enablePopupDesc },
				{ value: settings.enabled, onChange: actions.setEnabled },
			);
			group.select(
				"modifier",
				{ name: strings.modifier, description: strings.modifierDesc },
				{
					value: settings.modifier,
					options: [
						{ value: "none", label: strings.modifierNone },
						{ value: "alt", label: strings.modifierAlt },
						{ value: "shift", label: strings.modifierShift },
						{ value: "ctrl", label: strings.modifierCtrl },
					],
					onChange: (value) => actions.setModifier(value as SelectionHelperModifier),
				},
			);

			if (availableDictionaries.length === 0) return;
			group.row("dictionary-selection", {
				name: strings.dictSelectionHeading,
				description: strings.dictSelectionDesc,
			});

			const selectedSet = new Set(
				settings.selectedDictionaries.length > 0
					? settings.selectedDictionaries
					: availableDictionaries.map((dictionary) => dictionary.id),
			);
			for (const dictionary of availableDictionaries) {
				group.toggle(
					`dictionary-${settingsKey(dictionary.id)}`,
					{ name: dictionary.label },
					{
						value: selectedSet.has(dictionary.id),
						onChange: (enabled) => actions.toggleDictionary(dictionary.id, enabled),
					},
				);
			}
		});
	});
}
