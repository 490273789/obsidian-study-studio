import { State } from "ts-fsrs";
import type {
	CardDirection,
	Deck,
	FlashCard,
	PracticeSelection,
	SpellingCardProgress,
	SpellingSelection,
	StudyDayInfo,
	StudySettings,
} from "../../../../core/shared/types";
import { shuffleArray } from "../../../../core/shared/utils";
import { extractSpellingWord, validateSpellingDeck } from "../cards/spellingWord";
import { isStableCardIdentity } from "../identity/cardIdentity";
import type { SessionStartRequest } from "./sessionLifecycle";

export interface StudySetupPlan {
	readonly dayList: StudyDayInfo[];
	readonly todayNewCount: number;
	readonly todayReviewCount: number;
	readonly completedDays: number;
	readonly allCompleted: boolean;
	readonly hasAnythingToStudy: boolean;
	readonly todayTotal: number;
	readonly defaultStudyOrder: StudySettings["studyOrder"];
}

export interface PracticeSetupPlan {
	readonly maxQuestions: number;
	readonly maxRangeStart: number;
	readonly defaultQuestionCount: number;
	readonly initialQuestionCount: number;
	readonly initialRangeStart: number;
	readonly initialRangeEnd: number;
	readonly initialSelectionMode: "random" | "range";
}

export interface SpellingSetupPlan {
	readonly stats: SpellingDeckProgressStats;
	readonly maxQuestions: number;
	readonly defaultCount: number;
	readonly initialQuestionCount: number;
	readonly initialRangeStart: number;
	readonly initialRangeEnd: number;
	readonly initialSelectionMode: "smart" | "range";
}

export type PracticeSessionPlanSource = "study-day" | "random" | "range" | "incorrect-retry";

export type ShuffleCardIds = (cardIds: string[]) => string[];

export interface PracticeSessionPlan {
	source: PracticeSessionPlanSource;
	deckId: string;
	direction: CardDirection;
	cardIds: string[];
	requestedQuestionCount?: number;
	requestedCardRange?: {
		startIndex: number;
		endIndex: number;
	};
	studyOrder?: StudySettings["studyOrder"];
}

export type SpellingSessionPlanSource = "smart" | "range" | "incorrect-retry";

export interface SpellingSessionPlan {
	source: SpellingSessionPlanSource;
	deckId: string;
	cardIds: string[];
}

export interface SpellingDeckProgressStats {
	total: number;
	unpracticed: number;
}

export interface SpellingDeckEligibility {
	enabled: boolean;
	hasStableIdentities: boolean;
	canStart: boolean;
	valid: boolean;
	ready: boolean;
	issueCount: number;
	eligibleCardIds: string[];
	invalidCards: Array<{ cardId: string; indexInFile: number; front: string }>;
}

export type SpellingShuffle = (cardIds: string[]) => string[];

export interface SessionPlanningContext {
	readonly settings: Pick<StudySettings, "dailyNewCards" | "dailyReviewCards" | "studyOrder">;
	readonly isSpellingEnabled?: boolean;
	readonly spellingProgress?: Readonly<Record<string, SpellingCardProgress>>;
	readonly shuffle?: (cardIds: string[]) => string[];
	readonly now?: Date;
}

export type SessionQueuePlanResult =
	| {
			readonly kind: "success";
			readonly cardIds: string[];
			readonly direction: CardDirection;
	  }
	| {
			readonly kind: "rejected";
			readonly reason:
				| "no-eligible-cards"
				| "spelling-not-enabled"
				| "stable-card-identity-required";
	  };

export function sortDeckCards(cards: readonly FlashCard[]): FlashCard[] {
	return [...cards].sort((a, b) => a.indexInFile - b.indexInFile);
}

export function getDayList(deck: Pick<Deck, "cards">, dailyNewCards: number): StudyDayInfo[] {
	const validDailyNew = Math.max(1, Math.floor(dailyNewCards));
	const sortedCards = sortDeckCards(deck.cards);
	const totalCards = sortedCards.length;
	if (totalCards === 0) return [];

	const numDays = Math.ceil(totalCards / validDailyNew);
	const days: StudyDayInfo[] = [];
	let foundCurrent = false;

	for (let i = 0; i < numDays; i++) {
		const start = i * validDailyNew;
		const end = Math.min(start + validDailyNew, totalCards);
		const dayCards = sortedCards.slice(start, end);
		const studiedCards = dayCards.filter((c) => c.fsrsCard.state !== State.New).length;
		const isCompleted = studiedCards === dayCards.length;
		const isCurrent = !isCompleted && !foundCurrent;
		if (isCurrent) foundCurrent = true;

		days.push({
			dayIndex: i,
			startCardIndex: start,
			endCardIndex: end,
			totalCards: dayCards.length,
			studiedCards,
			isCompleted,
			isCurrent,
			isLocked: !isCompleted && !isCurrent,
		});
	}

	return days;
}

