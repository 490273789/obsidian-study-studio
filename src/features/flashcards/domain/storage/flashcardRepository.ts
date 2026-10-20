import { Card, State } from "ts-fsrs";
import type {
	Deck,
	DeckStats,
	FlashCard,
	SpellingCardProgress,
	SpellingProgressSnapshot,
	StudyHistoryEntry,
	StudyRating,
	StudySettings,
} from "../../../../core/shared/types";
import {
	DECK_INDEX_CACHE_VERSION,
	type DeckIndexCache,
	type DeckIndexCacheStore,
} from "../../../../core/storage/deckIndexCache";
import type { FlashcardStudySettings } from "../../settings/slice";
import { FSRSScheduler, toFSRSRating } from "../sessions/scheduler";
import type { StudyCardSchedule } from "../sessions/studySessionEngine";
import {
	cloneChallengeProgress,
	normalizeChallengeProgress,
	type ChallengeProgress,
} from "../sessions/challengeSessionEngine";
import type {
	CardIdentityContinuityState,
	ContinuityStateStore,
	PersistedCardIdentityContinuityState,
} from "../identity/cardIdentityContinuity";
import type {
	SessionCommit,
	SessionCommitResult,
	SessionPersistencePort,
	SessionPersistenceReceipt,
	SessionSourceChange,
} from "../sessions/sessionPersistence";
import {
	formatSessionCommit,
	isPureJournalWriteSet,
	type SessionWriteSet,
} from "./sessionCommitFormat";
import { CardCodec } from "./cardCodec";
import { findCardLocation, type CardIndexLocation } from "./cardLocation";
import {
	realSessionJournalTimer,
	type SessionJournalEntry,
	type SessionJournalStore,
	type SessionJournalTimer,
} from "./sessionJournal";
import { SessionJournalCoordinator } from "./sessionJournalCoordinator";
import { LearningDocumentStore, type AuthorityCandidate } from "./learningDocumentStore";
import { equalLearningValue } from "./learningDocumentEquality";
import { appendStudyHistory, createWordListHistoryEntry } from "../history/studyHistory";
import {
	type DailyLearningActivity,
	type LearningFootprintSnapshot,
	restoreDailyLearningActivity,
} from "../history/dailyLearningActivity";
import type { DeckHomeRepository } from "../decks/deckHome";
import type { FlashcardLearningActivityPort } from "./flashcardPersistence";
import {
	FlashcardPersistenceError,
	type FlashcardAuthority,
	type FlashcardAuthorityChange,
	type FlashcardAuthoritySnapshot,
	type LearningStateDocument,
	type LegacyFlashcardDocument,
	type PersistedCardLearningState,
	type PersistedDeckLearningState,
	type SerializedDeck,
} from "./persistenceTypes";

export type {
	LearningStateDocument,
	PersistedCardLearningState,
	PersistedDeckLearningState,
	SerializedCard,
	SerializedDeck,
	SerializedFSRSCard,
} from "./persistenceTypes";

const LEARNING_PLACEHOLDER_DECK_ID = "__markdown-rebuild__";

export type { SessionJournalTimer } from "./sessionJournal";

export interface FlashcardRepositoryOptions {
	authority: FlashcardAuthority;
	deckIndexCache?: DeckIndexCacheStore<SerializedDeck> | null;
	initialSettings?: FlashcardStudySettings;
	/**
	 * Local per-answer write-ahead log. When present, pure answer commits append
	 * one durable journal entry instead of rewriting `data.json`; journal entries
	 * are merged back into `data.json` on threshold, idle, session end, recovery,
	 * or disposal.
	 */
	sessionJournal?: SessionJournalStore | null;
	journalFlushThreshold?: number;
	journalIdleFlushMilliseconds?: number;
	journalTimer?: SessionJournalTimer;
}

/**
 * FlashcardRepository - the storage-internal persistence authority for the 闪卡
 * feature slice.
 *
 * Production composes it through `createFlashcardPersistence`, which hands each
 * consumer only its semantic seam. Implements those seams through the
 * feature-owned authority adapter and owns the semantic transition, migration,
 * revision, cache, and external-reload choreography.
 */
