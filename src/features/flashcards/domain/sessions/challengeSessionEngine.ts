export type ChallengeMode = "normal" | "reversed" | "spelling" | "random";

export type ChallengeQuestionMode = Exclude<ChallengeMode, "random">;

export interface ChallengeCardRef {
	readonly identity: string;
	readonly originDeckId: string;
}

export interface ChallengePersistedQuestion extends ChallengeCardRef {
	readonly questionMode: ChallengeQuestionMode;
}

export interface ChallengeLevelResult {
	readonly levelIndex: number;
	readonly totalQuestions: number;
	readonly firstTryCorrectCount: number;
	readonly firstTryAccuracy: number;
	readonly retryCount: number;
	readonly durationSeconds: number;
	readonly timeSpent: number;
	readonly completedAt: number;
	readonly incorrectIdentities: readonly string[];
	readonly removedCardCount: number;
}

export interface ChallengeRoundProgress {
	readonly id: string;
	readonly mode: ChallengeMode;
	readonly startedAt: number;
	readonly levels: readonly (readonly ChallengePersistedQuestion[])[];
	readonly completedLevelCount: number;
	readonly completedLevels: readonly ChallengeLevelResult[];
	readonly removedIdentities: readonly string[];
}

export interface ChallengeProgress {
	readonly version: 1;
	readonly lastMode: ChallengeMode;
	readonly round: ChallengeRoundProgress | null;
}

export function selectEligibleChallengeCards(
	decks: readonly Deck[],
	wordLearningDecks: Readonly<Record<string, boolean>>,
): ChallengeCardRef[] {
	return decks.flatMap((deck) => {
		if (!wordLearningDecks[deck.id]) return [];
		return deck.cards.flatMap((card) =>
			card.fsrsCard.state !== State.New &&
			isStableCardIdentity(card.id) &&
			extractSpellingWord(card.front)
				? [{ identity: card.id, originDeckId: deck.id }]
				: [],
		);
	});
}

export interface ChallengeFeedback {
	readonly correct: false;
	readonly submittedInput?: string;
	readonly expectedAnswer?: string;
}

export interface ChallengeAttempt {
	readonly identity: string;
	readonly correct: boolean;
	readonly answeredAt: number;
}

export interface ChallengeSession {
	readonly roundId: string;
	readonly levelIndex: number;
	readonly startTime: number;
	readonly initialQuestions: readonly ChallengePersistedQuestion[];
	readonly queue: readonly ChallengePersistedQuestion[];
	readonly completedIdentities: readonly string[];
	readonly firstAttempts: Readonly<Record<string, boolean>>;
	readonly attempts: readonly ChallengeAttempt[];
	readonly incorrectIdentities: readonly string[];
	readonly removedIdentities: readonly string[];
	readonly feedback: ChallengeFeedback | null;
}

type ChallengeSessionStep =
	| { readonly type: "continue"; readonly session: ChallengeSession }
	| {
			readonly type: "complete";
			readonly session: ChallengeSession;
			readonly result: ChallengeLevelResult;
	  };

interface ChallengeHistoryEntry {
	readonly deckId: string;
	readonly deckName: "";
	readonly mode: "challenge";
	readonly cardCount: number;
	readonly duration: number;
	readonly occurredAt: number;
}

/** The paired pure effects of one real submission, ready for an atomic commit. */
export type ChallengeAnswerUpdate = ChallengeSessionStep & {
	readonly progress: ChallengeProgress;
	readonly learningActivity: Extract<LearningActivityRecord, { kind: "session" }> & {
		readonly mode: "challenge";
	};
	readonly historyEntries: readonly ChallengeHistoryEntry[];
};

const CHALLENGE_LEVEL_SIZE = 15;
const QUESTION_MODES: readonly ChallengeQuestionMode[] = ["normal", "reversed", "spelling"];

