import { describe, expect, it } from "vitest";
import {
	answerPracticeCard,
	createDayPracticeSession,
	createIncorrectPracticeSession,
	createPracticeSession,
	createPracticeSessionFromPlan,
	createRangePracticeSession,
	createRandomPracticeSession,
	previousPracticeCard,
} from "../sessionEngine";
import type { FlashCard, PracticeSession } from "../../../../../core/shared/types";

function makeCard(id: string, indexInFile: number): FlashCard {
	return {
		id,
		front: `front ${indexInFile}`,
		back: `back ${indexInFile}`,
		fsrsCard: {
			due: new Date("2026-07-03T00:00:00.000Z"),
			stability: 0,
			difficulty: 0,
			elapsed_days: 0,
			scheduled_days: 0,
			reps: 0,
			lapses: 0,
			state: 0,
			last_review: undefined,
			learning_steps: 0,
		},
		sourceFile: "notes/deck.md",
		indexInFile,
	};
}

function makePracticeSession(overrides: Partial<PracticeSession> = {}): PracticeSession {
	return {
		deckId: "notes/deck.md",
		direction: "normal",
		cardQueue: ["card-1", "card-2", "card-3"],
		currentIndex: 0,
		startTime: 1000,
		totalQuestions: 3,
		answers: {},
		history: [],
		attemptCount: overrides.attemptCount ?? overrides.history?.length ?? 0,
		unavailableCardIds: [],
		...overrides,
	};
}

