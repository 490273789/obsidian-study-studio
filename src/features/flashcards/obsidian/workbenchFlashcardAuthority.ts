import { normalizePath, type DataAdapter } from "obsidian";
import {
	WorkbenchStoreConflictError,
	type WorkbenchStore,
	type WorkbenchStoreChange,
} from "../../../core/storage/workbenchStore";
import {
	decodePersistedLearning,
	encodePersistedLearning,
	isCompactPersistedLearning,
} from "../domain/storage/persistedLearningCodec";
import { FlashcardAuthorityConflictError } from "../domain/storage/persistenceTypes";
import type {
	FlashcardAuthority,
	FlashcardAuthorityChange,
	FlashcardAuthorityCommit,
	FlashcardAuthoritySnapshot,
	LegacyFlashcardDocument,
} from "../domain/storage/persistenceTypes";
import { flashcardSettingsSlice, type FlashcardStudySettings } from "../settings/slice";

const LEGACY_FLASHCARD_KEYS = [
	"decks",
	"studyHistory",
	"spellingProgress",
	"continuity",
	"availableTags",
] as const;

export interface WorkbenchFlashcardAuthorityOptions {
	store: WorkbenchStore;
	adapter?: DataAdapter;
	pluginDirectory?: string;
}

/**
 * Production adapter at the flashcard authority seam. It is the only flashcard
 * module that knows WorkbenchStore revisions, the learning partition name, or
 * the legacy top-level document shape.
 *
 * The caller must treat each committed learning document as immutable: the
 * store adopts it by reference (no defensive deep copy on the hot answer path).
 * `FlashcardRepository` builds a fresh copy-on-write document per transition.
 *
 * Only this seam knows the persisted card representation: commits store the
 * compact tuple layout from `persistedLearningCodec`, reads decode both the
 * compact and legacy object layouts, and the first compact write preserves a
 * downgrade backup of the pre-compact document.
 */
export class WorkbenchFlashcardAuthority implements FlashcardAuthority {
	private readonly source = {};
	private readonly listeners = new Set<
		(change: FlashcardAuthorityChange) => void | Promise<void>
	>();
	private readonly unsubscribeStore: () => void;
	private settingsFingerprint: string;
	private preCompactBackupAttempted = false;

	constructor(private readonly options: WorkbenchFlashcardAuthorityOptions) {
		this.settingsFingerprint = this.readSettingsFingerprint();
		this.unsubscribeStore = options.store.subscribe((change) => this.handleStoreChange(change));
	}

	async readSettings(): Promise<FlashcardStudySettings> {
		await this.options.store.load();
		return flashcardSettingsSlice.normalize(this.options.store.getSettings());
	}

	async read(): Promise<FlashcardAuthoritySnapshot> {
		await this.options.store.load();
		const settings = flashcardSettingsSlice.normalize(this.options.store.getSettings());
		this.settingsFingerprint = JSON.stringify(settings);
		const raw = structuredClone(this.options.store.getRawDocument());
		const storedLearning = raw.learning;
		const learning =
			storedLearning === undefined ? undefined : decodePersistedLearning(storedLearning);

		return {
			version: this.options.store.getRevision(),
			settings,
			content:
				learning !== undefined
					? { kind: "current", learning }
					: isLegacyFlashcardDocument(raw)
						? { kind: "legacy", document: raw }
						: { kind: "current" },
		};
	}

	async commit(
		expectedVersion: number,
		commit: FlashcardAuthorityCommit,
	): Promise<{ readonly version: number }> {
		if (commit.discardLegacy) await this.backupLegacyDocument();
		await this.backupPreCompactDocument();
		const learning = encodePersistedLearning(commit.learning);
		try {
			if (commit.discardLegacy) {
				await this.options.store.mutateDocument(
					(document) => {
						// Replacing the whole learning partition drops the legacy top-level
						// flashcard keys. `encodePersistedLearning` returns a fresh document
						// graph for the card map, so the store can adopt it directly under
						// the same immutable-document contract as the save path below.
						document.learning = learning;
						for (const key of LEGACY_FLASHCARD_KEYS) delete document[key];
					},
					{ expectedRevision: expectedVersion, source: this.source },
				);
			} else {
				// The repository builds a fresh copy-on-write learning document for
				// every transition and never mutates a committed one. The encoded
				// persisted document is fresh as well, so the store can adopt it
				// instead of deep-cloning the whole document on every answer.
				// Callers must keep that contract: a committed document is immutable.
				await this.options.store.savePartition("learning", learning, {
					expectedRevision: expectedVersion,
					source: this.source,
				});
			}
		} catch (error) {
			if (error instanceof WorkbenchStoreConflictError) {
				throw new FlashcardAuthorityConflictError(
					error.expectedRevision,
					error.actualRevision,
				);
			}
			throw error;
		}
		return { version: this.options.store.getRevision() };
	}

