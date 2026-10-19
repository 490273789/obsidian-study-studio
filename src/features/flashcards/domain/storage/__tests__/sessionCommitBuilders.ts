import type { Card } from "ts-fsrs";
import type { ChallengeProgress } from "../../sessions/challengeSessionEngine";
import type { SessionActivityFacts, SessionCommit } from "../../sessions/sessionPersistence";

/**
 * Test-only builders for semantic session commits. Storage tests drive the same
 * `commitSession(SessionCommit)` interface production uses instead of naming
 * document-shaped write sets.
 */
export function answerCommit(input: {
	deckId: string;
	cardId: string;
	fsrsCard: Card;
}): SessionCommit {
	return {
		cardSchedules: [{ deckId: input.deckId, cardId: input.cardId, fsrsCard: input.fsrsCard }],
	};
}

export function spellingCommit(input: {
	cardId: string;
	correct: boolean;
	attemptedAt: number;
}): SessionCommit {
	return {
		spellingAttempts: [
			{ cardId: input.cardId, correct: input.correct, attemptedAt: input.attemptedAt },
		],
	};
}

export function recordCommit(input: {
	mode: "study" | "practice" | "spelling" | "challenge";
	deckId: string;
	deckName: string;
	occurredAt: number;
	activity: SessionActivityFacts;
	history?: { cardCount: number; durationSeconds: number } | null;
}): SessionCommit {
	return {
		records: [
			{
				mode: input.mode,
				deckId: input.deckId,
				deckName: input.deckName,
				occurredAt: input.occurredAt,
				activity: input.activity,
				history: input.history ?? null,
			},
		],
	};
}

export function challengeCommit(input: {
	progress: ChallengeProgress;
	expectedProgress: ChallengeProgress | null;
}): SessionCommit {
	return {
		challenge: { progress: input.progress, expectedProgress: input.expectedProgress },
	};
}

/** Combines partial commits so multi-effect tests read as one semantic commit. */
export function mergeCommits(...parts: readonly SessionCommit[]): SessionCommit {
	const cardSchedules = parts.flatMap((part) => part.cardSchedules ?? []);
	const spellingAttempts = parts.flatMap((part) => part.spellingAttempts ?? []);
	const records = parts.flatMap((part) => part.records ?? []);
	const challenge = parts.find((part) => part.challenge)?.challenge;
	return {
		...(cardSchedules.length > 0 ? { cardSchedules } : {}),
		...(spellingAttempts.length > 0 ? { spellingAttempts } : {}),
		...(records.length > 0 ? { records } : {}),
		...(challenge ? { challenge } : {}),
	};
}