export function getTodayStudyCounts(
	deck: Pick<Deck, "cards">,
	settings: Pick<StudySettings, "dailyNewCards" | "dailyReviewCards">,
	now: Date = new Date(),
): { newCount: number; reviewCount: number } {
	const dailyNewCards = Math.max(0, settings.dailyNewCards);
	const dailyReviewCards = Math.max(0, settings.dailyReviewCards);
	let newCards = 0;
	let dueCards = 0;

	for (const card of deck.cards) {
		if (card.fsrsCard.state === State.New) {
			newCards++;
		} else if (card.fsrsCard.due <= now) {
			dueCards++;
		}
	}

	return {
		newCount: Math.min(dailyNewCards, newCards),
		reviewCount: Math.min(dailyReviewCards, dueCards),
	};
}

export function getCardsForDay(
	deck: Pick<Deck, "cards">,
	dayIndex: number,
	dailyNewCards: number,
): FlashCard[] {
	if (dayIndex < 0) return [];
	const validDailyNew = Math.max(1, Math.floor(dailyNewCards));
	const sortedCards = sortDeckCards(deck.cards);
	const start = dayIndex * validDailyNew;
	const end = Math.min(start + validDailyNew, sortedCards.length);
	if (start >= sortedCards.length) return [];
	return sortedCards.slice(start, end);
}

export function getStudySetupPlan(
	deck: Pick<Deck, "cards">,
	settings: StudySettings,
	now: Date = new Date(),
	initialStudyOrder?: StudySettings["studyOrder"],
): StudySetupPlan {
	const dayList = getDayList(deck, settings.dailyNewCards);
	const { newCount, reviewCount } = getTodayStudyCounts(deck, settings, now);
	const completedDays = dayList.reduce((total, day) => total + (day.isCompleted ? 1 : 0), 0);
	const allCompleted = dayList.length > 0 && completedDays === dayList.length;
	const hasAnythingToStudy = newCount > 0 || reviewCount > 0;
	const todayTotal = newCount + reviewCount;

	return {
		dayList,
		todayNewCount: newCount,
		todayReviewCount: reviewCount,
		completedDays,
		allCompleted,
		hasAnythingToStudy,
		todayTotal,
		defaultStudyOrder: initialStudyOrder ?? settings.studyOrder,
	};
}

export function getPracticeSetupPlan(
	deck: Pick<Deck, "cards">,
	initialSelection?: PracticeSelection,
): PracticeSetupPlan {
	const maxQuestions = deck.cards.length;
	const maxRangeStart = Math.max(1, maxQuestions - 1);
	const defaultQuestionCount = Math.min(50, maxQuestions);
	const initialQuestionCount =
		initialSelection?.kind === "random"
			? Math.min(initialSelection.questionCount, maxQuestions)
			: defaultQuestionCount;
	const initialRangeStart =
		initialSelection?.kind === "range"
			? Math.min(Math.max(1, initialSelection.startIndex), maxRangeStart)
			: 1;
	const initialRangeEnd =
		initialSelection?.kind === "range"
			? Math.min(initialSelection.endIndex, maxQuestions)
			: defaultQuestionCount;

	return {
		maxQuestions,
		maxRangeStart,
		defaultQuestionCount,
		initialQuestionCount,
		initialRangeStart,
		initialRangeEnd,
		initialSelectionMode: initialSelection?.kind === "range" ? "range" : "random",
	};
}