	subscribe(listener: (change: FlashcardAuthorityChange) => void | Promise<void>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.unsubscribeStore();
		this.listeners.clear();
	}

	private handleStoreChange(change: WorkbenchStoreChange): void {
		if ("source" in change && change.source === this.source) return;
		const mapped = this.mapStoreChange(change);
		if (!mapped) return;
		for (const listener of this.listeners) {
			try {
				void Promise.resolve(listener(mapped)).catch((error) => {
					console.error("Failed to reconcile a flashcard authority change:", error);
				});
			} catch (error) {
				console.error("Failed to reconcile a flashcard authority change:", error);
			}
		}
	}

	private mapStoreChange(change: WorkbenchStoreChange): FlashcardAuthorityChange | null {
		if (change.kind === "external") {
			this.settingsFingerprint = this.readSettingsFingerprint();
			return { kind: "external", version: change.revision };
		}
		if (change.kind === "partition") {
			return change.partitionKey === "learning"
				? { kind: "learning", version: change.revision }
				: null;
		}
		if (change.kind === "document") {
			this.settingsFingerprint = this.readSettingsFingerprint();
			return { kind: "learning", version: change.revision };
		}

		const nextFingerprint = this.readSettingsFingerprint();
		if (nextFingerprint === this.settingsFingerprint) return null;
		this.settingsFingerprint = nextFingerprint;
		return { kind: "settings", version: change.revision };
	}

	private readSettingsFingerprint(): string {
		return JSON.stringify(flashcardSettingsSlice.normalize(this.options.store.getSettings()));
	}

	private async backupLegacyDocument(): Promise<void> {
		const { adapter, pluginDirectory } = this.options;
		if (!adapter || !pluginDirectory) return;
		const path = normalizePath(`${pluginDirectory}/data.backup-v1.json`);
		try {
			if (!(await adapter.exists(path))) {
				await adapter.write(path, JSON.stringify(this.options.store.getRawDocument()));
			}
		} catch (error) {
			console.warn("Failed to preserve the local legacy data backup:", error);
		}
	}

	/**
	 * One-time downgrade protection before the first compact-format write:
	 * copies the still-legacy `data.json` to `data.backup-v2.json` so the user
	 * can restore a document the previous plugin version can read. The existing
	 * file is never overwritten, a failed attempt only warns (persistence must
	 * still proceed), and the check is skipped when the partition is already
	 * compact or the document holds no learning/legacy data to protect.
	 */
	private async backupPreCompactDocument(): Promise<void> {
		if (this.preCompactBackupAttempted) return;
		const { adapter, pluginDirectory } = this.options;
		if (!adapter || !pluginDirectory) {
			this.preCompactBackupAttempted = true;
			return;
		}
		// Commits normally follow a read; loading here keeps a standalone first
		// commit from backing up the not-yet-loaded empty document.
		try {
			await this.options.store.load();
		} catch (error) {
			console.warn(
				"Failed to inspect the local data before the compact-format backup:",
				error,
			);
			return;
		}
		const raw = this.options.store.getRawDocument();
		if (isCompactPersistedLearning(raw.learning)) {
			this.preCompactBackupAttempted = true;
			return;
		}
		const hasLearning = raw.learning !== undefined && raw.learning !== null;
		if (!hasLearning && !isLegacyFlashcardDocument(raw)) return;
		const path = normalizePath(`${pluginDirectory}/data.backup-v2.json`);
		try {
			if (!(await adapter.exists(path))) {
				await adapter.write(path, JSON.stringify(raw));
			}
		} catch (error) {
			// Retried on the next commit until the original document is preserved.
			console.warn("Failed to preserve the local pre-compact data backup:", error);
			return;
		}
		this.preCompactBackupAttempted = true;
	}
}

function isLegacyFlashcardDocument(
	value: Record<string, unknown>,
): value is Record<string, unknown> & LegacyFlashcardDocument {
	return Boolean(value.decks) && typeof value.decks === "object";
}
