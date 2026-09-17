import type {
	CardDirection,
	FlashCard,
	PracticeResult,
	PracticeSession,
	StudySettings,
} from "../../../../core/shared/types";
import {
	planDayPracticeSession,
	planIncorrectPracticeSession,
	planRangePracticeSession,
	planRandomPracticeSession,
	type PracticeSessionPlan,
	type ShuffleCardIds,
} from "./sessionPlanner";

export {
	answerStudyCard,
	canUndoStudyAnswer,
	createStudySession,
	finishStudySession,
	getCurrentStudyCardId,
	getStudyProgress,
	undoStudyAnswer,
} from "./studySessionEngine";
export type {
	StudyCardSchedule,
	StudyCardScheduler,
	StudyCardUpdateIntent,
	StudySessionFinishIntent,
} from "./studySessionEngine";
export {
	planDayPracticeSession,
	planIncorrectPracticeSession,
	planRangePracticeSession,
	planRandomPracticeSession,
} from "./sessionPlanner";
export type {
	PracticeSessionPlan,
	PracticeSessionPlanSource,
	ShuffleCardIds,
} from "./sessionPlanner";

export type PracticeSessionStep =
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

export function createPracticeSessionFromPlan(params: {
	plan: PracticeSessionPlan;
	startTime: number;
}): PracticeSession {
	return createPracticeSession({
		deckId: params.plan.deckId,
		direction: params.plan.direction,
		cardIds: params.plan.cardIds,
		startTime: params.startTime,
	});
}

export function createDayPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	studyOrder: StudySettings["studyOrder"];
	startTime?: number;
	shuffle?: ShuffleCardIds;
}): PracticeSession {
	const plan = planDayPracticeSession({
		deckId: params.deckId,
		direction: params.direction,
		cards: params.cards,
		studyOrder: params.studyOrder,
		shuffle: params.shuffle,
	});

	return createPracticeSessionFromPlan({
		plan,
		startTime: params.startTime ?? Date.now(),
	});
}

export function createRandomPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	questionCount: number;
	startTime?: number;
	shuffle?: ShuffleCardIds;
}): PracticeSession {
	const plan = planRandomPracticeSession({
		deckId: params.deckId,
		direction: params.direction,
		cards: params.cards,
		questionCount: params.questionCount,
		shuffle: params.shuffle,
	});

	return createPracticeSessionFromPlan({
		plan,
		startTime: params.startTime ?? Date.now(),
	});
}

export function createRangePracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	startIndex: number;
	endIndex: number;
	startTime?: number;
	shuffle?: ShuffleCardIds;
}): PracticeSession {
	const plan = planRangePracticeSession({
		deckId: params.deckId,
		direction: params.direction,
		cards: params.cards,
		startIndex: params.startIndex,
		endIndex: params.endIndex,
		shuffle: params.shuffle,
	});

	return createPracticeSessionFromPlan({
		plan,
		startTime: params.startTime ?? Date.now(),
	});
}

export function createIncorrectPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cardIds: string[];
	startTime?: number;
	shuffle?: ShuffleCardIds;
}): PracticeSession {
	const plan = planIncorrectPracticeSession({
		deckId: params.deckId,
		direction: params.direction,
		cardIds: params.cardIds,
		shuffle: params.shuffle,
	});

	return createPracticeSessionFromPlan({
		plan,
		startTime: params.startTime ?? Date.now(),
	});
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

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
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
