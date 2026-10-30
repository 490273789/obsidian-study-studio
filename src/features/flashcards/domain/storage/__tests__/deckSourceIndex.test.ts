/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import { State, type Card } from "ts-fsrs";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import {
	DECK_INDEX_CACHE_VERSION,
	type DeckIndexCache,
	type DeckIndexCacheStore,
} from "../../../../../core/storage/deckIndexCache";
import type { LearningStateDocument, SerializedDeck } from "../persistenceTypes";
import { DeckSourceIndex, LEARNING_PLACEHOLDER_DECK_ID } from "../deckSourceIndex";

function createDummyCard(id: string, state: State, due: Date): FlashCard {
	return {
		id,
		front: `front ${id}`,
		back: `back ${id}`,
		sourceFile: "deck-1.md",
		indexInFile: 0,
		fsrsCard: {
			state,
			due,
			stability: 1,
			difficulty: 5,
			elapsed_days: 0,
			scheduled_days: 1,
			reps: 1,
			lapses: 0,
			last_review: new Date(),
		} as Card,
	};
}

describe("DeckSourceIndex", () => {
	it("initializes empty and exposes basic query defaults", () => {
		const index = new DeckSourceIndex();
		expect(index.getAllDecks()).toEqual([]);
		expect(index.getDeck("non-existent")).toBeUndefined();
		expect(index.getCard("deck-1", "card-1")).toBeUndefined();
		expect(index.getAvailableTags()).toEqual([]);
		expect(index.hasAvailableTagsSnapshot()).toBe(false);
		expect(index.getNextDueTime(new Date())).toBeNull();
		expect(index.getDeckStructureRevision()).toBe(0);
	});

	it("restores placeholder decks when cache is absent", () => {
		const index = new DeckSourceIndex();
		const learning: LearningStateDocument = {
			cards: {
				"c-1": {
					fsrsCard: {
						state: State.Review,
						due: "2026-10-30T10:00:00.000Z",
						stability: 1,
						difficulty: 5,
						elapsed_days: 0,
						scheduled_days: 1,
						reps: 1,
						lapses: 0,
						last_review: null,
						learning_steps: 0,
					},
					sourceFile: "notes/deckA.md",
				},
				"c-2": {
					fsrsCard: {
						state: State.New,
						due: "2026-10-30T10:00:00.000Z",
						stability: 1,
						difficulty: 5,
						elapsed_days: 0,
						scheduled_days: 0,
						reps: 0,
						lapses: 0,
						last_review: null,
						learning_steps: 0,
					},
				},
			},
			decks: {
				"notes/deckA.md": { studyCount: 5, lastStudied: "2026-10-29T10:00:00.000Z" },
			},
			studyHistory: [],
			dailyLearningActivities: [],
			spellingProgress: {},
			continuity: { sources: {}, issues: [], journal: null },
		};

		index.restorePlaceholders(learning);

		const deckA = index.getDeck("notes/deckA.md");
		expect(deckA).toBeDefined();
		expect(deckA?.studyCount).toBe(5);
		expect(deckA?.cards.length).toBe(1);
		expect(deckA?.cards[0]?.id).toBe("c-1");

		const placeholder = index.getDeck(LEARNING_PLACEHOLDER_DECK_ID);
		expect(placeholder).toBeDefined();
		expect(placeholder?.cards.length).toBe(1);
		expect(placeholder?.cards[0]?.id).toBe("c-2");
	});

	it("restores from cache and attaches learning states", () => {
		const index = new DeckSourceIndex();
		const cache: DeckIndexCache<SerializedDeck> = {
			version: DECK_INDEX_CACHE_VERSION,
			updatedAt: "2026-10-30T00:00:00.000Z",
			availableTags: ["#flashcards", "#english"],
			decks: {
				"deck-1": {
					id: "deck-1",
					name: "Deck 1",
					filePath: "deck-1.md",
					tag: "#english",
					cards: [
						{
							id: "c-1",
							front: "Hello",
							back: "World",
							sourceFile: "deck-1.md",
							indexInFile: 0,
							fsrsCard: {
								state: State.New,
								due: "2026-10-30T00:00:00.000Z",
								stability: 1,
								difficulty: 5,
								elapsed_days: 0,
								scheduled_days: 0,
								reps: 0,
								lapses: 0,
								last_review: null,
								learning_steps: 0,
							},
						},
					],
					studyCount: 0,
					lastStudied: null,
				},
			},
		};

		const learning: LearningStateDocument = {
			cards: {
				"c-1": {
					fsrsCard: {
						state: State.Review,
						due: "2026-10-31T12:00:00.000Z",
						stability: 2,
						difficulty: 5,
						elapsed_days: 1,
						scheduled_days: 1,
						reps: 1,
						lapses: 0,
						last_review: "2026-10-30T00:00:00.000Z",
						learning_steps: 0,
					},
				},
			},
			decks: {
				"deck-1": { studyCount: 12, lastStudied: "2026-10-29T00:00:00.000Z" },
			},
			studyHistory: [],
			dailyLearningActivities: [],
			spellingProgress: {},
			continuity: { sources: {}, issues: [], journal: null },
		};

		index.restoreFromCache(cache, learning);

		expect(index.getAvailableTags()).toEqual(["#flashcards", "#english"]);
		expect(index.hasAvailableTagsSnapshot()).toBe(true);

		const deck = index.getDeck("deck-1");
		expect(deck?.studyCount).toBe(12);
		expect(deck?.lastStudied).toBe("2026-10-29T00:00:00.000Z");

		const card = index.getCard("deck-1", "c-1");
		expect(card).toBeDefined();
		expect(card?.fsrsCard.state).toBe(State.Review);
		expect(card?.fsrsCard.due).toEqual(new Date("2026-10-31T12:00:00.000Z"));
	});

	it("manages card index, finds location, and computes stats and due times", () => {
		const index = new DeckSourceIndex();
		const now = new Date("2026-10-30T12:00:00.000Z");
		const past = new Date("2026-10-30T10:00:00.000Z");
		const future1 = new Date("2026-10-30T14:00:00.000Z");
		const future2 = new Date("2026-10-30T16:00:00.000Z");

		const deck1: Deck = {
			id: "deck-1",
			name: "Deck 1",
			filePath: "deck-1.md",
			tag: "#test",
			cards: [
				createDummyCard("c-new", State.New, now),
				createDummyCard("c-due", State.Review, past),
				createDummyCard("c-future", State.Review, future1),
			],
			studyCount: 0,
			lastStudied: null,
		};
		const deck2: Deck = {
			id: "deck-2",
			name: "Deck 2",
			filePath: "deck-2.md",
			tag: "#test",
			cards: [createDummyCard("c-relearning", State.Relearning, future2)],
			studyCount: 0,
			lastStudied: null,
		};

		index.installSynchronizedDecks(
			new Map([
				["deck-1", deck1],
				["deck-2", deck2],
			]),
			["#test"],
			true,
		);

		expect(index.getDeckStructureRevision()).toBe(1);

		// Location lookup
		const loc1 = index.findCardLocation("deck-1", "c-due");
		expect(loc1).toEqual({ deckId: "deck-1", deck: deck1, cardIndex: 1 });

		// Cross-deck lookup (e.g. card moved or queried with wrong deckId)
		const locCross = index.findCardLocation("deck-1", "c-relearning");
		expect(locCross).toEqual({ deckId: "deck-2", deck: deck2, cardIndex: 0 });

		// Stats
		const stats = index.getDeckStats(deck1, now);
		expect(stats.totalCards).toBe(3);
		expect(stats.newCards).toBe(1);
		expect(stats.dueCards).toBe(1); // past is due
		expect(stats.reviewCards).toBe(2);

		// Next due time after now
		const nextDue = index.getNextDueTime(now);
		expect(nextDue).toBe(future1.getTime());

		// Incremental card updates
		const updatedDue = new Date("2026-10-30T18:00:00.000Z");
		index.applyCardUpdates([
			{
				deckId: "deck-1",
				cardId: "c-due",
				fsrsCard: {
					...deck1.cards[1]!.fsrsCard,
					due: updatedDue,
				},
			},
		]);

		const updatedCard = index.getCard("deck-1", "c-due");
		expect(updatedCard?.fsrsCard.due).toEqual(updatedDue);

		// Due time after now should still be future1
		expect(index.getNextDueTime(now)).toBe(future1.getTime());
	});

	it("schedules deck index cache writes through cache store", async () => {
		const mockCacheStore: DeckIndexCacheStore<SerializedDeck> = {
			load: vi.fn(),
			save: vi.fn().mockResolvedValue(undefined),
		};

		const index = new DeckSourceIndex({ deckIndexCache: mockCacheStore });
		const deck: Deck = {
			id: "deck-1",
			name: "Deck 1",
			filePath: "deck-1.md",
			tag: "#test",
			cards: [],
			studyCount: 1,
			lastStudied: null,
		};

		index.scheduleCacheWrite(new Map([["deck-1", deck]]), ["#test"]);
		// Allow asynchronous write queue to drain
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockCacheStore.save).toHaveBeenCalled();
	});
});
