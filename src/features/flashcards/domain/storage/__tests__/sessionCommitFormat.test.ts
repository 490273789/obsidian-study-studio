import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import { formatSessionCommit } from "../sessionCommitFormat";

describe("formatSessionCommit", () => {
	it("formats a completed study answer into history, activity and study count", () => {
		const fsrsCard = createEmptyCard();
		const commit = formatSessionCommit({
			cardSchedules: [{ deckId: "deck", cardId: "card", fsrsCard }],
			spellingAttempts: [{ cardId: "card", correct: true, attemptedAt: 1200 }],
			records: [
				{
					mode: "study",
					deckId: "deck",
					deckName: "Deck",
					occurredAt: 1200,
					activity: {
						completion: "completed",
						answerCount: 2,
						durationSeconds: 30,
					},
					history: { cardCount: 2, durationSeconds: 30 },
				},
			],
		});

		expect(commit.cardUpdates).toEqual([{ deckId: "deck", cardId: "card", fsrsCard }]);
		expect(commit.spellingAttempts).toEqual([
			{ cardId: "card", correct: true, attemptedAt: 1200 },
		]);
		expect(commit.incrementStudyCountFor).toEqual(["deck"]);
		expect(commit.historyEntries).toEqual([
			{
				deckId: "deck",
				deckName: "Deck",
				mode: "study",
				cardCount: 2,
				duration: 30,
				occurredAt: 1200,
			},
		]);
		expect(commit.learningActivity).toEqual({
			kind: "session",
			mode: "study",
			completion: "completed",
			answerCount: 2,
			durationSeconds: 30,
			occurredAt: 1200,
		});
		expect(commit).not.toHaveProperty("challengeProgress");
	});

	it("keeps partial exits and non-study completions out of the study count", () => {
		const partial = formatSessionCommit({
			records: [
				{
					mode: "practice",
					deckId: "deck",
					deckName: "Deck",
					occurredAt: 900,
					activity: {
						completion: "partial",
						answerCount: 1,
						durationSeconds: 10,
					},
					history: null,
				},
			],
		});
		const completed = formatSessionCommit({
			records: [
				{
					mode: "practice",
					deckId: "deck",
					deckName: "Deck",
					occurredAt: 900,
					activity: {
						completion: "completed",
						answerCount: 3,
						durationSeconds: 40,
					},
					history: { cardCount: 3, durationSeconds: 40 },
				},
			],
		});

		expect(partial.historyEntries).toEqual([]);
		expect(partial.incrementStudyCountFor).toEqual([]);
		expect(partial.learningActivity).toMatchObject({ completion: "partial", mode: "practice" });
		expect(completed.incrementStudyCountFor).toEqual([]);
		expect(completed.historyEntries).toHaveLength(1);
	});

	it("carries challenge progress and its expected revision through unchanged", () => {
		const progress = { version: 1 as const, lastMode: "random" as const, round: null };
		const expected = { version: 1 as const, lastMode: "reversed" as const, round: null };
		const commit = formatSessionCommit({
			challenge: { progress, expectedProgress: expected },
			records: [
				{
					mode: "challenge",
					deckId: "round",
					deckName: "",
					occurredAt: 500,
					activity: {
						completion: "completed",
						answerCount: 1,
						completedAnswerCount: 2,
						durationSeconds: 3,
					},
					history: { cardCount: 2, durationSeconds: 3 },
				},
			],
		});

		expect(commit.challengeProgress).toBe(progress);
		expect(commit.expectedChallengeProgress).toBe(expected);
		expect(commit.historyEntries[0]).toMatchObject({ mode: "challenge", cardCount: 2 });
		expect(commit.learningActivity).toMatchObject({
			mode: "challenge",
			completedAnswerCount: 2,
		});
	});
});
