import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import type {
	Deck,
	FlashCard,
	SpellingCardProgress,
	StudySettings,
} from "../../../../../core/shared/types";
import {
	evaluateSpellingDeckEligibility,
	getPracticeSetupPlan,
	getSpellingSetupPlan,
	getStudySetupPlan,
	planRetryIncorrectSession,
	planSessionQueue,
} from "../sessionPlanner";

function makeCard(
	id: string,
	state: State = State.New,
	due: Date = new Date("2026-08-01T00:00:00.000Z"),
	indexInFile = 0,
	front = "Front",
	back = "Back",
): FlashCard {
	return {
		id,
		front,
		back,
		fsrsCard: {
			...createEmptyCard(),
			due,
			state,
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

const STABLE_ONE = "550e8400-e29b-41d4-a716-446655440000";
const STABLE_TWO = "7d444840-9dc0-11d1-b245-5ffdce74fad2";

describe("study setup plan", () => {
	it("derives the day list, counts and completed state from the deck", () => {
		const now = new Date("2026-08-02T12:00:00.000Z");
		const overdue = new Date("2026-08-01T12:00:00.000Z");
		const deck = makeDeck([
			makeCard("c0", State.Review, overdue, 0),
			makeCard("c1", State.Review, overdue, 1),
			makeCard("c2", State.New, overdue, 2),
			makeCard("c3", State.Review, overdue, 3),
			makeCard("c4", State.New, overdue, 4),
		]);

		const plan = getStudySetupPlan(deck, defaultSettings, now, "random");

		expect(plan.dayList).toHaveLength(3);
		expect(plan.dayList[0]).toMatchObject({
			dayIndex: 0,
			startCardIndex: 0,
			endCardIndex: 2,
			studiedCards: 2,
			isCompleted: true,
			isCurrent: false,
		});
		expect(plan.dayList[1]).toMatchObject({
			dayIndex: 1,
			studiedCards: 1,
			isCompleted: false,
			isCurrent: true,
		});
		expect(plan.dayList[2]).toMatchObject({ isCompleted: false, isCurrent: false });
		expect(plan.todayNewCount).toBe(2);
		expect(plan.todayReviewCount).toBe(3);
		expect(plan.todayTotal).toBe(5);
		expect(plan.completedDays).toBe(1);
		expect(plan.allCompleted).toBe(false);
		expect(plan.hasAnythingToStudy).toBe(true);
		expect(plan.defaultStudyOrder).toBe("random");
	});

	it("sorts cards by file index before slicing days", () => {
		const deck = makeDeck([
			makeCard("c3", State.New, undefined, 3),
			makeCard("c1", State.New, undefined, 1),
			makeCard("c2", State.New, undefined, 2),
		]);

		const plan = getStudySetupPlan(deck, defaultSettings);

		expect(plan.dayList[0]?.totalCards).toBe(2);
		expect(plan.dayList[1]?.totalCards).toBe(1);
	});

	it("handles empty decks and zero or negative daily limits safely", () => {
		const empty = getStudySetupPlan(makeDeck([]), defaultSettings);
		expect(empty.dayList).toEqual([]);
		expect(empty.hasAnythingToStudy).toBe(false);
		expect(empty.allCompleted).toBe(false);

		const limited = getStudySetupPlan(makeDeck([makeCard("c0")]), {
			...defaultSettings,
			dailyNewCards: -3,
		});
		expect(limited.todayNewCount).toBe(0);
	});
});

describe("setup plan selection", () => {
	it("normalizes practice initial selections", () => {
		const deck = makeDeck([
			makeCard("c0", State.New, undefined, 0),
			makeCard("c1", State.New, undefined, 1),
			makeCard("c2", State.New, undefined, 2),
		]);

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

	it("derives spelling stats and clamps the range from spelling progress", () => {
		const deck = makeDeck([
			makeCard("c0", State.New, undefined, 0, "apple", "苹果"),
			makeCard("c1", State.New, undefined, 1, "banana", "香蕉"),
		]);
		const progress = {
			c0: { attempts: 1, correctAttempts: 1, correctStreak: 1, lastAttemptAt: 1000 },
		};

		const plan = getSpellingSetupPlan(deck, progress);
		expect(plan.stats).toEqual({ total: 2, unpracticed: 1 });
		expect(plan.maxQuestions).toBe(2);
		expect(plan.initialSelectionMode).toBe("smart");

		const range = getSpellingSetupPlan(deck, progress, {
			kind: "range",
			startIndex: 2,
			endIndex: 9,
		});
		expect(range.initialRangeStart).toBe(2);
		expect(range.initialRangeEnd).toBe(2);
		expect(range.initialSelectionMode).toBe("range");
	});

	it("derives complete spelling eligibility from enablement, identity and content", () => {
		const eligible = makeCard(STABLE_ONE, State.New, undefined, 0, "hello world", "back");
		const invalid = makeCard(STABLE_TWO, State.New, undefined, 1, "science / fair", "back");

		expect(evaluateSpellingDeckEligibility({ cards: [eligible, invalid] }, true)).toEqual({
			enabled: true,
			hasStableIdentities: true,
			canStart: true,
			valid: false,
			ready: true,
			issueCount: 1,
			eligibleCardIds: [STABLE_ONE],
			invalidCards: [{ cardId: STABLE_TWO, indexInFile: 1, front: "science / fair" }],
		});
	});
});

describe("session queue planning", () => {
	it("selects new cards first, then due reviews, honoring daily limits", () => {
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
			{ settings: { ...defaultSettings, dailyNewCards: 2, dailyReviewCards: 1 }, now },
		);

		expect(result).toEqual({
			kind: "success",
			cardIds: ["n1", "n2", "r1"],
			direction: "reversed",
		});
	});

	it("rejects an empty study queue", () => {
		const now = new Date("2026-08-02T12:00:00.000Z");
		const deck = makeDeck([
			makeCard("r1", State.Review, new Date("2026-08-05T12:00:00.000Z"), 0),
		]);

		expect(
			planSessionQueue(
				{ mode: "study", deckId: deck.id, direction: "normal", studyOrder: "sequential" },
				deck,
				{ settings: defaultSettings, now },
			),
		).toEqual({ kind: "rejected", reason: "no-eligible-cards" });
	});

	it("plans random practice with an injected shuffle and question limit", () => {
		const deck = makeDeck([
			makeCard("c1", State.New, undefined, 0),
			makeCard("c2", State.New, undefined, 1),
			makeCard("c3", State.New, undefined, 2),
		]);

		expect(
			planSessionQueue(
				{
					mode: "practice",
					deckId: deck.id,
					direction: "normal",
					selection: { kind: "random", questionCount: 2 },
				},
				deck,
				{
					settings: defaultSettings,
					shuffle: (ids) => [...ids].reverse(),
				},
			),
		).toEqual({ kind: "success", cardIds: ["c3", "c2"], direction: "normal" });
	});

	it("plans range practice and clamps the selection to the deck", () => {
		const deck = makeDeck([
			makeCard("c1", State.New, undefined, 0),
			makeCard("c2", State.New, undefined, 1),
			makeCard("c3", State.New, undefined, 2),
		]);

		expect(
			planSessionQueue(
				{
					mode: "practice",
					deckId: deck.id,
					direction: "reversed",
					selection: { kind: "range", startIndex: 2, endIndex: 9 },
				},
				deck,
				{ settings: defaultSettings, shuffle: (ids) => ids },
			),
		).toEqual({
			kind: "success",
			cardIds: ["c2", "c3"],
			direction: "reversed",
		});
	});

	it("plans study-day practice in card order or shuffled order", () => {
		const deck = makeDeck([
			makeCard("c1", State.New, undefined, 0),
			makeCard("c2", State.New, undefined, 1),
			makeCard("c3", State.New, undefined, 2),
		]);
		const request = {
			mode: "practice" as const,
			deckId: deck.id,
			direction: "normal" as const,
			selection: {
				kind: "study-day" as const,
				dayIndex: 0,
				studyOrder: "sequential" as const,
			},
		};

		expect(
			planSessionQueue(request, deck, {
				settings: defaultSettings,
				shuffle: (ids) => [...ids].reverse(),
			}),
		).toEqual({ kind: "success", cardIds: ["c1", "c2"], direction: "normal" });

		expect(
			planSessionQueue(
				{
					...request,
					selection: { ...request.selection, studyOrder: "random" },
				},
				deck,
				{ settings: defaultSettings, shuffle: (ids) => [...ids].reverse() },
			),
		).toEqual({ kind: "success", cardIds: ["c2", "c1"], direction: "normal" });
	});

	it("rejects spelling queues for disabled and unstable decks", () => {
		const stable = makeDeck([makeCard(STABLE_ONE, State.New, undefined, 0, "apple", "苹果")]);
		const legacy = makeDeck([
			makeCard("notes/deck.md::0", State.New, undefined, 0, "apple", "苹果"),
		]);

		expect(
			planSessionQueue(
				{
					mode: "spelling",
					deckId: stable.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				stable,
				{ settings: defaultSettings, isSpellingEnabled: false },
			),
		).toEqual({ kind: "rejected", reason: "spelling-not-enabled" });

		expect(
			planSessionQueue(
				{
					mode: "spelling",
					deckId: legacy.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				legacy,
				{ settings: defaultSettings, isSpellingEnabled: true },
			),
		).toEqual({ kind: "rejected", reason: "stable-card-identity-required" });
	});

	it("prioritizes last-wrong, unseen, then weaker spellable cards", () => {
		const wrong = "11111111-1111-4111-8111-111111111111";
		const unseen = "22222222-2222-4222-8222-222222222222";
		const weak = "33333333-3333-4333-8333-333333333333";
		const strong = "44444444-4444-4444-8444-444444444444";
		const deck = makeDeck([
			makeCard(wrong, State.New, undefined, 0, "apple", "back"),
			makeCard(unseen, State.New, undefined, 1, "banana", "back"),
			makeCard(weak, State.New, undefined, 2, "cherry", "back"),
			makeCard(strong, State.New, undefined, 3, "date", "back"),
			makeCard(STABLE_ONE, State.New, undefined, 4, "science / fair", "back"),
		]);
		const progress: Record<string, SpellingCardProgress> = {
			[wrong]: {
				attempts: 2,
				correctAttempts: 1,
				correctStreak: 0,
				lastAttemptAt: 40,
				lastIncorrectAt: 40,
			},
			[weak]: { attempts: 4, correctAttempts: 2, correctStreak: 1, lastAttemptAt: 20 },
			[strong]: { attempts: 4, correctAttempts: 4, correctStreak: 3, lastAttemptAt: 10 },
		};

		expect(
			planSessionQueue(
				{
					mode: "spelling",
					deckId: deck.id,
					selection: { kind: "smart", questionCount: 10 },
				},
				deck,
				{ settings: defaultSettings, isSpellingEnabled: true, spellingProgress: progress },
			),
		).toEqual({
			kind: "success",
			cardIds: [wrong, unseen, weak, strong],
			direction: "normal",
		});
	});

	it("plans a shuffled spelling range from eligible cards", () => {
		const deck = makeDeck([
			makeCard(STABLE_ONE, State.New, undefined, 0, "one", "back"),
			makeCard(STABLE_TWO, State.New, undefined, 1, "two", "back"),
			makeCard(
				"33333333-3333-4333-8333-333333333333",
				State.New,
				undefined,
				2,
				"three",
				"back",
			),
		]);

		expect(
			planSessionQueue(
				{
					mode: "spelling",
					deckId: deck.id,
					selection: { kind: "range", startIndex: 2, endIndex: 3 },
				},
				deck,
				{
					settings: defaultSettings,
					isSpellingEnabled: true,
					shuffle: (ids) => [...ids].reverse(),
				},
			),
		).toEqual({
			kind: "success",
			cardIds: ["33333333-3333-4333-8333-333333333333", STABLE_TWO],
			direction: "normal",
		});
	});
});

describe("incorrect retry planning", () => {
	const card1 = makeCard("c1", State.Review, undefined, 0, "apple", "苹果");
	const card2 = makeCard("c2", State.Review, undefined, 1, "invalid spelling 123", "无效拼写");
	const cardMap = new Map<string, FlashCard>([
		["c1", card1],
		["c2", card2],
	]);

	it("keeps existing practice cards and preserves direction", () => {
		expect(
			planRetryIncorrectSession({
				mode: "practice",
				direction: "reversed",
				incorrectCardIdentities: ["c1", "c2", "missing"],
				getCard: (id) => cardMap.get(id) ?? null,
				shuffle: (ids) => ids,
			}),
		).toEqual({
			kind: "success",
			cardIds: ["c1", "c2"],
			direction: "reversed",
			omittedCardCount: 1,
		});
	});

	it("filters spelling retries to spellable fronts", () => {
		expect(
			planRetryIncorrectSession({
				mode: "spelling",
				direction: "normal",
				incorrectCardIdentities: ["c1", "c2"],
				getCard: (id) => cardMap.get(id) ?? null,
				shuffle: (ids) => ids,
			}),
		).toEqual({
			kind: "success",
			cardIds: ["c1"],
			direction: "normal",
			omittedCardCount: 1,
		});
	});

	it("rejects when nothing is retryable", () => {
		expect(
			planRetryIncorrectSession({
				mode: "spelling",
				direction: "normal",
				incorrectCardIdentities: ["c2", "missing"],
				getCard: (id) => cardMap.get(id) ?? null,
			}),
		).toEqual({ kind: "rejected", reason: "no-retryable-cards" });
	});
});
