import { describe, expect, it } from "vite-plus/test";
import { State } from "ts-fsrs";
import type {
	Deck,
	FlashCard,
	SpellingCardProgress,
	StudySettings,
} from "../../../../../core/shared/types";
import {
	getDayList,
	getTodayStudyCounts,
	getCardsForDay,
	getStudySetupPlan,
	getPracticeSetupPlan,
	getSpellingSetupPlan,
	sortDeckCards,
	planDayPracticeSession,
	planRandomPracticeSession,
	planRangePracticeSession,
	planIncorrectPracticeSession,
	evaluateSpellingDeckEligibility,
	planSmartSpellingSession,
	planRangeSpellingSession,
	planIncorrectSpellingSession,
	planRetryIncorrectSession,
	planSessionQueue,
} from "../sessionPlanner";

function makeCard(
	id: string,
	state: State = State.New,
	due: Date = new Date("2026-08-01T00:00:00.000Z"),
	indexInFile: number = 0,
	front = "Front",
	back = "Back",
): FlashCard {
	return {
		id,
		front,
		back,
		fsrsCard: {
			due,
			stability: 1,
			difficulty: 1,
			elapsed_days: 0,
			scheduled_days: 0,
			reps: 0,
			lapses: 0,
			state,
			learning_steps: 0,
		},
		sourceFile: "notes/deck.md",
		indexInFile,
	};
}

function makeDeck(cards: FlashCard[]): Deck {
	return {
		id: "notes/deck.md",
		name: "deck",
		filePath: "notes/deck.md",
		tag: "#flashcards",
		cards,
		studyCount: 0,
		lastStudied: null,
	};
}

const defaultSettings: StudySettings = {
	dailyNewCards: 2,
	dailyReviewCards: 5,
	studyOrder: "sequential",
	fsrsParameters: {
		requestRetention: 0.9,
		maximumInterval: 36500,
	},
};

