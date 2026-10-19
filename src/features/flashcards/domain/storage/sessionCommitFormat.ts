import type { Card } from "ts-fsrs";
import type { LearningActivityRecord } from "../history/dailyLearningActivity";
import type { PendingStudyHistoryEntry } from "../history/studyHistory";
import type { ChallengeProgress } from "../sessions/challengeSessionEngine";
import type { SessionCommit } from "../sessions/sessionPersistence";

/**
 * Document-shaped write set. Storage-private: only files under
 * `domain/storage/` may import this module, and the module-boundary check
 * enforces that callers never name it.
 */
export interface SessionWriteSet {
	readonly cardUpdates: readonly {
		deckId: string;
		cardId: string;
		fsrsCard: Card;
	}[];
	readonly spellingAttempts: readonly {
		cardId: string;
		correct: boolean;
		attemptedAt: number;
	}[];
	readonly incrementStudyCountFor: readonly string[];
	readonly historyEntries: readonly PendingStudyHistoryEntry[];
	readonly learningActivity?: LearningActivityRecord;
	readonly challengeProgress?: ChallengeProgress;
	readonly expectedChallengeProgress?: ChallengeProgress | null;
}

/**
 * A pure answer write reaches durability through the local journal: it changes
 * no records, history, activity, study counts, or challenge progress.
 */
export function isPureJournalWriteSet(transition: SessionWriteSet): boolean {
	return (
		transition.incrementStudyCountFor.length === 0 &&
		transition.historyEntries.length === 0 &&
		transition.learningActivity === undefined &&
		transition.challengeProgress === undefined &&
		transition.expectedChallengeProgress === undefined &&
		(transition.cardUpdates.length > 0 || transition.spellingAttempts.length > 0)
	);
}

/**
 * Formats one semantic session commit into the learning-document write set.
 * All document rules live here so the lifecycle and engines stay unaware of it.
 */
export function formatSessionCommit(commit: SessionCommit): SessionWriteSet {
	const cardUpdates = (commit.cardSchedules ?? []).map((schedule) => ({
		deckId: schedule.deckId,
		cardId: schedule.cardId,
		fsrsCard: schedule.fsrsCard,
	}));
	const spellingAttempts = (commit.spellingAttempts ?? []).map((attempt) => ({
		cardId: attempt.cardId,
		correct: attempt.correct,
		attemptedAt: attempt.attemptedAt,
	}));
	const incrementStudyCountFor: string[] = [];
	const historyEntries: PendingStudyHistoryEntry[] = [];
	let learningActivity: LearningActivityRecord | undefined;

	for (const record of commit.records ?? []) {
		if (record.history) {
			historyEntries.push({
				deckId: record.deckId,
				deckName: record.deckName,
				mode: record.mode,
				cardCount: record.history.cardCount,
				duration: record.history.durationSeconds,
				occurredAt: record.occurredAt,
			});
		}
		learningActivity = {
			kind: "session",
			mode: record.mode,
			completion: record.activity.completion,
			answerCount: record.activity.answerCount,
			...(record.activity.completedAnswerCount === undefined
				? {}
				: { completedAnswerCount: record.activity.completedAnswerCount }),
			durationSeconds: record.activity.durationSeconds,
			occurredAt: record.occurredAt,
		};
		if (record.mode === "study" && record.activity.completion === "completed") {
			incrementStudyCountFor.push(record.deckId);
		}
	}

	return {
		cardUpdates,
		spellingAttempts,
		incrementStudyCountFor,
		historyEntries,
		...(learningActivity === undefined ? {} : { learningActivity }),
		...(commit.challenge === undefined
			? {}
			: {
					challengeProgress: commit.challenge.progress,
					expectedChallengeProgress: commit.challenge.expectedProgress,
				}),
	};
}
