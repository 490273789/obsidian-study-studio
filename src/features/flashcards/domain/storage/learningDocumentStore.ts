import type { Deck } from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import type { SessionSourceChange } from "../sessions/sessionPersistence";
import { equalLearningValue } from "./learningDocumentEquality";
import {
	FlashcardAuthorityConflictError,
	FlashcardPersistenceError,
	type FlashcardAuthority,
	type FlashcardAuthorityChange,
	type FlashcardAuthoritySnapshot,
	type LearningStateDocument,
	type PersistedCardLearningState,
} from "./persistenceTypes";

export interface AuthorityCandidate {
	learning: LearningStateDocument;
	install(): void;
}

export interface LearningDocumentStoreOptions {
	authority: FlashcardAuthority;
	onAuthorityChange: (change: FlashcardAuthorityChange) => void | Promise<void>;
	/** Restores the owner's memory from the authority after a version race. */
	onConflict: () => Promise<void>;
}

/**
 * Owns the durable learning document and its published revisions.
 *
 * The repository hands it a build/install candidate for every document write;
 * this module owns version-conflict retries, the reusable persisted-card
 * baseline, revision/subscription publication, the serialized operation queue,
 * and authority lifetime. Hydration, deck state, and semantic transitions stay
 * in the repository.
 */
export class LearningDocumentStore {
	private authorityVersion = 0;
	private persistedLearning: LearningStateDocument | undefined;
	private persistedCardDecks: ReadonlyMap<string, Deck> | null = null;
	private revision = 0;
	private readonly revisionListeners = new Set<() => void>();
	private readonly sourceChangeListeners = new Set<(change: SessionSourceChange) => void>();
	private announcedStructureRevision = 0;
	private announcedChallengeProgressRevision = 0;
	private operationTail: Promise<void> = Promise.resolve();
	private disposed = false;
	private readonly unsubscribeAuthority: () => void;

	constructor(private readonly options: LearningDocumentStoreOptions) {
		this.unsubscribeAuthority = options.authority.subscribe((change) =>
			options.onAuthorityChange(change),
		);
	}

	async read(): Promise<FlashcardAuthoritySnapshot> {
		const snapshot = await this.options.authority.read();
		// A restore adopts the version it read, so a later conflict retry commits
		// against the restored document rather than the stale local version.
		this.authorityVersion = snapshot.version;
		return snapshot;
	}

	readSettings(): Promise<FlashcardStudySettings> {
		return this.options.authority.readSettings();
	}

	getRevision(): number {
		return this.revision;
	}

	/** The learning document currently installed as the durable baseline. */
	getPersistedLearning(): LearningStateDocument | undefined {
		return this.persistedLearning;
	}

	subscribeRevision(listener: () => void): () => void {
		this.revisionListeners.add(listener);
		return () => this.revisionListeners.delete(listener);
	}

	subscribeSourceChanges(listener: (change: SessionSourceChange) => void): () => void {
		this.sourceChangeListeners.add(listener);
		return () => this.sourceChangeListeners.delete(listener);
	}

	/** Clears the reusable persisted-card baseline before a full restore. */
	clearBaseline(): void {
		this.persistedCardDecks = null;
	}

	/** Records the learning document adopted from an authority snapshot. */
	adoptPersistedLearning(learning: LearningStateDocument | undefined): void {
		this.persistedLearning = learning;
	}

	/** Records a complete baseline after a migration or successful commit. */
	recordBaseline(learning: LearningStateDocument, decks: ReadonlyMap<string, Deck>): void {
		this.persistedLearning = learning;
		this.persistedCardDecks = decks;
	}

	/** Commits the migrated legacy document once, adopting its version. */
	async commitLegacy(learning: LearningStateDocument): Promise<void> {
		const receipt = await this.options.authority.commit(this.authorityVersion, {
			learning,
			discardLegacy: true,
		});
		this.authorityVersion = receipt.version;
	}

	/**
	 * Commits one built learning document, retrying version conflicts by asking
	 * the owner to restore. `baselineDecks` snapshots the deck map that the
	 * committed card record describes so unchanged commits can reuse it.
	 */
	async commit(
		build: () => AuthorityCandidate,
		options: {
			skipUnchanged?: boolean;
			baselineDecks: () => ReadonlyMap<string, Deck>;
		},
	): Promise<void> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const candidate = build();
			// Continuity also refreshes source-derived decks and tags. Install those
			// even when the durable learning document needs no replacement.
			if (
				options.skipUnchanged &&
				equalLearningValue(candidate.learning, this.persistedLearning)
			) {
				candidate.install();
				this.persistedCardDecks = options.baselineDecks();
				return;
			}
			try {
				const receipt = await this.options.authority.commit(this.authorityVersion, {
					learning: candidate.learning,
				});
				this.authorityVersion = receipt.version;
				this.persistedLearning = candidate.learning;
				candidate.install();
				this.persistedCardDecks = options.baselineDecks();
				return;
			} catch (error) {
				if (error instanceof FlashcardAuthorityConflictError && attempt < 2) {
					await this.options.onConflict();
					continue;
				}
				throw new FlashcardPersistenceError(
					error instanceof FlashcardAuthorityConflictError
						? "conflict-exhausted"
						: "authority-write-failed",
					"Failed to persist flashcard learning state",
					error instanceof FlashcardAuthorityConflictError,
					{ cause: error },
				);
			}
		}
	}

	/**
	 * A pending journal already advanced card states in memory, so the persisted
	 * baseline no longer describes this deck snapshot.
	 */
	getCommittedCardStates(
		decks: ReadonlyMap<string, Deck>,
		hasPendingJournal: boolean,
	): Record<string, PersistedCardLearningState> | undefined {
		if (hasPendingJournal) return undefined;
		// Restored/cache-hydrated decks may contain identities absent from learning.
		// Only reuse a baseline established by a complete successful build/install.
		return this.persistedCardDecks === decks ? this.persistedLearning?.cards : undefined;
	}

	/** Publishes one revision and any source change the caller's revisions imply. */
	publishRevision(deckStructureRevision: number, challengeProgressRevision: number): void {
		if (this.disposed) return;
		this.revision++;
		for (const listener of this.revisionListeners) {
			try {
				listener();
			} catch (error) {
				console.error(
					"Failed to publish a committed flashcard repository revision:",
					error,
				);
			}
		}
		if (
			deckStructureRevision === this.announcedStructureRevision &&
			challengeProgressRevision === this.announcedChallengeProgressRevision
		)
			return;
		this.announcedStructureRevision = deckStructureRevision;
		this.announcedChallengeProgressRevision = challengeProgressRevision;
		const change: SessionSourceChange = {
			deckStructureRevision,
			challengeProgressRevision,
		};
		for (const listener of this.sourceChangeListeners) {
			try {
				listener(change);
			} catch (error) {
				console.error("Failed to publish a committed flashcard source change:", error);
			}
		}
	}

	enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const pending = this.operationTail.then(async () => {
			if (this.disposed) {
				throw new FlashcardPersistenceError(
					"disposed",
					"Flashcard persistence is disposed",
					false,
				);
			}
			await operation();
		});
		this.operationTail = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}

	/** Resolves once every operation already queued has settled. */
	waitForOperations(): Promise<void> {
		return this.operationTail;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeAuthority();
		this.options.authority.dispose?.();
		this.revisionListeners.clear();
		this.sourceChangeListeners.clear();
	}
}
