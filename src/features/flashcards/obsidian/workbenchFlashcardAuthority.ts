import { normalizePath, type DataAdapter } from "obsidian";
import {
	WorkbenchStoreConflictError,
	type WorkbenchStore,
	type WorkbenchStoreChange,
} from "../../../core/storage/workbenchStore";
import { FlashcardAuthorityConflictError } from "../domain/storage/persistenceTypes";
import type {
	FlashcardAuthority,
	FlashcardAuthorityChange,
	FlashcardAuthorityCommit,
	FlashcardAuthoritySnapshot,
	LearningStateDocument,
	LegacyFlashcardDocument,
} from "../domain/storage/persistenceTypes";
import { flashcardSettingsSlice } from "../settings/slice";

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
 */
export class WorkbenchFlashcardAuthority implements FlashcardAuthority {
	private readonly source = {};
	private readonly listeners = new Set<
		(change: FlashcardAuthorityChange) => void | Promise<void>
	>();
	private readonly unsubscribeStore: () => void;
	private settingsFingerprint: string;

	constructor(private readonly options: WorkbenchFlashcardAuthorityOptions) {
		this.settingsFingerprint = this.readSettingsFingerprint();
		this.unsubscribeStore = options.store.subscribe((change) => this.handleStoreChange(change));
	}

	async read(): Promise<FlashcardAuthoritySnapshot> {
		await this.options.store.load();
		const settings = flashcardSettingsSlice.normalize(this.options.store.getSettings());
		this.settingsFingerprint = JSON.stringify(settings);
		const raw = structuredClone(this.options.store.getRawDocument());
		const learning = raw.learning as LearningStateDocument | undefined;

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
		try {
			await this.options.store.mutateDocument(
				(document) => {
					document.learning = structuredClone(commit.learning);
					if (commit.discardLegacy) {
						for (const key of LEGACY_FLASHCARD_KEYS) delete document[key];
					}
				},
				{ expectedRevision: expectedVersion, source: this.source },
			);
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
}

function isLegacyFlashcardDocument(
	value: Record<string, unknown>,
): value is Record<string, unknown> & LegacyFlashcardDocument {
	return Boolean(value.decks) && typeof value.decks === "object";
}
