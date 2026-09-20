import { createEmptyCard, State } from "ts-fsrs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CardIdentityContinuity,
	CardIdentityContinuitySnapshot,
} from "../../identity/cardIdentityContinuity";
import {
	type Deck,
	type FlashcardSettings,
	type SpellingCardProgress,
	type StudyHistoryEntry,
	type StudySettings,
} from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import {
	createDeckHome,
	type DeckHomeClock,
	type DeckHomeEvent,
	type DeckHomeRepository,
} from "../deckHome";
import {
	restoreDailyLearningActivity,
	type DailyLearningActivity,
} from "../../history/dailyLearningActivity";

const STABLE_ONE = "550e8400-e29b-41d4-a716-446655440000";
const STABLE_TWO = "7d444840-9dc0-11d1-b245-5ffdce74fad2";

function makeDeck(id = "notes/words.md", due = new Date("2026-08-02T12:01:00.000Z")): Deck {
	return {
		id,
		name: "Words",
		filePath: id,
		tag: "#word",
		cards: [
			{
				id: STABLE_ONE,
				front: "hello world",
				back: "你好，世界",
				fsrsCard: {
					...createEmptyCard(),
					state: State.Review,
					due,
					reps: 1,
				},
				sourceFile: id,
				indexInFile: 0,
			},
			{
				id: STABLE_TWO,
				front: "science / fair",
				back: "科学展",
				fsrsCard: createEmptyCard(new Date("2026-08-02T12:00:00.000Z")),
				sourceFile: id,
				indexInFile: 1,
			},
		],
		studyCount: 3,
		lastStudied: null,
	};
}

function makeSettings(overrides: Partial<FlashcardSettings> = {}): FlashcardSettings {
	return {
		...DEFAULT_SETTINGS,
		...overrides,
		fsrsParameters: { ...DEFAULT_SETTINGS.fsrsParameters },
		deckStudySettings: overrides.deckStudySettings ?? {},
		wordLearningDecks: overrides.wordLearningDecks ?? {},
		pronunciation: { ...DEFAULT_SETTINGS.pronunciation },
	};
}

class MemoryRepository implements DeckHomeRepository {
	private revision = 1;
	private readonly listeners = new Set<() => void>();
	readonly statsReads = new Map<string, number>();

	getDeck?: (deckId: string) => Deck | undefined;
	getEffectiveStudySettings?: (deckId: string) => StudySettings;
	getSpellingProgress?: () => Readonly<Record<string, SpellingCardProgress>>;
	getStudyHistory?: () => StudyHistoryEntry[];
	dailyLearningActivity: DailyLearningActivity = restoreDailyLearningActivity(undefined);
	recordWordListVisit?: (
		deckId: string,
		deckName: string,
		startTimeMs: number,
		endTimeMs: number,
	) => Promise<void>;

	constructor(
		public decks: Deck[],
		public settings: FlashcardSettings = makeSettings(),
	) {}

	getRevision(): number {
		return this.revision;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getAllDecks(): Deck[] {
		return this.decks;
	}

	getDeckStats(deck: Deck, now = new Date()) {
		this.statsReads.set(deck.id, (this.statsReads.get(deck.id) ?? 0) + 1);
		return {
			totalCards: deck.cards.length,
			newCards: deck.cards.filter((card) => card.fsrsCard.state === State.New).length,
			dueCards: deck.cards.filter(
				(card) => card.fsrsCard.state !== State.New && card.fsrsCard.due <= now,
			).length,
			learningCards: 0,
			reviewCards: 1,
			relearningCards: 0,
		};
	}

	getSettings(): FlashcardSettings {
		return this.settings;
	}

	getLearningFootprint(now: Date) {
		return this.dailyLearningActivity.footprint(now);
	}

	getNextDueTime(now = new Date()): number | null {
		let min = Infinity;
		for (const deck of this.decks) {
			for (const card of deck.cards) {
				if (card.fsrsCard.state === State.New) continue;
				const due = card.fsrsCard.due.getTime();
				if (due > now.getTime() && due < min) min = due;
			}
		}
		return min === Infinity ? null : min;
	}

	commit(change: () => void): void {
		change();
		this.revision++;
		for (const listener of this.listeners) listener();
	}
}

class FakeClock implements DeckHomeClock {
	callback: (() => void) | null = null;
	delay = -1;
	clearCount = 0;

	constructor(public current: Date) {}

	now(): Date {
		return new Date(this.current);
	}

