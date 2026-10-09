import { describe, expect, it } from "vite-plus/test";
import { answerSpellingCard, createSpellingSession } from "../spellingSessionEngine";

describe("spelling session engine", () => {
	it("requires correction and requeues a missed word without inflating first-try accuracy", () => {
		const initial = createSpellingSession({
			deckId: "deck.md",
			cardIds: ["science", "apple"],
			startTime: 1000,
		});
		const wrong = answerSpellingCard({
			session: initial,
			cardId: "science",
			input: "sciense",
			isCorrect: false,
			now: 2000,
		});
		expect(wrong).toMatchObject({
			type: "continue",
			feedback: "retrieval-incorrect",
			session: {
				phase: "correction",
				currentIndex: 0,
				cardQueue: ["science", "apple", "science"],
			},
		});
		if (wrong.type !== "continue") throw new Error("expected continuation");

		const corrected = answerSpellingCard({
			session: wrong.session,
			cardId: "science",
			input: "science",
			isCorrect: true,
			now: 3000,
		});
		expect(corrected).toMatchObject({
			type: "continue",
			feedback: "correction-correct",
			session: { phase: "retrieval", currentIndex: 1 },
		});
		if (corrected.type !== "continue") throw new Error("expected continuation");

		const apple = answerSpellingCard({
			session: corrected.session,
			cardId: "apple",
			input: "apple",
			isCorrect: true,
			now: 4000,
		});
		if (apple.type !== "continue") throw new Error("expected continuation");
		const retry = answerSpellingCard({
			session: apple.session,
			cardId: "science",
			input: "science",
			isCorrect: true,
			now: 5000,
		});

		expect(retry).toEqual({
			type: "complete",
			feedback: "retrieval-correct",
			result: {
				totalWords: 2,
				firstTryCorrectCount: 1,
				firstTryIncorrectCount: 1,
				firstTryAccuracy: 50,
				totalRetrievalAttempts: 3,
				incorrectCardIds: ["science"],
				firstInputs: { science: "sciense", apple: "apple" },
				timeSpent: 4,
			},
		});
	});

	it("keeps a failed correction in place and requeues every failed retrieval", () => {
		const initial = createSpellingSession({
			deckId: "deck.md",
			cardIds: ["science"],
			startTime: 0,
		});
		const wrong = answerSpellingCard({
			session: initial,
			cardId: "science",
			input: "",
			isCorrect: false,
			now: 1,
		});
		if (wrong.type !== "continue") throw new Error("expected continuation");
		const correctionWrong = answerSpellingCard({
			session: wrong.session,
			cardId: "science",
			input: "sci",
			isCorrect: false,
			now: 2,
		});

		expect(correctionWrong).toMatchObject({
			type: "continue",
			feedback: "correction-incorrect",
			session: {
				currentIndex: 0,
				phase: "correction",
				cardQueue: ["science", "science"],
			},
		});
	});
});
