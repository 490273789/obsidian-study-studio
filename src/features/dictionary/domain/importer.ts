// The desktop importer lazily imports Node built-ins. `@types/node` is a
// devDependency but is not part of the default program, so reference it here to
// keep `node:fs/promises` typed without changing the deferred import calls.
/// <reference types="node" />
import { FileSystemAdapter, Platform, type App, type Plugin } from "obsidian";
import {
	CompiledPackageError,
	createCompiledPackagePublisher,
	type CompiledPackagePublisher,
} from "./compiled-package";
import type {
	LocalDictionaryStorageAdapter,
	LocalDictionaryStorageImport,
	LocalDictionaryStorageImportTransaction,
	LocalDictionaryStorageProgressListener,
	LocalDictionaryStorageRemoval,
} from "./local-storage";
import { LocalDictionaryStorageError } from "./local-storage";
import { DictionaryImportRecovery } from "./import-recovery";

function dictionaryStorageRoot(app: App, plugin: Plugin): string {
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) {
		throw new LocalDictionaryStorageError("unsupported");
	}
	const basePath = app.vault.adapter.getBasePath();
	return `${basePath}/${app.vault.configDir}/plugins/${plugin.manifest.id}/dictionaries`;
}

function validateDictionaryId(dictionaryId: string): void {
	if (!/^[a-z\d][a-z\d-]{2,80}$/i.test(dictionaryId)) {
		throw new LocalDictionaryStorageError("storage-failed");
	}
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function storageError(error: unknown): LocalDictionaryStorageError {
	if (error instanceof LocalDictionaryStorageError) return error;
	if (error instanceof CompiledPackageError) {
		return new LocalDictionaryStorageError(
			error.code === "incompatible" ? "corrupt" : error.code,
			error.message,
		);
	}
	return new LocalDictionaryStorageError(
		"storage-failed",
		error instanceof Error ? error.message : undefined,
	);
}

export class LocalDictionaryImporter implements LocalDictionaryStorageAdapter {
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
		imports: readonly LocalDictionaryStorageImport[],
		onProgress?: LocalDictionaryStorageProgressListener,
		signal?: AbortSignal,
	): Promise<LocalDictionaryStorageImportTransaction> {
		validateImports(imports);
		if (signal?.aborted) throw new LocalDictionaryStorageError("cancelled");
		const root = this.rootPath;
		const { lstat, mkdir, rm } = await import("node:fs/promises");
		await mkdir(root, { recursive: true });
		const collisions = await Promise.all(
			imports.map(async (item) =>
				Boolean(
					(await pathExists(lstat, `${root}/${item.id}`)) ||
					(await pathExists(lstat, `${root}/.import-${item.id}`)),
				),
			),
		);
		if (collisions.includes(true)) throw new LocalDictionaryStorageError("collision");
		const controller = new AbortController();
		const cancel = () => controller.abort();
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) controller.abort();
		this.controllers.add(controller);
		const recovery = new DictionaryImportRecovery({
			mkdir: async (directory) => {
				try {
					await mkdir(directory);
				} catch (error) {
					if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOTEMPTY")) {
						throw new LocalDictionaryStorageError("collision");
					}
					throw storageError(error);
				}
			},
			rm,
		});
		const packages: Array<LocalDictionaryStorageImportTransaction["packages"][number]> = [];
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
			const failure = storageError(error);
			// An abort must never hide failed recovery, even when it originated in the publisher.
			if (failure.code === "recovery-incomplete") throw failure;
			if (controller.signal.aborted) throw new LocalDictionaryStorageError("cancelled");
			throw failure;
		} finally {
			signal?.removeEventListener("abort", cancel);
			this.controllers.delete(controller);
		}

		return {
			commit: () => recovery.commit(),
			packages,
			rollback: () => recovery.rollback(),
		};
	}

	async stageRemoval(dictionaryId: string): Promise<LocalDictionaryStorageRemoval> {
		validateDictionaryId(dictionaryId);
		const source = `${this.rootPath}/${dictionaryId}`;
		const staged = `${this.rootPath}/.remove-${dictionaryId}-${crypto.randomUUID().slice(0, 8)}`;
		const { rename, rm } = await import("node:fs/promises");
		try {
			await rename(source, staged);
		} catch (error) {
			if (hasErrorCode(error, "ENOENT")) {
				return { commit: async () => undefined, rollback: async () => undefined };
			}
			throw storageError(error);
		}
		let state: "staged" | "committed" | "rolled-back" = "staged";
		return {
			commit: async () => {
				if (state !== "staged") return;
				try {
					await rm(staged, { force: true, recursive: true });
					state = "committed";
				} catch (error) {
					throw storageError(error);
				}
			},
			rollback: async () => {
				if (state !== "staged") return;
				try {
					await rename(staged, source);
					state = "rolled-back";
				} catch {
					throw new LocalDictionaryStorageError("recovery-incomplete");
				}
			},
		};
	}
}

function validateImports(imports: readonly LocalDictionaryStorageImport[]): void {
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
		throw new LocalDictionaryStorageError("storage-failed");
	}
}

async function pathExists(
	lstat: (path: string) => Promise<unknown>,
	path: string,
): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return false;
		throw storageError(error);
	}
}