export function getSpellingSetupPlan(
	deck: Pick<Deck, "cards">,
	progress: Readonly<Record<string, SpellingCardProgress>>,
	initialSelection?: SpellingSelection,
): SpellingSetupPlan {
	const stats = getSpellingDeckProgressStats(deck.cards, progress);
	const maxQuestions = stats.total;
	const defaultCount = Math.min(20, maxQuestions);
	const initialQuestionCount =
		initialSelection?.kind === "smart"
			? Math.min(initialSelection.questionCount, maxQuestions)
			: defaultCount;
	const initialRangeStart =
		initialSelection?.kind === "range"
			? Math.min(Math.max(1, initialSelection.startIndex), Math.max(1, maxQuestions))
			: 1;
	const initialRangeEnd =
		initialSelection?.kind === "range"
			? Math.min(initialSelection.endIndex, maxQuestions)
			: defaultCount;

	return {
		stats,
		maxQuestions,
		defaultCount,
		initialQuestionCount,
		initialRangeStart,
		initialRangeEnd,
		initialSelectionMode: initialSelection?.kind === "range" ? "range" : "smart",
	};
}

export function evaluateSpellingDeckEligibility(
	deck: Pick<Deck, "cards">,
	enabled: boolean,
): SpellingDeckEligibility {
	const validation = validateSpellingDeck(deck);
	const unstableCardIds = deck.cards
		.filter((card) => !isStableCardIdentity(card.id))
		.map((card) => card.id);
	const issueCount = new Set([
		...validation.invalidCards.map((card) => card.cardId),
		...unstableCardIds,
	]).size;
	const hasStableIdentities = unstableCardIds.length === 0;

	return {
		enabled,
		hasStableIdentities,
		canStart: validation.canStart,
		valid: validation.valid,
		ready: enabled && hasStableIdentities && validation.canStart,
		issueCount,
		eligibleCardIds: validation.eligibleCardIds,
		invalidCards: validation.invalidCards,
	};
}

export function getSpellingDeckProgressStats(
	cards: readonly FlashCard[],
	progress: Readonly<Record<string, SpellingCardProgress>>,
): SpellingDeckProgressStats {
	const eligibleCards = cards.filter((card) => extractSpellingWord(card.front) !== null);
	let unpracticed = 0;
	for (const card of eligibleCards) {
		const cardProgress = progress[card.id];
		if (!cardProgress || cardProgress.attempts === 0) {
			unpracticed++;
		}
	}
	return { total: eligibleCards.length, unpracticed };
}

export function planDayPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	studyOrder: StudySettings["studyOrder"];
	shuffle?: ShuffleCardIds;
}): PracticeSessionPlan {
	const cardIds = getCardIds(params.cards);

	return {
		source: "study-day",
		deckId: params.deckId,
		direction: params.direction,
		cardIds:
			params.studyOrder === "random" ? (params.shuffle ?? shuffleArray)(cardIds) : cardIds,
		studyOrder: params.studyOrder,
	};
}

export function planRandomPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	questionCount: number;
	shuffle?: ShuffleCardIds;
}): PracticeSessionPlan {
	const questionLimit = normalizeQuestionLimit(params.questionCount, params.cards.length);
	const cardIds = (params.shuffle ?? shuffleArray)(getCardIds(params.cards)).slice(
		0,
		questionLimit,
	);

	return {
		source: "random",
		deckId: params.deckId,
		direction: params.direction,
		cardIds,
		requestedQuestionCount: params.questionCount,
	};
}

export function planRangePracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cards: FlashCard[];
	startIndex: number;
	endIndex: number;
	shuffle?: ShuffleCardIds;
}): PracticeSessionPlan {
	const range = normalizeCardRange(params.startIndex, params.endIndex, params.cards.length);
	const rangedCards = range ? params.cards.slice(range.startIndex - 1, range.endIndex) : [];
	const cardIds = (params.shuffle ?? shuffleArray)(getCardIds(rangedCards));

	return {
		source: "range",
		deckId: params.deckId,
		direction: params.direction,
		cardIds,
		requestedCardRange: {
			startIndex: params.startIndex,
			endIndex: params.endIndex,
		},
	};
}

export function planIncorrectPracticeSession(params: {
	deckId: string;
	direction: CardDirection;
	cardIds: string[];
	shuffle?: ShuffleCardIds;
}): PracticeSessionPlan {
	return {
		source: "incorrect-retry",
		deckId: params.deckId,
		direction: params.direction,
		cardIds: (params.shuffle ?? shuffleArray)(Array.from(new Set(params.cardIds))),
	};
}