export function createChallengeProgress(params: {
	mode: ChallengeMode;
	cards: readonly ChallengeCardRef[];
	now: number;
	roundId: string;
	shuffle: (identities: string[]) => string[];
	random?: () => number;
}): ChallengeProgress | null {
	if (params.cards.length === 0) return null;
	const byIdentity = new Map(params.cards.map((card) => [card.identity, card]));
	const ordered = params
		.shuffle(params.cards.map((card) => card.identity))
		.flatMap((identity) => {
			const card = byIdentity.get(identity);
			return card ? [card] : [];
		});
	const random = params.random ?? Math.random;
	const questions = ordered.map((card) => ({
		...card,
		questionMode:
			params.mode === "random"
				? QUESTION_MODES[Math.min(QUESTION_MODES.length - 1, Math.floor(random() * 3))]!
				: params.mode,
	}));
	const levels: ChallengePersistedQuestion[][] = [];
	for (let index = 0; index < questions.length; index += CHALLENGE_LEVEL_SIZE) {
		levels.push(questions.slice(index, index + CHALLENGE_LEVEL_SIZE));
	}
	return {
		version: 1,
		lastMode: params.mode,
		round: {
			id: params.roundId,
			mode: params.mode,
			startedAt: params.now,
			levels,
			completedLevelCount: 0,
			completedLevels: [],
			removedIdentities: [],
		},
	};
}

/** Prepare the next checkpoint without counting omitted empty levels as completions. */
export function prepareChallengeLevel(params: {
	progress: ChallengeProgress;
	eligibleIdentities: ReadonlySet<string>;
	startTime: number;
}): { readonly progress: ChallengeProgress; readonly session: ChallengeSession | null } {
	const cleaned = cleanChallengeProgress(params.progress, params.eligibleIdentities);
	const round = cleaned.round ? omitEmptyFutureLevels(cleaned.round) : null;
	const progress = { ...cleaned, round };
	return {
		progress,
		session: round
			? createChallengeSession({
					round,
					questions: round.levels[round.completedLevelCount] ?? [],
					startTime: params.startTime,
				})
			: null,
	};
}

/** Reconcile an active level without advancing it when its remaining questions disappear. */
export function reconcileChallengeRound(
	progress: ChallengeProgress,
	session: ChallengeSession,
	eligibleIdentities: ReadonlySet<string>,
): { readonly progress: ChallengeProgress; readonly session: ChallengeSession | null } {
	return {
		progress: cleanChallengeProgress(progress, eligibleIdentities),
		session: reconcileChallengeSession(session, eligibleIdentities),
	};
}

function createChallengeSession(params: {
	round: ChallengeRoundProgress;
	questions: readonly ChallengePersistedQuestion[];
	startTime: number;
}): ChallengeSession | null {
	if (params.questions.length === 0) return null;
	return {
		roundId: params.round.id,
		levelIndex: params.round.completedLevelCount,
		startTime: params.startTime,
		initialQuestions: params.questions.map(cloneQuestion),
		queue: params.questions.map(cloneQuestion),
		completedIdentities: [],
		firstAttempts: {},
		attempts: [],
		incorrectIdentities: [],
		removedIdentities: [],
		feedback: null,
	};
}

export function getCurrentChallengeQuestion(
	session: ChallengeSession,
): ChallengePersistedQuestion | null {
	return session.queue[0] ?? null;
}

export function answerChallengeQuestion(params: {
	session: ChallengeSession;
	progress: ChallengeProgress;
	correct: boolean;
	now: number;
	submittedInput?: string;
	expectedAnswer?: string;
}): ChallengeAnswerUpdate {
	const step = stepChallengeQuestion(params);
	const lastAttempt =
		params.session.attempts[params.session.attempts.length - 1]?.answeredAt ??
		params.session.startTime;
	// Subtract floored cumulative time so consecutive sub-second answers retain their time.
	const durationSeconds = Math.max(
		0,
		Math.floor((params.now - params.session.startTime) / 1000) -
			Math.floor((lastAttempt - params.session.startTime) / 1000),
	);
	return {
		...step,
		progress:
			step.type === "complete"
				? completeChallengeLevel(params.progress, step.result)
				: params.progress,
		learningActivity: {
			kind: "session",
			mode: "challenge",
			completion: step.type === "complete" ? "completed" : "partial",
			answerCount: 1,
			completedAnswerCount:
				step.type === "complete" ? step.session.attempts.length : undefined,
			durationSeconds,
			occurredAt: params.now,
		},
		historyEntries:
			step.type === "complete"
				? [
						{
							deckId: params.session.roundId,
							deckName: "",
							mode: "challenge",
							cardCount: step.result.totalQuestions,
							duration: step.result.durationSeconds,
							occurredAt: params.now,
						},
					]
				: [],
	};
}

