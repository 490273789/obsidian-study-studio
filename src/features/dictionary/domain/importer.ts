// The desktop importer lazily imports Node built-ins. `@types/node` is a
// devDependency but is not part of the default program, so reference it here to
// keep `node:fs/promises` typed without changing the deferred import calls.
/// <reference types="node" />
import { FileSystemAdapter, Platform, type App, type Plugin } from "obsidian";
import {
	CompiledPackageError,
	createCompiledPackagePublisher,
	type CompiledPackagePublication,
	type CompiledPackagePublisher,
	type CompiledPackageSourceFormat,
} from "./compiled-package";
import type { LocalDictionaryImportProgressListener } from "./local-administration";
import type { CompiledDictionarySettings } from "./types";
import { hasErrorCode, pathExists } from "./fs-errors";

export interface LocalDictionaryImportPlan {
	readonly files: readonly File[];
	readonly format: CompiledPackageSourceFormat;
	readonly id: string;
}

export interface LocalDictionaryStagedPackage {
	readonly compiled: CompiledDictionarySettings;
	readonly id: string;
}

export interface LocalDictionaryImportTransaction {
	readonly packages: readonly LocalDictionaryStagedPackage[];
	/** May fail (e.g. pending recovery); callers must await and map the failure. */
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface LocalDictionaryRemoval {
	/** Marks the isolated package as deleted. Cleanup after that point is best-effort. */
	commit(): Promise<void>;
	/** Restores the isolated package while removal is still staged. */
	rollback(): Promise<void>;
}

export class LocalDictionaryUnsupportedError extends Error {
	readonly code = "unsupported" as const;

	constructor(message = "Local dictionary import is supported on desktop only.") {
		super(message);
		this.name = "LocalDictionaryUnsupportedError";
	}
}

interface OwnedDirectory {
	readonly path: string;
	publication?: CompiledPackagePublication;
}

type FsMkdir = (typeof import("node:fs/promises"))["mkdir"];
type FsRm = (typeof import("node:fs/promises"))["rm"];

/** Internal batch ownership: only directories exclusively created here may be removed. */
class ImportBatchRecovery {
	private readonly owned: OwnedDirectory[] = [];
	private state: "staged" | "committed" | "rolled-back" = "staged";
	private rollbackPending: Promise<void> | null = null;

	constructor(
		private readonly mkdir: FsMkdir,
		private readonly rm: FsRm,
	) {}

	async stage(
		directory: string,
		publish: () => Promise<CompiledPackagePublication>,
	): Promise<CompiledPackagePublication> {
		try {
			await this.mkdir(directory);
		} catch (error) {
			if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOTEMPTY")) {
				throw new CompiledPackageError("collision");
			}
			throw toImportError(error);
		}
		const owned: OwnedDirectory = { path: directory };
		this.owned.push(owned);
		const publication = await publish();
		owned.publication = publication;
		return publication;
	}

	commit(): void {
		if (this.state !== "staged") return;
		if (this.rollbackPending) throw new CompiledPackageError("recovery-incomplete");
		for (const item of this.owned) item.publication?.commit();
		this.state = "committed";
	}

	rollback(): Promise<void> {
		if (this.state !== "staged") return Promise.resolve();
		if (this.rollbackPending) return this.rollbackPending;
		const pending = this.clean().finally(() => {
			this.rollbackPending = null;
		});
		this.rollbackPending = pending;
		return pending;
	}

	private async clean(): Promise<void> {
		const results = await Promise.allSettled(
			this.owned.map(async (item) => {
				// Try directory cleanup even if the package's own rollback fails.
				try {
					await item.publication?.rollback();
				} finally {
					await this.rm(item.path, { force: true, recursive: true });
				}
			}),
		);
		if (results.some((result) => result.status === "rejected")) {
			throw new CompiledPackageError("recovery-incomplete");
		}
		this.state = "rolled-back";
	}
}

function dictionaryStorageRoot(app: App, plugin: Plugin): string {
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) {
		throw new LocalDictionaryUnsupportedError();
	}
	const basePath = app.vault.adapter.getBasePath();
	return `${basePath}/${app.vault.configDir}/plugins/${plugin.manifest.id}/dictionaries`;
}

function validateDictionaryId(dictionaryId: string): void {
	if (!/^[a-z\d][a-z\d-]{2,80}$/i.test(dictionaryId)) {
		throw new CompiledPackageError("storage-failed");
	}
}

function toImportError(error: unknown): CompiledPackageError | LocalDictionaryUnsupportedError {
	if (error instanceof CompiledPackageError || error instanceof LocalDictionaryUnsupportedError) {
		return error;
	}
	return new CompiledPackageError(
		"storage-failed",
		error instanceof Error ? error.message : undefined,
	);
}