export function planSmartSpellingSession(params: {
	deckId: string;
	cards: FlashCard[];
	progress: Readonly<Record<string, SpellingCardProgress>>;
	questionCount: number;
	random?: () => number;
}): SpellingSessionPlan {
	const random = params.random ?? Math.random;
	const ranked = params.cards.map((card) => ({
		card,
		tieBreaker: random(),
		progress: params.progress[card.id],
	}));
	ranked.sort((left, right) => {
		const leftRank = getProgressRank(left.progress);
		const rightRank = getProgressRank(right.progress);
		return (
			leftRank.priority - rightRank.priority ||
			leftRank.correctStreak - rightRank.correctStreak ||
			leftRank.accuracy - rightRank.accuracy ||
			leftRank.lastAttemptAt - rightRank.lastAttemptAt ||
			left.tieBreaker - right.tieBreaker
		);
	});

	return {
		source: "smart",
		deckId: params.deckId,
		cardIds: ranked
			.slice(0, normalizeQuestionLimit(params.questionCount, params.cards.length))
			.map(({ card }) => card.id),
	};
}

export function planRangeSpellingSession(params: {
	deckId: string;
	cards: FlashCard[];
	startIndex: number;
	endIndex: number;
	shuffle?: SpellingShuffle;
}): SpellingSessionPlan {
	const range = normalizeCardRange(params.startIndex, params.endIndex, params.cards.length);
	const cardIds = range
		? params.cards.slice(range.startIndex - 1, range.endIndex).map((card) => card.id)
		: [];
	return {
		source: "range",
		deckId: params.deckId,
		cardIds: (params.shuffle ?? shuffleArray)(cardIds),
	};
}

export function planIncorrectSpellingSession(params: {
	deckId: string;
	cardIds: string[];
	shuffle?: SpellingShuffle;
}): SpellingSessionPlan {
	return {
		source: "incorrect-retry",
		deckId: params.deckId,
		cardIds: (params.shuffle ?? shuffleArray)(Array.from(new Set(params.cardIds))),
	};
}

export type RetryIncorrectSessionPlanResult =
	| {
			readonly kind: "success";
			readonly cardIds: string[];
			readonly direction: CardDirection;
			readonly omittedCardCount: number;
	  }
	| {
			readonly kind: "rejected";
			readonly reason: "no-retryable-cards";
	  };

export function planRetryIncorrectSession(params: {
	mode: "practice" | "spelling";
	direction: CardDirection;
	incorrectCardIdentities: readonly string[];
	getCard: (cardId: string) => FlashCard | null | undefined;
	shuffle?: ShuffleCardIds;
}): RetryIncorrectSessionPlanResult {
	const retryableCards: FlashCard[] = [];
	for (const identity of params.incorrectCardIdentities) {
		const card = params.getCard(identity);
		if (card && (params.mode === "practice" || extractSpellingWord(card.front) !== null)) {
			retryableCards.push(card);
		}
	}

	if (retryableCards.length === 0) {
		return { kind: "rejected", reason: "no-retryable-cards" };
	}

	const omittedCardCount = params.incorrectCardIdentities.length - retryableCards.length;
	const shuffle = params.shuffle ?? shuffleArray;
	const uniqueCardIds = Array.from(new Set(retryableCards.map((c) => c.id)));
	const cardIds = shuffle(uniqueCardIds);

	return {
		kind: "success",
		cardIds,
		direction: params.mode === "practice" ? params.direction : "normal",
		omittedCardCount,
	};
}

