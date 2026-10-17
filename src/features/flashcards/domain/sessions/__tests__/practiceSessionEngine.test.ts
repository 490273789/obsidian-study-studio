import { describe, expect, it } from "vite-plus/test";
import {
	answerPracticeCard,
	createPracticeSession,
	previousPracticeCard,
} from "../practiceSessionEngine";
import type { PracticeSession } from "../../../../../core/shared/types";

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
