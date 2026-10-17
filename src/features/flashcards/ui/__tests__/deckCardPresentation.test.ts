import { describe, expect, it } from "vite-plus/test";
import type { DeckHomeDeckSnapshot, DeckHomeSnapshot } from "../../domain/decks/deckHome";
import { selectDeckCardPresentation } from "../deckCardPresentation";

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

function activity(
	overrides: Partial<Pick<DeckHomeSnapshot, "settingsDraft" | "export">> = {},
): Pick<DeckHomeSnapshot, "settingsDraft" | "export"> {
	return {
		settingsDraft: null,
		export: { kind: "idle" },
		...overrides,
	};
}

describe("selectDeckCardPresentation", () => {
	it("classifies untouched, partly learned and finished decks", () => {
		const fresh = selectDeckCardPresentation(makeDeck(), activity(), "view");
		const active = selectDeckCardPresentation(
			makeDeck({
				studyCount: 2,
				stats: { ...makeDeck().stats, newCards: 7 },
			}),
			activity(),
			"view",
		);
		const done = selectDeckCardPresentation(
			makeDeck({
				studyCount: 2,
				stats: { ...makeDeck().stats, newCards: 0 },
			}),
			activity(),
			"view",
		);

		expect(fresh.state).toBe("fresh");
		expect(active.state).toBe("active");
		expect(done.state).toBe("done");
		expect(done.isDone).toBe(true);
	});

	it("derives learned cards and clamped progress from the snapshot statistics", () => {
		const presentation = selectDeckCardPresentation(
			makeDeck({
				studyCount: 1,
				stats: { ...makeDeck().stats, totalCards: 10, newCards: 3 },
			}),
			activity(),
			"view",
		);

		expect(presentation.learnedCards).toBe(7);
		expect(presentation.progressPercent).toBe(70);

		const empty = selectDeckCardPresentation(
			makeDeck({ stats: { ...makeDeck().stats, totalCards: 0, newCards: 0 } }),
			activity(),
			"view",
		);
		expect(empty.progressPercent).toBe(0);
	});

	it("marks only the exporting deck as exporting and every other deck as export busy", () => {
		const exporting = activity({
			export: { kind: "exporting", deckId: "deck", phase: null, completed: 1, total: 2 },
		});
		const other = selectDeckCardPresentation(makeDeck({ id: "other" }), exporting, "view");
		const own = selectDeckCardPresentation(makeDeck(), exporting, "view");

		expect(own.isExporting).toBe(true);
		expect(own.isExportBusy).toBe(true);
		expect(other.isExporting).toBe(false);
		expect(other.isExportBusy).toBe(true);
	});

	it("locks settings only for a draft owned by another view", () => {
		const base = makeDeck({ id: "deck", name: "Deck" });
		const ownDraft = {
			ownerId: "view",
			deckId: "deck",
			deckName: "Deck",
			filePath: "deck.md",
			totalCards: 10,
			useCustom: false,
			dailyNewCards: 20,
			dailyReviewCards: 200,
			studyOrder: "sequential" as const,
			requestRetention: 0.9,
			maximumInterval: "36500",
			daysToComplete: "10",
			wordLearningEnabled: false,
			global: base.effectiveStudySettings,
			spelling: { canStart: false, hasStableIdentities: true, invalidCards: [] },
		};
		const locked = activity({ settingsDraft: { ...ownDraft, ownerId: "other" } });
		const unlocked = activity({ settingsDraft: ownDraft });
		const freeDraft = activity({ settingsDraft: { ...ownDraft, ownerId: "" } });

		expect(selectDeckCardPresentation(base, locked, "view").isSettingsLocked).toBe(true);
		expect(selectDeckCardPresentation(base, unlocked, "view").isSettingsLocked).toBe(false);
		expect(selectDeckCardPresentation(base, freeDraft, "view").isSettingsLocked).toBe(false);
		expect(
			selectDeckCardPresentation(makeDeck({ id: "other-deck" }), freeDraft, "view")
				.isSettingsLocked,
		).toBe(true);
	});
});
