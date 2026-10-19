import { describe, expect, it } from "vite-plus/test";
import type { DeckHomeDeckSnapshot } from "../../domain/decks/deckHome";
import {
	selectContinueDeck,
	selectDeckCardMetrics,
	selectDeckVisualState,
} from "../homePresentation";

function makeDeck(overrides: Partial<DeckHomeDeckSnapshot> = {}): DeckHomeDeckSnapshot {
	return {
		id: "deck",
		name: "Deck",
		filePath: "deck.md",
		tag: "#deck",
		studyCount: 0,
		stats: {
			totalCards: 10,
			newCards: 10,
			dueCards: 0,
			learningCards: 0,
			reviewCards: 0,
			relearningCards: 0,
		},
		effectiveStudySettings: {
			dailyNewCards: 20,
			dailyReviewCards: 200,
			studyOrder: "sequential",
			fsrsParameters: { requestRetention: 0.9, maximumInterval: 36500 },
		},
		spelling: {
			enabled: false,
			ready: false,
			valid: true,
			canStart: false,
			hasStableIdentities: true,
			issueCount: 0,
			ignoredCardCount: 0,
		},
		...overrides,
	};
}

describe("selectDeckCardMetrics", () => {
	it("classifies untouched, partly learned and finished decks", () => {
		const fresh = selectDeckCardMetrics(makeDeck());
		const active = selectDeckCardMetrics(
			makeDeck({ studyCount: 2, stats: { ...makeDeck().stats, newCards: 7 } }),
		);
		const done = selectDeckCardMetrics(
			makeDeck({ studyCount: 2, stats: { ...makeDeck().stats, newCards: 0 } }),
		);

		expect(fresh.state).toBe("fresh");
		expect(active.state).toBe("active");
		expect(done.state).toBe("done");
		expect(done.isDone).toBe(true);
	});

	it("derives learned cards and clamped progress from the row statistics", () => {
		const presentation = selectDeckCardMetrics(
			makeDeck({
				studyCount: 1,
				stats: { ...makeDeck().stats, totalCards: 10, newCards: 3 },
			}),
		);

		expect(presentation.learnedCards).toBe(7);
		expect(presentation.progressPercent).toBe(70);

		const empty = selectDeckCardMetrics(
			makeDeck({ stats: { ...makeDeck().stats, totalCards: 0, newCards: 0 } }),
		);
		expect(empty.progressPercent).toBe(0);
	});
});

describe("selectContinueDeck", () => {
	it("prefers a started deck over an untouched deck", () => {
		const started = makeDeck({
			id: "started",
			studyCount: 1,
			stats: { ...makeDeck().stats, newCards: 3 },
		});
		const untouched = makeDeck({
			id: "untouched",
			stats: { ...makeDeck().stats, newCards: 10 },
		});

		expect(selectContinueDeck([untouched, started])).toBe(started);
	});

	it("prefers the largest backlog within each tier", () => {
		const small = makeDeck({
			id: "small",
			studyCount: 1,
			stats: { ...makeDeck().stats, newCards: 3 },
		});
		const large = makeDeck({
			id: "large",
			studyCount: 2,
			stats: { ...makeDeck().stats, newCards: 7 },
		});

		expect(selectContinueDeck([small, large])).toBe(large);
	});

	it("keeps the snapshot's display order for equal backlogs", () => {
		const first = makeDeck({ id: "first", stats: { ...makeDeck().stats, newCards: 5 } });
		const second = makeDeck({ id: "second", stats: { ...makeDeck().stats, newCards: 5 } });

		expect(selectContinueDeck([first, second])).toBe(first);
		expect(selectContinueDeck([second, first])).toBe(second);
	});

	it("returns null when no deck has cards left to learn", () => {
		const done = makeDeck({
			id: "done",
			studyCount: 3,
			stats: { ...makeDeck().stats, newCards: 0 },
		});

		expect(selectContinueDeck([done])).toBeNull();
	});
});

describe("selectDeckVisualState", () => {
	it("reports the same state as the metrics selector", () => {
		const active = makeDeck({
			studyCount: 1,
			stats: { ...makeDeck().stats, newCards: 4 },
		});

		expect(selectDeckVisualState(active)).toBe(selectDeckCardMetrics(active).state);
	});
});
