import { stringArrayEquals } from "../../../../core/shared/utils";
import type { Card } from "ts-fsrs";
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
import type { DeckIndexCacheStore } from "../../../../core/storage/deckIndexCache";
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
import {
	realSessionJournalTimer,
	type SessionJournalEntry,
	type SessionJournalStore,
	type SessionJournalTimer,
} from "./sessionJournal";
import { SessionJournalCoordinator } from "./sessionJournalCoordinator";
import {
	equalLearningValue,
	LearningDocumentStore,
	type AuthorityCandidate,
} from "./learningDocumentStore";
import { formatWordListVisit, type LearningRecordWriteSet } from "../history/learningRecords";
import { appendStudyHistory } from "../history/studyHistory";
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
import { DeckSourceIndex, LEARNING_PLACEHOLDER_DECK_ID } from "./deckSourceIndex";

export type {
	LearningStateDocument,
	PersistedCardLearningState,
	PersistedDeckLearningState,
	SerializedCard,
	SerializedDeck,
	SerializedFSRSCard,
} from "./persistenceTypes";

export { LEARNING_PLACEHOLDER_DECK_ID };

export type { SessionJournalTimer } from "./sessionJournal";

interface FlashcardRepositoryOptions {
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
	private readonly deckIndex: DeckSourceIndex;
	private readonly journals: SessionJournalCoordinator;
	private readonly documents: LearningDocumentStore;

	private scheduler: FSRSScheduler;
	private settings: FlashcardStudySettings;
	private studyHistory: StudyHistoryEntry[] = [];
	private dailyLearningActivity: DailyLearningActivity = restoreDailyLearningActivity(undefined);
	private spellingProgress: Record<string, SpellingCardProgress> = {};
	private spellingSnapshotSource: Record<string, SpellingCardProgress> | null = null;
	private spellingSnapshot: SpellingProgressSnapshot = Object.freeze({});
	private challengeProgress: ChallengeProgress | null = null;
	private challengeProgressRevision = 0;
	private continuity: PersistedCardIdentityContinuityState = createEmptyContinuityState();

	private readonly codec = new CardCodec();
	private persistedCardStateCache = new WeakMap<FlashCard, PersistedCardLearningState>();
	private dataLoaded = false;
	private loadPromise: Promise<void> | null = null;
	private deckIndexRequested = false;
	private deckIndexLoaded = false;
	private disposed = false;

