import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import type { Deck, FlashCard, StudySettings } from "../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../core/host/settingsSlices";
import type { DeckHomeDeckSnapshot, DeckHomeSnapshot } from "../../domain/decks/deckHome";
import { restoreDailyLearningActivity } from "../../domain/history/dailyLearningActivity";
import { getStudySetupPlan } from "../../domain/sessions/sessionPlanner";
import {
	selectPracticeSetupPlan,
	selectSpellingSetupPlan,
	selectStudySetupPlan,
} from "../deckHomeSetupPlans";

function makeCard(id: string, front: string, back: string): FlashCard {
	return {
		id,
		front,
		back,
		fsrsCard: createEmptyCard(new Date("2026-08-02T12:00:00.000Z")),
		sourceFile: "deck.md",
		indexInFile: 0,
	};
}

function makeDeck(cards: FlashCard[]): Deck {
	return {
		id: "deck",
		name: "Deck",
		filePath: "deck.md",
		tag: "#deck",
		cards,
		studyCount: 0,
		lastStudied: null,
	};
}

function makeEffectiveSettings(overrides: Partial<StudySettings> = {}): StudySettings {
	return {
		dailyNewCards: DEFAULT_SETTINGS.dailyNewCards,
		dailyReviewCards: DEFAULT_SETTINGS.dailyReviewCards,
		studyOrder: DEFAULT_SETTINGS.studyOrder,
		fsrsParameters: { ...DEFAULT_SETTINGS.fsrsParameters },
		...overrides,
	};
}

function makeSnapshot(
	deck: Deck,
	effectiveStudySettings: StudySettings,
	spellingProgress: DeckHomeSnapshot["spellingProgress"] = {},
): DeckHomeSnapshot {
	const deckSnapshot: DeckHomeDeckSnapshot = {
		id: deck.id,
		name: deck.name,
		filePath: deck.filePath,
		tag: deck.tag,
		studyCount: deck.studyCount,
		stats: {
			totalCards: deck.cards.length,
			newCards: deck.cards.length,
			dueCards: 0,
			learningCards: 0,
			reviewCards: 0,
			relearningCards: 0,
		},
		effectiveStudySettings,
		spelling: {
			enabled: true,
			ready: false,
			valid: true,
			canStart: false,
			hasStableIdentities: true,
			issueCount: 0,
			ignoredCardCount: 0,
		},
	};
	return {
		challenge: { savedRoundId: null, eligibleCount: 0, lastMode: "random", round: null },
		revision: 1,
		evaluatedAt: new Date("2026-08-02T12:00:00.000Z").getTime(),
		decks: [deckSnapshot],
		totals: {
			deckCount: 1,
			totalCards: deck.cards.length,
			newCards: deck.cards.length,
			dueCards: 0,
			studyCount: deck.studyCount,
		},
		studyHistory: [],
		spellingProgress,
		learningFootprint: restoreDailyLearningActivity(undefined).footprint(new Date(0)),
		migration: null,
		mutation: { kind: "idle" },
		export: { kind: "idle" },
		settingsDraft: null,
	};
}

describe("deck home setup plan selectors", () => {
	it("derives the study plan from the snapshot's effective settings and evaluated time", () => {
		const deck = makeDeck([makeCard("a", "one", "一"), makeCard("b", "two", "二")]);
		const effective = makeEffectiveSettings({ dailyNewCards: 1, studyOrder: "sequential" });
		const snapshot = makeSnapshot(deck, effective);

		const plan = selectStudySetupPlan(snapshot, deck, "random");

		expect(plan).not.toBeNull();
		expect(plan).toEqual(
			getStudySetupPlan(deck, effective, new Date(snapshot.evaluatedAt), "random"),
		);
		expect(plan?.todayNewCount).toBe(1);
		expect(plan?.defaultStudyOrder).toBe("random");
	});

	it("returns no study plan when the snapshot does not contain the deck", () => {
		const deck = makeDeck([makeCard("a", "one", "一")]);
		const snapshot = makeSnapshot(deck, makeEffectiveSettings());

		expect(selectStudySetupPlan(snapshot, { ...deck, id: "missing" })).toBeNull();
	});

	it("passes the practice selection through to the planner", () => {
		const deck = makeDeck([
			makeCard("a", "one", "一"),
			makeCard("b", "two", "二"),
			makeCard("c", "three", "三"),
		]);

		const plan = selectPracticeSetupPlan(deck, {
			kind: "range",
			startIndex: 2,
			endIndex: 3,
		});

		expect(plan.initialSelectionMode).toBe("range");
		expect(plan.initialRangeStart).toBe(2);
		expect(plan.initialRangeEnd).toBe(3);
	});

	it("derives the spelling plan from the snapshot's spelling progress", () => {
		const deck = makeDeck([makeCard("a", "hello", "你好"), makeCard("b", "world", "世界")]);
		const snapshot = makeSnapshot(deck, makeEffectiveSettings(), {
			a: { attempts: 1, correctAttempts: 1, correctStreak: 1, lastAttemptAt: 1 },
		});

		const plan = selectSpellingSetupPlan(snapshot, deck);

		expect(plan.stats).toEqual({ total: 2, unpracticed: 1 });
		expect(plan.maxQuestions).toBe(2);
	});
});
