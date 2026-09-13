import type {
	CompiledDictionarySettings,
	DictionarySettingsStore,
	DictionarySourceSettings,
	LocalDictionaryAdministrationState,
	LocalDictionarySettings,
} from "./types";
import { isCompiledPackageCompatible, type CompiledPackageSourceFormat } from "./compiled-package";
import { MAX_EUDIC_DICTIONARY_BYTES } from "./eudic-image";
import type {
	LocalDictionaryStorageAdapter,
	LocalDictionaryStorageImport,
	LocalDictionaryStorageImportTransaction,
	LocalDictionaryStoragePackage,
	LocalDictionaryStorageProgress,
	LocalDictionaryStorageRemoval,
} from "./local-storage";
import { LocalDictionaryStorageError } from "./local-storage";

export interface LocalDictionaryListFile {
	readonly name: string;
	readonly size: number;
}

export interface LocalDictionaryListItem {
	readonly files: readonly LocalDictionaryListFile[];
	readonly id: string;
	readonly name: string;
	readonly compiled?: Readonly<CompiledDictionarySettings> & {
		readonly status: "ready";
	};
	readonly requiresReimport: boolean;
}

export type LocalDictionarySnapshot = readonly LocalDictionaryListItem[];

export type LocalDictionaryAdministrationFailureCode =
	| "unsupported"
	| "invalid-selection"
	| "not-found"
	| "storage-failed"
	| "persistence-failed"
	| "recovery-incomplete"
	| "cancelled"
	| "unsupported-format"
	| "encrypted"
	| "corrupt"
	| "limit-exceeded";

export interface LocalDictionaryAdministrationFailure {
	readonly code: LocalDictionaryAdministrationFailureCode;
	readonly recovery: "complete" | "incomplete";
}

export type LocalDictionaryImportPhase =
	| "validate"
	| "parse"
	| "index"
	| "records"
	| "resources"
	| "verify";

export interface LocalDictionaryImportProgress {
	readonly completedBytes: number;
	readonly fileName: string;
	readonly phase: LocalDictionaryImportPhase;
	readonly totalBytes: number;
}

export type LocalDictionaryImportProgressListener = (
	progress: LocalDictionaryImportProgress,
) => void;

export type LocalDictionaryImportResult =
	| {
			readonly imported: LocalDictionarySnapshot;
			readonly ok: true;
			readonly snapshot: LocalDictionarySnapshot;
	  }
	| {
			readonly error: LocalDictionaryAdministrationFailure;
			readonly ok: false;
			readonly snapshot: LocalDictionarySnapshot;
	  };

export type LocalDictionaryRemoveResult =
	| {
			readonly ok: true;
			readonly removed: LocalDictionaryListItem;
			readonly snapshot: LocalDictionarySnapshot;
	  }
	| {
			readonly error: LocalDictionaryAdministrationFailure;
			readonly ok: false;
			readonly snapshot: LocalDictionarySnapshot;
	  };

