import type { StudyHistoryEntry } from "../../../../core/shared/types";
export interface PendingStudyHistoryEntry {
	readonly deckId: string;
	readonly deckName: string;
	readonly mode: StudyHistoryEntry["mode"];
	readonly cardCount: number;
	readonly duration: number;
	readonly occurredAt: number;
}

export const MAX_STUDY_HISTORY_DAYS = 20;

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

type AppendableStudyHistoryEntry =
	| PendingStudyHistoryEntry
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
