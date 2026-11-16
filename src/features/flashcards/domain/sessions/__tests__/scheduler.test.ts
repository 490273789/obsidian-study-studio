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

	it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])(
		"schedules a legacy mastered card with zero difficulty for rating %s",
		(rating) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-07-24T00:00:00.000Z"));
			const scheduler = makeScheduler();
			const card = {
				...createEmptyCard(),
				state: State.Review,
				stability: 21,
				difficulty: 0,
				reps: 1,
				scheduled_days: 21,
				last_review: new Date("2026-07-03T00:00:00.000Z"),
			};

			const rated = scheduler.rateCard(card, rating);

			expect(rated.card.reps).toBe(2);
			expect(rated.card.difficulty).toBeGreaterThanOrEqual(1);
			expect(rated.card.difficulty).toBeLessThanOrEqual(10);
			expect(rated.card.stability).toBeGreaterThan(0);
			expect(rated.repeatInSession).toBe(rating === Rating.Again);
			expect(card.difficulty).toBe(0);
		},
	);

	it("schedules custom garbage ratings exactly 21 days later", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
		const scheduler = makeScheduler();
		const card = createEmptyCard();

		const rated = scheduler.rateAsGarbage(card);

		expect(rated.difficulty).toBeGreaterThanOrEqual(1);
		expect(rated.difficulty).toBeLessThanOrEqual(10);
		expect(rated.scheduled_days).toBe(21);
		expect(rated.due.toISOString()).toBe("2026-07-24T00:00:00.000Z");
		expect(rated.last_review?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
		expect(rated.reps).toBe(card.reps + 1);
		expect(rated.state).toBe(State.Review);
		expect(rated.learning_steps).toBe(0);
	});

	it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])(
		"can review a new card after a custom mastered rating with rating %s",
		(rating) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
			const scheduler = makeScheduler();
			const mastered = scheduler.rateAsGarbage(createEmptyCard());
			vi.setSystemTime(mastered.due);

			const reviewed = scheduler.rateCard(mastered, rating);

			expect(reviewed.card.reps).toBe(2);
			expect(reviewed.card.difficulty).toBeGreaterThanOrEqual(1);
			expect(reviewed.card.stability).toBeGreaterThan(0);
		},
	);

	it("repairs a legacy mastered rating without resetting its learning state", () => {
		const scheduler = makeScheduler();
		const card = {
			...createEmptyCard(),
			state: State.Review,
			stability: 21,
			difficulty: 0,
			reps: 3,
			lapses: 1,
		};

		const rated = scheduler.rateAsGarbage(card);

		expect(rated.difficulty).toBeGreaterThanOrEqual(1);
		expect(rated.stability).toBe(21);
		expect(rated.reps).toBe(4);
		expect(rated.lapses).toBe(1);
		expect(card.difficulty).toBe(0);
	});

	it("preserves an existing memory state for a custom mastered rating", () => {
		const scheduler = makeScheduler();
		const card = {
			...createEmptyCard(),
			state: State.Review,
			stability: 12.5,
			difficulty: 6.4,
			reps: 7,
			lapses: 2,
		};

		const rated = scheduler.rateAsGarbage(card);

		expect(rated.stability).toBe(12.5);
		expect(rated.difficulty).toBe(6.4);
		expect(rated.reps).toBe(8);
		expect(rated.lapses).toBe(2);
	});
});
