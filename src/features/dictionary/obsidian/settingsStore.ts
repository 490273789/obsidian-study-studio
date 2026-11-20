import type { WorkbenchHost } from "../../../core/host/workbench";
import { normalizeDictionarySettings } from "../domain/configuration";
import type { DictionarySettingsStore } from "../domain/types";

/** Applies mutations to the committed dictionary slice inside the host write queue. */
export function createDictionarySettingsStore(
	settings: WorkbenchHost<"dictionary">["settings"],
): DictionarySettingsStore {
	return {
		getDictionarySettings: () => settings.read().dictionary,

		async updateDictionarySettings(mutate): Promise<boolean> {
			try {
				await settings.update(({ dictionary }) => {
					mutate(dictionary);
					return { dictionary: normalizeDictionarySettings(dictionary) };
				});
				return true;
			} catch (error) {
				console.error("Failed to save dictionary settings:", error);
				return false;
			}
		},

		getLocalDictionaryAdministrationState() {
			const { localDictionaries, sources } = settings.read().dictionary;
			return { localDictionaries, sources };
		},
	};
}