export interface LocalDictionaryAdministration {
	importFiles(
		files: readonly File[],
		onProgress?: LocalDictionaryImportProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryImportResult>;
	list(): LocalDictionarySnapshot;
	remove(dictionaryId: string): Promise<LocalDictionaryRemoveResult>;
}

interface LocalDictionaryCandidate {
	readonly files: readonly File[];
	readonly format: CompiledPackageSourceFormat;
	readonly name: string;
}

interface LocalDictionarySourceFile {
	readonly directory: string;
	readonly file: File;
	readonly lowerName: string;
	readonly name: string;
}

interface LocalDictionaryDirectoryIndex {
	mdxCount: number;
	readonly resourcesByBase: Map<string, LocalDictionarySourceFile[]>;
	readonly scripts: LocalDictionarySourceFile[];
	readonly scriptsByBase: Map<string, LocalDictionarySourceFile[]>;
	readonly stylesheets: LocalDictionarySourceFile[];
	readonly stylesheetsByBase: Map<string, LocalDictionarySourceFile[]>;
}

const MAX_DICTIONARY_CSS_BYTES = 8 * 1_048_576;
const MAX_DICTIONARY_JAVASCRIPT_BYTES = 8 * 1_048_576;
const MAX_ID_ATTEMPTS = 8;

function safeFileName(value: string): boolean {
	return /^[^/\\]+\.(?:eudic|mdx|(?:\d+\.)?mdd|css|js)$/i.test(value);
}

function dictionaryBase(name: string): string {
	return name.replace(/\.(?:eudic|mdx)$/i, "");
}

function compareFileNames(left: string, right: string): number {
	const leftName = left.normalize("NFKC");
	const rightName = right.normalize("NFKC");
	return leftName < rightName ? -1 : Number(leftName > rightName);
}

function normalizedDictionaryBase(name: string): string {
	return dictionaryBase(name).normalize("NFKC").toLowerCase();
}

function insensitiveFileBase(value: string): string {
	return value.toUpperCase().toLowerCase();
}

function addIndexedFile(
	index: Map<string, LocalDictionarySourceFile[]>,
	base: string,
	file: LocalDictionarySourceFile,
): void {
	const key = insensitiveFileBase(base);
	const indexed = index.get(key) ?? [];
	indexed.push(file);
	index.set(key, indexed);
}

function createDirectoryIndex(): LocalDictionaryDirectoryIndex {
	return {
		mdxCount: 0,
		resourcesByBase: new Map(),
		scripts: [],
		scriptsByBase: new Map(),
		stylesheets: [],
		stylesheetsByBase: new Map(),
	};
}

function isNestedAlternative(
	source: LocalDictionarySourceFile,
	mdxDirectoriesByBase: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	const directories = mdxDirectoriesByBase.get(normalizedDictionaryBase(source.name));
	if (!directories || source.directory === "") return false;
	let parentEnd = source.directory.lastIndexOf("/");
	while (parentEnd >= 0) {
		const parent = source.directory.slice(0, parentEnd);
		if (directories.has(parent)) return true;
		parentEnd = parent.lastIndexOf("/");
	}
	return directories.has("");
}

function resourceVolume(name: string, pattern: RegExp): number {
	const suffix = pattern.exec(name)?.[1];
	return suffix === undefined ? 0 : Number.parseInt(suffix, 10) + 1;
}

function matchingCompanionFiles(
	companions: readonly LocalDictionarySourceFile[],
	exactCandidates: readonly LocalDictionarySourceFile[],
	mdxCount: number,
	pattern: RegExp,
): File[] {
	const exact = exactCandidates.filter((candidate) => pattern.test(candidate.name));
	const selected =
		exact.length > 0 ? exact : companions.length === 1 && mdxCount === 1 ? companions : [];
	return selected.map((candidate) => candidate.file);
}

export function groupDictionaryFiles(files: readonly File[]): LocalDictionaryCandidate[] {
	const usable = files.flatMap((file): LocalDictionarySourceFile[] => {
		const name = file.name;
		if (!safeFileName(name)) return [];
		const relativePath = (file.webkitRelativePath ?? "").replaceAll("\\", "/");
		const parts = relativePath ? relativePath.split("/").filter(Boolean) : [];
		if (parts.some((part) => part === "." || part === "..")) return [];
		return [
			{
				directory: parts.slice(0, -1).join("/"),
				file,
				lowerName: name.toLowerCase(),
				name,
			},
		];
	});
	const indexesByDirectory = new Map<string, LocalDictionaryDirectoryIndex>();
	const mdxFiles: LocalDictionarySourceFile[] = [];
	const mdxDirectoriesByBase = new Map<string, Set<string>>();
	for (const source of usable) {
		const directoryIndex = indexesByDirectory.get(source.directory) ?? createDirectoryIndex();
		indexesByDirectory.set(source.directory, directoryIndex);
		if (source.lowerName.endsWith(".mdx")) {
			mdxFiles.push(source);
			directoryIndex.mdxCount += 1;
			const base = normalizedDictionaryBase(source.name);
			const directories = mdxDirectoriesByBase.get(base) ?? new Set<string>();
			directories.add(source.directory);
			mdxDirectoriesByBase.set(base, directories);
			continue;
		}
		if (source.lowerName.endsWith(".mdd")) {
			const resourceBase = source.name.slice(0, -4);
			addIndexedFile(directoryIndex.resourcesByBase, resourceBase, source);
			const numberedVolume = /^(.*)\.(\d+)$/.exec(resourceBase);
			if (numberedVolume?.[1] !== undefined) {
				addIndexedFile(directoryIndex.resourcesByBase, numberedVolume[1], source);
			}
			continue;
		}
		if (source.lowerName.endsWith(".css")) {
			directoryIndex.stylesheets.push(source);
			addIndexedFile(directoryIndex.stylesheetsByBase, source.name.slice(0, -4), source);
			continue;
		}
		if (source.lowerName.endsWith(".js")) {
			directoryIndex.scripts.push(source);
			addIndexedFile(directoryIndex.scriptsByBase, source.name.slice(0, -3), source);
		}
	}
	const groups = mdxFiles
		.filter((source) => !isNestedAlternative(source, mdxDirectoriesByBase))
		.map(({ directory, file: mdx, name: sourceName }): LocalDictionaryCandidate => {
			const name = dictionaryBase(sourceName);
			const directoryIndex = indexesByDirectory.get(directory) ?? createDirectoryIndex();
			const fileBase = insensitiveFileBase(name);
			const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const resourcePattern = new RegExp(`^${escaped}(?:\\.(\\d+))?\\.mdd$`, "i");
			const stylesheetPattern = new RegExp(`^${escaped}\\.css$`, "i");
			const javascriptPattern = new RegExp(`^${escaped}\\.js$`, "i");
			const resources = (directoryIndex.resourcesByBase.get(fileBase) ?? []).filter(
				(candidate) => resourcePattern.test(candidate.name),
			);
			// oxlint-disable-next-line unicorn/no-array-sort -- resources is a new ES2022-compatible array.
			resources.sort(
				(left, right) =>
					resourceVolume(left.name, resourcePattern) -
						resourceVolume(right.name, resourcePattern) ||
					compareFileNames(left.name, right.name),
			);
			return {
				files: [
					mdx,
					...resources.map((candidate) => candidate.file),
					...matchingCompanionFiles(
						directoryIndex.stylesheets,
						directoryIndex.stylesheetsByBase.get(fileBase) ?? [],
						directoryIndex.mdxCount,
						stylesheetPattern,
					),
					...matchingCompanionFiles(
						directoryIndex.scripts,
						directoryIndex.scriptsByBase.get(fileBase) ?? [],
						directoryIndex.mdxCount,
						javascriptPattern,
					),
				],
				format: "mdict",
				name,
			};
		});
	groups.push(
		...usable
			.filter(({ lowerName }) => lowerName.endsWith(".eudic"))
			.map(({ file, name }): LocalDictionaryCandidate => ({
				files: [file],
				format: "eudic",
				name: dictionaryBase(name),
			})),
	);
	return groups;
}

function validCandidates(candidates: readonly LocalDictionaryCandidate[]): boolean {
	return (
		candidates.length > 0 &&
		!candidates.some((candidate) =>
			candidate.files.some(
				(file) =>
					file.name.toLowerCase().endsWith(".css") &&
					file.size > MAX_DICTIONARY_CSS_BYTES,
			),
		) &&
		!candidates.some((candidate) =>
			candidate.files.some(
				(file) =>
					file.name.toLowerCase().endsWith(".js") &&
					file.size > MAX_DICTIONARY_JAVASCRIPT_BYTES,
			),
		) &&
		!candidates.some(
			(candidate) =>
				candidate.format === "eudic" &&
				((candidate.files[0]?.size ?? 0) <= 0 ||
					(candidate.files[0]?.size ?? 0) > MAX_EUDIC_DICTIONARY_BYTES),
		)
	);
}

function dictionarySlug(name: string): string {
	return (
		name
			.normalize("NFKD")
			.replace(/[^a-z\d]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase()
			.slice(0, 48) || "dictionary"
	);
}

function allocateDictionaryId(name: string, reserved: Set<string>): string | null {
	const slug = dictionarySlug(name);
	for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
		const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
		if (reserved.has(id)) continue;
		reserved.add(id);
		return id;
	}
	return null;
}

function createImportPlans(
	candidates: readonly LocalDictionaryCandidate[],
	existingIds: readonly string[],
): LocalDictionaryStorageImport[] | null {
	const reserved = new Set(existingIds);
	const imports: LocalDictionaryStorageImport[] = [];
	for (const candidate of candidates) {
		const id = allocateDictionaryId(candidate.name, reserved);
		if (!id) return null;
		imports.push({ files: candidate.files, format: candidate.format, id });
	}
	return imports;
}

function toListItem(dictionary: Readonly<LocalDictionarySettings>): LocalDictionaryListItem {
	const requiresReimport = !isCompiledPackageCompatible(dictionary.compiled);
	const item: LocalDictionaryListItem = {
		files: dictionary.files.map((file) => ({ name: file.name, size: file.size })),
		id: dictionary.id,
		name: dictionary.name,
		requiresReimport,
	};
	return dictionary.compiled
		? {
				...item,
				compiled: {
					...dictionary.compiled,
					status: "ready",
				},
			}
		: item;
}

function toSnapshot(
	dictionaries: readonly Readonly<LocalDictionarySettings>[],
): LocalDictionarySnapshot {
	return dictionaries.map(toListItem);
}

function copySnapshot(snapshot: LocalDictionarySnapshot): LocalDictionarySnapshot {
	return snapshot.map((dictionary) => ({
		...dictionary,
		files: dictionary.files.map((file) => ({ ...file })),
	}));
}

function stateWithCatalog(
	current: Readonly<LocalDictionaryAdministrationState>,
	localDictionaries: readonly Readonly<LocalDictionarySettings>[],
): LocalDictionaryAdministrationState {
	const localById = new Map(localDictionaries.map((dictionary) => [dictionary.id, dictionary]));
	const retainedSources = current.sources.filter(
		(source) => source.kind !== "local" || localById.has(source.id),
	);
	const retainedIds = new Set(retainedSources.map((source) => source.id));
	const appendedSources: DictionarySourceSettings[] = [];
	for (const dictionary of localDictionaries) {
		if (retainedIds.has(dictionary.id)) continue;
		appendedSources.push({
			enabled: true,
			id: dictionary.id,
			kind: "local",
			label: dictionary.name,
		});
	}
	return {
		localDictionaries: localDictionaries.map((dictionary) => structuredClone(dictionary)),
		sources: [...structuredClone(retainedSources), ...appendedSources],
	};
}

function failure(
	code: LocalDictionaryAdministrationFailureCode,
	recovery: "complete" | "incomplete" = "complete",
): LocalDictionaryAdministrationFailure {
	return { code, recovery };
}

function storageFailure(error: unknown): LocalDictionaryAdministrationFailure {
	if (!(error instanceof LocalDictionaryStorageError)) return failure("storage-failed");
	if (error.code === "recovery-incomplete") return failure("recovery-incomplete", "incomplete");
	if (error.code === "collision") return failure("storage-failed");
	return failure(error.code);
}

function reportProgress(
	listener: LocalDictionaryImportProgressListener | undefined,
): ((progress: LocalDictionaryStorageProgress) => void) | undefined {
	return listener
		? (progress) => {
				listener({ ...progress });
			}
		: undefined;
}

function importedMembers(
	candidates: readonly LocalDictionaryCandidate[],
	imports: readonly LocalDictionaryStorageImport[],
	packages: readonly LocalDictionaryStoragePackage[],
): LocalDictionarySettings[] | null {
	if (imports.length !== candidates.length || packages.length !== imports.length) return null;
	const packagesById = new Map(packages.map((item) => [item.id, item]));
	if (packagesById.size !== packages.length) return null;
	return imports.flatMap((item, index): LocalDictionarySettings[] => {
		const candidate = candidates[index];
		const packageItem = packagesById.get(item.id);
		if (!candidate || !packageItem) return [];
		return [
			{
				compiled: structuredClone(packageItem.compiled),
				directory: item.id,
				files: candidate.files.map((file) => ({ name: file.name, size: file.size })),
				id: item.id,
				name: candidate.name,
			},
		];
	});
}

export class LocalDictionaryAdministrationModule implements LocalDictionaryAdministration {
	private degraded = false;
	private queue: Promise<void> = Promise.resolve();
	private snapshot: LocalDictionarySnapshot;

