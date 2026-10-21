import type {
	DictionarySettings,
	DictionarySettingsStore,
	LocalDictionaryAdministrationState,
} from "../domain/types";

interface DictionarySettingsStoreOptions {
	/** Currently committed dictionary settings. */
	readDictionarySettings(): Readonly<DictionarySettings>;
	/** Persists the supplied dictionary settings slice; rejects when the write failed. */
	commitDictionarySettings(dictionary: DictionarySettings): Promise<void>;
}

/**
 * Adapts the plugin's single `data.json` settings slice to the dictionary
 * domain seam.
 *
 * The local dictionary administration module works transactionally: it reads a
 * snapshot, stages a mutated catalog, calls `save()`, and restores the previous
 * snapshot when saving fails. `save()` therefore commits whatever has been
 * staged, and staged state stays visible to `getDictionarySettings()` until the
 * write settles — mirroring the source tool's in-memory settings store.
 */
export function createDictionarySettingsStore(
	options: DictionarySettingsStoreOptions,
): DictionarySettingsStore {
	let staged: LocalDictionaryAdministrationState | null = null;

	const currentDictionarySettings = (): Readonly<DictionarySettings> => {
		const committed = options.readDictionarySettings();
		if (!staged) return committed;
		return {
			...committed,
			localDictionaries: staged.localDictionaries,
			sources: staged.sources,
		};
	};

	return {
		getDictionarySettings: currentDictionarySettings,

		async updateDictionarySettings(
			mutate: (draft: DictionarySettings) => void,
		): Promise<boolean> {
			const draft = structuredClone(currentDictionarySettings()) as DictionarySettings;
			mutate(draft);
			try {
				await options.commitDictionarySettings(draft);
				staged = null;
				return true;
			} catch (error) {
				console.error("Failed to save dictionary settings:", error);
				return false;
			}
		},

		getLocalDictionaryAdministrationState(): Readonly<LocalDictionaryAdministrationState> {
			const dictionary = currentDictionarySettings();
			return {
				localDictionaries: structuredClone(dictionary.localDictionaries),
				sources: structuredClone(dictionary.sources),
			};
		},

		setLocalDictionaryAdministrationState(state: LocalDictionaryAdministrationState): void {
			staged = structuredClone(state);
		},

		async save(): Promise<void> {
			const dictionary = structuredClone(currentDictionarySettings()) as DictionarySettings;
			await options.commitDictionarySettings(dictionary);
			staged = null;
		},
	};
}
