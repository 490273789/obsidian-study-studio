import type {
	DictionarySettingsStore,
	LocalDictionaryAdministrationState,
	LocalDictionarySettings,
} from "./types";

type LocalCatalogFailureCode = "persistence-failed" | "storage-failed" | "recovery-incomplete";
type LocalCatalogTransactionOutcome =
	| { readonly kind: "applied" }
	| {
			readonly kind: "failed";
			readonly code: LocalCatalogFailureCode;
			readonly recovery: "complete" | "incomplete";
	  };

interface CatalogStage {
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

type CatalogMutation = (catalog: LocalDictionaryAdministrationState) => void;
type CatalogChange =
	| { readonly type: "import"; readonly dictionaries: readonly LocalDictionarySettings[] }
	| { readonly type: "remove"; readonly dictionaryId: string };

/** Persists the membership change before finalizing the staged files. Compensation
 * applies only its inverse to the latest settings, preserving other source edits.
 */
export async function commitLocalCatalogTransaction(options: {
	readonly settings: DictionarySettingsStore;
	readonly change: CatalogChange;
	readonly stage: CatalogStage;
}): Promise<LocalCatalogTransactionOutcome> {
	const { settings, change, stage } = options;
	let restore: CatalogMutation = () => undefined;
	if (
		!(await persist(settings, (catalog) => {
			restore = applyCatalogChange(catalog, change);
		}))
	) {
		try {
			await stage.rollback();
		} catch {
			return { kind: "failed", code: "recovery-incomplete", recovery: "incomplete" };
		}
		return { kind: "failed", code: "persistence-failed", recovery: "complete" };
	}

	try {
		await stage.commit();
	} catch {
		try {
			await stage.rollback();
		} catch {
			return { kind: "failed", code: "recovery-incomplete", recovery: "incomplete" };
		}
		return (await persist(settings, restore))
			? { kind: "failed", code: "storage-failed", recovery: "complete" }
			: { kind: "failed", code: "recovery-incomplete", recovery: "incomplete" };
	}

	return { kind: "applied" };
}

async function persist(
	settings: DictionarySettingsStore,
	mutate: CatalogMutation,
): Promise<boolean> {
	try {
		return await settings.updateDictionarySettings(mutate);
	} catch {
		return false;
	}
}

function applyCatalogChange(
	catalog: LocalDictionaryAdministrationState,
	change: CatalogChange,
): CatalogMutation {
	if (change.type === "import") {
		const ids = new Set(change.dictionaries.map(({ id }) => id));
		if (
			catalog.localDictionaries.some(({ id }) => ids.has(id)) ||
			catalog.sources.some(({ id }) => ids.has(id))
		) {
			throw new Error("Dictionary membership changed while staging an import.");
		}
		for (const dictionary of change.dictionaries) {
			catalog.localDictionaries.push(structuredClone(dictionary));
			catalog.sources.push({
				enabled: true,
				id: dictionary.id,
				kind: "local",
				label: dictionary.name,
			});
		}
		return (current) => {
			current.localDictionaries = current.localDictionaries.filter(({ id }) => !ids.has(id));
			current.sources = current.sources.filter(({ id }) => !ids.has(id));
		};
	}

	const { dictionaryId } = change;
	if (!catalog.localDictionaries.some(({ id }) => id === dictionaryId)) {
		throw new Error("Dictionary membership changed while staging a removal.");
	}
	const restoreDictionary = removeMember(catalog.localDictionaries, dictionaryId);
	const restoreSource = removeMember(catalog.sources, dictionaryId);
	return (current) => {
		restoreDictionary(current.localDictionaries);
		restoreSource(current.sources);
	};
}

function removeMember<Item extends { id: string }>(items: Item[], id: string) {
	const index = items.findIndex((item) => item.id === id);
	if (index === -1) return (_current: Item[]) => undefined;
	const previousId = items[index - 1]?.id;
	const nextId = items[index + 1]?.id;
	const [removed] = items.splice(index, 1);
	return (current: Item[]): void => {
		if (!removed || current.some((item) => item.id === id)) return;
		const next = current.findIndex((item) => item.id === nextId);
		const previous = current.findIndex((item) => item.id === previousId);
		const insertionIndex = next >= 0 ? next : previous >= 0 ? previous + 1 : current.length;
		current.splice(insertionIndex, 0, removed);
	};
}