async function cleanDeletedPackages(root: string): Promise<void> {
	const { readdir, rm } = await import("node:fs/promises");
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const deleted = entries.filter(
			(entry) =>
				entry.isDirectory() &&
				/^\.removed-[a-z\d][a-z\d-]{2,80}-[a-f\d]{8}$/i.test(entry.name),
		);
		for (const entry of deleted) {
			// oxlint-disable-next-line no-await-in-loop -- avoid concurrent recursive deletes.
			await rm(`${root}/${entry.name}`, { force: true, recursive: true }).catch(
				(error: unknown) => {
					console.warn("Failed to clean a deleted dictionary package:", error);
				},
			);
		}
	} catch (error) {
		if (!hasErrorCode(error, "ENOENT")) {
			console.warn("Failed to list deleted dictionary packages:", error);
		}
	}
}

export class LocalDictionaryImporter {
	private readonly controllers = new Set<AbortController>();

	constructor(
		private readonly app: App,
		private readonly plugin: Plugin,
		private readonly packagePublisher: CompiledPackagePublisher = createCompiledPackagePublisher(),
	) {}

	private get rootPath(): string {
		return dictionaryStorageRoot(this.app, this.plugin);
	}

	cancelActive(): void {
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
		this.packagePublisher.close();
	}

	async stageImport(
		imports: readonly LocalDictionaryImportPlan[],
		onProgress?: LocalDictionaryImportProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryImportTransaction> {
		validateImports(imports);
		if (signal?.aborted) throw new CompiledPackageError("cancelled");
		const root = this.rootPath;
		const { lstat, mkdir, rm } = await import("node:fs/promises");
		await mkdir(root, { recursive: true });
		const collisions = await Promise.all(
			imports.map(async (item) =>
				Boolean(
					(await pathExists(lstat, `${root}/${item.id}`, toImportError)) ||
					(await pathExists(lstat, `${root}/.import-${item.id}`, toImportError)),
				),
			),
		);
		if (collisions.includes(true)) throw new CompiledPackageError("collision");
		const controller = new AbortController();
		const cancel = () => controller.abort();
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) controller.abort();
		this.controllers.add(controller);
		const recovery = new ImportBatchRecovery(mkdir, rm);
		const packages: LocalDictionaryStagedPackage[] = [];
		try {
			for (const item of imports) {
				controller.signal.throwIfAborted();
				const destination = `${root}/${item.id}`;
				// oxlint-disable-next-line no-await-in-loop -- reserve and publish each dictionary before advancing.
				const publication = await recovery.stage(destination, () =>
					this.packagePublisher.publish(
						{
							dictionaryDirectory: destination,
							files: item.files,
							format: item.format,
						},
						onProgress,
						controller.signal,
					),
				);
				packages.push({ compiled: publication.metadata, id: item.id });
			}
			controller.signal.throwIfAborted();
		} catch (error) {
			await recovery.rollback();
			const failure = toImportError(error);
			// An abort must never hide failed recovery, even when it originated in the publisher.
			if (failure.code === "recovery-incomplete") throw failure;
			if (controller.signal.aborted) throw new CompiledPackageError("cancelled");
			throw failure;
		} finally {
			signal?.removeEventListener("abort", cancel);
			this.controllers.delete(controller);
		}

		return {
			commit: async () => recovery.commit(),
			packages,
			rollback: () => recovery.rollback(),
		};
	}

	async stageRemoval(dictionaryId: string): Promise<LocalDictionaryRemoval> {
		validateDictionaryId(dictionaryId);
		const root = this.rootPath;
		const source = `${root}/${dictionaryId}`;
		const suffix = `${dictionaryId}-${crypto.randomUUID().slice(0, 8)}`;
		const staged = `${root}/.remove-${suffix}`;
		const deleted = `${root}/.removed-${suffix}`;
		const { rename, rm } = await import("node:fs/promises");
		await cleanDeletedPackages(root);
		try {
			await rename(source, staged);
		} catch (error) {
			if (hasErrorCode(error, "ENOENT")) {
				return { commit: async () => undefined, rollback: async () => undefined };
			}
			throw toImportError(error);
		}
		let state: "staged" | "committed" | "rolled-back" = "staged";
		return {
			commit: async () => {
				if (state !== "staged") return;
				try {
					await rename(staged, deleted);
				} catch (error) {
					throw toImportError(error);
				}
				// A recursive deletion can remove some files before failing. After the
				// directory is marked as deleted, the catalog must never restore it.
				state = "committed";
				try {
					await rm(deleted, { force: true, recursive: true });
				} catch (error) {
					console.warn("Failed to clean a deleted dictionary package:", error);
				}
			},
			rollback: async () => {
				if (state !== "staged") return;
				try {
					await rename(staged, source);
					state = "rolled-back";
				} catch {
					throw new CompiledPackageError("recovery-incomplete");
				}
			},
		};
	}
}

function validateImports(imports: readonly LocalDictionaryImportPlan[]): void {
	const ids = new Set<string>();
	if (
		imports.length === 0 ||
		imports.some((item) => {
			validateDictionaryId(item.id);
			if (ids.has(item.id)) return true;
			ids.add(item.id);
			return item.files.length === 0;
		})
	) {
		throw new CompiledPackageError("storage-failed");
	}
}
