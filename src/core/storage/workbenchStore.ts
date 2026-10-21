import type { Plugin } from "obsidian";
import type { FlashcardSettings } from "../shared/types";
import {
	DEFAULT_SETTINGS,
	cloneSettingsDocument,
	normalizeSettingsDocument,
} from "../host/settingsSlices";

/** Minimal storage backend interface satisfied by Obsidian's Plugin. */
export interface StorageBackend {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

interface StoredWorkbenchDocument {
	schemaVersion: number;
	settings: FlashcardSettings;
	[partitionKey: string]: unknown;
}

type WorkbenchStoreChangeInput =
	| { readonly kind: "settings"; readonly source?: object }
	| {
			readonly kind: "partition";
			readonly partitionKey: string;
			readonly source?: object;
	  }
	| { readonly kind: "document"; readonly source?: object }
	| { readonly kind: "external" };

export type WorkbenchStoreChange = WorkbenchStoreChangeInput & {
	readonly revision: number;
};

interface WorkbenchStoreMutationOptions {
	/** Reject inside the write queue if another durable transition committed first. */
	readonly expectedRevision?: number;
	/** Opaque in-process identity used by adapters to absorb their own revision echo. */
	readonly source?: object;
}

interface PendingMutation {
	readonly build: (document: StoredWorkbenchDocument) => StoredWorkbenchDocument;
	readonly change: WorkbenchStoreChangeInput;
	readonly expectedRevision?: number;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

interface MutationBatch {
	readonly keys: Set<string>;
	readonly mutations: PendingMutation[];
}

export class WorkbenchStoreConflictError extends Error {
	constructor(
		readonly expectedRevision: number,
		readonly actualRevision: number,
	) {
		super(`WorkbenchStore revision changed from ${expectedRevision} to ${actualRevision}`);
		this.name = "WorkbenchStoreConflictError";
	}
}

/**
 * WorkbenchStore - the single atomic persistence authority for the entire plugin.
 *
 * Coordinates atomic serialization to data.json, external sync reload transitions,
 * monotonic revision publishing, and partition-level updates with zero knowledge
 * of feature-internal domain models.
 */
export class WorkbenchStore {
	private readonly backend: StorageBackend;
	private settings: FlashcardSettings;
	private document: StoredWorkbenchDocument;
	/** One writer for data.json. Every write is sequenced after prior writes settle. */
	private writeTail: Promise<void> = Promise.resolve();
	private openBatch: MutationBatch | null = null;
	private revision = 0;
	private readonly revisionListeners = new Set<(change: WorkbenchStoreChange) => void>();
	private loaded = false;

	constructor(backendOrPlugin: StorageBackend | Plugin, initialSettings?: FlashcardSettings) {
		this.backend = backendOrPlugin;
		this.settings = cloneSettingsDocument(initialSettings ?? DEFAULT_SETTINGS);
		this.document = {
			schemaVersion: 2,
			settings: this.settings,
		};
	}

	/**
	 * Loads settings and all persisted document partitions from disk in a single read.
	 */
	async loadSettings(): Promise<FlashcardSettings> {
		return this.enqueueWrite(async () => {
			const data = (await this.backend.loadData()) as StoredWorkbenchDocument | null;
			this.restoreDocument(data);
			this.loaded = true;
			return cloneSettingsDocument(this.settings);
		});
	}

	/**
	 * No-op if loadSettings() was already called (all data is loaded in one read).
	 */
	async load(): Promise<void> {
		if (this.loaded) return;
		await this.loadSettings();
	}

	/**
	 * Saves settings to disk and publishes a revision update.
	 */
	async saveSettings(
		newSettings?: FlashcardSettings,
		options: WorkbenchStoreMutationOptions = {},
	): Promise<void> {
		await this.enqueueMutation(
			(document) => {
				const next = cloneSettingsDocument(newSettings ?? document.settings);
				return JSON.stringify(next) === JSON.stringify(document.settings)
					? document
					: { ...document, settings: next };
			},
			"settings",
			{ kind: "settings", source: options.source },
			options,
		);
	}

	/** Returns a copy of the current committed settings document. */
	getSettings(): FlashcardSettings {
		return cloneSettingsDocument(this.settings);
	}

	/**
	 * Reads a named data partition from the persisted document snapshot.
	 */
	getPartition<T = unknown>(partitionKey: string): T | undefined {
		return this.document[partitionKey] as T | undefined;
	}

	/**
	 * Atomically persists a data partition to disk and publishes a revision update.
	 */
	async savePartition<T>(
		partitionKey: string,
		partitionData: T,
		options: WorkbenchStoreMutationOptions = {},
	): Promise<void> {
		await this.enqueueMutation(
			(document) =>
				Object.prototype.hasOwnProperty.call(document, partitionKey) &&
				(partitionData === null || typeof partitionData !== "object") &&
				document[partitionKey] === partitionData
					? document
					: { ...document, [partitionKey]: partitionData },
			partitionKey,
			{ kind: "partition", partitionKey, source: options.source },
			options,
		);
	}

