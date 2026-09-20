import { describe, expect, it } from "vitest";
import {
	restoreDailyLearningActivity,
	type DailyLearningActivityDay,
} from "../dailyLearningActivity";

function activity(
	date: string,
	options: {
		study?: number;
		practice?: number;
		spelling?: number;
		seconds?: number;
		wordListSeconds?: number;
		completedStudy?: number;
		completedPractice?: number;
		completedSpelling?: number;
		completedSessions?: number;
	} = {},
): DailyLearningActivityDay {
	return {
		date,
		answers: {
			study: options.study ?? 0,
			practice: options.practice ?? 0,
			spelling: options.spelling ?? 0,
		},
		seconds: {
			study: options.seconds ?? 0,
			practice: 0,
			spelling: 0,
			"word-list": options.wordListSeconds ?? 0,
		},
		completedAnswers: {
			study: options.completedStudy ?? 0,
			practice: options.completedPractice ?? 0,
			spelling: options.completedSpelling ?? 0,
		},
		completedSessions: {
			study: options.completedSessions ?? 0,
			practice: 0,
			spelling: 0,
		},
	};
}

describe("daily learning activity", () => {
	it("records a completed session as an immutable Daily learning activity candidate", () => {
		const current = restoreDailyLearningActivity([]);
		const next = current.record({
			kind: "session",
			mode: "study",
			completion: "completed",
			answerCount: 3,
			durationSeconds: 120,
			occurredAt: new Date(2026, 8, 17, 0, 5).getTime(),
		});

		expect(current.toDocument()).toEqual([]);
		expect(next.toDocument()).toEqual([
			{
				date: "2026-09-17",
				answers: { study: 3, practice: 0, spelling: 0 },
				seconds: { study: 120, practice: 0, spelling: 0, "word-list": 0 },
				completedAnswers: { study: 3, practice: 0, spelling: 0 },
				completedSessions: { study: 1, practice: 0, spelling: 0 },
			},
		]);
	});

	it("drops impossible local calendar dates while preserving valid leap days", () => {
		const restored = restoreDailyLearningActivity([
			activity("2026-02-29", { completedSessions: 1 }),
			activity("2026-04-31", { completedSessions: 1 }),
			activity("2028-02-29", { completedSessions: 1 }),
		]);

		expect(restored.toDocument().map((day) => day.date)).toEqual(["2028-02-29"]);
	});

	it("rejects invalid runtime dates without changing the current activity", () => {
		const current = restoreDailyLearningActivity([activity("2026-09-17", { study: 1 })]);

		expect(() =>
			current.record({
				kind: "session",
				mode: "study",
				completion: "partial",
				answerCount: 1,
				durationSeconds: 1,
				occurredAt: Number.NaN,
			}),
		).toThrow(RangeError);
		expect(() => current.footprint(new Date(Number.NaN))).toThrow(RangeError);
		expect(current.toDocument()).toEqual([activity("2026-09-17", { study: 1 })]);
	});

	it("merges completed, partial, and word-list records into the occurrence date", () => {
		const occurredAt = new Date(2026, 8, 17, 0, 5).getTime();
		const result = restoreDailyLearningActivity([])
			.record({
				kind: "session",
				mode: "study",
				completion: "completed",
				answerCount: 3,
				durationSeconds: 120,
				occurredAt,
			})
			.record({
				kind: "session",
				mode: "spelling",
				completion: "partial",
				answerCount: 4,
				durationSeconds: 90,
				occurredAt,
			})
			.record({ kind: "word-list", durationSeconds: 30, occurredAt })
			.toDocument();

		expect(result).toEqual([
			{
				date: "2026-09-17",
				answers: { study: 3, practice: 0, spelling: 4 },
				seconds: { study: 120, practice: 0, spelling: 90, "word-list": 30 },
				completedAnswers: { study: 3, practice: 0, spelling: 0 },
				completedSessions: { study: 1, practice: 0, spelling: 0 },
			},
		]);
	});

	it("normalizes malformed persisted values without backfilling history", () => {
		expect(restoreDailyLearningActivity(undefined).toDocument()).toEqual([]);
		expect(
			restoreDailyLearningActivity([
				{
					date: "2026-09-17",
					answers: { study: -3, practice: 2.9, spelling: Number.NaN },
				},
				{ date: "bad-date" },
			]).toDocument(),
		).toEqual([
			{
				...activity("2026-09-17"),
				answers: { study: 0, practice: 2, spelling: 0 },
			},
		]);
	});

	it("calculates current streak with today's grace period and all-time best", () => {
		const records = [
			activity("2026-09-10", { completedSessions: 1 }),
			activity("2026-09-11", { completedSessions: 1 }),
			activity("2026-09-12", { completedSessions: 1 }),
			activity("2026-09-15", { completedSessions: 1 }),
			activity("2026-09-16", { completedSessions: 1 }),
		];

		const beforeCompletion = restoreDailyLearningActivity(records).footprint(
			new Date(2026, 8, 17, 12),
		);
		expect(beforeCompletion.currentStreak).toBe(2);
		expect(beforeCompletion.bestStreak).toBe(3);

		const afterCompletion = restoreDailyLearningActivity([
			...records,
			activity("2026-09-17", { completedSessions: 1 }),
		]).footprint(new Date(2026, 8, 17, 12));
		expect(afterCompletion.currentStreak).toBe(3);
		expect(afterCompletion.bestStreak).toBe(3);
	});

	it("builds a Monday-first 53-week heatmap with quartile levels", () => {
		const records = [
			activity("2026-09-13", { completedStudy: 1, completedSessions: 1 }),
			activity("2026-09-14", { completedStudy: 2, completedSessions: 1 }),
			activity("2026-09-15", { completedStudy: 3, completedSessions: 1 }),
			activity("2026-09-16", { completedStudy: 4, completedSessions: 1 }),
			activity("2026-09-17", { study: 2, seconds: 30 }),
		];
		const footprint = restoreDailyLearningActivity(records).footprint(
			new Date(2026, 8, 17, 12),
		);
		const days = footprint.weeks.flatMap((week) => week.days);

		expect(footprint.weeks).toHaveLength(53);
		expect(footprint.weeks.every((week) => week.days.length === 7)).toBe(true);
		expect(new Date(`${days[0]!.date}T00:00:00`).getDay()).toBe(1);
		expect(days.find((day) => day.date === "2026-09-13")?.level).toBe(1);
		expect(days.find((day) => day.date === "2026-09-14")?.level).toBe(2);
		expect(days.find((day) => day.date === "2026-09-15")?.level).toBe(3);
		expect(days.find((day) => day.date === "2026-09-16")?.level).toBe(4);
		expect(days.find((day) => day.date === "2026-09-17")).toMatchObject({
			level: 0,
			hasActivity: true,
		});
		expect(days.find((day) => day.date === "2026-09-18")?.future).toBe(true);
	});

	it("handles leap-day streaks using local calendar arithmetic", () => {
		const footprint = restoreDailyLearningActivity([
			activity("2028-02-28", { completedSessions: 1 }),
			activity("2028-02-29", { completedSessions: 1 }),
			activity("2028-03-01", { completedSessions: 1 }),
		]).footprint(new Date(2028, 2, 1, 12));
		expect(footprint.currentStreak).toBe(3);
		expect(footprint.bestStreak).toBe(3);
	});
});
