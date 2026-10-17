import type { DictionarySettingsStore, LocalDictionaryAdministrationState } from "./types";

export type LocalCatalogFailureCode =
	| "persistence-failed"
	| "storage-failed"
	| "recovery-incomplete";

export type LocalCatalogTransactionOutcome =
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

/**
 * The single whole-dictionary transaction after staging: persist the catalog,
 * then commit the staged sources. Any failure unwinds through rollback and the
 * previous catalog; a failed unwind is reported as recovery-incomplete so the
 * module can latch degraded state instead of pretending it recovered.
 */
export async function commitLocalCatalogTransaction(options: {
	readonly settings: DictionarySettingsStore;
	readonly before: LocalDictionaryAdministrationState;
	readonly next: LocalDictionaryAdministrationState;
	readonly stage: CatalogStage;
}): Promise<LocalCatalogTransactionOutcome> {
	const restoreCatalog = () => {
		options.settings.setLocalDictionaryAdministrationState(structuredClone(options.before));
	};

	options.settings.setLocalDictionaryAdministrationState(structuredClone(options.next));
	try {
		await options.settings.save();
	} catch {
		restoreCatalog();
		try {
			await options.stage.rollback();
		} catch {
			return { kind: "failed", code: "recovery-incomplete", recovery: "incomplete" };
		}
		return { kind: "failed", code: "persistence-failed", recovery: "complete" };
	}

	try {
		await options.stage.commit();
	} catch {
		let recoveryIncomplete = false;
		try {
			await options.stage.rollback();
		} catch {
			recoveryIncomplete = true;
		}
		if (!recoveryIncomplete) {
			restoreCatalog();
			try {
				await options.settings.save();
			} catch {
				recoveryIncomplete = true;
			}
		}
		return recoveryIncomplete
			? { kind: "failed", code: "recovery-incomplete", recovery: "incomplete" }
			: { kind: "failed", code: "storage-failed", recovery: "complete" };
	}

	return { kind: "applied" };
}