	/**
	 * Atomically executes a document mutation against the authoritative in-memory document.
	 */
	async mutateDocument(
		mutator: (doc: StoredWorkbenchDocument) => void,
		options: WorkbenchStoreMutationOptions = {},
	): Promise<void> {
		await this.enqueueWrite(async () => {
			this.assertExpectedRevision(options.expectedRevision);
			const nextDocument = structuredClone(this.document);
			mutator(nextDocument);
			const nextSettings = nextDocument.settings
				? cloneSettingsDocument(nextDocument.settings)
				: this.settings;
			nextDocument.settings = nextSettings;
			await this.backend.saveData(nextDocument);
			this.document = nextDocument;
			if (nextDocument.settings) {
				this.settings = nextSettings;
			}
			this.publishRevision({ kind: "document", source: options.source });
		});
	}

	/**
	 * Reloads the Sync-tracked data.json document after Obsidian reports an external change.
	 */
	async reloadExternalSettings(): Promise<void> {
		await this.enqueueWrite(async () => {
			const data = (await this.backend.loadData()) as StoredWorkbenchDocument | null;
			this.restoreDocument(data);
			this.publishRevision({ kind: "external" });
		});
	}

	/**
	 * Returns the raw document snapshot for feature stores requiring migration inspection.
	 */
	getRawDocument(): Readonly<Record<string, unknown>> {
		return { ...this.document };
	}

	getRevision(): number {
		return this.revision;
	}

	subscribe(listener: (change: WorkbenchStoreChange) => void): () => void {
		this.revisionListeners.add(listener);
		return () => this.revisionListeners.delete(listener);
	}

	private restoreDocument(data: StoredWorkbenchDocument | null): void {
		let rawSettings: unknown = {};
		if (data?.settings) {
			rawSettings = data.settings;
		} else if (data && ("flashcardTags" in data || "flashcardTag" in data)) {
			rawSettings = data;
		}
		this.settings = normalizeSettingsDocument(rawSettings);

		if (data && typeof data === "object") {
			this.document = {
				...data,
				schemaVersion: 2,
				settings: this.settings,
			};
		} else {
			this.document = {
				schemaVersion: 2,
				settings: this.settings,
			};
		}
	}

	/**
	 * Combine adjacent writes to disjoint keys before the writer starts.
	 * Promises and notifications still wait for disk. A guarded write starts a new
	 * batch; only unguarded, disjoint writes can join it. Overlapping keys,
	 * full-document mutations, and reads are barriers, preserving ordering.
	 */
	private enqueueMutation(
		build: PendingMutation["build"],
		key: string,
		change: WorkbenchStoreChangeInput,
		options: WorkbenchStoreMutationOptions,
	): Promise<void> {
		let batch = this.openBatch;
		if (!batch || batch.keys.has(key) || options.expectedRevision !== undefined) {
			batch = { keys: new Set(), mutations: [] };
			const queuedBatch = batch;
			// enqueueWrite closes any preceding batch before creating this slot.
			void this.enqueueWrite(() => this.commitBatch(queuedBatch));
			this.openBatch = batch;
		}
		batch.keys.add(key);
		return new Promise<void>((resolve, reject) => {
			batch.mutations.push({
				build,
				change,
				expectedRevision: options.expectedRevision,
				resolve,
				reject,
			});
		});
	}

	private async commitBatch(batch: MutationBatch): Promise<void> {
		if (this.openBatch === batch) this.openBatch = null;
		let nextDocument = this.document;
		const prepared: { mutation: PendingMutation; document: StoredWorkbenchDocument }[] = [];
		for (const mutation of batch.mutations) {
			try {
				this.assertExpectedRevision(mutation.expectedRevision);
				nextDocument = mutation.build(nextDocument);
				prepared.push({ mutation, document: nextDocument });
			} catch (error) {
				mutation.reject(error);
			}
		}
		try {
			if (nextDocument !== this.document) await this.backend.saveData(nextDocument);
		} catch (error) {
			for (const { mutation } of prepared) mutation.reject(error);
			return;
		}
		for (const { mutation, document } of prepared) {
			this.document = document;
			this.settings = document.settings;
			this.publishRevision(mutation.change);
			mutation.resolve();
		}
	}

	private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
		this.openBatch = null;
		const pending = this.writeTail.then(operation, operation);
		this.writeTail = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}

	private assertExpectedRevision(expectedRevision: number | undefined): void {
		if (expectedRevision === undefined || expectedRevision === this.revision) return;
		throw new WorkbenchStoreConflictError(expectedRevision, this.revision);
	}

	private publishRevision(change: WorkbenchStoreChangeInput): void {
		this.revision++;
		for (const listener of this.revisionListeners) {
			try {
				listener({ ...change, revision: this.revision } as WorkbenchStoreChange);
			} catch (error) {
				console.error("Error in WorkbenchStore revision listener:", error);
			}
		}
	}
}
