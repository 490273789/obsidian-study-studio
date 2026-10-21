import { createEmptyCard, Rating, State } from "ts-fsrs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { FSRSScheduler, toFSRSRating } from "../scheduler";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";

function makeScheduler(): FSRSScheduler {
	return new FSRSScheduler(DEFAULT_SETTINGS);
}

describe("toFSRSRating", () => {
	it("maps UI rating numbers to FSRS ratings", () => {
		expect(toFSRSRating(1)).toBe(Rating.Again);
		expect(toFSRSRating(2)).toBe(Rating.Hard);
		expect(toFSRSRating(3)).toBe(Rating.Good);
		expect(toFSRSRating(4)).toBe(Rating.Easy);
	});
});

describe("FSRSScheduler", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("marks Again ratings for in-session repetition", () => {
		const scheduler = makeScheduler();
		const card = createEmptyCard();

		const again = scheduler.rateCard(card, Rating.Again);
		const good = scheduler.rateCard(card, Rating.Good);

		expect(again.repeatInSession).toBe(true);
		expect(again.card.reps).toBe(card.reps + 1);
		expect(good.repeatInSession).toBe(false);
		expect(good.card.reps).toBe(card.reps + 1);
	});

	it("schedules custom garbage ratings exactly 21 days later", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
		const scheduler = makeScheduler();
		const card = createEmptyCard();

		const rated = scheduler.rateAsGarbage(card);

		expect(rated.scheduled_days).toBe(21);
		expect(rated.due.toISOString()).toBe("2026-07-24T00:00:00.000Z");
		expect(rated.last_review?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
		expect(rated.reps).toBe(card.reps + 1);
		expect(rated.state).toBe(State.Review);
		expect(rated.learning_steps).toBe(0);
	});
});