	constructor(options: FlashcardRepositoryOptions) {
		this.deckIndex = new DeckSourceIndex({
			deckIndexCache: options.deckIndexCache ?? null,
		});
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
			const cache = await this.deckIndex.loadCache();
			if (this.disposed) return;
			if (cache) {
				this.deckIndex.restoreFromCache(
					cache,
					this.documents.getPersistedLearning() ?? emptyLearningState(),
				);
				this.deckIndex.refreshDerivedState();
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
		return this.deckIndex.getDeckStructureRevision();
	}

	subscribe(listener: () => void): () => void {
		return this.documents.subscribeRevision(listener);
	}

	subscribeSourceChanges(listener: (change: SessionSourceChange) => void): () => void {
		return this.documents.subscribeSourceChanges(listener);
	}

	getAllDecks(): Deck[] {
		return this.deckIndex.getAllDecks();
	}

	getDeck(id: string): Deck | undefined {
		return this.deckIndex.getDeck(id);
	}

	getAvailableTags(): string[] {
		return this.deckIndex.getAvailableTags();
	}

	hasAvailableTagsSnapshot(): boolean {
		return this.deckIndex.hasAvailableTagsSnapshot();
	}

	getDeckStats(deck: Deck, now: Date = new Date()): DeckStats {
		return this.deckIndex.getDeckStats(deck, now);
	}

	getNextDueTime(now: Date): number | null {
		return this.deckIndex.getNextDueTime(now);
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
		return this.deckIndex.getCard(deckId, cardId);
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
		const records = formatWordListVisit(deckId, deckName, startTimeMs, endTimeMs);
		if (!records) return;
		await this.commitLearningWriteSet(records);
	}

	private async commitLearningWriteSet(records: LearningRecordWriteSet): Promise<void> {
		await this.documents.enqueueOperation(async () => {
			await this.flushJournalBeforeWrite();
			await this.commitWriteSetAsDocument({
				cardUpdates: [],
				spellingAttempts: [],
				...records,
			});
		});
	}

	async commitSession(commit: SessionCommit): Promise<SessionCommitResult> {
		await this.loadDeckIndex();
		const writeSet = formatSessionCommit(commit);
		const missing = writeSet.cardUpdates.find(
			(update) => !this.deckIndex.findCardLocation(update.deckId, update.cardId),
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
			const nextDecks = this.deckIndex.cloneDecksForTransition(transition);
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
				const location = this.deckIndex.findCardLocation(
					update.deckId,
					update.cardId,
					nextDecks,
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
					this.deckIndex.setDecks(nextDecks);
					this.studyHistory = nextHistory;
					this.spellingProgress = nextSpellingProgress;
					this.dailyLearningActivity = nextActivity;
					this.installChallengeProgress(nextChallengeProgress);
					for (const deckId of updatedDeckIds) {
						this.deckIndex.refreshDeckDueTimes(deckId, nextDecks);
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
					...(this.deckIndex.hasAvailableTagsSnapshot()
						? { availableTags: this.deckIndex.getAvailableTags() }
						: {}),
					decks: new Map(this.deckIndex.getDecksMap()),
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
							const previous = this.deckIndex.getDeck(deckId);
							if (previous) nextDecks.set(deckId, previous);
						}
					}
					let cacheDecks: ReadonlyMap<string, Deck> | null = null;
					let cacheTags: readonly string[] = [];
					await this.commitAuthority(() => {
						const nextAvailableTags = [
							...(state.availableTags ?? this.deckIndex.getAvailableTags()),
						];
						const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
						this.pruneSpellingProgress(
							this.deckIndex.getDecksMap(),
							nextDecks,
							nextSpellingProgress,
						);
						const nextContinuity = cloneContinuityState(state.continuity);
						const previousDecks = this.deckIndex.getDecksMap();
						const previousTags = this.deckIndex.getAvailableTags();
						const hadTagsSnapshot = this.deckIndex.hasAvailableTagsSnapshot();
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
										!stringArrayEquals(previousTags, nextAvailableTags);
								this.deckIndex.installSynchronizedDecks(
									nextDecks,
									nextAvailableTags,
									decksChanged,
								);
								this.spellingProgress = nextSpellingProgress;
								this.continuity = nextContinuity;
								if (decksChanged || tagsChanged) {
									cacheDecks = nextDecks;
								}
								cacheTags = nextAvailableTags;
							},
						};
					}, true);
					this.publishRevision();
					if (cacheDecks) this.deckIndex.scheduleCacheWrite(cacheDecks, cacheTags);
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
		this.deckIndex.dispose();
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
				this.deckIndex.bumpDeckStructureRevision();
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
				this.deckIndex.getDecksMap(),
				this.studyHistory,
				this.spellingProgress,
				this.continuity,
			);
			try {
				await this.documents.commitLegacy(learning);
				this.documents.recordBaseline(learning, this.deckIndex.getDecksMap());
			} catch (error) {
				throw new FlashcardPersistenceError(
					"migration-failed",
					"Failed to migrate legacy flashcard learning state",
					true,
					{ cause: error },
				);
			}
			await this.journals.replay();
			this.deckIndex.scheduleCacheWrite(
				this.deckIndex.getDecksMap(),
				this.deckIndex.getAvailableTags(),
			);
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
		this.codec.reset();
		this.deckIndex.clear();
		this.persistedCardStateCache = new WeakMap();
		const cache = this.deckIndexRequested ? await this.deckIndex.loadCache() : null;
		if (cache) this.deckIndex.restoreFromCache(cache, learning);
		else this.deckIndex.restorePlaceholders(learning);
		this.studyHistory = (learning.studyHistory ?? []).map((entry) => ({ ...entry }));
		this.dailyLearningActivity = restoreDailyLearningActivity(learning.dailyLearningActivities);
		this.spellingProgress = normalizeSpellingProgress(learning.spellingProgress);
		this.installChallengeProgress(normalizeChallengeProgress(learning.challengeProgress));
		this.continuity = cloneContinuityState(learning.continuity);
		this.deckIndex.refreshDerivedState();
		this.deckIndexLoaded = this.deckIndexRequested || !this.deckIndex.hasCacheStore;
	}

	private restoreLegacyDocument(legacy: LegacyFlashcardDocument): void {
		this.journals.reset(0);
		const decodedDecks = Object.entries(legacy.decks).map(([id, deck]) => [
			id,
			this.codec.decodeDeck(deck),
		]) as [string, Deck][];
		this.deckIndex.restoreLegacyDecks(decodedDecks);
		this.studyHistory = [...(legacy.studyHistory ?? [])];
		this.dailyLearningActivity = restoreDailyLearningActivity(undefined);
		this.spellingProgress = normalizeSpellingProgress(legacy.spellingProgress);
		this.installChallengeProgress(null);
		this.continuity = cloneContinuityState(legacy.continuity);
		this.deckIndex.installSynchronizedDecks(
			new Map(decodedDecks),
			Array.isArray(legacy.availableTags)
				? legacy.availableTags.filter((tag): tag is string => typeof tag === "string")
				: [],
			true,
		);
		this.deckIndexLoaded = true;
	}

	private async commitAuthority(
		build: () => AuthorityCandidate,
		skipUnchanged = false,
	): Promise<void> {
		await this.documents.commit(build, {
			skipUnchanged,
			baselineDecks: () => this.deckIndex.getDecksMap(),
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
				this.deckIndex.getDecksMap(),
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
			this.deckIndex.applyCardUpdates(cardUpdates);
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
		return this.documents.getCommittedCardStates(
			this.deckIndex.getDecksMap(),
			this.journals.pendingCount > 0,
		);
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
		this.documents.publishRevision(
			this.deckIndex.getDeckStructureRevision(),
			this.challengeProgressRevision,
		);
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