export class FlashcardRepository
	implements DeckHomeRepository, SessionPersistencePort, FlashcardLearningActivityPort
{
	private readonly deckIndexCache: DeckIndexCacheStore<SerializedDeck> | null;
	private readonly journals: SessionJournalCoordinator;
	private readonly documents: LearningDocumentStore;

	private decks: Map<string, Deck> = new Map();
	private scheduler: FSRSScheduler;
	private settings: FlashcardStudySettings;
	private studyHistory: StudyHistoryEntry[] = [];
	private dailyLearningActivity: DailyLearningActivity = restoreDailyLearningActivity(undefined);
	private spellingProgress: Record<string, SpellingCardProgress> = {};
	private spellingSnapshotSource: Record<string, SpellingCardProgress> | null = null;
	private spellingSnapshot: SpellingProgressSnapshot = Object.freeze({});
	private challengeProgress: ChallengeProgress | null = null;
	private challengeProgressRevision = 0;
	private availableTags: string[] = [];
	private hasAvailableTagsSnapshotValue = false;
	private continuity: PersistedCardIdentityContinuityState = createEmptyContinuityState();

	/** Bumped only when the derived deck index changes, never by scheduling commits. */
	private deckStructureRevision = 0;
	private cardIndex = new Map<string, CardIndexLocation>();
	private readonly codec = new CardCodec();
	private persistedCardStateCache = new WeakMap<FlashCard, PersistedCardLearningState>();
	private deckDueTimes = new Map<string, number[]>();
	private deckDueTimesValid = false;
	private dataLoaded = false;
	private loadPromise: Promise<void> | null = null;
	private deckIndexRequested = false;
	private deckIndexLoaded = false;
	private cacheWriteTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: FlashcardRepositoryOptions) {
		this.deckIndexCache = options.deckIndexCache ?? null;
		this.documents = new LearningDocumentStore({
			authority: options.authority,
			onAuthorityChange: (change) => this.handleAuthorityChange(change),
			onConflict: () => this.restoreAuthority(false),
		});
		this.journals = new SessionJournalCoordinator({
			merge: (watermark) => this.mergeJournalDocument(watermark),
			apply: (entries, includeSpellingAttempts) =>
				this.applyJournalEntriesToMemory(entries, includeSpellingAttempts),
			serializeFsrsCard: (card) => this.codec.fsrsCard(card),
			requestMerge: () => {
				void this.flushJournal().catch((error: unknown) => {
					console.warn(
						"Failed to merge the local session journal into data.json:",
						error,
					);
				});
			},
			journal: options.sessionJournal ?? null,
			flushThreshold: options.journalFlushThreshold,
			idleFlushMilliseconds: options.journalIdleFlushMilliseconds,
			timer: options.journalTimer ?? realSessionJournalTimer,
		});

		this.settings = options.initialSettings
			? structuredClone(options.initialSettings)
			: {
					flashcardTags: [],
					wordLearningDecks: {},
					deckOrder: [],
					dailyNewCards: 20,
					dailyReviewCards: 100,
					studyOrder: "random",
					fsrsParameters: { requestRetention: 0.9, maximumInterval: 365 },
					deckStudySettings: {},
					practicePerfectMessages: [],
					practiceErrorMessages: [],
				};
		this.scheduler = new FSRSScheduler(this.settings);
	}

	async load(): Promise<void> {
		if (this.dataLoaded) return;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.documents
			.enqueueOperation(async () => {
				await this.restoreAuthority(true);
				this.dataLoaded = true;
				// Answers written before a crash are durable in the local journal but
				// may be missing from data.json; merge them before anything publishes.
				await this.journals.tryMerge();
				this.publishRevision();
			})
			.finally(() => {
				this.loadPromise = null;
			});
		return this.loadPromise;
	}

	/**
	 * Hydrate rebuildable source content only when a deck operation first needs it.
	 * Storage-internal seam: production reaches this through the continuity store
	 * or a session commit, never by calling it directly.
	 */
	async loadDeckIndex(): Promise<void> {
		await this.load();
		this.deckIndexRequested = true;
		if (this.deckIndexLoaded) return;
		await this.documents.enqueueOperation(async () => {
			if (this.deckIndexLoaded) return;
			const cache = await this.deckIndexCache?.load();
			if (this.disposed) return;
			if (cache) {
				this.decks = new Map();
				this.restoreDeckIndexCache(
					cache,
					this.documents.getPersistedLearning() ?? emptyLearningState(),
				);
				this.refreshDerivedState();
				// The cache was hydrated from the last merged learning document;
				// reapply journal card states that have not been merged yet.
				this.journals.applyPending(false);
			}
			this.deckIndexLoaded = true;
			if (cache) this.publishRevision();
		});
	}

	getSettings(): FlashcardStudySettings {
		return structuredClone(this.settings);
	}

	getRevision(): number {
		return this.documents.getRevision();
	}

	getDeckStructureRevision(): number {
		return this.deckStructureRevision;
	}

	subscribe(listener: () => void): () => void {
		return this.documents.subscribeRevision(listener);
	}

	subscribeSourceChanges(listener: (change: SessionSourceChange) => void): () => void {
		return this.documents.subscribeSourceChanges(listener);
	}

	getAllDecks(): Deck[] {
		return Array.from(this.decks.values());
	}

	getDeck(id: string): Deck | undefined {
		return this.decks.get(id);
	}

	getAvailableTags(): string[] {
		return [...this.availableTags];
	}

	hasAvailableTagsSnapshot(): boolean {
		return this.hasAvailableTagsSnapshotValue;
	}

	getDeckStats(deck: Deck, now: Date = new Date()): DeckStats {
		let newCards = 0;
		let dueCards = 0;
		let learningCards = 0;
		let reviewCards = 0;
		let relearningCards = 0;

		for (const card of deck.cards) {
			switch (card.fsrsCard.state) {
				case State.New:
					newCards++;
					break;
				case State.Learning:
					learningCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
				case State.Review:
					reviewCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
				case State.Relearning:
					relearningCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
			}
		}

		return {
			totalCards: deck.cards.length,
			newCards,
			dueCards,
			learningCards,
			reviewCards,
			relearningCards,
		};
	}

	getNextDueTime(now: Date): number | null {
		if (!this.deckDueTimesValid) this.rebuildDeckDueTimes();
		const nowMs = now.getTime();
		let min = Infinity;
		for (const dueTimes of this.deckDueTimes.values()) {
			const due = findFirstDueAfter(dueTimes, nowMs);
			if (due !== null && due < min) min = due;
		}
		return min === Infinity ? null : min;
	}

	getEffectiveStudySettings(deckId: string): StudySettings {
		const global: StudySettings = {
			dailyNewCards: this.settings.dailyNewCards,
			dailyReviewCards: this.settings.dailyReviewCards,
			studyOrder: this.settings.studyOrder,
			fsrsParameters: this.settings.fsrsParameters,
		};
		const overrides = this.settings.deckStudySettings?.[deckId] ?? {};
		return {
			...global,
			...overrides,
			fsrsParameters: {
				...global.fsrsParameters,
				...overrides.fsrsParameters,
			},
		};
	}

	getCard(deckId: string, cardId: string): FlashCard | undefined {
		// Session reads hit the current card several times per answer, so consult
		// the maintained identity index before falling back to linear deck scans.
		const location = this.cardIndex.get(cardId);
		if (location) {
			const indexedDeck = this.decks.get(location.deckId);
			const indexedCard = indexedDeck?.cards[location.cardIndex];
			if (indexedCard && indexedCard.id === cardId) return indexedCard;
		}
		const deck = this.decks.get(deckId);
		const cardInOriginDeck = deck?.cards.find((card) => card.id === cardId);
		if (cardInOriginDeck) return cardInOriginDeck;
		for (const candidateDeck of this.decks.values()) {
			const card = candidateDeck.cards.find((candidate) => candidate.id === cardId);
			if (card) return card;
		}
		return undefined;
	}

	getStudyHistory(): StudyHistoryEntry[] {
		return [...this.studyHistory];
	}

	getLearningFootprint(now: Date): LearningFootprintSnapshot {
		return this.dailyLearningActivity.footprint(now);
	}

	getSpellingProgress(): SpellingProgressSnapshot {
		if (this.spellingSnapshotSource === this.spellingProgress) return this.spellingSnapshot;
		this.spellingSnapshot = Object.freeze(
			Object.fromEntries(
				Object.entries(this.spellingProgress).map(([cardId, progress]) => [
					cardId,
					Object.freeze({ ...progress }),
				]),
			),
		);
		this.spellingSnapshotSource = this.spellingProgress;
		return this.spellingSnapshot;
	}

	getChallengeProgress(): ChallengeProgress | null {
		return this.challengeProgress ? cloneChallengeProgress(this.challengeProgress) : null;
	}

	getChallengeProgressRevision(): number {
		return this.challengeProgressRevision;
	}

	private installChallengeProgress(progress: ChallengeProgress | null): void {
		if (!equalLearningValue(this.challengeProgress, progress)) this.challengeProgressRevision++;
		this.challengeProgress = progress;
	}

	rateStudyCard(card: Card, rating: StudyRating): StudyCardSchedule {
		if (rating === 5) {
			return {
				fsrsCard: this.scheduler.rateAsGarbage(card),
				repeatInSession: false,
			};
		}

		const result = this.scheduler.rateCard(card, toFSRSRating(rating));
		return {
			fsrsCard: result.card,
			repeatInSession: result.repeatInSession,
		};
	}

	async recordWordListVisit(
		deckId: string,
		deckName: string,
		startTimeMs: number,
		endTimeMs: number,
	): Promise<void> {
		await this.loadDeckIndex();
		const entry = createWordListHistoryEntry(deckId, deckName, startTimeMs, endTimeMs);
		if (!entry) return;

		await this.documents.enqueueOperation(async () => {
			await this.flushJournalBeforeWrite();
			await this.commitAuthority(() => {
				const nextHistory = appendStudyHistory(this.studyHistory, [entry]);
				const nextActivity = this.dailyLearningActivity.record({
					kind: "word-list",
					durationSeconds: entry.duration,
					occurredAt: entry.timestamp,
				});
				return {
					learning: this.buildLearningState(
						this.decks,
						nextHistory,
						this.spellingProgress,
						this.continuity,
						nextActivity,
						this.challengeProgress,
						this.getCommittedCardStates(),
					),
					install: () => {
						this.studyHistory = nextHistory;
						this.dailyLearningActivity = nextActivity;
					},
				};
			});
			this.publishRevision();
		});
	}

	async commitSession(commit: SessionCommit): Promise<SessionCommitResult> {
		await this.loadDeckIndex();
		const writeSet = formatSessionCommit(commit);
		const missing = writeSet.cardUpdates.find(
			(update) => !findCardLocation(this.decks, update.deckId, update.cardId, this.cardIndex),
		);
		if (missing) {
			return {
				kind: "rejected",
				reason: "card-missing",
				message: `Card ${missing.cardId} is no longer part of deck ${missing.deckId}`,
				retryable: true,
			};
		}
		if (
			writeSet.challengeProgress !== undefined &&
			JSON.stringify(this.challengeProgress) !==
				JSON.stringify(writeSet.expectedChallengeProgress ?? null)
		) {
			return {
				kind: "rejected",
				reason: "challenge-progress-changed",
				message: "Challenge progress changed; reopen the challenge to continue.",
				retryable: true,
			};
		}
		try {
			let receipt!: SessionPersistenceReceipt;
			await this.documents.enqueueOperation(async () => {
				if (this.journals.hasStore && isPureJournalWriteSet(writeSet)) {
					receipt = await this.applyJournalWriteSet(writeSet);
					return;
				}
				await this.flushJournalBeforeWrite();
				receipt = await this.commitWriteSetAsDocument(writeSet);
			});
			return { kind: "applied", receipt };
		} catch (error) {
			if (error instanceof FlashcardPersistenceError) {
				return { kind: "failed", message: error.message, retryable: error.retryable };
			}
			return {
				kind: "failed",
				message: error instanceof Error ? error.message : "Session commit failed",
				retryable: false,
			};
		}
	}

	/**
	 * Appends one pure answer to the local journal and installs it in memory only;
	 * `data.json` is written later by the journal merge. A failed append falls back
	 * to the full document commit so a confirmed answer is never lost.
	 */
	private async applyJournalWriteSet(
		transition: SessionWriteSet,
	): Promise<SessionPersistenceReceipt> {
		const result = await this.journals.append(transition);
		if (result.kind === "unavailable") return this.commitWriteSetAsDocument(transition);
		if (result.kind === "settle-failed") {
			// The on-disk journal state is unknown (a restore read failed or an
			// interrupted truncation left merged lines). Settle it before allocating
			// new sequence numbers so entries cannot collide.
			console.warn(
				"Failed to settle the local session journal; committing the full document instead:",
				result.error,
			);
			return this.commitWriteSetAsDocument(transition);
		}
		if (result.kind === "append-failed") {
			// Durability must not depend on the journal being writable.
			console.warn(
				"Failed to append to the local session journal; committing the full document instead:",
				result.error,
			);
			return this.commitWriteSetAsDocument(transition, this.journals.lastWritten);
		}
		const receipt: SessionPersistenceReceipt = {
			challengeProgressRevision: this.challengeProgressRevision,
		};
		this.publishRevision();
		if (this.journals.reachedFlushThreshold()) {
			try {
				await this.journals.mergeNow();
			} catch (error) {
				// The answer is already durable in the journal. A failed merge keeps it
				// there for a later attempt instead of failing a confirmed commit.
				console.warn("Failed to merge the session journal into data.json:", error);
			}
		}
		return receipt;
	}

	/** Full-document path for non-pure commits and the journal append fallback. */
	private async commitWriteSetAsDocument(
		transition: SessionWriteSet,
		adoptJournalSeq?: number,
	): Promise<SessionPersistenceReceipt> {
		let receipt!: SessionPersistenceReceipt;
		let updatedDeckIds = new Set<string>();
		const requestedJournalSeq =
			adoptJournalSeq === undefined ? this.journals.watermark : adoptJournalSeq;
		await this.commitAuthority(() => {
			if (
				transition.expectedChallengeProgress !== undefined &&
				JSON.stringify(this.challengeProgress) !==
					JSON.stringify(transition.expectedChallengeProgress)
			) {
				throw new FlashcardPersistenceError(
					"invariant-violated",
					"Challenge progress changed; reopen the challenge to continue.",
					true,
				);
			}
			const nextDecks = cloneDecksForTransition(this.decks, transition, this.cardIndex);
			const committedCards = this.getCommittedCardStates();
			let nextCards = committedCards;
			const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
			const nextChallengeProgress =
				transition.challengeProgress === undefined
					? this.challengeProgress
						? cloneChallengeProgress(this.challengeProgress)
						: null
					: cloneChallengeProgress(transition.challengeProgress);
			updatedDeckIds = new Set<string>();
			const occurredAt =
				transition.learningActivity?.occurredAt ?? transition.historyEntries[0]?.occurredAt;
			const now = occurredAt === undefined ? new Date() : new Date(occurredAt);
			for (const update of transition.cardUpdates) {
				const location = findCardLocation(
					nextDecks,
					update.deckId,
					update.cardId,
					this.cardIndex,
				);
				if (!location) continue;
				updatedDeckIds.add(location.deckId);
				const updatedCard = {
					...location.deck.cards[location.cardIndex]!,
					fsrsCard: update.fsrsCard,
				};
				location.deck.cards[location.cardIndex] = updatedCard;
				if (nextCards) {
					// Copy on the first actual update; unchanged transitions share the record.
					if (nextCards === committedCards) nextCards = { ...committedCards };
					nextCards[updatedCard.id] = this.getPersistedCardLearningState(updatedCard);
				}
			}
			for (const deckId of transition.incrementStudyCountFor) {
				const deck = nextDecks.get(deckId);
				if (!deck) continue;
				deck.studyCount++;
				deck.lastStudied = now.toISOString();
			}
			for (const attempt of transition.spellingAttempts) {
				applySpellingAttempt(
					nextSpellingProgress,
					attempt.cardId,
					attempt.correct,
					attempt.attemptedAt,
				);
			}
			const nextHistory = appendStudyHistory(
				this.studyHistory,
				transition.historyEntries,
				now,
			);
			const nextActivity = transition.learningActivity
				? this.dailyLearningActivity.record(transition.learningActivity)
				: this.dailyLearningActivity;
			return {
				learning: this.buildLearningState(
					nextDecks,
					nextHistory,
					nextSpellingProgress,
					this.continuity,
					nextActivity,
					nextChallengeProgress,
					nextCards,
					Math.max(requestedJournalSeq, this.journals.watermark),
				),
				install: () => {
					this.decks = nextDecks;
					this.studyHistory = nextHistory;
					this.spellingProgress = nextSpellingProgress;
					this.dailyLearningActivity = nextActivity;
					this.installChallengeProgress(nextChallengeProgress);
					for (const deckId of updatedDeckIds) {
						this.refreshDeckDueTimes(deckId, nextDecks);
					}
				},
			};
		});
		if (adoptJournalSeq !== undefined) await this.journals.adoptFromDocument(adoptJournalSeq);
		receipt = { challengeProgressRevision: this.challengeProgressRevision };
		this.publishRevision();
		return receipt;
	}

	createContinuityStateStore(): ContinuityStateStore {
		return {
			load: async (): Promise<CardIdentityContinuityState> => {
				await this.loadDeckIndex();
				return {
					configuredTags: [...this.settings.flashcardTags],
					...(this.hasAvailableTagsSnapshotValue
						? { availableTags: [...this.availableTags] }
						: {}),
					decks: new Map(this.decks),
					continuity: cloneContinuityState(this.continuity),
				};
			},
			commit: async (state: CardIdentityContinuityState): Promise<void> => {
				await this.loadDeckIndex();
				await this.documents.enqueueOperation(async () => {
					// A pending journal already changed card states in memory; merge it
					// first so this full-document build and later replays stay consistent.
					await this.flushJournalBeforeWrite();
					const nextDecks = new Map(state.decks);
					const change = state.change;
					if (change) {
						// Continuity reports the truth; fresh-but-equal decks reuse the previous
						// objects so WeakMap serialization and DeckHome caches stay warm.
						const touched = new Set([
							...change.changedDeckIds,
							...change.removedDeckIds,
						]);
						for (const deckId of nextDecks.keys()) {
							if (touched.has(deckId)) continue;
							const previous = this.decks.get(deckId);
							if (previous) nextDecks.set(deckId, previous);
						}
					}
					let cacheDecks: ReadonlyMap<string, Deck> | null = null;
					let cacheTags: readonly string[] = [];
					await this.commitAuthority(() => {
						const nextAvailableTags = [...(state.availableTags ?? this.availableTags)];
						const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
						this.pruneSpellingProgress(this.decks, nextDecks, nextSpellingProgress);
						const nextContinuity = cloneContinuityState(state.continuity);
						const previousDecks = this.decks;
						const previousTags = this.availableTags;
						const hadTagsSnapshot = this.hasAvailableTagsSnapshotValue;
						const decksChanged = change
							? change.changedDeckIds.length > 0 || change.removedDeckIds.length > 0
							: !sameDeckObjects(previousDecks, nextDecks);
						// Unchanged decks mean the persisted card baseline still applies, so
						// the learning document does not need a full card-record rebuild.
						const committedCards = decksChanged
							? undefined
							: this.getCommittedCardStates();
						return {
							learning: this.buildLearningState(
								nextDecks,
								this.studyHistory,
								nextSpellingProgress,
								nextContinuity,
								this.dailyLearningActivity,
								this.challengeProgress,
								committedCards,
							),
							install: () => {
								const tagsChanged = change
									? change.tagsChanged
									: !hadTagsSnapshot ||
										!sameStringValues(previousTags, nextAvailableTags);
								this.decks = nextDecks;
								this.spellingProgress = nextSpellingProgress;
								this.availableTags = nextAvailableTags;
								this.hasAvailableTagsSnapshotValue = true;
								this.continuity = nextContinuity;
								// Reusing deck objects keeps the derived index and due-time
								// caches valid; only a real deck change invalidates them.
								if (decksChanged) this.refreshDerivedState();
								if (decksChanged || tagsChanged) {
									cacheDecks = nextDecks;
								}
								cacheTags = nextAvailableTags;
							},
						};
					}, true);
					this.publishRevision();
					if (cacheDecks) this.scheduleDeckIndexCacheWrite(cacheDecks, cacheTags);
				});
			},
		};
	}

	dispose(): void {
		this.disposed = true;
		this.journals.cancelIdleMerge();
		if (this.journals.pendingCount > 0) {
			// A confirmed answer must not stay only in memory: merge it best-effort.
			void this.flushJournalOnDispose();
		}
		this.journals.dispose();
		this.documents.dispose();
	}

	private handleAuthorityChange(change: FlashcardAuthorityChange): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (change.kind === "settings") {
			// A settings-only commit leaves the learning partition untouched. Apply the
			// new slice and scheduler without re-deserializing every card and deck.
			return this.documents.enqueueOperation(async () => {
				await this.journals.tryMerge();
				const settings = await this.documents.readSettings();
				this.settings = structuredClone(settings);
				this.scheduler = new FSRSScheduler(this.settings);
				// Eligibility and effective study settings derive from the slice.
				this.deckStructureRevision++;
				this.publishRevision();
			});
		}
		return this.documents.enqueueOperation(async () => {
			// Merge locally confirmed answers before adopting an externally changed
			// document. A conflict here replays the journal on the restored state.
			await this.journals.tryMerge();
			await this.restoreAuthority(false);
			this.dataLoaded = true;
			this.publishRevision();
		});
	}

	private async restoreAuthority(initial: boolean): Promise<void> {
		let snapshot: FlashcardAuthoritySnapshot;
		try {
			snapshot = await this.documents.read();
		} catch (error) {
			throw new FlashcardPersistenceError(
				"authority-read-failed",
				"Failed to read flashcard learning state",
				true,
				{ cause: error },
			);
		}

		this.settings = structuredClone(snapshot.settings);
		this.scheduler = new FSRSScheduler(this.settings);

		if (snapshot.content.kind === "legacy") {
			this.restoreLegacyDocument(snapshot.content.document);
			const learning = this.buildLearningState(
				this.decks,
				this.studyHistory,
				this.spellingProgress,
				this.continuity,
			);
			try {
				await this.documents.commitLegacy(learning);
				this.documents.recordBaseline(learning, this.decks);
			} catch (error) {
				throw new FlashcardPersistenceError(
					"migration-failed",
					"Failed to migrate legacy flashcard learning state",
					true,
					{ cause: error },
				);
			}
			await this.journals.replay();
			this.scheduleDeckIndexCacheWrite(this.decks, this.availableTags);
			return;
		}

		const learning = snapshot.content.learning ?? emptyLearningState();
		await this.restoreLearningState(learning);
		// Reapply answers that were durable in the journal but never merged into the
		// restored document (crash, interrupted merge, or external Sync reload).
		await this.journals.replay();
		this.documents.adoptPersistedLearning(snapshot.content.learning);
		if (!initial && !this.dataLoaded) return;
	}

	private async restoreLearningState(learning: LearningStateDocument): Promise<void> {
		this.documents.clearBaseline();
		this.journals.reset(normalizeJournalSeq(learning.journalSeq));
		this.deckIndexLoaded = false;
		this.decks = new Map();
		this.availableTags = [];
		this.hasAvailableTagsSnapshotValue = false;
		this.codec.reset();
		this.persistedCardStateCache = new WeakMap();
		this.deckDueTimes = new Map();
		const cache = this.deckIndexRequested ? await this.deckIndexCache?.load() : null;
		if (cache) this.restoreDeckIndexCache(cache, learning);
		else this.restoreLearningPlaceholders(learning);
		this.studyHistory = (learning.studyHistory ?? []).map((entry) => ({ ...entry }));
		this.dailyLearningActivity = restoreDailyLearningActivity(learning.dailyLearningActivities);
		this.spellingProgress = normalizeSpellingProgress(learning.spellingProgress);
		this.installChallengeProgress(normalizeChallengeProgress(learning.challengeProgress));
		this.continuity = cloneContinuityState(learning.continuity);
		this.refreshDerivedState();
		this.deckIndexLoaded = this.deckIndexRequested || !this.deckIndexCache;
	}

	private restoreLegacyDocument(legacy: LegacyFlashcardDocument): void {
		this.journals.reset(0);
		this.decks = new Map(
			Object.entries(legacy.decks).map(([id, deck]) => [id, this.codec.decodeDeck(deck)]),
		);
		this.studyHistory = [...(legacy.studyHistory ?? [])];
		this.dailyLearningActivity = restoreDailyLearningActivity(undefined);
		this.spellingProgress = normalizeSpellingProgress(legacy.spellingProgress);
		this.installChallengeProgress(null);
		this.continuity = cloneContinuityState(legacy.continuity);
		this.restoreAvailableTags(legacy.availableTags);
		this.refreshDerivedState();
		this.deckIndexLoaded = true;
	}

	private async commitAuthority(
		build: () => AuthorityCandidate,
		skipUnchanged = false,
	): Promise<void> {
		await this.documents.commit(build, {
			skipUnchanged,
			baselineDecks: () => this.decks,
		});
	}

	/** Merges every journal entry above the persisted sequence into data.json. */
	private async flushJournal(): Promise<void> {
		if (!this.journals.hasStore) return;
		await this.documents.enqueueOperation(() => this.journals.mergeNow());
	}

	private async flushJournalBeforeWrite(): Promise<void> {
		await this.journals.mergeBeforeWrite();
	}

	/** Builds and durably commits the merged learning document for the journal merge. */
	private async mergeJournalDocument(watermark: number): Promise<void> {
		await this.commitAuthority(() => ({
			learning: this.buildLearningState(
				this.decks,
				this.studyHistory,
				this.spellingProgress,
				this.continuity,
				this.dailyLearningActivity,
				this.challengeProgress,
				this.getCommittedCardStates(),
				watermark,
			),
			install: () => {},
		}));
	}

	private applyJournalEntriesToMemory(
		entries: readonly SessionJournalEntry[],
		includeSpellingAttempts: boolean,
	): void {
		const cardUpdates: {
			deckId: string;
			cardId: string;
			fsrsCard: Card;
		}[] = [];
		const spellingAttempts: {
			cardId: string;
			correct: boolean;
			attemptedAt: number;
		}[] = [];
		for (const entry of entries) {
			if (entry.kind === "card-update") {
				cardUpdates.push({
					deckId: entry.cardUpdate.deckId,
					cardId: entry.cardUpdate.cardId,
					fsrsCard: this.codec.decodeFsrsCard(entry.cardUpdate.fsrsCard),
				});
				continue;
			}
			if (!includeSpellingAttempts) continue;
			spellingAttempts.push({
				cardId: entry.spellingAttempt.cardId,
				correct: entry.spellingAttempt.correct,
				attemptedAt: entry.spellingAttempt.attemptedAt,
			});
		}
		if (cardUpdates.length === 0 && spellingAttempts.length === 0) return;
		this.applyWriteSetToMemory(cardUpdates, spellingAttempts);
	}

	/** Installs a pure write set without building the persisted learning document. */
	private applyWriteSetToMemory(
		cardUpdates: readonly { deckId: string; cardId: string; fsrsCard: Card }[],
		spellingAttempts: readonly { cardId: string; correct: boolean; attemptedAt: number }[],
	): void {
		if (cardUpdates.length > 0) {
			const nextDecks = cloneDecksForTransition(
				this.decks,
				{
					cardUpdates,
					spellingAttempts: [],
					incrementStudyCountFor: [],
					historyEntries: [],
				},
				this.cardIndex,
			);
			const dueTimeChanges: DeckDueTimeChange[] = [];
			for (const update of cardUpdates) {
				const location = findCardLocation(
					nextDecks,
					update.deckId,
					update.cardId,
					this.cardIndex,
				);
				if (!location) continue;
				const previous = location.deck.cards[location.cardIndex]!;
				dueTimeChanges.push({
					deckId: location.deckId,
					previous: previous.fsrsCard,
					next: update.fsrsCard,
				});
				location.deck.cards[location.cardIndex] = {
					...previous,
					fsrsCard: update.fsrsCard,
				};
			}
			this.decks = nextDecks;
			this.applyDeckDueTimeChanges(dueTimeChanges);
		}
		if (spellingAttempts.length > 0) {
			const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
			for (const attempt of spellingAttempts) {
				applySpellingAttempt(
					nextSpellingProgress,
					attempt.cardId,
					attempt.correct,
					attempt.attemptedAt,
				);
			}
			this.spellingProgress = nextSpellingProgress;
		}
	}

	private async flushJournalOnDispose(): Promise<void> {
		try {
			await this.documents.waitForOperations();
			await this.journals.mergeNow();
		} catch (error) {
			console.warn("Failed to merge the local session journal during disposal:", error);
		}
	}

	private getCommittedCardStates(): Record<string, PersistedCardLearningState> | undefined {
		// A pending journal already advanced card states in memory, so the persisted
		// baseline no longer describes this deck snapshot.
		return this.documents.getCommittedCardStates(this.decks, this.journals.pendingCount > 0);
	}

	private buildLearningState(
		decks: ReadonlyMap<string, Deck>,
		studyHistory: StudyHistoryEntry[],
		spellingProgress: Record<string, SpellingCardProgress>,
		continuity: PersistedCardIdentityContinuityState = this.continuity,
		dailyLearningActivity: DailyLearningActivity = this.dailyLearningActivity,
		challengeProgress: ChallengeProgress | null = this.challengeProgress,
		committedCards?: Record<string, PersistedCardLearningState>,
		journalSeq: number = this.journals.watermark,
	): LearningStateDocument {
		const cards: Record<string, PersistedCardLearningState> = committedCards ?? {};
		const persistedDecks: Record<string, PersistedDeckLearningState> = {};

		for (const [deckId, deck] of decks) {
			if (deckId !== LEARNING_PLACEHOLDER_DECK_ID) {
				persistedDecks[deckId] = {
					studyCount: deck.studyCount,
					lastStudied: deck.lastStudied,
				};
			}
			if (!committedCards) {
				for (const card of deck.cards) {
					cards[card.id] = this.getPersistedCardLearningState(card);
				}
			}
		}

		return {
			cards,
			decks: persistedDecks,
			studyHistory: studyHistory.map((entry) => ({ ...entry })),
			dailyLearningActivities: dailyLearningActivity.toDocument(),
			spellingProgress: { ...spellingProgress },
			...(challengeProgress
				? { challengeProgress: cloneChallengeProgress(challengeProgress) }
				: {}),
			continuity: cloneContinuityState(continuity),
			...(journalSeq > 0 ? { journalSeq } : {}),
		};
	}

	private getPersistedCardLearningState(card: FlashCard): PersistedCardLearningState {
		const cached = this.persistedCardStateCache.get(card);
		if (cached) return cached;
		const state: PersistedCardLearningState = {
			fsrsCard: this.codec.fsrsCard(card.fsrsCard),
		};
		this.persistedCardStateCache.set(card, state);
		return state;
	}

	private scheduleDeckIndexCacheWrite(
		decks: ReadonlyMap<string, Deck>,
		availableTags: readonly string[],
	): void {
		this.cacheWriteTail = this.cacheWriteTail
			.then(() =>
				this.disposed ? undefined : this.writeDeckIndexCache(decks, availableTags),
			)
			.catch((error) => {
				console.warn("Failed to update the rebuildable deck-index cache:", error);
			});
	}

	private async writeDeckIndexCache(
		decks: ReadonlyMap<string, Deck>,
		availableTags: readonly string[],
	): Promise<void> {
		if (!this.deckIndexCache) return;
		const serializedDecks: Record<string, SerializedDeck> = {};
		for (const [id, deck] of decks) serializedDecks[id] = this.codec.deck(deck);
		await this.deckIndexCache.save({
			version: DECK_INDEX_CACHE_VERSION,
			updatedAt: new Date().toISOString(),
			availableTags: [...availableTags],
			decks: serializedDecks,
		});
	}

	private restoreDeckIndexCache(
		cache: DeckIndexCache<SerializedDeck>,
		learning: LearningStateDocument,
	): void {
		for (const [deckId, serializedDeck] of Object.entries(cache.decks)) {
			const deck = this.codec.decodeDeck(serializedDeck);
			const persistedDeck = learning.decks[deckId];
			if (persistedDeck) {
				deck.studyCount = persistedDeck.studyCount;
				deck.lastStudied = persistedDeck.lastStudied;
			}
			for (const card of deck.cards) {
				const persistedCard = learning.cards[card.id];
				if (persistedCard)
					card.fsrsCard = this.codec.decodeFsrsCard(persistedCard.fsrsCard);
			}
			this.decks.set(deckId, deck);
		}
		this.availableTags = [...cache.availableTags];
		this.hasAvailableTagsSnapshotValue = true;
	}

	private restoreLearningPlaceholders(learning: LearningStateDocument): void {
		const placeholder = (deckId: string): Deck => ({
			id: deckId,
			name: deckId.split("/").pop()?.replace(/\.md$/i, "") ?? deckId,
			filePath: deckId,
			tag: "",
			cards: [],
			studyCount: learning.decks[deckId]?.studyCount ?? 0,
			lastStudied: learning.decks[deckId]?.lastStudied ?? null,
		});
		// Current learning cards need not retain source paths. Keep deck metadata
		// separately so Markdown rebuilding can reattach it by path.
		const decks = new Map(Object.keys(learning.decks).map((id) => [id, placeholder(id)]));
		for (const [cardId, state] of Object.entries(learning.cards)) {
			const deckId = state.sourceFile ?? LEARNING_PLACEHOLDER_DECK_ID;
			let deck = decks.get(deckId);
			if (!deck) {
				deck = placeholder(deckId);
				decks.set(deckId, deck);
			}
			deck.cards.push({
				id: cardId,
				front: "",
				back: "",
				fsrsCard: this.codec.decodeFsrsCard(state.fsrsCard),
				sourceFile: state.sourceFile ?? "",
				indexInFile: deck.cards.length,
			});
		}
		this.decks = decks;
	}

	private restoreAvailableTags(value: unknown): void {
		if (!Array.isArray(value)) return;
		this.availableTags = Array.from(
			new Set(value.filter((tag): tag is string => typeof tag === "string")),
		);
		this.hasAvailableTagsSnapshotValue = true;
	}

	private refreshDerivedState(): void {
		this.deckStructureRevision++;
		this.rebuildCardIndex();
		this.deckDueTimesValid = false;
	}

	private rebuildCardIndex(): void {
		this.cardIndex.clear();
		for (const [deckId, deck] of this.decks) {
			for (let index = 0; index < deck.cards.length; index++) {
				const card = deck.cards[index]!;
				if (!this.cardIndex.has(card.id)) {
					this.cardIndex.set(card.id, { deckId, cardIndex: index });
				}
			}
		}
	}

	private rebuildDeckDueTimes(decks: ReadonlyMap<string, Deck> = this.decks): void {
		this.deckDueTimes.clear();
		for (const [deckId, deck] of decks) {
			const dueTimes = collectDeckDueTimes(deck);
			if (dueTimes.length > 0) this.deckDueTimes.set(deckId, dueTimes);
		}
		this.deckDueTimesValid = true;
	}

	/**
	 * Updates the cached sorted due times for the answered cards only. The journal
	 * path runs on every answer, so re-sorting the whole deck there would make the
	 * cache incremental in name only.
	 */
	private applyDeckDueTimeChanges(changes: readonly DeckDueTimeChange[]): void {
		if (!this.deckDueTimesValid) return;
		for (const change of changes) {
			const previousDue =
				change.previous.state === State.New ? null : change.previous.due.getTime();
			const nextDue = change.next.state === State.New ? null : change.next.due.getTime();
			if (previousDue === nextDue) continue;
			const dueTimes = this.deckDueTimes.get(change.deckId) ?? [];
			if (previousDue !== null) removeSortedValue(dueTimes, previousDue);
			if (nextDue !== null) insertSortedValue(dueTimes, nextDue);
			if (dueTimes.length === 0) this.deckDueTimes.delete(change.deckId);
			else this.deckDueTimes.set(change.deckId, dueTimes);
		}
	}

	private refreshDeckDueTimes(deckId: string, decks: ReadonlyMap<string, Deck>): void {
		if (!this.deckDueTimesValid) return;
		const deck = decks.get(deckId);
		if (!deck) {
			this.deckDueTimes.delete(deckId);
			return;
		}
		const dueTimes = collectDeckDueTimes(deck);
		if (dueTimes.length === 0) this.deckDueTimes.delete(deckId);
		else this.deckDueTimes.set(deckId, dueTimes);
	}

	private pruneSpellingProgress(
		previousDecks: ReadonlyMap<string, Deck>,
		nextDecks: ReadonlyMap<string, Deck>,
		progress: Record<string, SpellingCardProgress>,
	): void {
		const availableIdentities = new Set<string>();
		for (const deck of nextDecks.values()) {
			for (const card of deck.cards) {
				availableIdentities.add(card.id);
			}
		}
		for (const deck of previousDecks.values()) {
			for (const card of deck.cards) {
				if (!availableIdentities.has(card.id)) {
					delete progress[card.id];
				}
			}
		}
	}

	private publishRevision(): void {
		this.documents.publishRevision(this.deckStructureRevision, this.challengeProgressRevision);
	}
}