function stepChallengeQuestion(params: {
	session: ChallengeSession;
	correct: boolean;
	now: number;
	submittedInput?: string;
	expectedAnswer?: string;
}): ChallengeSessionStep {
	if (params.session.feedback) throw new Error("Challenge feedback must be continued first");
	const question = getCurrentChallengeQuestion(params.session);
	if (!question) throw new Error("Challenge session has no current question");
	const firstAttempts =
		params.session.firstAttempts[question.identity] === undefined
			? { ...params.session.firstAttempts, [question.identity]: params.correct }
			: { ...params.session.firstAttempts };
	const attempts = [
		...params.session.attempts,
		{ identity: question.identity, correct: params.correct, answeredAt: params.now },
	];
	const incorrectIdentities = params.correct
		? [...params.session.incorrectIdentities]
		: Array.from(new Set([...params.session.incorrectIdentities, question.identity]));

	if (!params.correct) {
		return {
			type: "continue",
			session: {
				...params.session,
				firstAttempts,
				attempts,
				incorrectIdentities,
				feedback: {
					correct: false,
					...(params.submittedInput === undefined
						? {}
						: { submittedInput: params.submittedInput }),
					...(params.expectedAnswer === undefined
						? {}
						: { expectedAnswer: params.expectedAnswer }),
				},
			},
		};
	}

	const nextSession: ChallengeSession = {
		...params.session,
		queue: params.session.queue.slice(1),
		completedIdentities: [...params.session.completedIdentities, question.identity],
		firstAttempts,
		attempts,
		incorrectIdentities,
	};
	if (nextSession.queue.length > 0) return { type: "continue", session: nextSession };
	return {
		type: "complete",
		session: nextSession,
		result: buildChallengeLevelResult(nextSession, params.now),
	};
}

export function continueChallengeAfterError(session: ChallengeSession): ChallengeSession {
	if (!session.feedback) throw new Error("Challenge session has no pending feedback");
	const question = getCurrentChallengeQuestion(session);
	if (!question) throw new Error("Challenge session has no current question");
	return {
		...session,
		queue: [...session.queue.slice(1), question],
		feedback: null,
	};
}

function reconcileChallengeSession(
	session: ChallengeSession,
	eligibleIdentities: ReadonlySet<string>,
): ChallengeSession | null {
	const removed = session.initialQuestions
		.filter((question) => !eligibleIdentities.has(question.identity))
		.map((question) => question.identity);
	const queue = session.queue.filter((question) => eligibleIdentities.has(question.identity));
	if (queue.length === 0) return null;
	const currentRemoved = session.queue[0] && !eligibleIdentities.has(session.queue[0].identity);
	return {
		...session,
		initialQuestions: session.initialQuestions.filter((question) =>
			eligibleIdentities.has(question.identity),
		),
		queue,
		completedIdentities: session.completedIdentities.filter((identity) =>
			eligibleIdentities.has(identity),
		),
		firstAttempts: Object.fromEntries(
			Object.entries(session.firstAttempts).filter(([identity]) =>
				eligibleIdentities.has(identity),
			),
		),
		incorrectIdentities: session.incorrectIdentities.filter((identity) =>
			eligibleIdentities.has(identity),
		),
		removedIdentities: Array.from(new Set([...session.removedIdentities, ...removed])),
		feedback: currentRemoved ? null : session.feedback,
	};
}

function completeChallengeLevel(
	progress: ChallengeProgress,
	result: ChallengeLevelResult,
): ChallengeProgress {
	if (!progress.round) throw new Error("Challenge round is unavailable");
	if (result.levelIndex !== progress.round.completedLevelCount) {
		throw new Error("Challenge level completion is out of order");
	}
	return {
		...progress,
		round: omitEmptyFutureLevels({
			...progress.round,
			completedLevelCount: progress.round.completedLevelCount + 1,
			completedLevels: [...progress.round.completedLevels, cloneLevelResult(result)],
			removedIdentities: [...progress.round.removedIdentities],
		}),
	};
}

