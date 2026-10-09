import { describe, expect, it } from "vite-plus/test";
import type { StudyHistoryEntry } from "../../../../../core/shared/types";
import {
	appendStudyHistory,
	createWordListHistoryEntry,
	formatLocalDateKey,
	MAX_STUDY_HISTORY_DAYS,
	pruneStudyHistory,
} from "../studyHistory";

function makeEntry(date: string, mode: StudyHistoryEntry["mode"] = "study"): StudyHistoryEntry {
	return {
		date,
		deckId: "notes/deck.md",
		deckName: "Deck",
		mode,
		cardCount: 10,
		duration: 120,
		timestamp: new Date(`${date}T10:00:00.000Z`).getTime(),
	};
}

describe("studyHistory", () => {
	describe("formatLocalDateKey", () => {
		it("formats dates with zero padding for single digit month and day", () => {
			const date = new Date(2026, 4, 3); // May 3, 2026
			expect(formatLocalDateKey(date)).toBe("2026-05-03");
		});

		it("formats dates with double digit month and day", () => {
			const date = new Date(2026, 10, 25); // Nov 25, 2026
			expect(formatLocalDateKey(date)).toBe("2026-11-25");
		});
	});

	describe("pruneStudyHistory", () => {
		it("returns an empty array when history is empty", () => {
			expect(pruneStudyHistory([])).toEqual([]);
		});

		it("returns all entries when distinct days are within the limit", () => {
			const entries = [
				makeEntry("2026-08-01"),
				makeEntry("2026-08-02"),
				makeEntry("2026-08-02", "practice"),
				makeEntry("2026-08-03"),
			];

			const result = pruneStudyHistory(entries);

			expect(result).toEqual(entries);
			expect(result).not.toBe(entries);
		});

		it("prunes oldest days using default MAX_STUDY_HISTORY_DAYS", () => {
			expect(MAX_STUDY_HISTORY_DAYS).toBe(20);
			const entries: StudyHistoryEntry[] = [];
			for (let day = 1; day <= 25; day++) {
				const dayStr = String(day).padStart(2, "0");
				entries.push(makeEntry(`2026-08-${dayStr}`));
			}

			const pruned = pruneStudyHistory(entries);

			expect(pruned).toHaveLength(20);
			// Should keep day 06 to 25 (latest 20 days), and drop day 01 to 05
			expect(pruned[0]?.date).toBe("2026-08-06");
			expect(pruned[pruned.length - 1]?.date).toBe("2026-08-25");
		});

		it("preserves multiple entries that occur on the same retained day", () => {
			const entries: StudyHistoryEntry[] = [];
			// Add 21 days, but day 21 has 3 entries
			for (let day = 1; day <= 21; day++) {
				const dayStr = String(day).padStart(2, "0");
				entries.push(makeEntry(`2026-08-${dayStr}`, "study"));
				if (day === 21) {
					entries.push(makeEntry(`2026-08-${dayStr}`, "practice"));
					entries.push(makeEntry(`2026-08-${dayStr}`, "spelling"));
				}
			}

			const pruned = pruneStudyHistory(entries, 20);

			// Total days: 21. Retains days 02..21 (20 distinct days). Day 01 dropped.
			// Days 02..20 have 1 entry each (19 entries), Day 21 has 3 entries -> total 22 entries.
			expect(pruned).toHaveLength(22);
			const day21Entries = pruned.filter((e) => e.date === "2026-08-21");
			expect(day21Entries).toHaveLength(3);
			expect(pruned.some((e) => e.date === "2026-08-01")).toBe(false);
		});

		it("does not mutate the original history array", () => {
			const entries = [
				makeEntry("2026-08-01"),
				makeEntry("2026-08-02"),
				makeEntry("2026-08-03"),
			];
			const originalCopy = [...entries];

			pruneStudyHistory(entries, 2);

			expect(entries).toEqual(originalCopy);
		});
	});

	describe("createWordListHistoryEntry", () => {
		it("returns null when duration is under 5 seconds", () => {
			const entry = createWordListHistoryEntry("deck-1", "Deck 1", 1000, 5000); // 4 seconds
			expect(entry).toBeNull();
		});

		it("returns entry when duration is at least 5 seconds", () => {
			const now = new Date("2026-08-02T12:00:00.000Z");
			const entry = createWordListHistoryEntry("deck-1", "Deck 1", 1000, 6500, now); // 5 seconds
			expect(entry).toEqual({
				date: "2026-08-02",
				deckId: "deck-1",
				deckName: "Deck 1",
				mode: "word-list",
				cardCount: 0,
				duration: 5,
				timestamp: now.getTime(),
			});
		});
	});

	describe("appendStudyHistory", () => {
		it("returns a copy when newEntries is empty", () => {
			const history = [makeEntry("2026-08-01")];
			const result = appendStudyHistory(history, []);
			expect(result).toEqual(history);
			expect(result).not.toBe(history);
		});

		it("auto-stamps date and timestamp when appending pending entries", () => {
			const now = new Date("2026-08-05T15:30:00.000Z");
			const history = [makeEntry("2026-08-01")];
			const result = appendStudyHistory(
				history,
				[
					{
						deckId: "deck-2",
						deckName: "Deck 2",
						mode: "practice",
						cardCount: 5,
						duration: 60,
					},
				],
				now,
			);

			expect(result).toHaveLength(2);
			expect(result[1]).toEqual({
				deckId: "deck-2",
				deckName: "Deck 2",
				mode: "practice",
				cardCount: 5,
				duration: 60,
				date: "2026-08-05",
				timestamp: now.getTime(),
			});
		});

		it("auto-prunes when appended entries exceed maxDays", () => {
			const entries: StudyHistoryEntry[] = [];
			for (let day = 1; day <= 20; day++) {
				const dayStr = String(day).padStart(2, "0");
				entries.push(makeEntry(`2026-08-${dayStr}`));
			}
			const now = new Date("2026-08-21T10:00:00.000Z");
			const result = appendStudyHistory(
				entries,
				[
					{
						deckId: "deck-1",
						deckName: "Deck 1",
						mode: "study",
						cardCount: 10,
						duration: 100,
					},
				],
				now,
				20,
			);

			expect(result).toHaveLength(20);
			expect(result[0]?.date).toBe("2026-08-02");
			expect(result[result.length - 1]?.date).toBe("2026-08-21");
		});
	});
});
