import { normalizeStringArray } from "../../../../core/shared/utils";
import type {
	SpellingFirstAttempt,
	SpellingResult,
	SpellingSession,
} from "../../../../core/shared/types";

type SpellingAnswerFeedback =
	| "retrieval-correct"
	| "retrieval-incorrect"
	| "correction-correct"
	| "correction-incorrect";

type SpellingSessionStep =
	| {
			type: "continue";
			session: SpellingSession;
			feedback: SpellingAnswerFeedback;
	  }
	| {
			type: "complete";
			result: SpellingResult;
			feedback: "retrieval-correct";
	  };

export function createSpellingSession(params: {
	deckId: string;
	cardIds: string[];
	startTime?: number;
}): SpellingSession {
	const selectedCardIds = Array.from(new Set(params.cardIds));
	return {
		deckId: params.deckId,
		selectedCardIds,
		cardQueue: [...selectedCardIds],
		currentIndex: 0,
		startTime: params.startTime ?? Date.now(),
		phase: "retrieval",
		firstAttempts: {},
		attempts: [],
		completedCardIds: [],
		unavailableCardIds: [],
	};
}

export function answerSpellingCard(params: {
	session: SpellingSession;
	cardId: string;
	input: string;
	isCorrect: boolean;
	now?: number;
}): SpellingSessionStep {
	const session = normalizeSpellingSession(params.session);
	const now = params.now ?? Date.now();
	const event = {
		cardId: params.cardId,
		input: params.input,
		correct: params.isCorrect,
		kind: session.phase,
		answeredAt: now,
	} as const;
	const attempts = [...session.attempts, event];

	if (session.phase === "correction") {
		if (!params.isCorrect) {
			return {
				type: "continue",
				feedback: "correction-incorrect",
				session: { ...session, attempts },
			};
		}
		return {
			type: "continue",
			feedback: "correction-correct",
			session: {
				...session,
				attempts,
				phase: "retrieval",
				currentIndex: session.currentIndex + 1,
			},
		};
	}

	const firstAttempts = session.firstAttempts[params.cardId]
		? session.firstAttempts
		: {
				...session.firstAttempts,
				[params.cardId]: {
					input: params.input,
					correct: params.isCorrect,
					answeredAt: now,
				} satisfies SpellingFirstAttempt,
			};

	if (!params.isCorrect) {
		return {
			type: "continue",
			feedback: "retrieval-incorrect",
			session: {
				...session,
				firstAttempts,
				attempts,
				cardQueue: [...session.cardQueue, params.cardId],
				phase: "correction",
			},
		};
	}

	const completedCardIds = Array.from(new Set([...session.completedCardIds, params.cardId]));
	const nextSession: SpellingSession = {
		...session,
		firstAttempts,
		attempts,
		completedCardIds,
		currentIndex: session.currentIndex + 1,
	};
	if (nextSession.currentIndex < nextSession.cardQueue.length) {
		return {
			type: "continue",
			feedback: "retrieval-correct",
			session: nextSession,
		};
	}

	return {
		type: "complete",
		feedback: "retrieval-correct",
		result: buildSpellingResult(nextSession, now),
	};
}

function buildSpellingResult(session: SpellingSession, now: number = Date.now()): SpellingResult {
	const firstEntries = Object.entries(session.firstAttempts);
	const firstTryCorrectCount = firstEntries.filter(([, attempt]) => attempt.correct).length;
	const incorrectCardIds = firstEntries
		.filter(([, attempt]) => !attempt.correct)
		.map(([cardId]) => cardId);
	const totalWords = session.selectedCardIds.length;
	return {
		totalWords,
		firstTryCorrectCount,
		firstTryIncorrectCount: totalWords - firstTryCorrectCount,
		firstTryAccuracy: totalWords > 0 ? (firstTryCorrectCount / totalWords) * 100 : 0,
		totalRetrievalAttempts: session.attempts.filter((attempt) => attempt.kind === "retrieval")
			.length,
		incorrectCardIds,
		firstInputs: Object.fromEntries(
			firstEntries.map(([cardId, attempt]) => [cardId, attempt.input]),
		),
		timeSpent: Math.max(0, Math.floor((now - session.startTime) / 1000)),
	};
}

export function getCurrentSpellingCardId(session: SpellingSession): string | null {
	return session.cardQueue[session.currentIndex] ?? null;
}

function normalizeSpellingSession(session: SpellingSession): SpellingSession {
	return {
		...session,
		selectedCardIds: normalizeStringArray(session.selectedCardIds),
		cardQueue: normalizeStringArray(session.cardQueue),
		currentIndex: Math.max(0, session.currentIndex),
		phase: session.phase === "correction" ? "correction" : "retrieval",
		firstAttempts: normalizeFirstAttempts(session.firstAttempts),
		attempts: Array.isArray(session.attempts) ? session.attempts : [],
		completedCardIds: normalizeStringArray(session.completedCardIds),
		unavailableCardIds: normalizeStringArray(session.unavailableCardIds),
	};
}

function normalizeFirstAttempts(value: unknown): Record<string, SpellingFirstAttempt> {
	if (!value || typeof value !== "object") return {};
	const normalized: Record<string, SpellingFirstAttempt> = {};
	for (const [cardId, attempt] of Object.entries(value)) {
		if (
			attempt &&
			typeof attempt === "object" &&
			"input" in attempt &&
			typeof attempt.input === "string" &&
			"correct" in attempt &&
			typeof attempt.correct === "boolean" &&
			"answeredAt" in attempt &&
			typeof attempt.answeredAt === "number"
		) {
			normalized[cardId] = {
				input: attempt.input,
				correct: attempt.correct,
				answeredAt: attempt.answeredAt,
			};
		}
	}
	return normalized;
}
