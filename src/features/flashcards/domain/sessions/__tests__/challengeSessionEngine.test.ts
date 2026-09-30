import { describe, expect, it } from "vitest";
import {
	answerChallengeQuestion,
	continueChallengeAfterError,
	createChallengeProgress,
	prepareChallengeLevel,
	type ChallengeProgress,
	type ChallengeSession,
} from "../challengeSessionEngine";

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		Object.values(value).forEach(deepFreeze);
		Object.freeze(value);
	}
	return value;
}

function fixture(count = 2, startTime = 0) {
	const cards = Array.from({ length: count }, (_, index) => ({
		identity: `card-${index + 1}`,
		originDeckId: "source-deck",
	}));
	const progress = createChallengeProgress({
		mode: "spelling",
		cards,
		now: startTime,
		roundId: "challenge-round",
		shuffle: (identities) => [...identities],
	});
	if (!progress) throw new Error("Expected challenge progress");
	const prepared = prepareChallengeLevel({
		progress,
		eligibleIdentities: new Set(cards.map((card) => card.identity)),
		startTime,
	});
	if (!prepared.session) throw new Error("Expected challenge session");
	return { progress: prepared.progress, session: prepared.session };
}

function answer(
	state: { progress: ChallengeProgress; session: ChallengeSession },
	correct: boolean,
	now: number,
	feedback: { submittedInput?: string; expectedAnswer?: string } = {},
) {
	const before = structuredClone(state);
	deepFreeze(state);
	const update = answerChallengeQuestion({ ...state, correct, now, ...feedback });
	expect(state).toEqual(before);
	return update;
}