function omitEmptyFutureLevels(round: ChallengeRoundProgress): ChallengeRoundProgress {
	return {
		...round,
		levels: [
			...round.levels.slice(0, round.completedLevelCount),
			...round.levels.slice(round.completedLevelCount).filter((level) => level.length > 0),
		],
	};
}

function cleanChallengeProgress(
	progress: ChallengeProgress,
	eligibleIdentities: ReadonlySet<string>,
): ChallengeProgress {
	if (!progress.round) return progress;
	const removed = new Set(
		progress.round.levels
			.slice(progress.round.completedLevelCount)
			.flat()
			.filter((question) => !eligibleIdentities.has(question.identity))
			.map((question) => question.identity),
	);
	return removeChallengeQuestions(progress, removed);
}

function removeChallengeQuestions(
	progress: ChallengeProgress,
	identities: ReadonlySet<string>,
): ChallengeProgress {
	if (!progress.round || identities.size === 0) return cloneChallengeProgress(progress);
	return {
		...progress,
		round: {
			...progress.round,
			levels: progress.round.levels.map((level, index) =>
				index < progress.round!.completedLevelCount
					? [...level]
					: level.filter((question) => !identities.has(question.identity)),
			),
			removedIdentities: Array.from(
				new Set([...progress.round.removedIdentities, ...identities]),
			),
		},
	};
}

export function cloneChallengeProgress(progress: ChallengeProgress): ChallengeProgress {
	return {
		version: 1,
		lastMode: progress.lastMode,
		round: progress.round
			? {
					...progress.round,
					levels: progress.round.levels.map((level) => level.map(cloneQuestion)),
					completedLevels: progress.round.completedLevels.map(cloneLevelResult),
					removedIdentities: [...progress.round.removedIdentities],
				}
			: null,
	};
}

export function normalizeChallengeProgress(value: unknown): ChallengeProgress | null {
	if (!isRecord(value) || value.version !== 1 || !isChallengeMode(value.lastMode)) return null;
	if (value.round === null) return { version: 1, lastMode: value.lastMode, round: null };
	if (!isRecord(value.round)) return null;
	const round = value.round;
	if (
		typeof round.id !== "string" ||
		!round.id ||
		!isChallengeMode(round.mode) ||
		typeof round.startedAt !== "number" ||
		!Number.isFinite(round.startedAt) ||
		!Array.isArray(round.levels) ||
		!Number.isInteger(round.completedLevelCount) ||
		!Array.isArray(round.completedLevels) ||
		!Array.isArray(round.removedIdentities)
	) {
		return null;
	}
	const levels = round.levels.map(normalizeLevel);
	if (levels.some((level) => level === null)) return null;
	const identities = (levels as ChallengePersistedQuestion[][])
		.flat()
		.map((question) => question.identity);
	if (new Set(identities).size !== identities.length) return null;
	const completedLevels = round.completedLevels.map(normalizeLevelResult);
	if (completedLevels.some((result) => result === null)) return null;
	const completedLevelCount = round.completedLevelCount as number;
	if (
		completedLevelCount < 0 ||
		completedLevelCount > levels.length ||
		completedLevels.length !== completedLevelCount ||
		completedLevels.some((result, index) => result?.levelIndex !== index) ||
		!round.removedIdentities.every((identity) => typeof identity === "string")
	) {
		return null;
	}
	return {
		version: 1,
		lastMode: value.lastMode,
		round: {
			id: round.id,
			mode: round.mode,
			startedAt: round.startedAt,
			levels: levels as ChallengePersistedQuestion[][],
			completedLevelCount,
			completedLevels: completedLevels as ChallengeLevelResult[],
			removedIdentities: [...new Set(round.removedIdentities as string[])],
		},
	};
}

