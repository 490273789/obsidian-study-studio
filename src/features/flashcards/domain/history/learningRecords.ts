import type { LearningActivityRecord } from "./dailyLearningActivity";
import type { PendingStudyHistoryEntry } from "./studyHistory";
import type { SessionActivityFacts } from "../sessions/sessionPersistence";

/** The five-second floor for counting a word-list visit as study activity. */
export const MIN_WORD_LIST_VISIT_DURATION_SECONDS = 5;

/** One semantic learning event before it becomes history, activity, and counts. */
type LearningRecordFacts =
	| {
			readonly kind: "session";
			readonly deckId: string;
			readonly deckName: string;
			readonly mode: "study" | "practice" | "spelling" | "challenge";
			readonly occurredAt: number;
			readonly history: {
				readonly cardCount: number;
				readonly durationSeconds: number;
			} | null;
			readonly activity: SessionActivityFacts;
	  }
	| {
			readonly kind: "word-list";
			readonly deckId: string;
			readonly deckName: string;
			readonly startTimeMs: number;
			readonly endTimeMs: number;
	  };

/** The learning-document records one or more facts contribute to a commit. */
export interface LearningRecordWriteSet {
	readonly incrementStudyCountFor: readonly string[];
	readonly historyEntries: readonly PendingStudyHistoryEntry[];
	readonly learningActivity?: LearningActivityRecord;
}

/**
 * Formats learning facts into history entries, daily activity, and study counts.
 * Calendar stamping and history pruning stay in `appendStudyHistory`; this module
 * owns only which facts produce which records.
 */
export function formatLearningRecords(
	facts: readonly LearningRecordFacts[],
): LearningRecordWriteSet {
	const incrementStudyCountFor: string[] = [];
	const historyEntries: PendingStudyHistoryEntry[] = [];
	let learningActivity: LearningActivityRecord | undefined;

	for (const fact of facts) {
		if (fact.kind === "word-list") {
			const duration = Math.max(0, Math.floor((fact.endTimeMs - fact.startTimeMs) / 1000));
			if (duration < MIN_WORD_LIST_VISIT_DURATION_SECONDS) continue;
			historyEntries.push({
				deckId: fact.deckId,
				deckName: fact.deckName,
				mode: "word-list",
				cardCount: 0,
				duration,
				occurredAt: fact.endTimeMs,
			});
			learningActivity = {
				kind: "word-list",
				durationSeconds: duration,
				occurredAt: fact.endTimeMs,
			};
			continue;
		}

		if (fact.history) {
			historyEntries.push({
				deckId: fact.deckId,
				deckName: fact.deckName,
				mode: fact.mode,
				cardCount: fact.history.cardCount,
				duration: fact.history.durationSeconds,
				occurredAt: fact.occurredAt,
			});
		}
		learningActivity = {
			kind: "session",
			mode: fact.mode,
			completion: fact.activity.completion,
			answerCount: fact.activity.answerCount,
			...(fact.activity.completedAnswerCount === undefined
				? {}
				: { completedAnswerCount: fact.activity.completedAnswerCount }),
			durationSeconds: fact.activity.durationSeconds,
			occurredAt: fact.occurredAt,
		};
		if (fact.mode === "study" && fact.activity.completion === "completed") {
			incrementStudyCountFor.push(fact.deckId);
		}
	}

	return {
		incrementStudyCountFor,
		historyEntries,
		...(learningActivity === undefined ? {} : { learningActivity }),
	};
}

/** Formats one visited word list, or null when the visit is too short to record. */
export function formatWordListVisit(
	deckId: string,
	deckName: string,
	startTimeMs: number,
	endTimeMs: number,
): LearningRecordWriteSet | null {
	const writeSet = formatLearningRecords([
		{
			kind: "word-list",
			deckId,
			deckName,
			startTimeMs,
			endTimeMs,
		},
	]);
	return writeSet.historyEntries.length === 0 ? null : writeSet;
}