describe("SessionPlanner", () => {
	describe("sortDeckCards", () => {
		it("sorts cards by indexInFile stably", () => {
			const cards = [
				makeCard("c3", State.New, new Date(), 3),
				makeCard("c1", State.New, new Date(), 1),
				makeCard("c2", State.New, new Date(), 2),
			];
			const sorted = sortDeckCards(cards);
			expect(sorted.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
		});
	});

	describe("getDayList", () => {
		it("returns empty array for empty deck", () => {
			const deck = makeDeck([]);
			expect(getDayList(deck, 10)).toEqual([]);
		});

		it("partitions cards into day slices with completed, current, locked states", () => {
			const cards = [
				makeCard("c0", State.Review, new Date(), 0), // Day 0
				makeCard("c1", State.Review, new Date(), 1), // Day 0 -> completed
				makeCard("c2", State.New, new Date(), 2), // Day 1
				makeCard("c3", State.Review, new Date(), 3), // Day 1 -> current
				makeCard("c4", State.New, new Date(), 4), // Day 2 -> locked
			];
			const deck = makeDeck(cards);
			const dayList = getDayList(deck, 2);

			expect(dayList).toHaveLength(3);

			// Day 0 (cards 0-2): all studied -> isCompleted
			expect(dayList[0]).toMatchObject({
				dayIndex: 0,
				startCardIndex: 0,
				endCardIndex: 2,
				totalCards: 2,
				studiedCards: 2,
				isCompleted: true,
				isCurrent: false,
				isLocked: false,
			});

			// Day 1 (cards 2-4): partially studied -> isCurrent
			expect(dayList[1]).toMatchObject({
				dayIndex: 1,
				startCardIndex: 2,
				endCardIndex: 4,
				totalCards: 2,
				studiedCards: 1,
				isCompleted: false,
				isCurrent: true,
				isLocked: false,
			});

			// Day 2 (cards 4-5): unstudied -> isLocked
			expect(dayList[2]).toMatchObject({
				dayIndex: 2,
				startCardIndex: 4,
				endCardIndex: 5,
				totalCards: 1,
				studiedCards: 0,
				isCompleted: false,
				isCurrent: false,
				isLocked: true,
			});
		});

		it("handles first day as current when nothing is studied", () => {
			const cards = [
				makeCard("c0", State.New, new Date(), 0),
				makeCard("c1", State.New, new Date(), 1),
			];
			const deck = makeDeck(cards);
			const dayList = getDayList(deck, 2);

			expect(dayList[0]?.isCurrent).toBe(true);
			expect(dayList[0]?.isCompleted).toBe(false);
			expect(dayList[0]?.isLocked).toBe(false);
		});

		it("handles dailyNewCards being 0 or negative safely", () => {
			const cards = [makeCard("c0", State.New, new Date(), 0)];
			const deck = makeDeck(cards);
			const dayList = getDayList(deck, 0);
			expect(dayList).toHaveLength(1);
			expect(dayList[0]?.totalCards).toBe(1);
		});
	});

	describe("getTodayStudyCounts", () => {
		it("clamps new and review cards by daily limits", () => {
			const now = new Date("2026-08-02T12:00:00.000Z");
			const overdue = new Date("2026-08-01T12:00:00.000Z");
			const future = new Date("2026-08-03T12:00:00.000Z");

			const cards = [
				makeCard("n1", State.New, overdue, 0),
				makeCard("n2", State.New, overdue, 1),
				makeCard("n3", State.New, overdue, 2),
				makeCard("r1", State.Review, overdue, 3),
				makeCard("r2", State.Review, overdue, 4),
				makeCard("r3", State.Review, future, 5), // Not due
				makeCard("l1", State.Learning, overdue, 6),
			];
			const deck = makeDeck(cards);

			// dailyNewCards: 2, dailyReviewCards: 1
			const counts = getTodayStudyCounts(
				deck,
				{ dailyNewCards: 2, dailyReviewCards: 1 },
				now,
			);

			// 3 new cards in deck -> clamped to 2
			expect(counts.newCount).toBe(2);
			// 2 due review/learning cards (r1, l1) -> clamped to 1
			expect(counts.reviewCount).toBe(1);
		});
	});

	describe("getCardsForDay", () => {
		it("returns slice of sorted cards for specified day index", () => {
			const cards = [
				makeCard("c3", State.New, new Date(), 3),
				makeCard("c1", State.New, new Date(), 1),
				makeCard("c0", State.New, new Date(), 0),
				makeCard("c2", State.New, new Date(), 2),
			];
			const deck = makeDeck(cards);

			// dailyNewCards = 2
			const day0 = getCardsForDay(deck, 0, 2);
			expect(day0.map((c) => c.id)).toEqual(["c0", "c1"]);

			const day1 = getCardsForDay(deck, 1, 2);
			expect(day1.map((c) => c.id)).toEqual(["c2", "c3"]);

			const day2 = getCardsForDay(deck, 2, 2);
			expect(day2).toEqual([]);
		});

		it("returns empty array for negative dayIndex", () => {
			const deck = makeDeck([makeCard("c0", State.New, new Date(), 0)]);
			expect(getCardsForDay(deck, -1, 2)).toEqual([]);
		});
	});

	describe("getStudySetupPlan", () => {
		it("creates a complete immutable study setup plan", () => {
			const now = new Date("2026-08-02T12:00:00.000Z");
			const overdue = new Date("2026-08-01T12:00:00.000Z");

			const cards = [
				makeCard("c0", State.Review, overdue, 0),
				makeCard("c1", State.Review, overdue, 1),
			];
			const deck = makeDeck(cards);

			const plan = getStudySetupPlan(deck, defaultSettings, now, "random");

			expect(plan.allCompleted).toBe(true);
			expect(plan.completedDays).toBe(1);
			expect(plan.todayNewCount).toBe(0);
			expect(plan.todayReviewCount).toBe(2);
			expect(plan.todayTotal).toBe(2);
			expect(plan.hasAnythingToStudy).toBe(true);
			expect(plan.defaultStudyOrder).toBe("random");
		});
	});

	describe("getPracticeSetupPlan", () => {
		it("normalizes initial selection for practice setup", () => {
			const cards = [
				makeCard("c0", State.New, new Date(), 0),
				makeCard("c1", State.New, new Date(), 1),
				makeCard("c2", State.New, new Date(), 2),
			];
			const deck = makeDeck(cards);

			const randomPlan = getPracticeSetupPlan(deck, { kind: "random", questionCount: 10 });
			expect(randomPlan.maxQuestions).toBe(3);
			expect(randomPlan.initialQuestionCount).toBe(3);
			expect(randomPlan.initialSelectionMode).toBe("random");

			const rangePlan = getPracticeSetupPlan(deck, {
				kind: "range",
				startIndex: 2,
				endIndex: 5,
			});
			expect(rangePlan.initialRangeStart).toBe(2);
			expect(rangePlan.initialRangeEnd).toBe(3);
			expect(rangePlan.initialSelectionMode).toBe("range");
		});
	});

	describe("getSpellingSetupPlan", () => {
		it("derives spelling stats and clamps range", () => {
			const cards = [
				makeCard("c0", State.New, new Date(), 0, "apple", "苹果"),
				makeCard("c1", State.New, new Date(), 1, "banana", "香蕉"),
			];
			const deck = makeDeck(cards);
			const progress = {
				c0: { attempts: 1, correctAttempts: 1, correctStreak: 1, lastAttemptAt: 1000 },
			};

			const plan = getSpellingSetupPlan(deck, progress);
			expect(plan.stats.total).toBe(2);
			expect(plan.stats.unpracticed).toBe(1);
			expect(plan.maxQuestions).toBe(2);
			expect(plan.initialSelectionMode).toBe("smart");
		});
	});

	describe("practice session planning", () => {
		it("plans study-day practice in supplied card order", () => {
			const plan = planDayPracticeSession({
				deckId: "notes/deck.md",
				direction: "normal",
				cards: [
					makeCard("card-1", State.New, new Date(), 0),
					makeCard("card-2", State.New, new Date(), 1),
				],
				studyOrder: "sequential",
				shuffle: (ids) => [...ids].reverse(),
			});

			expect(plan).toEqual({
				source: "study-day",
				deckId: "notes/deck.md",
				direction: "normal",
				cardIds: ["card-1", "card-2"],
				studyOrder: "sequential",
			});
		});

		it("plans randomized study-day practice with injected shuffle", () => {
			const plan = planDayPracticeSession({
				deckId: "notes/deck.md",
				direction: "reversed",
				cards: [
					makeCard("card-1", State.New, new Date(), 0),
					makeCard("card-2", State.New, new Date(), 1),
				],
				studyOrder: "random",
				shuffle: (ids) => [...ids].reverse(),
			});

			expect(plan).toEqual({
				source: "study-day",
				deckId: "notes/deck.md",
				direction: "reversed",
				cardIds: ["card-2", "card-1"],
				studyOrder: "random",
			});
		});

		it("plans random practice by shuffling and limiting supplied cards", () => {
			const plan = planRandomPracticeSession({
				deckId: "notes/deck.md",
				direction: "normal",
				cards: [
					makeCard("card-1", State.New, new Date(), 0),
					makeCard("card-2", State.New, new Date(), 1),
					makeCard("card-3", State.New, new Date(), 2),
				],
				questionCount: 2,
				shuffle: (ids) => [...ids].reverse(),
			});

			expect(plan).toEqual({
				source: "random",
				deckId: "notes/deck.md",
				direction: "normal",
				cardIds: ["card-3", "card-2"],
				requestedQuestionCount: 2,
			});
		});

		it("plans range practice and clamps to available bounds", () => {
			const plan = planRangePracticeSession({
				deckId: "notes/deck.md",
				direction: "normal",
				cards: [
					makeCard("card-1", State.New, new Date(), 0),
					makeCard("card-2", State.New, new Date(), 1),
					makeCard("card-3", State.New, new Date(), 2),
				],
				startIndex: 2,
				endIndex: 3,
				shuffle: (ids) => [...ids].reverse(),
			});

			expect(plan.cardIds).toEqual(["card-3", "card-2"]);
		});

		it("plans incorrect-retry practice without mutating input", () => {
			const input = ["c1", "c2", "c1"];
			const plan = planIncorrectPracticeSession({
				deckId: "notes/deck.md",
				direction: "reversed",
				cardIds: input,
				shuffle: (ids) => [...ids].reverse(),
			});

			expect(input).toEqual(["c1", "c2", "c1"]);
			expect(plan.cardIds).toEqual(["c2", "c1"]);
		});
	});

	describe("spelling session planning", () => {
		const STABLE_ONE = "550e8400-e29b-41d4-a716-446655440000";
		const STABLE_TWO = "7d444840-9dc0-11d1-b245-5ffdce74fad2";

		it("derives complete deck eligibility from enablement, identity, and content", () => {
			const eligible = makeCard(STABLE_ONE, State.New, new Date(), 0, "hello world", "back");
			const invalid = makeCard(
				STABLE_TWO,
				State.New,
				new Date(),
				1,
				"science / fair",
				"back",
			);

			expect(evaluateSpellingDeckEligibility({ cards: [eligible, invalid] }, true)).toEqual({
				enabled: true,
				hasStableIdentities: true,
				canStart: true,
				valid: false,
				ready: true,
				issueCount: 1,
				eligibleCardIds: [STABLE_ONE],
				invalidCards: [
					{
						cardId: STABLE_TWO,
						indexInFile: 1,
						front: "science / fair",
					},
				],
			});
		});

		it("prioritizes last-wrong, unseen, then weaker cards in smart mode", () => {
			const cards = [
				makeCard("wrong", State.New, new Date(), 0, "apple", "back"),
				makeCard("new", State.New, new Date(), 1, "banana", "back"),
				makeCard("weak", State.New, new Date(), 2, "cherry", "back"),
				makeCard("strong", State.New, new Date(), 3, "date", "back"),
			];
			const progress: Record<string, SpellingCardProgress> = {
				wrong: {
					attempts: 2,
					correctAttempts: 1,
					correctStreak: 0,
					lastAttemptAt: 40,
					lastIncorrectAt: 40,
				},
				weak: { attempts: 4, correctAttempts: 2, correctStreak: 1, lastAttemptAt: 20 },
				strong: { attempts: 4, correctAttempts: 4, correctStreak: 3, lastAttemptAt: 10 },
			};

			const plan = planSmartSpellingSession({
				deckId: "deck.md",
				cards,
				progress,
				questionCount: 4,
				random: () => 0,
			});

			expect(plan.cardIds).toEqual(["wrong", "new", "weak", "strong"]);
		});

		it("normalizes ranges and shuffles retry cards", () => {
			const cards = [
				makeCard("c1", State.New, new Date(), 0, "one", "back"),
				makeCard("c2", State.New, new Date(), 1, "two", "back"),
				makeCard("c3", State.New, new Date(), 2, "three", "back"),
			];
			expect(
				planRangeSpellingSession({
					deckId: "deck.md",
					cards,
					startIndex: 2,
					endIndex: 3,
					shuffle: (ids) => [...ids].reverse(),
				}).cardIds,
			).toEqual(["c3", "c2"]);

			expect(
				planIncorrectSpellingSession({
					deckId: "deck.md",
					cardIds: ["c1", "c1", "c2"],
					shuffle: (ids) => ids,
				}).cardIds,
			).toEqual(["c1", "c2"]);
		});
	});

	describe("planSessionQueue (Unified Seam)", () => {
		it("plans study queue selecting new cards first then due reviews", () => {
			const now = new Date("2026-08-02T12:00:00.000Z");
			const overdue = new Date("2026-08-01T12:00:00.000Z");
			const future = new Date("2026-08-05T12:00:00.000Z");

			const deck = makeDeck([
				makeCard("n1", State.New, overdue, 0),
				makeCard("n2", State.New, overdue, 1),
				makeCard("r1", State.Review, overdue, 2),
				makeCard("r2", State.Review, future, 3),
			]);

			const result = planSessionQueue(
				{ mode: "study", deckId: deck.id, direction: "reversed", studyOrder: "sequential" },
				deck,
				{
					settings: { dailyNewCards: 2, dailyReviewCards: 1, studyOrder: "sequential" },
					now,
				},
			);

			expect(result).toEqual({
				kind: "success",
				cardIds: ["n1", "n2", "r1"],
				direction: "reversed",
			});
		});

		it("returns no-eligible-cards when study queue is empty", () => {
			const now = new Date("2026-08-02T12:00:00.000Z");
			const future = new Date("2026-08-05T12:00:00.000Z");

			const deck = makeDeck([makeCard("r1", State.Review, future, 0)]);

			const result = planSessionQueue(
				{
					mode: "study",
					deckId: deck.id,
					direction: "normal",
					studyOrder: "sequential",
				},
				deck,
				{
					settings: { dailyNewCards: 2, dailyReviewCards: 2, studyOrder: "sequential" },
					now,
				},
			);

			expect(result).toEqual({
				kind: "rejected",
				reason: "no-eligible-cards",
			});
		});

		it("plans practice queue with random selection", () => {
			const deck = makeDeck([
				makeCard("c1", State.New, new Date(), 0),
				makeCard("c2", State.New, new Date(), 1),
			]);

			const result = planSessionQueue(
				{
					mode: "practice",
					deckId: deck.id,
					direction: "normal",
					selection: { kind: "random", questionCount: 1 },
				},
				deck,
				{
					settings: defaultSettings,
					shuffle: (ids) => ids,
				},
			);

			expect(result).toEqual({
				kind: "success",
				cardIds: ["c1"],
				direction: "normal",
			});
		});

		it("returns spelling-not-enabled when spelling is disabled for deck", () => {
			const deck = makeDeck([
				makeCard(
					"550e8400-e29b-41d4-a716-446655440000",
					State.New,
					new Date(),
					0,
					"apple",
					"苹果",
				),
			]);

			const result = planSessionQueue(
				{
					mode: "spelling",
					deckId: deck.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				deck,
				{
					settings: defaultSettings,
					isSpellingEnabled: false,
				},
			);

			expect(result).toEqual({
				kind: "rejected",
				reason: "spelling-not-enabled",
			});
		});

		it("returns stable-card-identity-required when spelling deck has legacy unstable identities", () => {
			const deck = makeDeck([
				makeCard("notes/deck.md::0", State.New, new Date(), 0, "apple", "苹果"),
			]);

			const result = planSessionQueue(
				{
					mode: "spelling",
					deckId: deck.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				deck,
				{
					settings: defaultSettings,
					isSpellingEnabled: true,
				},
			);

			expect(result).toEqual({
				kind: "rejected",
				reason: "stable-card-identity-required",
			});
		});

		it("plans spelling queue filtering out non-spelling cards", () => {
			const STABLE_ONE = "550e8400-e29b-41d4-a716-446655440000";
			const STABLE_TWO = "7d444840-9dc0-11d1-b245-5ffdce74fad2";
			const deck = makeDeck([
				makeCard(STABLE_ONE, State.New, new Date(), 0, "apple", "苹果"),
				makeCard(STABLE_TWO, State.New, new Date(), 1, "science / fair", "科学展"),
			]);

			const result = planSessionQueue(
				{
					mode: "spelling",
					deckId: deck.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				deck,
				{
					settings: defaultSettings,
					isSpellingEnabled: true,
				},
			);

			expect(result).toEqual({
				kind: "success",
				cardIds: [STABLE_ONE],
				direction: "normal",
			});
		});
	});

	describe("planRetryIncorrectSession", () => {
		const card1 = makeCard("c1", State.Review, new Date(), 0, "apple", "苹果");
		const card2 = makeCard(
			"c2",
			State.Review,
			new Date(),
			1,
			"invalid spelling 123",
			"无效拼写",
		);
		const cardMap = new Map<string, FlashCard>([
			["c1", card1],
			["c2", card2],
		]);
		const getCard = (id: string) => cardMap.get(id) ?? null;

		it("plans practice retry including all existing cards and preserves direction", () => {
			const result = planRetryIncorrectSession({
				mode: "practice",
				direction: "reversed",
				incorrectCardIdentities: ["c1", "c2", "missing"],
				getCard,
				shuffle: (ids) => ids,
			});

			expect(result).toEqual({
				kind: "success",
				cardIds: ["c1", "c2"],
				direction: "reversed",
				omittedCardCount: 1,
			});
		});

		it("plans spelling retry filtering out invalid spellable fronts", () => {
			const result = planRetryIncorrectSession({
				mode: "spelling",
				direction: "normal",
				incorrectCardIdentities: ["c1", "c2"],
				getCard,
				shuffle: (ids) => ids,
			});

			expect(result).toEqual({
				kind: "success",
				cardIds: ["c1"],
				direction: "normal",
				omittedCardCount: 1,
			});
		});

		it("rejects when no cards are retryable", () => {
			const result = planRetryIncorrectSession({
				mode: "spelling",
				direction: "normal",
				incorrectCardIdentities: ["c2", "missing"],
				getCard,
			});

			expect(result).toEqual({
				kind: "rejected",
				reason: "no-retryable-cards",
			});
		});
	});
});
