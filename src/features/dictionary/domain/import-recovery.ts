import type { CompiledPackagePublication } from "./compiled-package";
import { LocalDictionaryStorageError } from "./local-storage";

interface OwnedDirectory {
	readonly path: string;
	publication?: CompiledPackagePublication;
}

interface ImportRecoveryStorage {
	mkdir(path: string): Promise<unknown>;
	rm(path: string, options: { force: boolean; recursive: boolean }): Promise<unknown>;
}

/** Internal batch ownership: only directories exclusively created here may be removed. */
export class DictionaryImportRecovery {
	private readonly owned: OwnedDirectory[] = [];
	private state: "staged" | "committed" | "rolled-back" = "staged";
	private rollbackPending: Promise<void> | null = null;

	constructor(private readonly storage: ImportRecoveryStorage) {}

	async stage(
		directory: string,
		publish: () => Promise<CompiledPackagePublication>,
	): Promise<CompiledPackagePublication> {
		await this.storage.mkdir(directory);
		const owned: OwnedDirectory = { path: directory };
		this.owned.push(owned);
		const publication = await publish();
		owned.publication = publication;
		return publication;
	}

	commit(): void {
		if (this.state !== "staged") return;
		if (this.rollbackPending) throw new LocalDictionaryStorageError("recovery-incomplete");
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
					await this.storage.rm(item.path, { force: true, recursive: true });
				}
			}),
		);
		if (results.some((result) => result.status === "rejected")) {
			throw new LocalDictionaryStorageError("recovery-incomplete");
		}
		this.state = "rolled-back";
	}
}