function buildChallengeLevelResult(
	session: ChallengeSession,
	completedAt: number,
): ChallengeLevelResult {
	const firstTryCorrectCount = Object.values(session.firstAttempts).filter(Boolean).length;
	return {
		levelIndex: session.levelIndex,
		totalQuestions: session.initialQuestions.length,
		firstTryCorrectCount,
		firstTryAccuracy:
			session.initialQuestions.length > 0
				? (firstTryCorrectCount / session.initialQuestions.length) * 100
				: 0,
		retryCount: Math.max(
			0,
			session.attempts.length -
				new Set(session.attempts.map((attempt) => attempt.identity)).size,
		),
		durationSeconds: Math.max(0, Math.floor((completedAt - session.startTime) / 1000)),
		timeSpent: Math.max(0, Math.floor((completedAt - session.startTime) / 1000)),
		completedAt,
		incorrectIdentities: [...session.incorrectIdentities],
		removedCardCount: session.removedIdentities.length,
	};
}

function normalizeLevel(value: unknown): ChallengePersistedQuestion[] | null {
	if (!Array.isArray(value) || value.length > CHALLENGE_LEVEL_SIZE) return null;
	const questions = value.map(normalizeQuestion);
	return questions.some((question) => question === null)
		? null
		: (questions as ChallengePersistedQuestion[]);
}

function normalizeQuestion(value: unknown): ChallengePersistedQuestion | null {
	return isRecord(value) &&
		typeof value.identity === "string" &&
		value.identity.length > 0 &&
		typeof value.originDeckId === "string" &&
		value.originDeckId.length > 0 &&
		isQuestionMode(value.questionMode)
		? {
				identity: value.identity,
				originDeckId: value.originDeckId,
				questionMode: value.questionMode,
			}
		: null;
}

function normalizeLevelResult(value: unknown): ChallengeLevelResult | null {
	if (!isRecord(value) || !Array.isArray(value.incorrectIdentities)) return null;
	const numericKeys = [
		"levelIndex",
		"totalQuestions",
		"firstTryCorrectCount",
		"firstTryAccuracy",
		"retryCount",
		"durationSeconds",
		"timeSpent",
		"completedAt",
		"removedCardCount",
	] as const;
	if (
		numericKeys.some(
			(key) =>
				typeof value[key] !== "number" ||
				!Number.isFinite(value[key]) ||
				(value[key] as number) < 0,
		) ||
		!value.incorrectIdentities.every((identity) => typeof identity === "string")
	) {
		return null;
	}
	if (
		(value.firstTryCorrectCount as number) > (value.totalQuestions as number) ||
		(value.totalQuestions as number) > CHALLENGE_LEVEL_SIZE ||
		(value.firstTryAccuracy as number) > 100
	)
		return null;
	return {
		levelIndex: value.levelIndex as number,
		totalQuestions: value.totalQuestions as number,
		firstTryCorrectCount: value.firstTryCorrectCount as number,
		firstTryAccuracy: value.firstTryAccuracy as number,
		retryCount: value.retryCount as number,
		durationSeconds: value.durationSeconds as number,
		timeSpent: value.timeSpent as number,
		completedAt: value.completedAt as number,
		incorrectIdentities: [...(value.incorrectIdentities as string[])],
		removedCardCount: value.removedCardCount as number,
	};
}

function cloneQuestion(question: ChallengePersistedQuestion): ChallengePersistedQuestion {
	return { ...question };
}

function cloneLevelResult(result: ChallengeLevelResult): ChallengeLevelResult {
	return { ...result, incorrectIdentities: [...result.incorrectIdentities] };
}

function isChallengeMode(value: unknown): value is ChallengeMode {
	return value === "normal" || value === "reversed" || value === "spelling" || value === "random";
}

function isQuestionMode(value: unknown): value is ChallengeQuestionMode {
	return value === "normal" || value === "reversed" || value === "spelling";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}
import { State } from "ts-fsrs";
import type { Deck } from "../../../../core/shared/types";
import { extractSpellingWord } from "../cards/spellingWord";
import { isStableCardIdentity } from "../identity/cardIdentity";
import type { LearningActivityRecord } from "../history/dailyLearningActivity";