function createEmptyContinuityState(): PersistedCardIdentityContinuityState {
	return {
		sources: {},
		issues: [],
		journal: null,
	};
}

function emptyLearningState(): LearningStateDocument {
	return {
		cards: {},
		decks: {},
		studyHistory: [],
		dailyLearningActivities: [],
		spellingProgress: {},
		continuity: createEmptyContinuityState(),
	};
}

function normalizeJournalSeq(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * True when a commit only schedules card states or records spelling attempts:
 * the two facts a per-answer journal entry can carry without losing data. Any
 * session record, activity, challenge progress, or study-count change needs the
 * full learning document and therefore forces a merge first.
 */
function sameDeckObjects(
	left: ReadonlyMap<string, Deck>,
	right: ReadonlyMap<string, Deck>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [deckId, deck] of right) {
		if (left.get(deckId) !== deck) return false;
	}
	return true;
}

function sameStringValues(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneContinuityState(
	state: PersistedCardIdentityContinuityState | undefined,
): PersistedCardIdentityContinuityState {
	if (!state) return createEmptyContinuityState();
	return {
		sources: Object.fromEntries(
			Object.entries(state.sources ?? {}).map(([path, condition]) => [
				path,
				{ ...condition },
			]),
		),
		issues: (state.issues ?? []).map((issue) => ({
			...issue,
			affectedSources: [...issue.affectedSources],
			candidates: (issue.candidates ?? []).map((candidate) => ({ ...candidate })),
			...(issue.type === "identity-ambiguity"
				? { missingIdentities: [...issue.missingIdentities] }
				: {}),
		})),
		journal: state.journal
			? {
					...state.journal,
					completedSources: [...state.journal.completedSources],
					pendingSources: [...state.journal.pendingSources],
					sources: (state.journal.sources ?? []).map((source) => ({
						...source,
						identityMap: { ...source.identityMap },
					})),
				}
			: null,
	};
}

function normalizeSpellingProgress(
	value: Record<string, SpellingCardProgress> | undefined,
): Record<string, SpellingCardProgress> {
	if (!value || typeof value !== "object") return {};
	const normalized: Record<string, SpellingCardProgress> = {};
	for (const [cardId, progress] of Object.entries(value)) {
		if (
			!progress ||
			typeof progress.attempts !== "number" ||
			typeof progress.correctAttempts !== "number" ||
			typeof progress.correctStreak !== "number" ||
			typeof progress.lastAttemptAt !== "number"
		) {
			continue;
		}
		normalized[cardId] = {
			attempts: Math.max(0, progress.attempts),
			correctAttempts: Math.max(0, progress.correctAttempts),
			correctStreak: Math.max(0, progress.correctStreak),
			lastAttemptAt: progress.lastAttemptAt,
			...(typeof progress.lastIncorrectAt === "number"
				? { lastIncorrectAt: progress.lastIncorrectAt }
				: {}),
		};
	}
	return normalized;
}

function cloneDecksForTransition(
	decks: ReadonlyMap<string, Deck>,
	transition: SessionWriteSet,
	cardIndex: ReadonlyMap<string, CardIndexLocation>,
): Map<string, Deck> {
	const touched = new Set<string>();
	for (const update of transition.cardUpdates) {
		const location = findCardLocation(decks, update.deckId, update.cardId, cardIndex);
		if (location) touched.add(location.deckId);
	}
	for (const deckId of transition.incrementStudyCountFor) touched.add(deckId);

	const next = new Map<string, Deck>();
	for (const [deckId, deck] of decks) {
		if (!touched.has(deckId)) {
			next.set(deckId, deck);
			continue;
		}
		next.set(deckId, {
			...deck,
			cards: [...deck.cards],
		});
	}
	return next;
}

interface DeckDueTimeChange {
	readonly deckId: string;
	readonly previous: Card;
	readonly next: Card;
}

function removeSortedValue(values: number[], value: number): void {
	const index = values.indexOf(value);
	if (index >= 0) values.splice(index, 1);
}

function insertSortedValue(values: number[], value: number): void {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < value) low = middle + 1;
		else high = middle;
	}
	values.splice(low, 0, value);
}

