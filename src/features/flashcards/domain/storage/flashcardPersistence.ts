import type { DeckIndexCacheStore } from "../../../../core/storage/deckIndexCache";
import type { FlashcardStudySettings } from "../../settings/slice";
import type { DeckHomeRepository } from "../decks/deckHome";
import type { ContinuityStateStore } from "../identity/cardIdentityContinuity";
import type { SessionPersistencePort } from "../sessions/sessionPersistence";
import { FlashcardRepository, type SessionJournalTimer } from "./flashcardRepository";
import type { SessionJournalStore } from "./sessionJournal";
import type { FlashcardAuthority, SerializedDeck } from "./persistenceTypes";

/** Read-only tag projection consumed by the flashcards settings section. */
interface FlashcardTagRead {
	hasSnapshot(): boolean;
	read(): string[];
}

/** Learning activity port for recording non-session study events like word list visits. */
export interface FlashcardLearningActivityPort {
	recordWordListVisit(
		deckId: string,
		deckName: string,
		startTimeMs: number,
		endTimeMs: number,
	): Promise<void>;
}

/**
 * Local per-answer write-ahead log configuration. When present, pure answer
 * commits append one durable journal entry instead of rewriting `data.json`;
 * entries merge back into `data.json` on threshold, idle, session end,
 * recovery, or disposal.
 */
interface FlashcardJournalOptions {
	store: SessionJournalStore;
	flushThreshold?: number;
	idleFlushMilliseconds?: number;
	timer?: SessionJournalTimer;
}

interface CreateFlashcardPersistenceOptions {
	authority: FlashcardAuthority;
	/** Rebuildable source index; missing or corrupt data is rebuilt from Markdown. */
	deckIndex?: DeckIndexCacheStore<SerializedDeck> | null;
	journal?: FlashcardJournalOptions | null;
	initialSettings?: FlashcardStudySettings;
}

/**
 * The 闪卡 feature's persistence composition.
 *
 * Every consumer receives only the semantic seam it needs: `DeckHome` reads
 * through `deckHome`, `SessionLifecycle` reads and commits through `sessions`,
 * `CardIdentityContinuity` hydrates and persists through `continuity`, and the
 * settings section reads discovered tags through `tags`. Hydration, journal
 * merging, conflict retries, and revision bookkeeping stay behind these
 * handles; production code never constructs the repository directly.
 */
export interface FlashcardPersistence {
	/** Restores merged learning state. The rebuildable deck index stays lazy. */
	prepare(): Promise<void>;
	dispose(): void;
	readonly deckHome: DeckHomeRepository;
	readonly sessions: SessionPersistencePort;
	readonly continuity: ContinuityStateStore;
	readonly tags: FlashcardTagRead;
	readonly learningActivity: FlashcardLearningActivityPort;
}

export function createFlashcardPersistence(
	options: CreateFlashcardPersistenceOptions,
): FlashcardPersistence {
	const journal = options.journal ?? null;
	const repository = new FlashcardRepository({
		authority: options.authority,
		deckIndexCache: options.deckIndex ?? null,
		initialSettings: options.initialSettings,
		sessionJournal: journal?.store ?? null,
		journalFlushThreshold: journal?.flushThreshold,
		journalIdleFlushMilliseconds: journal?.idleFlushMilliseconds,
		journalTimer: journal?.timer,
	});
	const tags: FlashcardTagRead = {
		hasSnapshot: () => repository.hasAvailableTagsSnapshot(),
		read: () => repository.getAvailableTags(),
	};
	return Object.freeze({
		prepare: () => repository.load(),
		dispose: () => repository.dispose(),
		deckHome: repository,
		sessions: repository,
		continuity: repository.createContinuityStateStore(),
		tags,
		learningActivity: repository,
	});
}
