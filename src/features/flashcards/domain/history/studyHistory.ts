import type { StudyHistoryEntry } from "../../../../core/shared/types";
import type { PendingSessionHistoryEntry } from "../sessions/sessionLifecycle";

export const MAX_STUDY_HISTORY_DAYS = 20;
export const MIN_WORD_LIST_VISIT_DURATION_SECONDS = 5;

/**
 * Format a Date into local calendar key "YYYY-MM-DD".
 */
export function formatLocalDateKey(date: Date): string {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
}

/**
 * Prune history to at most `maxDays` distinct calendar days (keeping the latest days).
 * Returns a new array without mutating the input.
 */
export function pruneStudyHistory(
	history: readonly StudyHistoryEntry[],
	maxDays = MAX_STUDY_HISTORY_DAYS,
): StudyHistoryEntry[] {
	const days = [...new Set(history.map((entry) => entry.date))].sort().reverse();
	if (days.length <= maxDays) {
		return [...history];
	}
	const keep = new Set(days.slice(0, maxDays));
	return history.filter((entry) => keep.has(entry.date));
}

/**
 * Create a word list study history entry if visit duration is at least 5 seconds.
 */
export function createWordListHistoryEntry(
	deckId: string,
	deckName: string,
	startTimeMs: number,
	endTimeMs: number,
	now: Date = new Date(endTimeMs),
): StudyHistoryEntry | null {
	const duration = Math.max(0, Math.floor((endTimeMs - startTimeMs) / 1000));
	if (duration < MIN_WORD_LIST_VISIT_DURATION_SECONDS) {
		return null;
	}
	return {
		date: formatLocalDateKey(now),
		deckId,
		deckName,
		mode: "word-list",
		cardCount: 0,
		duration,
		timestamp: now.getTime(),
	};
}

export type AppendableStudyHistoryEntry =
	| PendingSessionHistoryEntry
	| StudyHistoryEntry
	| {
			deckId: string;
			deckName: string;
			mode: StudyHistoryEntry["mode"];
			cardCount: number;
			duration: number;
			date?: string;
			timestamp?: number;
	  };

/**
 * Appends new history entries (auto-stamping date and timestamp if missing)
 * and prunes the result to `maxDays`.
 */
export function appendStudyHistory(
	history: readonly StudyHistoryEntry[],
	newEntries: readonly AppendableStudyHistoryEntry[],
	now: Date = new Date(),
	maxDays = MAX_STUDY_HISTORY_DAYS,
): StudyHistoryEntry[] {
	if (newEntries.length === 0) {
		return [...history];
	}
	const dateStr = formatLocalDateKey(now);
	const nowMs = now.getTime();

	const nextHistory = [...history];
	for (const entry of newEntries) {
		const entryRecord = entry as {
			date?: string;
			timestamp?: number;
			occurredAt?: number;
		};
		const occurredAt = Number.isFinite(entryRecord.occurredAt)
			? entryRecord.occurredAt
			: undefined;
		nextHistory.push({
			deckId: entry.deckId,
			deckName: entry.deckName,
			mode: entry.mode,
			cardCount: entry.cardCount,
			duration: entry.duration,
			date:
				entryRecord.date ??
				(occurredAt === undefined ? dateStr : formatLocalDateKey(new Date(occurredAt))),
			timestamp: entryRecord.timestamp ?? occurredAt ?? nowMs,
		});
	}
	return pruneStudyHistory(nextHistory, maxDays);
}