	setTimeout(callback: () => void, delay: number): unknown {
		this.callback = callback;
		this.delay = delay;
		return callback;
	}

	clearTimeout(): void {
		this.clearCount++;
		this.callback = null;
	}

	advanceTo(next: Date): void {
		const callback = this.callback;
		this.current = next;
		this.callback = null;
		callback?.();
	}
}

function makeIdentity(
	snapshot: CardIdentityContinuitySnapshot = {
		sources: {},
		issues: [],
		journal: null,
	},
	resolve = vi.fn().mockResolvedValue({ kind: "applied" }),
): CardIdentityContinuity {
	return {
		synchronize: vi.fn().mockResolvedValue({ kind: "current", changedDeckIds: [] }),
		prepareEdit: vi.fn().mockResolvedValue({ kind: "not-found" }),
		change: vi.fn(),
		inspect: vi.fn(() => snapshot),
		resolve,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("DeckHome", () => {
	let events: DeckHomeEvent[];

	beforeEach(() => {
		events = [];
	});

	it("publishes a purpose-built home read model with centralized spelling readiness", () => {
		const deck = makeDeck();
		const repository = new MemoryRepository(
			[deck],
			makeSettings({ wordLearningDecks: { [deck.id]: true } }),
		);
		repository.dailyLearningActivity = restoreDailyLearningActivity([
			{
				date: "2026-08-02",
				answers: { study: 3, practice: 2, spelling: 1 },
				seconds: { study: 60, practice: 30, spelling: 20, "word-list": 10 },
				completedAnswers: { study: 3, practice: 0, spelling: 0 },
				completedSessions: { study: 1, practice: 0, spelling: 0 },
			},
		]);
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
			clock: new FakeClock(new Date("2026-08-02T12:00:00.000Z")),
		});

		const snapshot = home.getSnapshot();

		expect(snapshot.totals).toEqual({
			deckCount: 1,
			totalCards: 2,
			newCards: 1,
			dueCards: 0,
			studyCount: 3,
		});
		expect(snapshot.decks[0]).toMatchObject({
			id: deck.id,
			name: "Words",
			spelling: {
				enabled: true,
				ready: true,
				valid: false,
				issueCount: 1,
				ignoredCardCount: 1,
			},
		});
		expect(snapshot.decks[0]).not.toHaveProperty("cards");
		expect(snapshot.learningFootprint).toMatchObject({
			today: { answers: { study: 3, practice: 2, spelling: 1 } },
			todayTotalSeconds: 120,
			currentStreak: 1,
			bestStreak: 1,
		});
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.decks[0])).toBe(true);
	});

	it("persists a custom deck order and appends newly discovered decks", async () => {
		const first = makeDeck("notes/first.md");
		const second = makeDeck("notes/second.md");
		const third = makeDeck("notes/third.md");
		const repository = new MemoryRepository(
			[first, second, third],
			makeSettings({
				deckOrder: [second.id, "notes/missing.md", second.id],
			}),
		);
		const saveDeckOrder = vi.fn(async (deckIds: readonly string[]) => {
			repository.commit(() => {
				repository.settings = makeSettings({
					deckOrder: [...deckIds],
				});
			});
		});
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			saveDeckOrder,
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		expect(home.getSnapshot().decks.map((deck) => deck.id)).toEqual([
			second.id,
			first.id,
			third.id,
		]);

		const outcome = await home.act({
			kind: "reorder",
			deckIds: [third.id, first.id, second.id],
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(saveDeckOrder).toHaveBeenCalledWith([third.id, first.id, second.id]);
		expect(home.getSnapshot().decks.map((deck) => deck.id)).toEqual([
			third.id,
			first.id,
			second.id,
		]);

		home.dispose();
		const reopenedHome = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});
		expect(reopenedHome.getSnapshot().decks.map((deck) => deck.id)).toEqual([
			third.id,
			first.id,
			second.id,
		]);
	});

	it("publishes a new snapshot only when the repository announces a committed revision", () => {
		const repository = new MemoryRepository([makeDeck()]);
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});
		const listener = vi.fn();
		home.subscribe(listener);
		const previous = home.getSnapshot();

		repository.decks[0]!.studyCount = 9;
		expect(home.getSnapshot()).toBe(previous);
		repository.commit(() => undefined);