describe("practice session engine", () => {
	it("creates practice sessions from card ids", () => {
		expect(
			createPracticeSession({
				deckId: "notes/deck.md",
				direction: "reversed",
				cardIds: ["card-2", "card-1"],
				startTime: 2000,
			}),
		).toEqual({
			deckId: "notes/deck.md",
			direction: "reversed",
			cardQueue: ["card-2", "card-1"],
			currentIndex: 0,
			startTime: 2000,
			totalQuestions: 2,
			answers: {},
			history: [],
			attemptCount: 0,
			unavailableCardIds: [],
		});
	});

	it("creates practice sessions from plans", () => {
		expect(
			createPracticeSessionFromPlan({
				plan: {
					source: "random",
					deckId: "notes/deck.md",
					direction: "reversed",
					cardIds: ["card-3", "card-1"],
					requestedQuestionCount: 10,
				},
				startTime: 2500,
			}),
		).toEqual(
			makePracticeSession({
				direction: "reversed",
				cardQueue: ["card-3", "card-1"],
				startTime: 2500,
				totalQuestions: 2,
			}),
		);
	});

	it("creates day practice sessions from supplied cards and optional random order", () => {
		const session = createDayPracticeSession({
			deckId: "notes/deck.md",
			direction: "reversed",
			cards: [makeCard("card-1", 0), makeCard("card-2", 1), makeCard("card-3", 2)],
			studyOrder: "random",
			startTime: 2000,
			shuffle: (ids) => [...ids].reverse(),
		});

		expect(session).toEqual(
			makePracticeSession({
				direction: "reversed",
				cardQueue: ["card-3", "card-2", "card-1"],
				startTime: 2000,
			}),
		);
	});

	it("creates random practice sessions by shuffling and limiting supplied cards", () => {
		const session = createRandomPracticeSession({
			deckId: "notes/deck.md",
			direction: "normal",
			cards: [
				makeCard("card-1", 0),
				makeCard("card-2", 1),
				makeCard("card-3", 2),
				makeCard("card-4", 3),
			],
			questionCount: 2,
			startTime: 3000,
			shuffle: (ids) => [...ids].reverse(),
		});

		expect(session).toEqual(
			makePracticeSession({
				cardQueue: ["card-4", "card-3"],
				startTime: 3000,
				totalQuestions: 2,
			}),
		);
	});

	it("creates range practice sessions from a 1-based inclusive card range", () => {
		const session = createRangePracticeSession({
			deckId: "notes/deck.md",
			direction: "normal",
			cards: [
				makeCard("card-1", 0),
				makeCard("card-2", 1),
				makeCard("card-3", 2),
				makeCard("card-4", 3),
			],
			startIndex: 2,
			endIndex: 4,
			startTime: 3500,
			shuffle: (ids) => [...ids].reverse(),
		});

		expect(session).toEqual(
			makePracticeSession({
				cardQueue: ["card-4", "card-3", "card-2"],
				startTime: 3500,
				totalQuestions: 3,
			}),
		);
	});

	it("creates incorrect-card practice sessions from supplied card identities", () => {
		const session = createIncorrectPracticeSession({
			deckId: "notes/deck.md",
			direction: "reversed",
			cardIds: ["card-1", "card-3"],
			startTime: 4000,
			shuffle: (ids) => [...ids].reverse(),
		});

		expect(session).toEqual(
			makePracticeSession({
				direction: "reversed",
				cardQueue: ["card-3", "card-1"],
				startTime: 4000,
				totalQuestions: 2,
			}),
		);
	});

	it("advances practice sessions and records answers", () => {
		const result = answerPracticeCard({
			session: makePracticeSession(),
			cardId: "card-1",
			isCorrect: true,
			now: 3000,
		});

		expect(result).toEqual({
			type: "continue",
			session: makePracticeSession({
				currentIndex: 1,
				answers: { "card-1": true },
				history: ["card-1"],
			}),
		});
	});

	it("returns a practice result on the final answer", () => {
		const result = answerPracticeCard({
			session: makePracticeSession({
				currentIndex: 2,
				answers: {
					"card-1": true,
					"card-2": false,
				},
				history: ["card-1", "card-2"],
			}),
			cardId: "card-3",
			isCorrect: true,
			now: 91000,
		});

		expect(result).toEqual({
			type: "complete",
			result: {
				direction: "normal",
				totalQuestions: 3,
				correctCount: 2,
				incorrectCount: 1,
				accuracy: 66.66666666666666,
				incorrectCardIds: ["card-2"],
				timeSpent: 90,
			},
		});
	});

	it("retains deleted-card answers in history but excludes them from the result", () => {
		const result = answerPracticeCard({
			session: makePracticeSession({
				cardQueue: ["card-3"],
				currentIndex: 0,
				totalQuestions: 3,
				answers: {
					"card-1": true,
					"card-2": false,
				},
				history: ["card-1", "card-2"],
				unavailableCardIds: ["card-2"],
			}),
			cardId: "card-3",
			isCorrect: true,
			now: 91000,
		});

		expect(result).toEqual({
			type: "complete",
			result: {
				direction: "normal",
				totalQuestions: 3,
				correctCount: 2,
				incorrectCount: 1,
				accuracy: 66.66666666666666,
				incorrectCardIds: [],
				timeSpent: 90,
			},
		});
	});

	it("returns to the previous practice card and removes its answer", () => {
		const result = previousPracticeCard(
			makePracticeSession({
				currentIndex: 1,
				answers: {
					"card-1": true,
				},
				history: ["card-1"],
			}),
		);

		expect(result).toEqual(
			makePracticeSession({
				currentIndex: 0,
				answers: {},
				history: [],
				attemptCount: 1,
			}),
		);
	});

	it("keeps deleted answer events while returning to the latest available card", () => {
		const result = previousPracticeCard(
			makePracticeSession({
				cardQueue: ["card-1", "card-3"],
				currentIndex: 1,
				answers: {
					"card-1": true,
					"card-2": false,
				},
				history: ["card-1", "card-2"],
				unavailableCardIds: ["card-2"],
			}),
		);

		expect(result).toEqual(
			makePracticeSession({
				cardQueue: ["card-1", "card-3"],
				currentIndex: 0,
				answers: { "card-2": false },
				history: ["card-2"],
				attemptCount: 2,
				unavailableCardIds: ["card-2"],
			}),
		);
	});
});
