import { Card, State } from "ts-fsrs";
import type {
	Deck,
	DeckStats,
	FlashCard,
	SpellingCardProgress,
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
import type { StudyCardSchedule } from "../sessions/sessionEngine";
import type {
	CardIdentityContinuityState,
	ContinuityStateStore,
	PersistedCardIdentityContinuityState,
} from "../identity/cardIdentityContinuity";
import type { SessionPersistenceTransition } from "../sessions/sessionLifecycle";
import { appendStudyHistory, createWordListHistoryEntry } from "../history/studyHistory";
import type { DeckHomeRepository } from "../decks/deckHome";
import {
	FlashcardAuthorityConflictError,
	FlashcardPersistenceError,
	type FlashcardAuthority,
	type FlashcardAuthoritySnapshot,
	type LearningStateDocument,
	type LegacyFlashcardDocument,
	type PersistedCardLearningState,
	type PersistedDeckLearningState,
	type SerializedCard,
	type SerializedDeck,
	type SerializedFSRSCard,
} from "./persistenceTypes";

export type {
	LearningStateDocument,
	PersistedCardLearningState,
	PersistedDeckLearningState,
	SerializedCard,
	SerializedDeck,
	SerializedFSRSCard,
} from "./persistenceTypes";

interface CardIndexLocation {
	deckId: string;
	cardIndex: number;
}

interface AuthorityCandidate {
	learning: LearningStateDocument;
	install(): void;
}

export interface FlashcardRepositoryOptions {
	authority: FlashcardAuthority;
	deckIndexCache?: DeckIndexCacheStore<SerializedDeck> | null;
	initialSettings?: FlashcardStudySettings;
}

/**
 * FlashcardRepository - the deep persistence authority for the 闪卡 feature slice.
 *
 * Implements DeckHomeRepository, ContinuityStateStore, and session persistence
 * through the feature-owned authority seam. It owns the semantic transition,
 * migration, revision, cache, and external-reload choreography.
 */
export class FlashcardRepository implements DeckHomeRepository {
	private readonly authority: FlashcardAuthority;
	private readonly deckIndexCache: DeckIndexCacheStore<SerializedDeck> | null;

	private decks: Map<string, Deck> = new Map();
	private scheduler: FSRSScheduler;
	private settings: FlashcardStudySettings;
	private studyHistory: StudyHistoryEntry[] = [];
	private spellingProgress: Record<string, SpellingCardProgress> = {};
	private availableTags: string[] = [];
	private hasAvailableTagsSnapshotValue = false;
	private continuity: PersistedCardIdentityContinuityState = createEmptyContinuityState();

	private revision = 0;
	private readonly revisionListeners = new Set<() => void>();
	private cardIndex = new Map<string, CardIndexLocation>();
	private serializedDeckCache = new WeakMap<Deck, SerializedDeck>();
	private serializedCardCache = new WeakMap<FlashCard, SerializedCard>();
	private serializedFSRSCardCache = new WeakMap<Card, SerializedFSRSCard>();
	private persistedCardStateCache = new WeakMap<FlashCard, PersistedCardLearningState>();
	private deckDueTimes = new Map<string, number[]>();
	private deckDueTimesValid = false;
	private dataLoaded = false;
	private loadPromise: Promise<void> | null = null;
	private authorityVersion = 0;
	private authorityUnsubscribe: () => void;
	private operationTail: Promise<void> = Promise.resolve();
	private cacheWriteTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: FlashcardRepositoryOptions) {
		this.authority = options.authority;
		this.deckIndexCache = options.deckIndexCache ?? null;

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

		this.authorityUnsubscribe = this.authority.subscribe(() => this.handleAuthorityChange());
	}

	async load(): Promise<void> {
		if (this.dataLoaded) return;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.enqueueOperation(async () => {
			await this.restoreAuthority(true);
			this.dataLoaded = true;
			this.publishRevision();
		}).finally(() => {
			this.loadPromise = null;
		});
		return this.loadPromise;
	}

	getSettings(): FlashcardStudySettings {
		return structuredClone(this.settings);
	}

	getRevision(): number {
		return this.revision;
	}

	subscribe(listener: () => void): () => void {
		this.revisionListeners.add(listener);
		return () => this.revisionListeners.delete(listener);
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
		const deck = this.decks.get(deckId);
		const cardInOriginDeck = deck?.cards.find((card) => card.id === cardId);
		if (cardInOriginDeck) return cardInOriginDeck;
		const location = this.cardIndex.get(cardId);
		if (location && location.deckId !== deckId) {
			const candidateDeck = this.decks.get(location.deckId);
			const card = candidateDeck?.cards[location.cardIndex];
			if (card && card.id === cardId) return card;
		}
		for (const candidateDeck of this.decks.values()) {
			const card = candidateDeck.cards.find((candidate) => candidate.id === cardId);
			if (card) return card;
		}
		return undefined;
	}

	getStudyHistory(): StudyHistoryEntry[] {
		return [...this.studyHistory];
	}

	getSpellingProgress(): Record<string, SpellingCardProgress> {
		return Object.fromEntries(
			Object.entries(this.spellingProgress).map(([cardId, progress]) => [
				cardId,
				{ ...progress },
			]),
		);
	}

	getScheduler(): FSRSScheduler {
		return this.scheduler;
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
		await this.load();
		const entry = createWordListHistoryEntry(deckId, deckName, startTimeMs, endTimeMs);
		if (!entry) return;

		await this.enqueueOperation(async () => {
			await this.commitAuthority(() => {
				const nextHistory = appendStudyHistory(this.studyHistory, [entry]);
				return {
					learning: this.buildLearningState(
						this.decks,
						nextHistory,
						this.spellingProgress,
						this.continuity,
					),
					install: () => {
						this.studyHistory = nextHistory;
					},
				};
			});
			this.publishRevision();
		});
	}

	async recordWordListSession(deckId: string, deckName: string, duration: number): Promise<void> {
		const now = Date.now();
		return this.recordWordListVisit(deckId, deckName, now - duration * 1000, now);
	}

	async commitSessionTransition(transition: SessionPersistenceTransition): Promise<void> {
		await this.load();
		await this.enqueueOperation(async () => {
			let updatedDeckIds = new Set<string>();
			await this.commitAuthority(() => {
				const nextDecks = cloneDecksForTransition(this.decks, transition, this.cardIndex);
				const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
				updatedDeckIds = new Set<string>();
				const now = new Date();
				for (const update of transition.cardUpdates) {
					const location = findCardLocation(
						nextDecks,
						update.deckId,
						update.cardId,
						this.cardIndex,
					);
					if (!location) continue;
					updatedDeckIds.add(location.deckId);
					location.deck.cards[location.cardIndex] = {
						...location.deck.cards[location.cardIndex]!,
						fsrsCard: update.fsrsCard,
					};
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
				return {
					learning: this.buildLearningState(
						nextDecks,
						nextHistory,
						nextSpellingProgress,
						this.continuity,
					),
					install: () => {
						this.decks = nextDecks;
						this.studyHistory = nextHistory;
						this.spellingProgress = nextSpellingProgress;
						for (const deckId of updatedDeckIds) {
							this.refreshDeckDueTimes(deckId, nextDecks);
						}
					},
				};
			});
			this.publishRevision();
		});
	}

	createContinuityStateStore(): ContinuityStateStore {
		return {
			load: async (): Promise<CardIdentityContinuityState> => {
				await this.load();
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
				await this.load();
				await this.enqueueOperation(async () => {
					let cacheDecks: ReadonlyMap<string, Deck> | null = null;
					let cacheTags: readonly string[] = [];
					await this.commitAuthority(() => {
						const nextAvailableTags = [...(state.availableTags ?? this.availableTags)];
						const nextDecks = new Map(state.decks);
						const nextSpellingProgress = cloneSpellingProgress(this.spellingProgress);
						this.pruneSpellingProgress(this.decks, nextDecks, nextSpellingProgress);
						const nextContinuity = cloneContinuityState(state.continuity);
						return {
							learning: this.buildLearningState(
								nextDecks,
								this.studyHistory,
								nextSpellingProgress,
								nextContinuity,
							),
							install: () => {
								this.decks = nextDecks;
								this.spellingProgress = nextSpellingProgress;
								this.availableTags = nextAvailableTags;
								this.hasAvailableTagsSnapshotValue = true;
								this.continuity = nextContinuity;
								this.refreshDerivedState();
								cacheDecks = nextDecks;
								cacheTags = nextAvailableTags;
							},
						};
					});
					this.publishRevision();
					if (cacheDecks) this.scheduleDeckIndexCacheWrite(cacheDecks, cacheTags);
				});
			},
		};
	}

	async commit(state: CardIdentityContinuityState): Promise<void> {
		await this.load();
		return this.createContinuityStateStore().commit(state);
	}

	dispose(): void {
		this.disposed = true;
		this.authorityUnsubscribe();
		this.authority.dispose?.();
		this.revisionListeners.clear();
	}

	private handleAuthorityChange(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		return this.enqueueOperation(async () => {
			await this.restoreAuthority(false);
			this.dataLoaded = true;
			this.publishRevision();
		});
	}

	private async restoreAuthority(initial: boolean): Promise<void> {
		let snapshot: FlashcardAuthoritySnapshot;
		try {
			snapshot = await this.authority.read();
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
		this.authorityVersion = snapshot.version;

		if (snapshot.content.kind === "legacy") {
			this.restoreLegacyDocument(snapshot.content.document);
			const learning = this.buildLearningState(
				this.decks,
				this.studyHistory,
				this.spellingProgress,
				this.continuity,
			);
			try {
				const receipt = await this.authority.commit(snapshot.version, {
					learning,
					discardLegacy: true,
				});
				this.authorityVersion = receipt.version;
			} catch (error) {
				throw new FlashcardPersistenceError(
					"migration-failed",
					"Failed to migrate legacy flashcard learning state",
					true,
					{ cause: error },
				);
			}
			this.scheduleDeckIndexCacheWrite(this.decks, this.availableTags);
			return;
		}

		const learning = snapshot.content.learning ?? emptyLearningState();
		await this.restoreLearningState(learning);
		if (!initial && !this.dataLoaded) return;
	}

	private async restoreLearningState(learning: LearningStateDocument): Promise<void> {
		this.decks = new Map();
		this.availableTags = [];
		this.hasAvailableTagsSnapshotValue = false;
		this.serializedDeckCache = new WeakMap();
		this.serializedCardCache = new WeakMap();
		this.serializedFSRSCardCache = new WeakMap();
		this.persistedCardStateCache = new WeakMap();
		this.deckDueTimes = new Map();
		const cache = await this.deckIndexCache?.load();
		if (cache) this.restoreDeckIndexCache(cache, learning);
		else this.restoreLearningPlaceholders(learning);
		this.studyHistory = [...(learning.studyHistory ?? [])];
		this.spellingProgress = normalizeSpellingProgress(learning.spellingProgress);
		this.continuity = cloneContinuityState(learning.continuity);
		this.refreshDerivedState();
	}

	private restoreLegacyDocument(legacy: LegacyFlashcardDocument): void {
		this.decks = new Map(
			Object.entries(legacy.decks).map(([id, deck]) => [id, this.deserializeDeck(deck)]),
		);
		this.studyHistory = [...(legacy.studyHistory ?? [])];
		this.spellingProgress = normalizeSpellingProgress(legacy.spellingProgress);
		this.continuity = cloneContinuityState(legacy.continuity);
		this.restoreAvailableTags(legacy.availableTags);
		this.refreshDerivedState();
	}

	private async commitAuthority(build: () => AuthorityCandidate): Promise<void> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const candidate = build();
			try {
				const receipt = await this.authority.commit(this.authorityVersion, {
					learning: candidate.learning,
				});
				this.authorityVersion = receipt.version;
				candidate.install();
				return;
			} catch (error) {
				if (error instanceof FlashcardAuthorityConflictError && attempt < 2) {
					await this.restoreAuthority(false);
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

	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
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

	private buildLearningState(
		decks: ReadonlyMap<string, Deck>,
		studyHistory: StudyHistoryEntry[],
		spellingProgress: Record<string, SpellingCardProgress>,
		continuity: PersistedCardIdentityContinuityState = this.continuity,
	): LearningStateDocument {
		const cards: Record<string, PersistedCardLearningState> = {};
		const persistedDecks: Record<string, PersistedDeckLearningState> = {};

		for (const [deckId, deck] of decks) {
			persistedDecks[deckId] = {
				studyCount: deck.studyCount,
				lastStudied: deck.lastStudied,
			};
			for (const card of deck.cards) {
				cards[card.id] = this.getPersistedCardLearningState(card);
			}
		}

		return {
			cards,
			decks: persistedDecks,
			studyHistory: [...studyHistory],
			spellingProgress: { ...spellingProgress },
			continuity: cloneContinuityState(continuity),
		};
	}

	private getPersistedCardLearningState(card: FlashCard): PersistedCardLearningState {
		const cached = this.persistedCardStateCache.get(card);
		if (cached) return cached;
		const state: PersistedCardLearningState = {
			fsrsCard: this.serializeFSRSCard(card.fsrsCard),
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
		for (const [id, deck] of decks) serializedDecks[id] = this.getSerializedDeck(deck);
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
			const deck = this.deserializeDeck(serializedDeck);
			const persistedDeck = learning.decks[deckId];
			if (persistedDeck) {
				deck.studyCount = persistedDeck.studyCount;
				deck.lastStudied = persistedDeck.lastStudied;
			}
			for (const card of deck.cards) {
				const persistedCard = learning.cards[card.id];
				if (persistedCard) card.fsrsCard = this.deserializeFSRSCard(persistedCard.fsrsCard);
			}
			this.decks.set(deckId, deck);
		}
		this.availableTags = [...cache.availableTags];
		this.hasAvailableTagsSnapshotValue = true;
	}

	private restoreLearningPlaceholders(learning: LearningStateDocument): void {
		const decks = new Map<string, Deck>();
		for (const [cardId, state] of Object.entries(learning.cards)) {
			const deckId = state.sourceFile ?? "__markdown-rebuild__";
			let deck = decks.get(deckId);
			if (!deck) {
				const persistedDeck = learning.decks[deckId];
				deck = {
					id: deckId,
					name: deckId.split("/").pop()?.replace(/\.md$/i, "") ?? deckId,
					filePath: deckId,
					tag: "",
					cards: [],
					studyCount: persistedDeck?.studyCount ?? 0,
					lastStudied: persistedDeck?.lastStudied ?? null,
				};
				decks.set(deckId, deck);
			}
			deck.cards.push({
				id: cardId,
				front: "",
				back: "",
				fsrsCard: this.deserializeFSRSCard(state.fsrsCard),
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

	private getSerializedDeck(deck: Deck): SerializedDeck {
		const cached = this.serializedDeckCache.get(deck);
		if (cached) return cached;
		const serialized = this.serializeDeck(deck);
		this.serializedDeckCache.set(deck, serialized);
		return serialized;
	}

	private serializeDeck(deck: Deck): SerializedDeck {
		return {
			...deck,
			cards: deck.cards.map((card) => this.getSerializedCard(card)),
		};
	}

	private getSerializedCard(card: FlashCard): SerializedCard {
		const cached = this.serializedCardCache.get(card);
		if (cached) return cached;
		const serialized = this.serializeCard(card);
		this.serializedCardCache.set(card, serialized);
		return serialized;
	}

	private serializeCard(card: FlashCard): SerializedCard {
		return {
			...card,
			fsrsCard: this.serializeFSRSCard(card.fsrsCard),
		};
	}

	private serializeFSRSCard(card: Card): SerializedFSRSCard {
		const cached = this.serializedFSRSCardCache.get(card);
		if (cached) return cached;
		const { due, last_review, ...serializedCard } = card;

		const serialized: SerializedFSRSCard = {
			...serializedCard,
			due: due instanceof Date ? due.toISOString() : due,
			last_review:
				last_review instanceof Date ? last_review.toISOString() : (last_review ?? null),
			learning_steps: serializedCard.learning_steps ?? 0,
		};
		this.serializedFSRSCardCache.set(card, serialized);
		return serialized;
	}

	private deserializeDeck(data: SerializedDeck): Deck {
		return {
			...data,
			cards: data.cards.map((card) => this.deserializeCard(card)),
		};
	}

	private deserializeCard(
		data: SerializedCard & {
			question?: string;
			answer?: string;
		},
	): FlashCard {
		return {
			...data,
			front: data.front ?? data.question ?? "",
			back: data.back ?? data.answer ?? "",
			explanation: data.explanation?.trim() || undefined,
			fsrsCard: this.deserializeFSRSCard(data.fsrsCard),
		};
	}

	private deserializeFSRSCard(data: SerializedFSRSCard): Card {
		return {
			due: new Date(data.due),
			stability: data.stability,
			difficulty: data.difficulty,
			elapsed_days: data.elapsed_days,
			scheduled_days: data.scheduled_days,
			reps: data.reps,
			lapses: data.lapses,
			state: data.state,
			last_review: data.last_review ? new Date(data.last_review) : undefined,
			learning_steps: data.learning_steps ?? 0,
		};
	}

	private refreshDerivedState(): void {
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
		spellingProgress: {},
		continuity: createEmptyContinuityState(),
	};
}

function cloneContinuityState(
	state: PersistedCardIdentityContinuityState | undefined,
): PersistedCardIdentityContinuityState {
	if (!state) return createEmptyContinuityState();
	return {
		sources: { ...state.sources },
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
	transition: SessionPersistenceTransition,
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

function findCardLocation(
	decks: ReadonlyMap<string, Deck>,
	deckId: string,
	cardId: string,
	cardIndex?: ReadonlyMap<string, CardIndexLocation>,
): { deckId: string; deck: Deck; cardIndex: number } | null {
	if (cardIndex) {
		const location = cardIndex.get(cardId);
		if (location) {
			const candidateDeck = decks.get(location.deckId);
			const card = candidateDeck?.cards[location.cardIndex];
			if (card && card.id === cardId) {
				return {
					deckId: location.deckId,
					deck: candidateDeck!,
					cardIndex: location.cardIndex,
				};
			}
		}
	}
	const originDeck = decks.get(deckId);
	const originIndex = originDeck?.cards.findIndex((card) => card.id === cardId) ?? -1;
	if (originDeck && originIndex !== -1) {
		return { deckId, deck: originDeck, cardIndex: originIndex };
	}
	for (const [candidateDeckId, deck] of decks) {
		if (candidateDeckId === deckId) continue;
		const cardIndexInDeck = deck.cards.findIndex((card) => card.id === cardId);
		if (cardIndexInDeck !== -1) {
			return {
				deckId: candidateDeckId,
				deck,
				cardIndex: cardIndexInDeck,
			};
		}
	}
	return null;
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