function collectDeckDueTimes(deck: Deck): number[] {
	return deck.cards
		.filter((card) => card.fsrsCard.state !== State.New)
		.map((card) => card.fsrsCard.due.getTime())
		.sort((left, right) => left - right);
}

function findFirstDueAfter(sortedDueTimes: readonly number[], now: number): number | null {
	let low = 0;
	let high = sortedDueTimes.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (sortedDueTimes[middle]! <= now) low = middle + 1;
		else high = middle;
	}
	return sortedDueTimes[low] ?? null;
}

function cloneSpellingProgress(
	progress: Readonly<Record<string, SpellingCardProgress>>,
): Record<string, SpellingCardProgress> {
	return Object.fromEntries(
		Object.entries(progress).map(([cardId, value]) => [cardId, { ...value }]),
	);
}

function applySpellingAttempt(
	progress: Record<string, SpellingCardProgress>,
	cardId: string,
	correct: boolean,
	attemptedAt: number,
): void {
	const current = progress[cardId] ?? {
		attempts: 0,
		correctAttempts: 0,
		correctStreak: 0,
		lastAttemptAt: attemptedAt,
	};
	progress[cardId] = {
		...current,
		attempts: current.attempts + 1,
		correctAttempts: current.correctAttempts + (correct ? 1 : 0),
		correctStreak: correct ? current.correctStreak + 1 : 0,
		lastAttemptAt: attemptedAt,
		...(correct ? {} : { lastIncorrectAt: attemptedAt }),
	};
}
