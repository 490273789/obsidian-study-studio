import { describe, expect, it } from "vite-plus/test";
import {
	formatLearningRecords,
	formatWordListVisit,
	MIN_WORD_LIST_VISIT_DURATION_SECONDS,
} from "../learningRecords";

const studyActivity = {
	completion: "completed" as const,
	answerCount: 2,
	durationSeconds: 30,
};

describe("formatWordListVisit", () => {
	it("does not record visits shorter than the five-second floor", () => {
		expect(formatWordListVisit("deck", "Deck", 1_000, 5_000)).toBeNull();
	});

	it("records a visit as pending history plus word-list activity", () => {
		expect(formatWordListVisit("deck", "Deck", 1_000, 6_500)).toEqual({
			incrementStudyCountFor: [],
			historyEntries: [
				{
					deckId: "deck",
					deckName: "Deck",
					mode: "word-list",
					cardCount: 0,
					duration: MIN_WORD_LIST_VISIT_DURATION_SECONDS,
					occurredAt: 6_500,
				},
			],
			learningActivity: {
				kind: "word-list",
				durationSeconds: 5,
				occurredAt: 6_500,
			},
		});
	});
});

describe("formatLearningRecords", () => {
	it("returns empty records when there are no facts", () => {
		expect(formatLearningRecords([])).toEqual({
			incrementStudyCountFor: [],
			historyEntries: [],
		});
	});

	it("maps a completed study session to history, activity, and one study count", () => {
		const records = formatLearningRecords([
			{
				kind: "session",
				deckId: "deck",
				deckName: "Deck",
				mode: "study",
				occurredAt: 1_200,
				history: { cardCount: 2, durationSeconds: 30 },
				activity: studyActivity,
			},
		]);

		expect(records.incrementStudyCountFor).toEqual(["deck"]);
		expect(records.historyEntries).toEqual([
			{
				deckId: "deck",
				deckName: "Deck",
				mode: "study",
				cardCount: 2,
				duration: 30,
				occurredAt: 1_200,
			},
		]);
		expect(records.learningActivity).toEqual({
			kind: "session",
			mode: "study",
			completion: "completed",
			answerCount: 2,
			durationSeconds: 30,
			occurredAt: 1_200,
		});
	});

	it("keeps partial and non-study sessions out of the study count", () => {
		const partial = formatLearningRecords([
			{
				kind: "session",
				deckId: "deck",
				deckName: "Deck",
				mode: "practice",
				occurredAt: 900,
				history: null,
				activity: { completion: "partial", answerCount: 1, durationSeconds: 10 },
			},
		]);
		const completedPractice = formatLearningRecords([
			{
				kind: "session",
				deckId: "deck",
				deckName: "Deck",
				mode: "practice",
				occurredAt: 900,
				history: { cardCount: 3, durationSeconds: 40 },
				activity: { completion: "completed", answerCount: 3, durationSeconds: 40 },
			},
		]);

		expect(partial.historyEntries).toEqual([]);
		expect(partial.incrementStudyCountFor).toEqual([]);
		expect(partial.learningActivity).toMatchObject({ completion: "partial", mode: "practice" });
		expect(completedPractice.historyEntries).toHaveLength(1);
		expect(completedPractice.incrementStudyCountFor).toEqual([]);
	});

	it("carries completed answer counts and lets the last fact own the activity", () => {
		const records = formatLearningRecords([
			{
				kind: "session",
				deckId: "round",
				deckName: "",
				mode: "challenge",
				occurredAt: 500,
				history: { cardCount: 2, durationSeconds: 3 },
				activity: {
					completion: "completed",
					answerCount: 1,
					completedAnswerCount: 2,
					durationSeconds: 3,
				},
			},
			{
				kind: "word-list",
				deckId: "deck",
				deckName: "Deck",
				startTimeMs: 1_000,
				endTimeMs: 8_000,
			},
		]);

		expect(records.historyEntries).toHaveLength(2);
		expect(records.historyEntries[0]).toMatchObject({
			mode: "challenge",
			cardCount: 2,
			occurredAt: 500,
		});
		expect(records.historyEntries[1]).toMatchObject({
			mode: "word-list",
			duration: 7,
			occurredAt: 8_000,
		});
		expect(records.learningActivity).toEqual({
			kind: "word-list",
			durationSeconds: 7,
			occurredAt: 8_000,
		});
	});
});
