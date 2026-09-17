import type { Card } from "ts-fsrs";
import type {
	CardDirection,
	FlashCard,
	StudyAnswerEvent,
	StudyRating,
	StudySession,
} from "../../../../core/shared/types";

export type { StudyRating };

export interface StudyCardSchedule {
	fsrsCard: Card;
	repeatInSession: boolean;
}

export interface StudyCardScheduler {
	rateStudyCard(card: Card, rating: StudyRating): StudyCardSchedule;
}

export interface StudyCardUpdateIntent {
	deckId: string;
	cardId: string;
	fsrsCard: Card;
}

export type StudySessionFinishReason = "completed" | "abandoned";

export interface StudySessionFinishIntent {
	reason: StudySessionFinishReason;
	deckId: string;
	mode: "study";
	cardCount: number;
	duration: number;
	incrementStudyCount: boolean;
}

export type StudySessionAnswerStep =
	| {
			type: "continue";
			session: StudySession;
			cardUpdate: StudyCardUpdateIntent;
	  }
	| {
			type: "complete";
			session: StudySession;
			cardUpdate: StudyCardUpdateIntent;
			finishIntent: StudySessionFinishIntent;
	  };

export interface StudySessionUndoStep {
	session: StudySession;
	cardUpdate: StudyCardUpdateIntent;
}

export function createStudySession(params: {
	deckId: string;
	direction?: CardDirection;
	cardIds: string[];
	startTime?: number;
}): StudySession | null {
	if (params.cardIds.length === 0) return null;

	return {
		deckId: params.deckId,
		direction: params.direction ?? "normal",
		cardQueue: [...params.cardIds],
		currentIndex: 0,
		startTime: params.startTime ?? Date.now(),
		repeatQueue: [],
		history: [],
		answerEvents: [],
		attemptCount: 0,
		unavailableCardIds: [],
	};
}

export function answerStudyCard(params: {
	session: StudySession;
	card: FlashCard;
	rating: StudyRating;
	scheduler: StudyCardScheduler;
	now?: number;
}): StudySessionAnswerStep {
	const now = params.now ?? Date.now();
	const session = normalizeStudySession(params.session);
	const scheduled = params.scheduler.rateStudyCard(params.card.fsrsCard, params.rating);
	const event: StudyAnswerEvent = {
		cardId: params.card.id,
		rating: params.rating,
		previousFsrsCard: params.card.fsrsCard,
		nextFsrsCard: scheduled.fsrsCard,
		repeatInSession: scheduled.repeatInSession,
		answeredAt: now,
		previousCurrentIndex: session.currentIndex,
		previousCardQueueLength: session.cardQueue.length,
		previousRepeatQueue: [...session.repeatQueue],
	};
	const nextSession = addAnswerEvent(session, event);
	const cardUpdate: StudyCardUpdateIntent = {
		deckId: session.deckId,
		cardId: params.card.id,
		fsrsCard: scheduled.fsrsCard,
	};

	if (nextSession.currentIndex < nextSession.cardQueue.length - 1) {
		return {
			type: "continue",
			session: {
				...nextSession,
				currentIndex: nextSession.currentIndex + 1,
			},
			cardUpdate,
		};
	}

	if (nextSession.repeatQueue.length > 0) {
		return {
			type: "continue",
			session: {
				...nextSession,
				cardQueue: [...nextSession.cardQueue, ...nextSession.repeatQueue],
				repeatQueue: [],
				currentIndex: nextSession.currentIndex + 1,
			},
			cardUpdate,
		};
	}

	return {
		type: "complete",
		session: nextSession,
		cardUpdate,
		finishIntent: buildFinishIntent(nextSession, "completed", now),
	};
}

export function undoStudyAnswer(session: StudySession): StudySessionUndoStep | null {
	const normalized = normalizeStudySession(session);
	const event = normalized.answerEvents[normalized.answerEvents.length - 1];
	if (!event || normalized.unavailableCardIds?.includes(event.cardId)) return null;

	return {
		session: {
			...normalized,
			cardQueue: normalized.cardQueue.slice(0, event.previousCardQueueLength),
			currentIndex: event.previousCurrentIndex,
			repeatQueue: [...event.previousRepeatQueue],
			history: normalized.history.slice(0, -1),
			answerEvents: normalized.answerEvents.slice(0, -1),
		},
		cardUpdate: {
			deckId: normalized.deckId,
			cardId: event.cardId,
			fsrsCard: event.previousFsrsCard,
		},
	};
}

export function finishStudySession(
	session: StudySession,
	reason: StudySessionFinishReason,
	now: number = Date.now(),
): StudySessionFinishIntent | null {
	const normalized = normalizeStudySession(session);
	if (normalized.answerEvents.length === 0) return null;

	return buildFinishIntent(normalized, reason, now);
}

export function getCurrentStudyCardId(session: StudySession): string | null {
	const normalized = normalizeStudySession(session);
	return normalized.cardQueue[normalized.currentIndex] ?? null;
}

export function getStudyProgress(session: StudySession): {
	current: number;
	total: number;
	percent: number;
	label: string;
} {
	const total = session.cardQueue.length;
	const current = total === 0 ? 0 : Math.min(session.currentIndex + 1, total);
	const percent = total === 0 ? 0 : (current / total) * 100;
	return {
		current,
		total,
		percent,
		label: `${current}/${total}`,
	};
}

export function canUndoStudyAnswer(session: StudySession): boolean {
	const normalized = normalizeStudySession(session);
	const event = normalized.answerEvents[normalized.answerEvents.length - 1];
	return Boolean(event && !normalized.unavailableCardIds?.includes(event.cardId));
}

function addAnswerEvent(session: StudySession, event: StudyAnswerEvent): StudySession {
	return {
		...session,
		attemptCount: (session.attemptCount ?? session.answerEvents.length) + 1,
		repeatQueue: event.repeatInSession
			? [...session.repeatQueue, event.cardId]
			: [...session.repeatQueue],
		history: [...session.history, event.cardId],
		answerEvents: [...session.answerEvents, event],
	};
}

function buildFinishIntent(
	session: StudySession,
	reason: StudySessionFinishReason,
	now: number,
): StudySessionFinishIntent {
	return {
		reason,
		deckId: session.deckId,
		mode: "study",
		cardCount: session.answerEvents.length,
		duration: Math.floor((now - session.startTime) / 1000),
		incrementStudyCount: reason === "completed",
	};
}

function normalizeStudySession(session: StudySession): StudySession {
	return {
		...session,
		direction: session.direction === "reversed" ? "reversed" : "normal",
		cardQueue: normalizeStringArray(session.cardQueue),
		repeatQueue: normalizeStringArray(session.repeatQueue),
		history: normalizeStringArray(session.history),
		answerEvents: Array.isArray(session.answerEvents) ? session.answerEvents : [],
		attemptCount: Math.max(0, session.attemptCount ?? session.answerEvents.length),
		unavailableCardIds: normalizeStringArray(session.unavailableCardIds),
	};
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}
