import { normalizeStringArray } from "../../../../core/shared/utils";
import type { CardDirection, PracticeResult, PracticeSession } from "../../../../core/shared/types";

type PracticeSessionStep =
	| {
			type: "continue";
			session: PracticeSession;
	  }
	| {
			type: "complete";
			result: PracticeResult;
	  };

export function createPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cardIds: string[];
	startTime: number;
}): PracticeSession {
	return {
		deckId: params.deckId,
		direction: params.direction,
		cardQueue: [...params.cardIds],
		currentIndex: 0,
		startTime: params.startTime,
		totalQuestions: params.cardIds.length,
		answers: {},
		history: [],
		attemptCount: 0,
		unavailableCardIds: [],
	};
}

export function answerPracticeCard(params: {
	session: PracticeSession;
	cardId: string;
	isCorrect: boolean;
	now: number;
}): PracticeSessionStep {
	const session = normalizePracticeSession(params.session);
	const answers = {
		...session.answers,
		[params.cardId]: params.isCorrect,
	};
	const nextSession: PracticeSession = {
		...session,
		attemptCount: (session.attemptCount ?? session.history.length) + 1,
		answers,
		history: [...session.history, params.cardId],
	};

	if (nextSession.currentIndex < nextSession.cardQueue.length - 1) {
		return {
			type: "continue",
			session: {
				...nextSession,
				currentIndex: nextSession.currentIndex + 1,
			},
		};
	}

	const unavailableCardIds = new Set(nextSession.unavailableCardIds ?? []);
	const incorrectCardIds = Object.entries(answers)
		.filter(([cardId, correct]) => !correct && !unavailableCardIds.has(cardId))
		.map(([cardId]) => cardId);
	const correctCount = Object.values(answers).filter(Boolean).length;
	const incorrectCount = nextSession.totalQuestions - correctCount;
	const accuracy =
		nextSession.totalQuestions > 0 ? (correctCount / nextSession.totalQuestions) * 100 : 0;

	return {
		type: "complete",
		result: {
			direction: nextSession.direction,
			totalQuestions: nextSession.totalQuestions,
			correctCount,
			incorrectCount,
			accuracy,
			incorrectCardIds,
			timeSpent: Math.floor((params.now - nextSession.startTime) / 1000),
		},
	};
}

export function previousPracticeCard(session: PracticeSession): PracticeSession | null {
	const normalized = normalizePracticeSession(session);
	const unavailableCardIds = new Set(normalized.unavailableCardIds);
	const historyIndex = normalized.history.findLastIndex(
		(cardId) => normalized.cardQueue.includes(cardId) && !unavailableCardIds.has(cardId),
	);
	if (historyIndex === -1) return null;
	const previousCardId = normalized.history[historyIndex];
	const previousIndex = previousCardId ? normalized.cardQueue.indexOf(previousCardId) : -1;
	if (!previousCardId || previousIndex === -1) return null;
	const answers = { ...normalized.answers };
	delete answers[previousCardId];

	const history = normalized.history.slice();
	history.splice(historyIndex, 1);

	return {
		...normalized,
		currentIndex: previousIndex,
		answers,
		history,
	};
}

function normalizePracticeSession(session: PracticeSession): PracticeSession {
	return {
		...session,
		direction: session.direction === "reversed" ? "reversed" : "normal",
		cardQueue: normalizeStringArray(session.cardQueue),
		answers: normalizeAnswerMap(session.answers),
		history: normalizeStringArray(session.history),
		attemptCount: Math.max(0, session.attemptCount ?? session.history.length),
		unavailableCardIds: normalizeStringArray(session.unavailableCardIds),
	};
}

function normalizeAnswerMap(value: unknown): Record<string, boolean> {
	if (!value || typeof value !== "object") return {};

	const answers: Record<string, boolean> = {};
	for (const [cardId, answer] of Object.entries(value)) {
		if (typeof answer === "boolean") {
			answers[cardId] = answer;
		}
	}
	return answers;
}