	constructor(
		private readonly settings: DictionarySettingsStore,
		private readonly storage: LocalDictionaryStorageAdapter,
		private readonly invalidateRuntimeCache: () => void = () => undefined,
	) {
		this.snapshot = toSnapshot(
			settings.getLocalDictionaryAdministrationState().localDictionaries,
		);
	}

	list(): LocalDictionarySnapshot {
		return copySnapshot(this.snapshot);
	}

	importFiles(
		files: readonly File[],
		onProgress?: LocalDictionaryImportProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryImportResult> {
		return this.enqueue(async () => this.importNow(files, onProgress, signal));
	}

	remove(dictionaryId: string): Promise<LocalDictionaryRemoveResult> {
		return this.enqueue(async () => this.removeNow(dictionaryId));
	}

	cancelActiveOperations(): void {
		this.storage.cancelActive();
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation, operation);
		this.queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private importFailure(
		code: LocalDictionaryAdministrationFailureCode,
		recovery: "complete" | "incomplete" = "complete",
	): LocalDictionaryImportResult {
		return { error: failure(code, recovery), ok: false, snapshot: this.list() };
	}

	private importStorageFailure(error: unknown): LocalDictionaryImportResult {
		const result = storageFailure(error);
		if (result.recovery === "incomplete") this.enterDegraded();
		return { error: result, ok: false, snapshot: this.list() };
	}

	private removeFailure(
		code: LocalDictionaryAdministrationFailureCode,
		recovery: "complete" | "incomplete" = "complete",
	): LocalDictionaryRemoveResult {
		return { error: failure(code, recovery), ok: false, snapshot: this.list() };
	}

	private removeStorageFailure(error: unknown): LocalDictionaryRemoveResult {
		const result = storageFailure(error);
		if (result.recovery === "incomplete") this.enterDegraded();
		return { error: result, ok: false, snapshot: this.list() };
	}

	private enterDegraded(): void {
		this.degraded = true;
	}

	private invalidateCache(): void {
		try {
			this.invalidateRuntimeCache();
		} catch {
			// Cache invalidation is an idempotent, non-throwing internal adapter by contract.
		}
	}

	private commitSnapshot(): LocalDictionarySnapshot {
		this.snapshot = toSnapshot(
			this.settings.getLocalDictionaryAdministrationState().localDictionaries,
		);
		this.invalidateCache();
		return this.list();
	}

	private async importNow(
		files: readonly File[],
		onProgress?: LocalDictionaryImportProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryImportResult> {
		if (this.degraded) return this.importFailure("recovery-incomplete", "incomplete");
		if (files.length === 0) return this.importFailure("invalid-selection");
		const candidates = groupDictionaryFiles(files);
		if (!validCandidates(candidates)) return this.importFailure("invalid-selection");
		const before = this.settings.getLocalDictionaryAdministrationState();

		let imports: LocalDictionaryStorageImport[] | null = null;
		let transaction: LocalDictionaryStorageImportTransaction | null = null;
		for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
			imports = createImportPlans(
				candidates,
				before.localDictionaries.map((dictionary) => dictionary.id),
			);
			if (!imports) return this.importFailure("storage-failed");
			try {
				// oxlint-disable-next-line no-await-in-loop -- a collision requires fresh stable IDs.
				transaction = await this.storage.stageImport(
					imports,
					reportProgress(onProgress),
					signal,
				);
				break;
			} catch (error) {
				if (error instanceof LocalDictionaryStorageError && error.code === "collision")
					continue;
				return this.importStorageFailure(error);
			}
		}
		if (!imports || !transaction) return this.importFailure("storage-failed");

		const imported = importedMembers(candidates, imports, transaction.packages);
		if (!imported || imported.length !== candidates.length) {
			try {
				await transaction.rollback();
			} catch {
				this.enterDegraded();
				return this.importFailure("recovery-incomplete", "incomplete");
			}
			return this.importFailure("storage-failed");
		}

		const next = stateWithCatalog(before, [...before.localDictionaries, ...imported]);
		this.settings.setLocalDictionaryAdministrationState(next);
		try {
			await this.settings.save();
		} catch {
			this.settings.setLocalDictionaryAdministrationState(structuredClone(before));
			try {
				await transaction.rollback();
			} catch {
				this.enterDegraded();
				return this.importFailure("recovery-incomplete", "incomplete");
			}
			return this.importFailure("persistence-failed");
		}

		transaction.commit();
		const snapshot = this.commitSnapshot();
		const importedIds = new Set(imported.map((dictionary) => dictionary.id));
		return {
			imported: snapshot.filter((dictionary) => importedIds.has(dictionary.id)),
			ok: true,
			snapshot,
		};
	}

	private async removeNow(dictionaryId: string): Promise<LocalDictionaryRemoveResult> {
		if (this.degraded) return this.removeFailure("recovery-incomplete", "incomplete");
		const before = this.settings.getLocalDictionaryAdministrationState();
		const dictionary = before.localDictionaries.find(
			(candidate) => candidate.id === dictionaryId,
		);
		if (!dictionary) return this.removeFailure("not-found");

		let removal: LocalDictionaryStorageRemoval;
		try {
			removal = await this.storage.stageRemoval(dictionaryId);
		} catch (error) {
			return this.removeStorageFailure(error);
		}

		const next = stateWithCatalog(
			before,
			before.localDictionaries.filter((candidate) => candidate.id !== dictionaryId),
		);
		this.settings.setLocalDictionaryAdministrationState(next);
		try {
			await this.settings.save();
		} catch {
			this.settings.setLocalDictionaryAdministrationState(structuredClone(before));
			try {
				await removal.rollback();
			} catch {
				this.enterDegraded();
				return this.removeFailure("recovery-incomplete", "incomplete");
			}
			return this.removeFailure("persistence-failed");
		}

		try {
			await removal.commit();
		} catch {
			let recoveryIncomplete = false;
			try {
				await removal.rollback();
			} catch {
				recoveryIncomplete = true;
			}
			if (!recoveryIncomplete) {
				this.settings.setLocalDictionaryAdministrationState(structuredClone(before));
				try {
					await this.settings.save();
				} catch {
					recoveryIncomplete = true;
				}
			}
			if (recoveryIncomplete) {
				this.enterDegraded();
				return this.removeFailure("recovery-incomplete", "incomplete");
			}
			return this.removeFailure("storage-failed");
		}

		const snapshot = this.commitSnapshot();
		return { ok: true, removed: toListItem(dictionary), snapshot };
	}
}