		expect(home.getSnapshot()).not.toBe(previous);
		expect(home.getSnapshot().revision).toBe(2);
		expect(home.getSnapshot().totals.studyCount).toBe(9);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("reuses statistics for decks whose committed object did not change", () => {
		const changedDeck = makeDeck("notes/changed.md");
		const unchangedDeck = makeDeck("notes/unchanged.md");
		const repository = new MemoryRepository([changedDeck, unchangedDeck]);
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});
		home.subscribe(vi.fn());
		repository.statsReads.clear();

		repository.commit(() => {
			repository.decks = [
				{
					...changedDeck,
					cards: changedDeck.cards.map((card) => ({ ...card })),
				},
				unchangedDeck,
			];
		});

		expect(repository.statsReads.get(changedDeck.id)).toBe(1);
		expect(repository.statsReads.get(unchangedDeck.id)).toBeUndefined();
	});

	it("owns one settings draft, submits a narrow patch, and retains it after failure", async () => {
		const deck = makeDeck();
		const repository = new MemoryRepository([deck]);
		const save = vi.fn().mockRejectedValueOnce(new Error("disk unavailable"));
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: save,
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		expect(
			await home.act({
				kind: "open-settings",
				ownerId: "view-a",
				deckId: deck.id,
			}),
		).toEqual({
			kind: "applied",
		});
		expect(
			await home.act({
				kind: "open-settings",
				ownerId: "view-b",
				deckId: deck.id,
			}),
		).toEqual({ kind: "rejected", reason: "draft-owned-by-another-view" });
		await home.act({
			kind: "change-settings",
			ownerId: "view-a",
			change: { field: "dailyNewCards", value: 12 },
		});

		expect(await home.act({ kind: "save-settings", ownerId: "view-a" })).toEqual({
			kind: "failed",
			message: "disk unavailable",
		});
		expect(home.getSnapshot().settingsDraft).toMatchObject({
			ownerId: "view-a",
			dailyNewCards: 12,
			daysToComplete: "1",
		});
		expect(events).toContainEqual({
			kind: "settings-save-failed",
			message: "disk unavailable",
		});

		await home.act({ kind: "save-settings", ownerId: "view-a" });
		expect(save).toHaveBeenLastCalledWith({
			deckId: deck.id,
			overrides: null,
			wordLearningEnabled: false,
		});
		expect(home.getSnapshot().settingsDraft).toBeNull();
	});

	it("serializes mutations while allowing one captured PDF export", async () => {
		const deck = makeDeck();
		const repository = new MemoryRepository([deck]);
		const saving = deferred<void>();
		const exportDeck = vi.fn(async (captured: Deck) => {
			expect(captured).not.toBe(deck);
			expect(captured.cards).not.toBe(deck.cards);
			return { kind: "cancelled" as const };
		});
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: () => saving.promise,
			exportDeck,
			report: (event) => events.push(event),
		});
		await home.act({
			kind: "open-settings",
			ownerId: "view-a",
			deckId: deck.id,
		});

		const savePromise = home.act({
			kind: "save-settings",
			ownerId: "view-a",
		});
		expect(home.getSnapshot().mutation).toEqual({
			kind: "saving-settings",
			deckId: deck.id,
		});
		expect(await home.act({ kind: "refresh" })).toEqual({
			kind: "rejected",
			reason: "busy",
		});
		expect(await home.act({ kind: "export", deckId: deck.id })).toEqual({
			kind: "cancelled",
		});
		saving.resolve();
		await savePromise;
	});

	it("uses an opaque migration continuation and cancels waiting work when its owner closes", async () => {
		const deck = makeDeck();
		const preview = {
			ticket: "internal-ticket",
			sourceCount: 1,
			cardCount: 2,
			sources: [{ deckId: deck.id, deckName: deck.name, cardCount: 2 }],
		};
		const resolveIdentity = vi.fn().mockResolvedValue({ kind: "applied" });
		const identity = makeIdentity(
			{
				sources: {},
				issues: [],
				journal: null,
				migration: preview,
			},
			resolveIdentity,
		);
		const home = createDeckHome({
			repository: new MemoryRepository([deck]),
			identity,
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		const request = await home.act({
			kind: "request-migration",
			ownerId: "view-a",
			deckId: deck.id,
		});
		expect(request).toMatchObject({
			kind: "confirmation-required",
			scope: { kind: "deck", deckId: deck.id },
			cardCount: 2,
			deckName: deck.name,
		});
		expect(request).not.toHaveProperty("ticket");

		await home.act({ kind: "release-owner", ownerId: "view-a" });
		expect(home.getSnapshot().mutation).toEqual({ kind: "idle" });
		if (request.kind !== "confirmation-required") throw new Error("Expected confirmation");
		expect(
			await home.act({
				kind: "continue",
				ownerId: "view-a",
				continuation: request.continuation,
				confirmed: true,
			}),
		).toEqual({ kind: "rejected", reason: "invalid-continuation" });
		expect(resolveIdentity).not.toHaveBeenCalled();
	});

	it("revalidates navigation against committed state", async () => {
		const deck = makeDeck();
		const repository = new MemoryRepository(
			[deck],
			makeSettings({ wordLearningDecks: { [deck.id]: true } }),
		);
		const home = createDeckHome({
			repository,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		repository.decks = [];
		expect(
			await home.act({
				kind: "navigate",
				destination: "study",
				deckId: deck.id,
			}),
		).toEqual({ kind: "rejected", reason: "deck-missing" });
	});

	it("refreshes due counts at the earliest due time and stops the clock without subscribers", () => {
		const clock = new FakeClock(new Date("2026-08-02T12:00:00.000Z"));
		const deck = makeDeck();
		const home = createDeckHome({
			repository: new MemoryRepository([deck]),
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
			clock,
		});
		const listener = vi.fn();
		const unsubscribe = home.subscribe(listener);
		listener.mockClear();

		expect(clock.delay).toBe(60_000);
		clock.advanceTo(new Date("2026-08-02T12:01:00.000Z"));
		expect(home.getSnapshot().totals.dueCards).toBe(1);
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		expect(clock.callback).toBeNull();
		expect(clock.clearCount).toBeGreaterThan(0);
	});

	it("recomputes time-sensitive statistics when the first subscriber arrives", () => {
		const clock = new FakeClock(new Date("2026-08-02T12:00:00.000Z"));
		const home = createDeckHome({
			repository: new MemoryRepository([makeDeck()]),
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
			clock,
		});
		clock.current = new Date("2026-08-02T12:02:00.000Z");

		home.subscribe(vi.fn());

		expect(home.getSnapshot().totals.dueCards).toBe(1);
	});

	it("falls back safely for query and record facade methods when repository does not provide them", async () => {
		const deck = makeDeck();
		const home = createDeckHome({
			repository: new MemoryRepository([deck]),
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		expect(home.getDeck(deck.id)).toEqual(deck);
		expect(home.getDeck("non-existent")).toBeUndefined();
		expect(home.getEffectiveStudySettings(deck.id)).toBeDefined();
		expect(home.getEffectiveStudySettings(deck.id).dailyNewCards).toBe(
			DEFAULT_SETTINGS.dailyNewCards,
		);
		expect(home.getSpellingProgress()).toEqual({});
		expect(home.getStudyHistory()).toEqual([]);

		await expect(home.recordWordListVisit(deck.id, 1000, 2000)).resolves.toBeUndefined();
	});

	it("delegates query and record facade methods to repository when available", async () => {
		const deck = makeDeck();
		const memoryRepo = new MemoryRepository([deck]);
		const customSettings = {
			...DEFAULT_SETTINGS,
			dailyNewCards: 42,
		};
		const customSpellingProgress = {
			completedCounts: { "card-1": 3 },
			history: [],
		};
		const customHistory = [
			{
				date: "2026-08-02",
				cardsStudied: 10,
				timeSpentSeconds: 120,
			},
		];
		const recordWordListVisitSpy = vi.fn().mockResolvedValue(undefined);

		memoryRepo.getDeck = (id: string) => (id === deck.id ? deck : undefined);
		memoryRepo.getEffectiveStudySettings = vi.fn().mockReturnValue(customSettings);
		memoryRepo.getSpellingProgress = vi.fn().mockReturnValue(customSpellingProgress);
		memoryRepo.getStudyHistory = vi.fn().mockReturnValue(customHistory);
		memoryRepo.recordWordListVisit = recordWordListVisitSpy;

		const home = createDeckHome({
			repository: memoryRepo,
			identity: makeIdentity(),
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: (event) => events.push(event),
		});

		expect(home.getDeck(deck.id)).toBe(deck);
		expect(home.getEffectiveStudySettings(deck.id)).toBe(customSettings);
		expect(home.getSpellingProgress()).toBe(customSpellingProgress);
		expect(home.getStudyHistory()).toBe(customHistory);

		await home.recordWordListVisit(deck.id, 1000, 2000);
		expect(recordWordListVisitSpy).toHaveBeenCalledWith(deck.id, deck.name, 1000, 2000);
	});
});
