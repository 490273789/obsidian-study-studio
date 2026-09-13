import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import { FlashcardRepository, type SerializedDeck } from "../flashcardRepository";
import { WorkbenchFlashcardAuthority } from "../../../obsidian/workbenchFlashcardAuthority";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";
import { WorkbenchStore, type StorageBackend } from "../../../../../core/storage/workbenchStore";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";

function createMockBackend(initialData: unknown = null): StorageBackend & {
	data: unknown;
	saveCalls: number;
} {
	return {
		data: initialData,
		saveCalls: 0,
		async loadData() {
			return this.data;
		},
		async saveData(nextData: unknown) {
			this.saveCalls++;
			this.data = JSON.parse(JSON.stringify(nextData));
		},
	};
}

function makeCard(
	id: string,
	state: State,
	due: Date,
	indexInFile: number,
	overrides: Partial<FlashCard> = {},
): FlashCard {
	return {
		id,
		front: `front ${indexInFile}`,
		back: `back ${indexInFile}`,
		fsrsCard: {
			...createEmptyCard(),
			due,
			state,
			reps: state === State.New ? 0 : 1,
		},
		sourceFile: "notes/deck.md",
		indexInFile,
		...overrides,
	};
}

function makeDeck(id = "deck-1", cards: FlashCard[] = []): Deck {
	return {
		id,
		name: "Test Deck",
		filePath: "notes/deck.md",
		tag: "#flashcard",
		cards,
		studyCount: 3,
		lastStudied: "2026-03-01T00:00:00.000Z",
	};
}

function serializeDeck(deck: Deck): SerializedDeck {
	return {
		...deck,
		cards: deck.cards.map((card) => ({
			...card,
			fsrsCard: {
				...card.fsrsCard,
				due: card.fsrsCard.due.toISOString(),
				last_review: card.fsrsCard.last_review?.toISOString() ?? null,
				learning_steps: card.fsrsCard.learning_steps ?? 0,
			},
		})),
	};
}