describe("answerChallengeQuestion", () => {
	it("returns feedback and a partial activity without completing progress on a wrong answer", () => {
		const state = fixture();
		const update = answer(state, false, 600, {
			submittedInput: "aple",
			expectedAnswer: "apple",
		});

		expect(update.type).toBe("continue");
		expect(update.session.feedback).toEqual({
			correct: false,
			submittedInput: "aple",
			expectedAnswer: "apple",
		});
		expect(update.session.queue).toEqual(state.session.queue);
		expect(update.session.completedIdentities).toEqual([]);
		expect(update.session.firstAttempts).toEqual({ "card-1": false });
		expect(update.session.attempts).toEqual([
			{ identity: "card-1", correct: false, answeredAt: 600 },
		]);
		expect(update.progress).toEqual(state.progress);
		expect(update.learningActivity).toEqual({
			kind: "session",
			mode: "challenge",
			completion: "partial",
			answerCount: 1,
			completedAnswerCount: undefined,
			durationSeconds: 0,
			occurredAt: 600,
		});
		expect(update.historyEntries).toEqual([]);
		expect(update).not.toHaveProperty("result");
	});

	it("requires continuing feedback, then requeues the wrong question without another answer event", () => {
		const wrong = answer(fixture(), false, 600);
		const before = structuredClone(wrong);
		deepFreeze(wrong);
		expect(() =>
			answerChallengeQuestion({
				progress: wrong.progress,
				session: wrong.session,
				correct: true,
				now: 1200,
			}),
		).toThrow("Challenge feedback must be continued first");
		const continued = continueChallengeAfterError(wrong.session);
		expect(wrong).toEqual(before);
		expect(continued.feedback).toBeNull();
		expect(continued.queue.map((question) => question.identity)).toEqual(["card-2", "card-1"]);
		expect(continued.attempts).toEqual(wrong.session.attempts);
		expect(continued.firstAttempts).toEqual({ "card-1": false });
	});

	it("counts each submission once, preserves first attempts through retries, and completes all records together", () => {
		const initial = fixture();
		const wrong = answer(initial, false, 600);
		const second = answer(
			{ progress: wrong.progress, session: continueChallengeAfterError(wrong.session) },
			true,
			1200,
		);
		const retry = answer(second, false, 1800);
		const completed = answer(
			{ progress: retry.progress, session: continueChallengeAfterError(retry.session) },
			true,
			2400,
		);

		const updates = [wrong, second, retry, completed];
		expect(updates.map((update) => update.learningActivity.answerCount)).toEqual([1, 1, 1, 1]);
		expect(updates.map((update) => update.learningActivity.completedAnswerCount)).toEqual([
			undefined,
			undefined,
			undefined,
			4,
		]);
		expect(updates.map((update) => update.learningActivity.durationSeconds)).toEqual([
			0, 1, 0, 1,
		]);
		for (const update of updates.slice(0, -1)) {
			expect(update.progress).toEqual(initial.progress);
			expect(update.historyEntries).toEqual([]);
			expect(update.learningActivity.completion).toBe("partial");
		}
		if (completed.type !== "complete") throw new Error("Expected completed challenge");
		expect(completed.session.queue).toEqual([]);
		expect(completed.session.firstAttempts).toEqual({ "card-1": false, "card-2": true });
		expect(completed.result).toEqual({
			levelIndex: 0,
			totalQuestions: 2,
			firstTryCorrectCount: 1,
			firstTryAccuracy: 50,
			retryCount: 2,
			durationSeconds: 2,
			timeSpent: 2,
			completedAt: 2400,
			incorrectIdentities: ["card-1"],
			removedCardCount: 0,
		});
		expect(completed.progress.round?.completedLevelCount).toBe(1);
		expect(completed.progress.round?.completedLevels).toEqual([completed.result]);
		expect(completed.progress.round?.levels).toEqual(initial.progress.round?.levels);
		expect(completed.learningActivity).toEqual({
			kind: "session",
			mode: "challenge",
			completion: "completed",
			answerCount: 1,
			completedAnswerCount: 4,
			durationSeconds: 1,
			occurredAt: 2400,
		});
		expect(completed.historyEntries).toEqual([
			{
				mode: "challenge",
				deckId: "challenge-round",
				deckName: "",
				cardCount: 2,
				duration: 2,
				occurredAt: 2400,
			},
		]);
	});

	it("completes a first-try level with perfect accuracy and no retries", () => {
		const first = answer(fixture(), true, 600);
		const completed = answer(first, true, 1200);
		if (completed.type !== "complete") throw new Error("Expected completed challenge");
		expect(completed.result).toMatchObject({
			firstTryCorrectCount: 2,
			firstTryAccuracy: 100,
			retryCount: 0,
			incorrectIdentities: [],
			durationSeconds: 1,
		});
		expect(completed.learningActivity.completedAnswerCount).toBe(2);
		expect(
			first.learningActivity.durationSeconds + completed.learningActivity.durationSeconds,
		).toBe(1);
	});

	it("clamps activity and completion duration to zero when the clock moves backward", () => {
		const first = answer(fixture(3, 1000), true, 2200);
		const second = answer(first, true, 1600);
		const completed = answer(second, true, 900);
		expect(
			[first, second, completed].map((update) => update.learningActivity.durationSeconds),
		).toEqual([1, 0, 0]);
		if (completed.type !== "complete") throw new Error("Expected completed challenge");
		expect(completed.result.durationSeconds).toBe(0);
		expect(completed.result.timeSpent).toBe(0);
		expect(completed.historyEntries[0]?.duration).toBe(0);
		expect(completed.learningActivity.occurredAt).toBe(900);
	});

	it("advances only the completed level and retains earlier results when the next level completes", () => {
		let state = fixture(16);
		for (let index = 0; index < 14; index++) {
			const update = answer(state, true, (index + 1) * 100);
			expect(update.type).toBe("continue");
			state = { progress: update.progress, session: update.session };
		}
		const firstLevel = answer(state, true, 1500);
		if (firstLevel.type !== "complete") throw new Error("Expected completed first level");
		expect(firstLevel.progress.round?.completedLevelCount).toBe(1);
		expect(firstLevel.progress.round?.levels.map((level) => level.length)).toEqual([15, 1]);
		const next = prepareChallengeLevel({
			progress: deepFreeze(firstLevel.progress),
			eligibleIdentities: new Set(
				firstLevel.progress.round!.levels.flat().map((question) => question.identity),
			),
			startTime: 5000,
		});
		if (!next.session) throw new Error("Expected second level");
		expect(next.session.levelIndex).toBe(1);
		const secondLevel = answer({ progress: next.progress, session: next.session }, true, 5600);
		if (secondLevel.type !== "complete") throw new Error("Expected completed second level");
		expect(secondLevel.progress.round?.completedLevelCount).toBe(2);
		expect(secondLevel.progress.round?.completedLevels).toEqual([
			firstLevel.result,
			secondLevel.result,
		]);
		expect(secondLevel.learningActivity.completedAnswerCount).toBe(1);
		expect(secondLevel.historyEntries).toHaveLength(1);
		expect(secondLevel.historyEntries[0]).toMatchObject({
			cardCount: 1,
			duration: 0,
			occurredAt: 5600,
		});
	});
});
