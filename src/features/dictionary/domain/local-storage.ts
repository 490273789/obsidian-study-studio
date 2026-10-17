import type { CompiledDictionarySettings } from "./types";
import type { CompiledPackageProgressPhase, CompiledPackageSourceFormat } from "./compiled-package";

export interface LocalDictionaryStorageProgress {
	readonly completedBytes: number;
	readonly fileName: string;
	readonly phase: CompiledPackageProgressPhase;
	readonly totalBytes: number;
}

export type LocalDictionaryStorageProgressListener = (
	progress: LocalDictionaryStorageProgress,
) => void;

export interface LocalDictionaryStorageImport {
	readonly files: readonly File[];
	readonly format: CompiledPackageSourceFormat;
	readonly id: string;
}

export interface LocalDictionaryStoragePackage {
	readonly compiled: CompiledDictionarySettings;
	readonly id: string;
}

export interface LocalDictionaryStorageImportTransaction {
	readonly packages: readonly LocalDictionaryStoragePackage[];
	/** May fail (e.g. pending recovery); callers must await and map the failure. */
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface LocalDictionaryStorageRemoval {
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export type LocalDictionaryStorageFailureCode =
	| "cancelled"
	| "collision"
	| "corrupt"
	| "encrypted"
	| "limit-exceeded"
	| "recovery-incomplete"
	| "storage-failed"
	| "unsupported"
	| "unsupported-format";

export class LocalDictionaryStorageError extends Error {
	constructor(
		readonly code: LocalDictionaryStorageFailureCode,
		message = "Local dictionary storage operation failed.",
	) {
		super(message);
		this.name = "LocalDictionaryStorageError";
	}
}

export interface LocalDictionaryStorageAdapter {
	cancelActive(): void;
	stageImport(
		imports: readonly LocalDictionaryStorageImport[],
		onProgress?: LocalDictionaryStorageProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryStorageImportTransaction>;
	stageRemoval(dictionaryId: string): Promise<LocalDictionaryStorageRemoval>;
}