describe("FlashcardRepository", () => {
	it("initializes with empty decks and passes settings through from WorkbenchStore", async () => {
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: { ...DEFAULT_SETTINGS, dailyNewCards: 30 },
		});
		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});

		await repo.load();

		expect(repo.getAllDecks()).toEqual([]);
		expect(repo.getSettings().dailyNewCards).toBe(30);
		expect(repo.getRevision()).toBe(1);
	});

	it("restores learning state and deck index cache on load", async () => {
		const deck = makeDeck("deck-1", [
			makeCard("c1", State.Review, new Date("2026-03-01T12:00:00.000Z"), 0),
		]);
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: {
				cards: {
					c1: {
						fsrsCard: {
							due: "2026-03-01T12:00:00.000Z",
							stability: 5,
							difficulty: 4,
							elapsed_days: 2,
							scheduled_days: 5,
							reps: 2,
							lapses: 0,
							state: State.Review,
							last_review: "2026-02-24T12:00:00.000Z",
							learning_steps: 0,
						},
					},
				},
				decks: {
					"deck-1": { studyCount: 7, lastStudied: "2026-03-01T00:00:00.000Z" },
				},
				studyHistory: [],
				spellingProgress: {},
				continuity: { sources: {}, issues: [], journal: null },
			},
			cache: { deckIndexVersion: 1 },
		});
		const mockCacheStore = {
			load: vi.fn().mockResolvedValue({
				version: 1,
				updatedAt: new Date().toISOString(),
				availableTags: ["#flashcard"],
				decks: { "deck-1": serializeDeck(deck) },
			}),
			loadOrRebuild: vi.fn(),
			save: vi.fn(),
			invalidateSource: vi.fn(),
			clear: vi.fn(),
		};

		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: mockCacheStore,
		});

		await repo.load();

		const restoredDecks = repo.getAllDecks();
		expect(restoredDecks).toHaveLength(1);
		expect(restoredDecks[0]?.studyCount).toBe(7);
		expect(restoredDecks[0]?.cards[0]?.fsrsCard.stability).toBe(5);
		expect(repo.getAvailableTags()).toEqual(["#flashcard"]);
	});

	it("migrates legacy V1 decks into V2 learning state and saves to WorkbenchStore", async () => {
		const deck = makeDeck("legacy-deck", [
			makeCard("c1", State.New, new Date("2026-01-01T00:00:00.000Z"), 0),
		]);
		const backend = createMockBackend({
			decks: { "legacy-deck": serializeDeck(deck) },
			studyHistory: [
				{
					deckId: "legacy-deck",
					deckName: "Test Deck",
					reviewCount: 5,
					correctCount: 4,
					totalDurationMs: 10000,
					date: "2026-01-01",
					timestamp: 123456789,
				},
			],
			availableTags: ["#legacy"],
		});

		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});

		await repo.load();

		expect(repo.getAllDecks()).toHaveLength(1);
		expect(repo.getStudyHistory()).toHaveLength(1);

		// Saved partition to store
		const savedLearning = store.getPartition<any>("learning");
		expect(savedLearning).toBeDefined();
		expect(savedLearning.decks["legacy-deck"].studyCount).toBe(3);
		expect(savedLearning.cards["c1"]).toBeDefined();
		expect(store.getRawDocument()).not.toHaveProperty("decks");
		expect(store.getRawDocument()).not.toHaveProperty("studyHistory");
		expect(store.getRawDocument()).not.toHaveProperty("availableTags");
	});

	it("commits session transitions atomically and updates learning partition", async () => {
		const initialDeck = makeDeck("deck-1", [
			makeCard("c1", State.New, new Date("2026-01-01T00:00:00.000Z"), 0),
			makeCard("c2", State.New, new Date("2026-01-01T00:00:00.000Z"), 1),
		]);
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: {
				cards: {},
				decks: { "deck-1": { studyCount: 0, lastStudied: null } },
				studyHistory: [],
				spellingProgress: {},
				continuity: { sources: {}, issues: [], journal: null },
			},
			cache: { deckIndexVersion: 1 },
		});
		const mockCacheStore = {
			load: vi.fn().mockResolvedValue({
				version: 1,
				updatedAt: new Date().toISOString(),
				availableTags: ["#flashcard"],
				decks: { "deck-1": serializeDeck(initialDeck) },
			}),
			loadOrRebuild: vi.fn(),
			save: vi.fn(),
			invalidateSource: vi.fn(),
			clear: vi.fn(),
		};

		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: mockCacheStore,
		});
		await repo.load();

		const listener = vi.fn();
		repo.subscribe(listener);

		await repo.commitSessionTransition({
			cardUpdates: [
				{
					cardId: "c1",
					deckId: "deck-1",
					fsrsCard: {
						...createEmptyCard(),
						due: new Date("2026-03-05T00:00:00.000Z"),
						state: State.Review,
					},
				},
			],
			incrementStudyCountFor: ["deck-1"],
			spellingAttempts: [
				{
					cardId: "c1",
					correct: true,
					attemptedAt: Date.now(),
				},
			],
			historyEntries: [
				{
					deckId: "deck-1",
					deckName: "Test Deck",
					mode: "study",
					cardCount: 1,
					duration: 5000,
				},
			],
		});

		const updatedDeck = repo.getDeck("deck-1")!;
		expect(updatedDeck.studyCount).toBe(1);
		expect(updatedDeck.cards[0]?.fsrsCard.state).toBe(State.Review);
		expect(repo.getSpellingProgress()["c1"]?.correctAttempts).toBe(1);
		expect(repo.getStudyHistory()).toHaveLength(1);
		expect(listener).toHaveBeenCalledTimes(1);

		// WorkbenchStore partition was updated
		const learning = store.getPartition<any>("learning");
		expect(learning.decks["deck-1"].studyCount).toBe(1);
		expect(learning.cards["c1"].fsrsCard.state).toBe(State.Review);
	});

	it("computes deck stats accurately", async () => {
		const now = new Date("2026-03-01T12:00:00.000Z");
		const deck = makeDeck("deck-1", [
			makeCard("c1", State.New, new Date("2026-01-01T00:00:00.000Z"), 0),
			makeCard("c2", State.Learning, new Date("2026-03-01T10:00:00.000Z"), 1), // due
			makeCard("c3", State.Review, new Date("2026-03-01T14:00:00.000Z"), 2), // future
			makeCard("c4", State.Review, new Date("2026-03-01T08:00:00.000Z"), 3), // due
		]);

		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});

		const stats = repo.getDeckStats(deck, now);
		expect(stats.totalCards).toBe(4);
		expect(stats.newCards).toBe(1);
		expect(stats.dueCards).toBe(2);
		expect(stats.learningCards).toBe(1);
		expect(stats.reviewCards).toBe(2);
	});

	it("commits continuity state and prunes deleted spelling progress", async () => {
		const c1 = makeCard("c1", State.Review, new Date(), 0);
		const c2 = makeCard("c2", State.Review, new Date(), 1);
		const initialDeck = makeDeck("deck-1", [c1, c2]);

		const backend = createMockBackend({
			decks: { "deck-1": serializeDeck(initialDeck) },
			settings: DEFAULT_SETTINGS,
			spellingProgress: {
				c1: { attempts: 1, correctAttempts: 1, correctStreak: 1, lastAttemptAt: 100 },
				c2: { attempts: 2, correctAttempts: 0, correctStreak: 0, lastAttemptAt: 100 },
			},
		});
		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});
		await repo.load();

		const continuityStore = repo.createContinuityStateStore();
		const initialContinuity = await continuityStore.load();
		expect(initialContinuity.configuredTags).toEqual(DEFAULT_SETTINGS.flashcardTags);

		// Commit new continuity where card c2 is removed
		const updatedDeck = makeDeck("deck-1", [c1]);
		await continuityStore.commit({
			configuredTags: ["#flashcard"],
			availableTags: ["#flashcard", "#extra"],
			decks: new Map([["deck-1", updatedDeck]]),
			continuity: {
				sources: { "notes/deck.md": { type: "current" } },
				issues: [],
				journal: null,
			},
		});

		expect(repo.getAllDecks()).toHaveLength(1);
		expect(repo.getAvailableTags()).toContain("#extra");
		// c2 was deleted from decks, so spelling progress for c2 was pruned
		expect(repo.getSpellingProgress()["c1"]).toBeDefined();
		expect(repo.getSpellingProgress()["c2"]).toBeUndefined();
	});

	it("records word list visits into study history and persists them", async () => {
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: {
				cards: {},
				decks: {},
				studyHistory: [],
				spellingProgress: {},
				continuity: { sources: {}, issues: [], journal: null },
			},
		});
		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});
		await repo.load();

		await repo.recordWordListVisit("deck-1", "My Deck", 1000, 7000);

		expect(repo.getStudyHistory()).toHaveLength(1);
		expect(repo.getStudyHistory()[0]?.deckName).toBe("My Deck");
		expect(repo.getStudyHistory()[0]?.duration).toBe(6);
	});

	it("rehydrates the complete learning snapshot after external Sync", async () => {
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: {
				cards: {},
				decks: {},
				studyHistory: [],
				spellingProgress: {},
				continuity: { sources: {}, issues: [], journal: null },
			},
		});
		const store = new WorkbenchStore(backend);
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: null,
		});
		await repo.load();

		backend.data = {
			schemaVersion: 2,
			settings: { ...DEFAULT_SETTINGS, dailyNewCards: 31 },
			learning: {
				cards: {
					synced: {
						sourceFile: "notes/external.md",
						fsrsCard: {
							due: "2026-04-01T00:00:00.000Z",
							stability: 3,
							difficulty: 4,
							elapsed_days: 1,
							scheduled_days: 3,
							reps: 2,
							lapses: 0,
							state: State.Review,
							last_review: null,
							learning_steps: 0,
						},
					},
				},
				decks: { "notes/external.md": { studyCount: 9, lastStudied: null } },
				studyHistory: [
					{
						deckId: "notes/external.md",
						deckName: "External",
						reviewCount: 1,
						correctCount: 1,
						totalDurationMs: 1000,
						date: "2026-04-01",
						timestamp: 1,
					},
				],
				spellingProgress: {
					synced: {
						attempts: 2,
						correctAttempts: 2,
						correctStreak: 2,
						lastAttemptAt: 1,
					},
				},
				continuity: {
					sources: { "notes/external.md": { type: "current" } },
					issues: [],
					journal: null,
				},
			},
		};
		await store.reloadExternalSettings();

		await vi.waitFor(() => {
			expect(repo.getSettings().dailyNewCards).toBe(31);
			expect(repo.getDeck("notes/external.md")?.studyCount).toBe(9);
			expect(repo.getStudyHistory()).toHaveLength(1);
			expect(repo.getSpellingProgress().synced?.correctStreak).toBe(2);
		});
	});

	it("keeps the observable snapshot and revision unchanged when authority persistence fails", async () => {
		const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
		const repo = new FlashcardRepository({ authority, deckIndexCache: null });
		await repo.load();
		const revision = repo.getRevision();
		authority.failNextCommit = true;

		await expect(repo.recordWordListVisit("deck", "Deck", 0, 6_000)).rejects.toMatchObject({
			code: "authority-write-failed",
		});

		expect(repo.getRevision()).toBe(revision);
		expect(repo.getStudyHistory()).toEqual([]);
	});

	it("does not roll back a durable continuity commit when the rebuildable cache fails", async () => {
		const cache = {
			load: vi.fn().mockResolvedValue(null),
			loadOrRebuild: vi.fn(),
			save: vi.fn().mockRejectedValue(new Error("cache unavailable")),
			invalidateSource: vi.fn(),
			clear: vi.fn(),
		};
		const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
		const repo = new FlashcardRepository({ authority, deckIndexCache: cache });
		await repo.load();
		const state = await repo.createContinuityStateStore().load();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await repo.commit(state);

		await vi.waitFor(() => expect(cache.save).toHaveBeenCalledOnce());
		expect(repo.getRevision()).toBe(2);
		warning.mockRestore();
	});

	it("automatically loads data and configured tags on continuity store load without prior explicit load", async () => {
		const authority = new MemoryFlashcardAuthority({
			...DEFAULT_SETTINGS,
			flashcardTags: ["#words", "#grammar"],
		});
		const repo = new FlashcardRepository({ authority, deckIndexCache: null });

		// Intentionally do NOT call repo.load() before accessing continuity store.
		const stateStore = repo.createContinuityStateStore();
		const state = await stateStore.load();

		expect(state.configuredTags).toEqual(["#words", "#grammar"]);
		expect(repo.getRevision()).toBe(1);
	});

	it("uses initialSettings synchronously before load completes", () => {
		const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
		const initialSettings = {
			...DEFAULT_SETTINGS,
			flashcardTags: ["#immediateTag"],
			dailyNewCards: 50,
		};
		const repo = new FlashcardRepository({
			authority,
			deckIndexCache: null,
			initialSettings,
		});

		expect(repo.getSettings().flashcardTags).toEqual(["#immediateTag"]);
		expect(repo.getSettings().dailyNewCards).toBe(50);
	});

	it("deduplicates concurrent load operations into a single execution", async () => {
		const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
		const readSpy = vi.spyOn(authority, "read");
		const repo = new FlashcardRepository({ authority, deckIndexCache: null });

		await Promise.all([repo.load(), repo.load(), repo.load()]);

		expect(readSpy).toHaveBeenCalledTimes(1);
		expect(repo.getRevision()).toBe(1);
	});
});
