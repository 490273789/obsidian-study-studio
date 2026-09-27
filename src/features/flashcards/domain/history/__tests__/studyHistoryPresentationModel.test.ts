import { describe, expect, it } from "vitest";
import { createTranslator } from "../../../strings/index";
import type { StudyHistoryEntry } from "../../../../../core/shared/types";
import {
	buildStudyHistoryPresentationModel,
	STUDY_HISTORY_MODE_PRESENTATION,
} from "../studyHistoryPresentationModel";

function makeEntry(overrides: Partial<StudyHistoryEntry>): StudyHistoryEntry {
	return {
		date: "2026-07-08",
		deckId: "deck-a",
		deckName: "Deck A",
		mode: "study",
		cardCount: 10,
		duration: 60,
		timestamp: 100,
		...overrides,
	};
}

describe("buildStudyHistoryPresentationModel", () => {
	it("presents challenge history as its own mode", () => {
		expect(STUDY_HISTORY_MODE_PRESENTATION.challenge).toEqual({
			labelKey: "challenge.title",
			cls: "stats-mode-challenge",
		});
	});

	it("groups entries by date, sorts days descending, and sorts entries by timestamp", () => {
		const t = createTranslator("zh");
		const model = buildStudyHistoryPresentationModel(
			[
				makeEntry({ date: "2026-07-07", timestamp: 300, cardCount: 3, duration: 30 }),
				makeEntry({ date: "2026-07-08", timestamp: 200, cardCount: 2, duration: 20 }),
				makeEntry({ date: "2026-07-08", timestamp: 100, cardCount: 1, duration: 10 }),
			],
			{
				language: "zh",
				t,
				now: new Date("2026-07-08T12:00:00"),
			},
		);

		expect(model.dayGroups.map((group) => group.date)).toEqual(["2026-07-08", "2026-07-07"]);
		expect(model.dayGroups[0]?.entries.map((entry) => entry.timestamp)).toEqual([100, 200]);
		expect(model.dayGroups[0]).toMatchObject({
			displayDate: "07月08日（今天）",
			totalDuration: 30,
			totalDurationLabel: "30秒",
			totalCards: 3,
		});
		expect(model.dayGroups[1]).toMatchObject({
			displayDate: "07月07日（昨天）",
			totalDuration: 30,
			totalCards: 3,
		});
		expect(model.totals).toEqual({
			duration: 60,
			durationLabel: "1分钟",
			cards: 6,
		});
	});

	it("formats older dates with localized weekday labels", () => {
		const model = buildStudyHistoryPresentationModel([makeEntry({ date: "2026-07-01" })], {
			language: "en",
			t: createTranslator("en"),
			now: new Date("2026-07-08T12:00:00"),
		});

		expect(model.dayGroups[0]?.displayDate).toBe("07/01 (Wed)");
	});
});
