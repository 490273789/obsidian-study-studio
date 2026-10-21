import type { Card } from "ts-fsrs";
import { formatLearningRecords, type LearningRecordWriteSet } from "../history/learningRecords";
import type { ChallengeProgress } from "../sessions/challengeSessionEngine";
import type { SessionCommit } from "../sessions/sessionPersistence";

/**
 * Document-shaped write set. Storage-private: only files under
 * `domain/storage/` may import this module, and the module-boundary check
 * enforces that callers never name it.
 */
export interface SessionWriteSet extends LearningRecordWriteSet {
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
	const learning = formatLearningRecords(
		(commit.records ?? []).map((record) => ({
			kind: "session" as const,
			deckId: record.deckId,
			deckName: record.deckName,
			mode: record.mode,
			occurredAt: record.occurredAt,
			history: record.history,
			activity: record.activity,
		})),
	);

	return {
		...learning,
		cardUpdates,
		spellingAttempts,
		...(commit.challenge === undefined
			? {}
			: {
					challengeProgress: commit.challenge.progress,
					expectedChallengeProgress: commit.challenge.expectedProgress,
				}),
	};
}