export function planSessionQueue(
	request: Exclude<SessionStartRequest, { mode: "challenge" }>,
	deck: Deck,
	context: SessionPlanningContext,
): SessionQueuePlanResult {
	const shuffle = context.shuffle ?? shuffleArray;

	if (request.mode === "study") {
		const direction: CardDirection = request.direction ?? "normal";
		const studyOrder = request.studyOrder ?? context.settings.studyOrder;
		const now = context.now ?? new Date();
		const newCards: FlashCard[] = [];
		const dueCards: FlashCard[] = [];

		for (const card of deck.cards) {
			if (card.fsrsCard.state === State.New) {
				newCards.push(card);
			} else if (card.fsrsCard.due <= now) {
				dueCards.push(card);
			}
		}

		const dailyNew = Math.max(0, context.settings.dailyNewCards);
		const dailyReview = Math.max(0, context.settings.dailyReviewCards);
		const selectedNew = newCards.slice(0, dailyNew);
		const selectedDue = dueCards.slice(0, dailyReview);
		let cardIds = [...selectedNew, ...selectedDue].map((card) => card.id);

		if (studyOrder === "random") {
			cardIds = shuffle(cardIds);
		}

		if (cardIds.length === 0) {
			return { kind: "rejected", reason: "no-eligible-cards" };
		}
		return { kind: "success", cardIds, direction };
	}

	if (request.mode === "practice") {
		const direction: CardDirection = request.direction;
		let plan: PracticeSessionPlan;

		if (request.selection.kind === "study-day") {
			plan = planDayPracticeSession({
				deckId: request.deckId,
				direction,
				cards: getCardsForDay(
					deck,
					request.selection.dayIndex,
					context.settings.dailyNewCards,
				),
				studyOrder: request.selection.studyOrder,
				shuffle,
			});
		} else if (request.selection.kind === "range") {
			plan = planRangePracticeSession({
				deckId: request.deckId,
				direction,
				cards: deck.cards,
				startIndex: request.selection.startIndex,
				endIndex: request.selection.endIndex,
				shuffle,
			});
		} else {
			plan = planRandomPracticeSession({
				deckId: request.deckId,
				direction,
				cards: deck.cards,
				questionCount: request.selection.questionCount,
				shuffle,
			});
		}

		if (plan.cardIds.length === 0) {
			return { kind: "rejected", reason: "no-eligible-cards" };
		}
		return { kind: "success", cardIds: plan.cardIds, direction };
	}

	// mode === "spelling"
	const isEnabled = Boolean(context.isSpellingEnabled);
	const eligibility = evaluateSpellingDeckEligibility(deck, isEnabled);
	if (!eligibility.enabled) {
		return { kind: "rejected", reason: "spelling-not-enabled" };
	}
	if (!eligibility.hasStableIdentities) {
		return { kind: "rejected", reason: "stable-card-identity-required" };
	}

	const eligibleCardIdSet = new Set(eligibility.eligibleCardIds);
	const eligibleCards = deck.cards.filter((card) => eligibleCardIdSet.has(card.id));
	let cardIds: string[];

	if (request.selection.kind === "study-day") {
		const dayCards = getCardsForDay(
			deck,
			request.selection.dayIndex,
			context.settings.dailyNewCards,
		);
		const eligibleDayCards = dayCards.filter((card) => eligibleCardIdSet.has(card.id));
		cardIds = shuffle(eligibleDayCards.map((card) => card.id));
	} else if (request.selection.kind === "range") {
		const plan = planRangeSpellingSession({
			deckId: request.deckId,
			cards: eligibleCards,
			startIndex: request.selection.startIndex,
			endIndex: request.selection.endIndex,
			shuffle,
		});
		cardIds = plan.cardIds;
	} else {
		const plan = planSmartSpellingSession({
			deckId: request.deckId,
			cards: eligibleCards,
			progress: context.spellingProgress ?? {},
			questionCount: request.selection.questionCount,
		});
		cardIds = plan.cardIds;
	}

	if (cardIds.length === 0) {
		return { kind: "rejected", reason: "no-eligible-cards" };
	}
	return { kind: "success", cardIds, direction: "normal" };
}

function getCardIds(cards: FlashCard[]): string[] {
	return cards.map((card) => card.id);
}

function getProgressRank(progress: SpellingCardProgress | undefined): {
	priority: number;
	correctStreak: number;
	accuracy: number;
	lastAttemptAt: number;
} {
	if (!progress || progress.attempts === 0) {
		return {
			priority: 1,
			correctStreak: 0,
			accuracy: 0,
			lastAttemptAt: 0,
		};
	}
	return {
		priority: progress.correctStreak === 0 ? 0 : 2,
		correctStreak: progress.correctStreak,
		accuracy: progress.correctAttempts / progress.attempts,
		lastAttemptAt: progress.lastAttemptAt,
	};
}

function normalizeQuestionLimit(questionCount: number, cardCount: number): number {
	if (!Number.isFinite(questionCount)) return 0;
	return Math.max(0, Math.min(cardCount, Math.floor(questionCount)));
}

function normalizeCardRange(
	startIndex: number,
	endIndex: number,
	cardCount: number,
): { startIndex: number; endIndex: number } | null {
	if (
		!Number.isFinite(startIndex) ||
		!Number.isFinite(endIndex) ||
		!Number.isFinite(cardCount) ||
		cardCount < 1
	) {
		return null;
	}
	const normalizedStart = Math.max(1, Math.floor(startIndex));
	const normalizedEnd = Math.min(cardCount, Math.floor(endIndex));
	if (normalizedStart > normalizedEnd) return null;
	return { startIndex: normalizedStart, endIndex: normalizedEnd };
}
