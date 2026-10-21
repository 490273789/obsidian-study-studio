import { errorMessage } from "../../../../core/shared/utils";
import {
	buildSpellingDiff,
	extractSpellingWord,
	isSpellingAnswerCorrect,
	type SpellingDiffSegment,
} from "../cards/spellingWord";
import type {
	ContinuitySessionAdapter,
	ContinuitySessionChange,
} from "../identity/cardIdentityContinuity";
import type {
	CardDirection,
	Deck,
	FlashCard,
	PracticeSelection,
	PracticeResult,
	PracticeSession,
	SessionOriginDeckSnapshot,
	SpellingResult,
	SpellingSelection,
	SpellingSession,
	StudyRating,
	StudySession,
	StudySettings,
} from "../../../../core/shared/types";
import { shuffleArray } from "../../../../core/shared/utils";
import {
	answerStudyCard,
	canUndoStudyAnswer,
	createStudySession,
	getCurrentStudyCardId,
	getStudyProgress,
	undoStudyAnswer,
} from "./studySessionEngine";
import {
	answerPracticeCard,
	createPracticeSession,
	previousPracticeCard,
} from "./practiceSessionEngine";
import {
	answerSpellingCard,
	createSpellingSession,
	getCurrentSpellingCardId,
} from "./spellingSessionEngine";
import { planRetryIncorrectSession, planSessionQueue } from "./sessionPlanner";
import {
	answerChallengeQuestion,
	continueChallengeAfterError,
	createChallengeProgress,
	getCurrentChallengeQuestion,
	prepareChallengeLevel,
	reconcileChallengeRound,
	selectEligibleChallengeCards,
	type ChallengeFeedback,
	type ChallengeLevelResult,
	type ChallengeMode,
	type ChallengeProgress,
	type ChallengeQuestionMode,
	type ChallengeSession,
} from "./challengeSessionEngine";

export interface SessionCardSnapshot {
	readonly identity: string;
	readonly currentDeckId: string;
	readonly currentDeckName?: string;
	readonly front: string;
	readonly back: string;
	readonly explanation?: string;
	readonly sourceFile: string;
	readonly indexInFile: number;
}

interface SessionProgressSnapshot {
	readonly current: number;
	readonly completed: number;
	readonly total: number;
	readonly percent: number;
	readonly label: string;
}

interface ReferenceBase {
	readonly revision: number;
	readonly key: string;
}

interface IdleLifecycleReference extends ReferenceBase {
	readonly kind: "idle";
}

export interface ActiveStudyReference extends ReferenceBase {
	readonly kind: "active";
	readonly mode: "study";
}

export interface ActivePracticeReference extends ReferenceBase {
	readonly kind: "active";
	readonly mode: "practice";
}

export interface ActiveSpellingReference extends ReferenceBase {
	readonly kind: "active";
	readonly mode: "spelling";
}

export interface ActiveChallengeReference extends ReferenceBase {
	readonly kind: "active";
	readonly mode: "challenge";
}

interface StudyResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "study";
}

interface PracticeResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "practice";
}

interface SpellingResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "spelling";
}

interface ChallengeResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "challenge";
}

export type LifecycleReference =
	| IdleLifecycleReference
	| ActiveStudyReference
	| ActivePracticeReference
	| ActiveSpellingReference
	| ActiveChallengeReference
	| StudyResultReference
	| PracticeResultReference
	| SpellingResultReference
	| ChallengeResultReference;

interface SourceChangeEndSnapshot {
	readonly id: string;
	readonly reason: "source-change";
	readonly mode: "study" | "practice" | "spelling" | "challenge";
	readonly originDeck?: Readonly<SessionOriginDeckSnapshot>;
	readonly answerEventCount: number;
}

interface IdleLifecycleSnapshot {
	readonly kind: "idle";
	readonly revision: number;
	readonly reference: IdleLifecycleReference;
	readonly lastEnd: SourceChangeEndSnapshot | null;
}

interface ActiveSnapshotBase {
	readonly kind: "active";
	readonly revision: number;
	readonly originDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly startTime: number;
	readonly currentCard: Readonly<SessionCardSnapshot>;
	readonly progress: Readonly<SessionProgressSnapshot>;
	readonly answerEventCount: number;
}

export interface ActiveStudySnapshot extends ActiveSnapshotBase {
	readonly mode: "study";
	readonly reference: ActiveStudyReference;
	readonly direction: CardDirection;
	readonly canPrevious: boolean;
}

export interface ActivePracticeSnapshot extends ActiveSnapshotBase {
	readonly mode: "practice";
	readonly reference: ActivePracticeReference;
	readonly direction: CardDirection;
	readonly canPrevious: boolean;
}

export interface ActiveSpellingSnapshot extends ActiveSnapshotBase {
	readonly mode: "spelling";
	readonly reference: ActiveSpellingReference;
	readonly phase: "retrieval" | "correction";
}

interface ChallengeRoundProgressSnapshot {
	readonly level: number;
	readonly totalLevels: number;
	readonly passedInLevel: number;
	readonly currentLevelTotal: number;
	readonly completedAcrossRound: number;
	readonly totalAcrossRound: number;
}

export interface ActiveChallengeSnapshot {
	readonly kind: "active";
	readonly mode: "challenge";
	readonly revision: number;
	readonly reference: ActiveChallengeReference;
	readonly startTime: number;
	readonly currentCard: Readonly<SessionCardSnapshot>;
	readonly sourceDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly questionMode: ChallengeQuestionMode;
	readonly phase: "question" | "feedback";
	readonly feedback: ChallengeFeedback | null;
	readonly progress: Readonly<SessionProgressSnapshot>;
	readonly roundProgress: Readonly<ChallengeRoundProgressSnapshot>;
	readonly answerEventCount: number;
	readonly removedCardCount: number;
}

type ActiveLifecycleSnapshot =
	| ActiveStudySnapshot
	| ActivePracticeSnapshot
	| ActiveSpellingSnapshot
	| ActiveChallengeSnapshot;

export type { PracticeSelection, SpellingSelection };

export type SessionStartRequest =
	| {
			readonly mode: "study";
			readonly deckId: string;
			readonly studyOrder: StudySettings["studyOrder"];
			readonly direction: CardDirection;
	  }
	| {
			readonly mode: "practice";
			readonly deckId: string;
			readonly direction: CardDirection;
			readonly selection: PracticeSelection;
	  }
	| {
			readonly mode: "spelling";
			readonly deckId: string;
			readonly selection: SpellingSelection;
	  }
	| {
			readonly mode: "challenge";
			readonly challengeMode: ChallengeMode;
			readonly intent: "new" | "continue";
			readonly expectedRoundId?: string | null;
	  };

/** Mode-neutral restart provenance: session facts, no view-route vocabulary. */
export type SessionRestartOrigin =
	| {
			readonly mode: "study";
			readonly deckId: string;
			readonly studyOrder: StudySettings["studyOrder"];
			readonly direction: CardDirection;
	  }
	| {
			readonly mode: "practice";
			readonly deckId: string;
			readonly direction: CardDirection;
			readonly selection: PracticeSelection;
	  }
	| {
			readonly mode: "spelling";
			readonly deckId: string;
			readonly selection: SpellingSelection;
	  }
	| { readonly mode: "challenge"; readonly challengeMode: ChallengeMode };

export interface StudyResultSnapshot {
	readonly kind: "result";
	readonly mode: "study";
	readonly revision: number;
	readonly reference: StudyResultReference;
	readonly originDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly completedAt: number;
	readonly cardCount: number;
	readonly totalReviews: number;
	readonly timeSpent: number;
	readonly ratingCounts: Record<StudyRating, number>;
	readonly restartOrigin: Readonly<Extract<SessionRestartOrigin, { mode: "study" }>>;
}

export interface PracticeResultSnapshot {
	readonly kind: "result";
	readonly mode: "practice";
	readonly revision: number;
	readonly reference: PracticeResultReference;
	readonly originDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly completedAt: number;
	readonly direction: CardDirection;
	readonly totalQuestions: number;
	readonly correctCount: number;
	readonly incorrectCount: number;
	readonly accuracy: number;
	readonly timeSpent: number;
	readonly incorrectCards: readonly Readonly<SessionCardSnapshot>[];
	readonly restartOrigin: Readonly<Extract<SessionRestartOrigin, { mode: "practice" }>>;
}

export interface SpellingIncorrectCardSnapshot extends SessionCardSnapshot {
	readonly firstInput: string;
	readonly expectedAnswer: string;
}

export interface SpellingResultSnapshot {
	readonly kind: "result";
	readonly mode: "spelling";
	readonly revision: number;
	readonly reference: SpellingResultReference;
	readonly originDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly completedAt: number;
	readonly totalWords: number;
	readonly firstTryCorrectCount: number;
	readonly firstTryIncorrectCount: number;
	readonly firstTryAccuracy: number;
	readonly totalRetrievalAttempts: number;
	readonly timeSpent: number;
	readonly incorrectCards: readonly Readonly<SpellingIncorrectCardSnapshot>[];
	readonly restartOrigin: Readonly<Extract<SessionRestartOrigin, { mode: "spelling" }>>;
}

interface ChallengeRoundSummarySnapshot {
	readonly completedLevels: number;
	readonly totalLevels: number;
	readonly totalQuestions: number;
	readonly firstTryCorrectCount: number;
	readonly retryCount: number;
	readonly timeSpent: number;
}

export interface ChallengeResultSnapshot {
	readonly kind: "result";
	readonly mode: "challenge";
	readonly revision: number;
	readonly reference: ChallengeResultReference;
	readonly completedAt: number;
	readonly levelResult: Readonly<ChallengeLevelResult>;
	readonly roundSummary: Readonly<ChallengeRoundSummarySnapshot>;
	readonly incorrectCards: readonly Readonly<SessionCardSnapshot>[];
	readonly roundComplete: boolean;
	readonly canContinue: boolean;
	readonly removedCardCount: number;
	readonly restartOrigin: Readonly<Extract<SessionRestartOrigin, { mode: "challenge" }>>;
}

type ResultLifecycleSnapshot =
	| StudyResultSnapshot
	| PracticeResultSnapshot
	| SpellingResultSnapshot
	| ChallengeResultSnapshot;

export type SessionLifecycleSnapshot =
	| IdleLifecycleSnapshot
	| ActiveLifecycleSnapshot
	| ResultLifecycleSnapshot;

type StudyLifecycleAction =
	| { readonly kind: "answer"; readonly rating: StudyRating }
	| { readonly kind: "previous" }
	| { readonly kind: "exit" };

type PracticeLifecycleAction =
	| { readonly kind: "answer"; readonly correct: boolean }
	| { readonly kind: "previous" }
	| { readonly kind: "exit" };

type SpellingLifecycleAction =
	| { readonly kind: "answer"; readonly input: string }
	| { readonly kind: "exit" };

export type ChallengeLifecycleAction =
	| { readonly kind: "answer"; readonly correct: boolean }
	| { readonly kind: "answer"; readonly input: string }
	| { readonly kind: "reveal" }
	| { readonly kind: "continue" }
	| { readonly kind: "exit" };

type ResultLifecycleAction =
	| { readonly kind: "retry-incorrect" }
	| { readonly kind: "next-level" }
	| { readonly kind: "restart-challenge" }
	| { readonly kind: "dismiss" };

type IdleLifecycleAction = {
	readonly kind: "acknowledge-end";
	readonly noticeId: string;
};

export type ActionFor<R extends LifecycleReference> = R extends ActiveStudyReference
	? StudyLifecycleAction
	: R extends ActivePracticeReference
		? PracticeLifecycleAction
		: R extends ActiveSpellingReference
			? SpellingLifecycleAction
			: R extends ActiveChallengeReference
				? ChallengeLifecycleAction
				: R extends
							| StudyResultReference
							| PracticeResultReference
							| SpellingResultReference
							| ChallengeResultReference
					? ResultLifecycleAction
					: R extends IdleLifecycleReference
						? IdleLifecycleAction
						: never;

export interface SpellingLifecycleFeedback {
	readonly kind:
		| "retrieval-correct"
		| "retrieval-incorrect"
		| "correction-correct"
		| "correction-incorrect";
	readonly submittedInput: string;
	readonly expectedAnswer: string;
	readonly diff: readonly SpellingDiffSegment[];
}

export type LifecycleRejection =
	| "busy"
	| "stale-reference"
	| "invalid-state"
	| "action-not-available"
	| "deck-not-found"
	| "no-eligible-cards"
	| "no-retryable-cards"
	| "spelling-not-enabled"
	| "stable-card-identity-required"
	| "current-card-unavailable"
	| "no-challenge-progress"
	| "challenge-progress-changed"
	| "notice-mismatch";

export type LifecycleOutcome =
	| {
			readonly kind: "applied";
			readonly snapshot: SessionLifecycleSnapshot;
			readonly feedback?: SpellingLifecycleFeedback;
			readonly omittedCardCount?: number;
	  }
	| {
			readonly kind: "rejected";
			readonly reason: LifecycleRejection;
			readonly snapshot: SessionLifecycleSnapshot;
	  }
	| {
			readonly kind: "failed";
			readonly failure: {
				readonly code: "persistence-failed" | "read-failed" | "invariant-violated";
				readonly message: string;
				readonly retryable: boolean;
			};
			readonly snapshot: SessionLifecycleSnapshot;
	  };

export type {
	SessionCardSchedule,
	SessionChallengeCommit,
	SessionCommit,
	SessionCommitResult,
	SessionPersistencePort,
	SessionPersistenceReceipt,
	SessionRecord,
	SessionSourceChange,
	SessionSpellingAttempt,
} from "./sessionPersistence";
export type SessionLifecycleRepository = SessionPersistencePort;
import type {
	SessionCardSchedule,
	SessionChallengeCommit,
	SessionCommit,
	SessionPersistencePort,
	SessionPersistenceReceipt,
	SessionRecord,
	SessionSourceChange,
	SessionSpellingAttempt,
} from "./sessionPersistence";

export interface SessionLifecycle {
	getSnapshot(): SessionLifecycleSnapshot;
	subscribe(listener: () => void): () => void;
	start(request: SessionStartRequest): Promise<LifecycleOutcome>;
	/** Releases the repository source-change subscription; the lifecycle is inert after it. */
	dispose(): void;
	act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome>;
}

interface SessionLifecycleWiring {
	readonly lifecycle: SessionLifecycle;
	readonly continuitySessions: ContinuitySessionAdapter;
}

interface CreateSessionLifecycleOptions {
	now?: () => number;
	shuffle?: (identities: string[]) => string[];
	random?: () => number;
}

type InternalActiveState =
	| {
			kind: "active";
			mode: "study";
			key: string;
			session: StudySession;
			restartOrigin: Extract<SessionRestartOrigin, { mode: "study" }>;
	  }
	| {
			kind: "active";
			mode: "practice";
			key: string;
			session: PracticeSession;
			restartOrigin: Extract<SessionRestartOrigin, { mode: "practice" }>;
	  }
	| {
			kind: "active";
			mode: "spelling";
			key: string;
			session: SpellingSession;
			restartOrigin: Extract<SessionRestartOrigin, { mode: "spelling" }>;
	  }
	| {
			kind: "active";
			mode: "challenge";
			key: string;
			session: ChallengeSession;
			progress: ChallengeProgress;
			progressRevision: number;
			/** Deck-structure revision the active round was last reconciled against. */
			structureRevision: number;
			restartOrigin: Extract<SessionRestartOrigin, { mode: "challenge" }>;
	  };

type InternalResultState =
	| {
			kind: "result";
			mode: "study";
			key: string;
			originDeck: SessionOriginDeckSnapshot;
			completedAt: number;
			cardCount: number;
			totalReviews: number;
			timeSpent: number;
			ratingCounts: Record<StudyRating, number>;
			restartOrigin: Extract<SessionRestartOrigin, { mode: "study" }>;
	  }
	| {
			kind: "result";
			mode: "practice";
			key: string;
			originDeck: SessionOriginDeckSnapshot;
			completedAt: number;
			result: PracticeResult;
			incorrectCards: SessionCardSnapshot[];
			restartOrigin: Extract<SessionRestartOrigin, { mode: "practice" }>;
	  }
	| {
			kind: "result";
			mode: "spelling";
			key: string;
			originDeck: SessionOriginDeckSnapshot;
			completedAt: number;
			result: SpellingResult;
			incorrectCards: SpellingIncorrectCardSnapshot[];
			restartOrigin: Extract<SessionRestartOrigin, { mode: "spelling" }>;
	  }
	| {
			kind: "result";
			mode: "challenge";
			key: string;
			completedAt: number;
			levelResult: ChallengeLevelResult;
			progress: ChallengeProgress;
			incorrectCards: SessionCardSnapshot[];
			restartOrigin: Extract<SessionRestartOrigin, { mode: "challenge" }>;
	  };

type InternalState =
	| { kind: "idle"; key: string; lastEnd: SourceChangeEndSnapshot | null }
	| InternalActiveState
	| InternalResultState;

type AnyLifecycleAction =
	| StudyLifecycleAction
	| PracticeLifecycleAction
	| SpellingLifecycleAction
	| ChallengeLifecycleAction
	| ResultLifecycleAction
	| IdleLifecycleAction;

class PersistenceFailure extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
	}
}

/** A durable transition the repository semantically rejected, not an infrastructure failure. */
class SessionCommitRejection extends Error {
	constructor(readonly reason: LifecycleRejection) {
		super(reason);
		this.name = "SessionCommitRejection";
	}
}

export function createSessionLifecycle(
	repository: SessionLifecycleRepository,
	options: CreateSessionLifecycleOptions = {},
): SessionLifecycleWiring {
	const implementation = new DefaultSessionLifecycle(repository, options);
	return {
		lifecycle: implementation,
		continuitySessions: implementation,
	};
}

class DefaultSessionLifecycle implements SessionLifecycle, ContinuitySessionAdapter {
	private state: InternalState = { kind: "idle", key: "idle-0", lastEnd: null };
	private revision = 0;
	private nextKey = 1;
	private snapshot: SessionLifecycleSnapshot = makeIdleSnapshot(0, "idle-0", null);
	private readonly listeners = new Set<() => void>();
	private busyDone: Promise<void> | null = null;
	private releaseBusy: (() => void) | null = null;
	private busyKind: "interactive" | "background" | null = null;
	private sourceReconcilePending = false;
	private unsubscribeSourceChanges: (() => void) | null = null;
	private disposed = false;
	private readonly now: () => number;
	private readonly shuffle: (identities: string[]) => string[];
	private readonly random: () => number;
	private challengeCardsCache: {
		structureRevision: number;
		cards: ReadonlyMap<string, { card: FlashCard; deck: Deck }>;
	} | null = null;

	constructor(
		private readonly repository: SessionLifecycleRepository,
		options: CreateSessionLifecycleOptions,
	) {
		this.now = options.now ?? Date.now;
		this.shuffle = options.shuffle ?? shuffleArray;
		this.random = options.random ?? Math.random;
		this.unsubscribeSourceChanges = repository.subscribeSourceChanges((change) =>
			this.sourceChanged(change),
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.sourceReconcilePending = false;
		this.unsubscribeSourceChanges?.();
		this.unsubscribeSourceChanges = null;
		this.listeners.clear();
	}

	getSnapshot(): SessionLifecycleSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(request: SessionStartRequest): Promise<LifecycleOutcome> {
		if (!(await this.acquireInteractive())) return this.rejected("busy");
		try {
			if (this.state.kind !== "idle") return this.rejected("invalid-state");
			if (request.mode === "challenge") return await this.startChallenge(request);
			const deck = this.repository.getDeck(request.deckId);
			if (!deck) return this.rejected("deck-not-found");
			const active = this.createActiveState(request, deck);
			if (!active) return this.rejected("no-eligible-cards");
			this.publish(active);
			return this.applied();
		} catch (error) {
			if (error instanceof SessionCommitRejection) return this.rejected(error.reason);
			return error instanceof PersistenceFailure
				? this.failed("persistence-failed", error, error.retryable)
				: this.failed("read-failed", error, true);
		} finally {
			this.unlock();
		}
	}

	async act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome> {
		if (!(await this.acquireInteractive())) return this.rejected("busy");
		try {
			if (!this.matchesReference(reference)) return this.rejected("stale-reference");
			return await this.applyAction(action as AnyLifecycleAction);
		} catch (error) {
			if (error instanceof SessionCommitRejection) return this.rejected(error.reason);
			return error instanceof PersistenceFailure
				? this.failed("persistence-failed", error, error.retryable)
				: this.failed("invariant-violated", error, false);
		} finally {
			this.unlock();
		}
	}

	hasActiveSession(): boolean {
		return this.state.kind === "active";
	}

	async reconcile(change: ContinuitySessionChange): Promise<void> {
		await this.acquireBackground();
		try {
			if (this.state.kind !== "active") return;
			const current = this.state;
			// Challenge state is reconciled from the repository source-change channel,
			// which already observed the continuity commit that produced this change.
			if (current.mode === "challenge") return;
			const reconciled = reconcileActiveState(current, change);
			if (reconciled) {
				this.publish(reconciled);
				return;
			}

			const answerEventCount = getAnswerEventCount(current);
			const activityAnswerCount = getActivityAnswerCount(current);
			if (activityAnswerCount > 0) {
				const occurredAt = this.now();
				await this.commit({
					records: [
						this.buildSessionRecord(current, {
							completed: false,
							occurredAt,
							answerCount: activityAnswerCount,
							durationSeconds: Math.max(
								0,
								Math.floor((occurredAt - current.session.startTime) / 1000),
							),
							cardCount: answerEventCount,
						}),
					],
				});
			}
			const originDeck = getOriginDeck(current.session);
			this.publish({
				kind: "idle",
				key: this.makeKey("idle"),
				lastEnd: {
					id: this.makeKey("source-change"),
					reason: "source-change",
					mode: current.mode,
					originDeck,
					answerEventCount,
				},
			});
		} finally {
			this.unlock();
		}
	}

	private challengeCards(): ReadonlyMap<string, { card: FlashCard; deck: Deck }> {
		// Eligibility depends on card text and deck membership, not on FSRS state.
		// Keying on the deck-structure revision keeps this map warm between answers.
		const structureRevision = this.repository.getDeckStructureRevision();
		if (this.challengeCardsCache?.structureRevision === structureRevision)
			return this.challengeCardsCache.cards;
		const decks = this.repository.getAllDecks();
		const eligible = new Set(
			selectEligibleChallengeCards(
				decks,
				this.repository.getSettings().wordLearningDecks,
			).map((ref) => ref.identity),
		);
		const cards = new Map(
			decks.flatMap((deck) =>
				deck.cards
					.filter((card) => eligible.has(card.id))
					.map((card) => [card.id, { card, deck }] as const),
			),
		);
		this.challengeCardsCache = { structureRevision, cards };
		return cards;
	}

	private async startChallenge(
		request: Extract<SessionStartRequest, { mode: "challenge" }>,
	): Promise<LifecycleOutcome> {
		const saved = this.repository.getChallengeProgress();
		if (
			request.expectedRoundId !== undefined &&
			request.expectedRoundId !== (saved?.round?.id ?? null)
		)
			return this.rejected("stale-reference");
		const now = this.now();
		const cards = this.challengeCards();
		const initialProgress =
			request.intent === "new"
				? createChallengeProgress({
						mode: request.challengeMode,
						cards: [...cards].map(([identity, { deck }]) => ({
							identity,
							originDeckId: deck.id,
						})),
						now,
						roundId: `challenge-${now}-${this.makeKey("round")}-${this.random()}`,
						shuffle: this.shuffle,
						random: this.random,
					})
				: saved;
		if (!initialProgress?.round)
			return this.rejected(
				request.intent === "continue" ? "no-challenge-progress" : "no-eligible-cards",
			);
		if (request.intent === "continue" && initialProgress.round.mode !== request.challengeMode)
			return this.rejected("invalid-state");
		const { progress, session } = prepareChallengeLevel({
			progress: initialProgress,
			eligibleIdentities: new Set(cards.keys()),
			startTime: now,
		});
		if (!session) {
			if (request.intent === "new") return this.rejected("no-eligible-cards");
			await this.commit({
				challenge: { progress: { ...progress, round: null }, expectedProgress: saved },
			});
			this.endChallengeBySourceChange(0);
			return this.applied();
		}
		const receipt = await this.commit({
			challenge: { progress, expectedProgress: saved },
		});
		this.publish({
			kind: "active",
			mode: "challenge",
			key: this.makeKey("challenge"),
			session,
			progress,
			progressRevision: receipt.challengeProgressRevision,
			structureRevision: this.repository.getDeckStructureRevision(),
			restartOrigin: { mode: "challenge", challengeMode: request.challengeMode },
		});
		return this.applied();
	}

	private endChallengeBySourceChange(answerEventCount: number): void {
		this.publish({
			kind: "idle",
			key: this.makeKey("idle"),
			lastEnd: {
				id: this.makeKey("source-change"),
				reason: "source-change",
				mode: "challenge",
				answerEventCount,
			},
		});
	}

	private async revalidateActiveChallenge(
		state: Extract<InternalActiveState, { mode: "challenge" }>,
	): Promise<boolean> {
		if (this.repository.getChallengeProgressRevision() !== state.progressRevision) {
			this.endChallengeBySourceChange(state.session.attempts.length);
			return true;
		}
		// Nothing about card content or deck membership changed since the last
		// reconciliation, so there is nothing to re-derive. This also absorbs the
		// revision echo produced by the session's own answer commit.
		if (this.repository.getDeckStructureRevision() === state.structureRevision) return false;
		const cards = this.challengeCards();
		const { progress, session } = reconcileChallengeRound(
			state.progress,
			state.session,
			new Set(cards.keys()),
		);
		const changed =
			progress.round!.removedIdentities.length !==
			state.progress.round!.removedIdentities.length;
		if (!session) {
			await this.commit({
				challenge: {
					progress: { ...progress, round: null },
					expectedProgress: state.progress,
				},
			});
			this.endChallengeBySourceChange(state.session.attempts.length);
			return true;
		}
		let progressRevision = state.progressRevision;
		if (changed) {
			const receipt = await this.commit({
				challenge: { progress, expectedProgress: state.progress },
			});
			progressRevision = receipt.challengeProgressRevision;
		}
		const oldCard = this.snapshot.kind === "active" ? this.snapshot.currentCard : null;
		const current = cards.get(session.queue[0]!.identity)!;
		const contentChanged =
			!oldCard ||
			oldCard.front !== current.card.front ||
			oldCard.back !== current.card.back ||
			(oldCard.explanation ?? "") !== (current.card.explanation ?? "") ||
			oldCard.currentDeckId !== current.deck.id;
		if (changed || contentChanged) {
			this.publish({
				...state,
				progress,
				progressRevision,
				structureRevision: this.repository.getDeckStructureRevision(),
				session: contentChanged ? { ...session, feedback: null } : session,
			});
			return true;
		}
		return false;
	}

	private async applyChallengeAction(
		state: Extract<InternalActiveState, { mode: "challenge" }>,
		action: AnyLifecycleAction,
	): Promise<LifecycleOutcome> {
		if (await this.revalidateActiveChallenge(state)) return this.rejected("stale-reference");
		if (action.kind === "continue") {
			if (!state.session.feedback) return this.rejected("action-not-available");
			this.publish({ ...state, session: continueChallengeAfterError(state.session) });
			return this.applied();
		}
		if (state.session.feedback || (action.kind !== "answer" && action.kind !== "reveal"))
			return this.rejected("action-not-available");
		const question = getCurrentChallengeQuestion(state.session)!;
		const found = this.challengeCards().get(question.identity);
		if (!found) return this.rejected("current-card-unavailable");
		const expectedAnswer = extractSpellingWord(found.card.front)!;
		let correct: boolean;
		let submittedInput: string | undefined;
		if (question.questionMode === "spelling") {
			if (action.kind === "reveal") correct = false;
			else if ("input" in action) {
				submittedInput = action.input;
				correct = isSpellingAnswerCorrect(action.input, expectedAnswer);
			} else return this.rejected("action-not-available");
		} else {
			if (action.kind !== "answer" || !("correct" in action))
				return this.rejected("action-not-available");
			correct = action.correct;
		}
		const now = this.now();
		const step = answerChallengeQuestion({
			session: state.session,
			progress: state.progress,
			correct,
			now,
			submittedInput,
			expectedAnswer,
		});
		const receipt = await this.commit({
			challenge: { progress: step.progress, expectedProgress: state.progress },
			records: [step.record],
		});
		if (step.type === "complete") {
			this.publish({
				kind: "result",
				mode: "challenge",
				key: this.makeKey("challenge-result"),
				completedAt: now,
				levelResult: step.result,
				progress: step.progress,
				incorrectCards: step.result.incorrectIdentities.flatMap((identity) => {
					const entry = this.challengeCards().get(identity);
					return entry
						? [
								{
									...snapshotCard(entry.card),
									currentDeckId: entry.deck.id,
									currentDeckName: entry.deck.name,
								},
							]
						: [];
				}),
				restartOrigin: state.restartOrigin,
			});
		} else
			this.publish({
				...state,
				progress: step.progress,
				progressRevision: receipt.challengeProgressRevision,
				session: step.session,
			});
		return this.applied();
	}

	private buildChallengeSnapshot(
		state: Extract<InternalActiveState, { mode: "challenge" }>,
	): ActiveChallengeSnapshot {
		const question = getCurrentChallengeQuestion(state.session)!;
		const entry = this.challengeCards().get(question.identity);
		if (!entry) throw new Error("Challenge current card is unavailable");
		const round = state.progress.round!;
		const completed = state.session.completedIdentities.length;
		const total = state.session.initialQuestions.length;
		return {
			kind: "active",
			mode: "challenge",
			revision: this.revision,
			reference: {
				kind: "active",
				mode: "challenge",
				revision: this.revision,
				key: state.key,
			},
			startTime: state.session.startTime,
			currentCard: {
				...snapshotCard(entry.card),
				currentDeckId: entry.deck.id,
				currentDeckName: entry.deck.name,
			},
			sourceDeck: { id: entry.deck.id, name: entry.deck.name },
			questionMode: question.questionMode,
			phase: state.session.feedback ? "feedback" : "question",
			feedback: state.session.feedback,
			progress: {
				current: completed + 1,
				completed,
				total,
				percent: total ? (completed / total) * 100 : 0,
				label: `${completed}/${total}`,
			},
			roundProgress: {
				level: state.session.levelIndex + 1,
				totalLevels: round.levels.length,
				passedInLevel: completed,
				currentLevelTotal: total,
				completedAcrossRound:
					round.completedLevels.reduce((sum, level) => sum + level.totalQuestions, 0) +
					completed,
				totalAcrossRound: round.levels.reduce((sum, level) => sum + level.length, 0),
			},
			answerEventCount: state.session.attempts.length,
			removedCardCount: round.removedIdentities.length,
		};
	}

	private buildChallengeResultSnapshot(
		state: Extract<InternalResultState, { mode: "challenge" }>,
	): ChallengeResultSnapshot {
		const round = state.progress.round!;
		const totals = round.completedLevels.reduce(
			(sum, level) => ({
				totalQuestions: sum.totalQuestions + level.totalQuestions,
				firstTryCorrectCount: sum.firstTryCorrectCount + level.firstTryCorrectCount,
				retryCount: sum.retryCount + level.retryCount,
				timeSpent: sum.timeSpent + level.durationSeconds,
			}),
			{ totalQuestions: 0, firstTryCorrectCount: 0, retryCount: 0, timeSpent: 0 },
		);
		return {
			kind: "result",
			mode: "challenge",
			revision: this.revision,
			reference: {
				kind: "result",
				mode: "challenge",
				revision: this.revision,
				key: state.key,
			},
			completedAt: state.completedAt,
			levelResult: state.levelResult,
			roundSummary: {
				...totals,
				completedLevels: round.completedLevels.length,
				totalLevels: round.levels.length,
			},
			incorrectCards: state.incorrectCards,
			roundComplete: round.completedLevelCount >= round.levels.length,
			canContinue: round.completedLevelCount < round.levels.length,
			removedCardCount: round.removedIdentities.length,
			restartOrigin: state.restartOrigin,
		};
	}

	private createActiveState(
		request: Exclude<SessionStartRequest, { mode: "challenge" }>,
		deck: Deck,
	): InternalActiveState | null {
		const originDeck = { id: deck.id, name: deck.name };
		const key = this.makeKey(request.mode);
		const planResult = planSessionQueue(request, deck, {
			settings: this.repository.getEffectiveStudySettings(request.deckId),
			isSpellingEnabled: Boolean(
				this.repository.getSettings().wordLearningDecks[request.deckId],
			),
			spellingProgress: this.repository.getSpellingProgress(),
			now: new Date(this.now()),
			shuffle: this.shuffle,
		});

		if (planResult.kind === "rejected") {
			if (planResult.reason === "no-eligible-cards") return null;
			throw new StartRejectionError(planResult.reason);
		}

		if (request.mode === "study") {
			const session = createStudySession({
				deckId: request.deckId,
				direction: planResult.direction,
				cardIds: planResult.cardIds,
				startTime: this.now(),
			});
			return session
				? {
						kind: "active",
						mode: "study",
						key,
						session: { ...session, originDeck },
						restartOrigin: toRestartOrigin(request),
					}
				: null;
		}

		if (request.mode === "practice") {
			return {
				kind: "active",
				mode: "practice",
				key,
				session: {
					...createPracticeSession({
						deckId: request.deckId,
						direction: planResult.direction,
						cardIds: planResult.cardIds,
						startTime: this.now(),
					}),
					originDeck,
				},
				restartOrigin: toRestartOrigin(request),
			};
		}

		return {
			kind: "active",
			mode: "spelling",
			key,
			session: {
				...createSpellingSession({
					deckId: request.deckId,
					cardIds: planResult.cardIds,
					startTime: this.now(),
				}),
				originDeck,
			},
			restartOrigin: toRestartOrigin(request),
		};
	}

	private async applyAction(action: AnyLifecycleAction): Promise<LifecycleOutcome> {
		if (this.state.kind === "idle") return this.applyIdleAction(action);
		if (this.state.kind === "result") return this.applyResultAction(action);
		if (action.kind === "exit") return this.exitActive(this.state);
		if (this.state.mode === "challenge") return this.applyChallengeAction(this.state, action);
		if (this.state.mode === "study") return this.applyStudyAction(this.state, action);
		if (this.state.mode === "practice") return this.applyPracticeAction(this.state, action);
		return this.applySpellingAction(this.state, action);
	}

	private applyIdleAction(action: AnyLifecycleAction): LifecycleOutcome {
		const state = this.state;
		if (state.kind !== "idle") return this.rejected("invalid-state");
		if (action.kind !== "acknowledge-end") return this.rejected("action-not-available");
		if (!state.lastEnd || state.lastEnd.id !== action.noticeId) {
			return this.rejected("notice-mismatch");
		}
		this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
		return this.applied();
	}

	private async applyStudyAction(
		state: Extract<InternalActiveState, { mode: "study" }>,
		action: AnyLifecycleAction,
	): Promise<LifecycleOutcome> {
		if (action.kind === "previous") {
			const step = undoStudyAnswer(state.session);
			if (!step) return this.rejected("action-not-available");
			await this.commit({ cardSchedules: [step.cardUpdate] });
			this.publish({ ...state, session: step.session });
			return this.applied();
		}
		if (action.kind !== "answer" || !("rating" in action)) {
			return this.rejected("action-not-available");
		}
		const cardId = getCurrentStudyCardId(state.session);
		const card = cardId ? this.repository.getCard(state.session.deckId, cardId) : undefined;
		if (!card) return this.rejected("current-card-unavailable");
		const now = this.now();
		const step = answerStudyCard({
			session: state.session,
			card,
			rating: action.rating,
			scheduler: this.repository,
			now,
		});
		const commit = emptyCommit();
		commit.cardSchedules.push(step.cardUpdate);
		if (step.type === "complete") {
			commit.records.push(
				this.buildSessionRecord(state, {
					completed: true,
					occurredAt: now,
					answerCount: step.session.attemptCount ?? step.session.answerEvents.length,
					durationSeconds: step.finishIntent.duration,
					cardCount: step.finishIntent.cardCount,
				}),
			);
		}
		await this.commit(commit);
		if (step.type === "complete") {
			const ratingCounts: Record<StudyRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
			for (const event of step.session.answerEvents) {
				ratingCounts[event.rating] = (ratingCounts[event.rating] ?? 0) + 1;
			}
			const uniqueCardCount = new Set(step.session.answerEvents.map((event) => event.cardId))
				.size;
			this.publish({
				kind: "result",
				mode: "study",
				key: this.makeKey("study-result"),
				originDeck: getOriginDeck(state.session),
				completedAt: now,
				cardCount: uniqueCardCount,
				totalReviews: step.session.answerEvents.length,
				timeSpent: step.finishIntent.duration,
				ratingCounts,
				restartOrigin: state.restartOrigin,
			});
		} else {
			this.publish({ ...state, session: step.session });
		}
		return this.applied();
	}

	private async applyPracticeAction(
		state: Extract<InternalActiveState, { mode: "practice" }>,
		action: AnyLifecycleAction,
	): Promise<LifecycleOutcome> {
		if (action.kind === "previous") {
			const session = previousPracticeCard(state.session);
			if (!session) return this.rejected("action-not-available");
			this.publish({ ...state, session });
			return this.applied();
		}
		if (action.kind !== "answer" || !("correct" in action)) {
			return this.rejected("action-not-available");
		}
		const cardId = state.session.cardQueue[state.session.currentIndex];
		const card = cardId ? this.repository.getCard(state.session.deckId, cardId) : undefined;
		if (!card) return this.rejected("current-card-unavailable");
		const now = this.now();
		const step = answerPracticeCard({
			session: state.session,
			cardId: card.id,
			isCorrect: action.correct,
			now,
		});
		if (step.type === "continue") {
			this.publish({ ...state, session: step.session });
			return this.applied();
		}
		const incorrectCards = this.snapshotCards(
			state.session.deckId,
			step.result.incorrectCardIds,
		);
		await this.commit({
			records: [
				this.buildSessionRecord(state, {
					completed: true,
					occurredAt: now,
					answerCount: (state.session.attemptCount ?? state.session.history.length) + 1,
					durationSeconds: step.result.timeSpent,
					cardCount: step.result.totalQuestions,
				}),
			],
		});
		this.publish({
			kind: "result",
			mode: "practice",
			key: this.makeKey("practice-result"),
			originDeck: getOriginDeck(state.session),
			completedAt: now,
			result: step.result,
			incorrectCards,
			restartOrigin: state.restartOrigin,
		});
		return this.applied();
	}

	private async applySpellingAction(
		state: Extract<InternalActiveState, { mode: "spelling" }>,
		action: AnyLifecycleAction,
	): Promise<LifecycleOutcome> {
		if (action.kind !== "answer" || !("input" in action)) {
			return this.rejected("action-not-available");
		}
		const cardId = getCurrentSpellingCardId(state.session);
		const card = cardId ? this.repository.getCard(state.session.deckId, cardId) : undefined;
		const expectedAnswer = card ? extractSpellingWord(card.front) : null;
		if (!card || !expectedAnswer) return this.rejected("current-card-unavailable");
		const now = this.now();
		const correct = isSpellingAnswerCorrect(action.input, expectedAnswer);
		const step = answerSpellingCard({
			session: state.session,
			cardId: card.id,
			input: action.input,
			isCorrect: correct,
			now,
		});
		const commit = emptyCommit();
		if (state.session.phase === "retrieval") {
			commit.spellingAttempts.push({
				cardId: card.id,
				correct,
				attemptedAt: now,
			});
		}
		if (step.type === "complete") {
			commit.records.push(
				this.buildSessionRecord(state, {
					completed: true,
					occurredAt: now,
					answerCount: state.session.attempts.length + 1,
					durationSeconds: step.result.timeSpent,
					cardCount: step.result.totalWords,
				}),
			);
		}
		if (hasCommitContent(commit)) await this.commit(commit);
		const feedback: SpellingLifecycleFeedback = {
			kind: step.feedback,
			submittedInput: action.input,
			expectedAnswer,
			diff: buildSpellingDiff(action.input, expectedAnswer),
		};
		if (step.type === "continue") {
			this.publish({ ...state, session: step.session });
		} else {
			this.publish({
				kind: "result",
				mode: "spelling",
				key: this.makeKey("spelling-result"),
				originDeck: getOriginDeck(state.session),
				completedAt: now,
				result: step.result,
				incorrectCards: this.snapshotSpellingCards(state.session, step.result),
				restartOrigin: state.restartOrigin,
			});
		}
		return this.applied(feedback);
	}

	private async applyResultAction(action: AnyLifecycleAction): Promise<LifecycleOutcome> {
		const state = this.state;
		if (state.kind !== "result") return this.rejected("invalid-state");
		if (action.kind === "dismiss") {
			this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
			return this.applied();
		}
		if (state.mode === "challenge") {
			if (action.kind !== "next-level" && action.kind !== "restart-challenge")
				return this.rejected("action-not-available");
			return this.startChallenge({
				mode: "challenge",
				challengeMode: state.restartOrigin.challengeMode,
				intent: action.kind === "next-level" ? "continue" : "new",
				expectedRoundId: state.progress.round?.id ?? null,
			});
		}
		if (state.mode === "study" || action.kind !== "retry-incorrect") {
			return this.rejected("action-not-available");
		}
		const planResult = planRetryIncorrectSession({
			mode: state.mode,
			direction: state.mode === "practice" ? state.result.direction : "normal",
			incorrectCardIdentities: state.incorrectCards.map((card) => card.identity),
			getCard: (cardId) => this.repository.getCard(state.originDeck.id, cardId),
			shuffle: this.shuffle,
		});
		if (planResult.kind === "rejected") {
			return this.rejected(planResult.reason);
		}

		if (state.mode === "practice") {
			this.publish({
				kind: "active",
				mode: "practice",
				key: this.makeKey("practice"),
				session: {
					...createPracticeSession({
						deckId: state.originDeck.id,
						direction: planResult.direction,
						cardIds: planResult.cardIds,
						startTime: this.now(),
					}),
					originDeck: state.originDeck,
				},
				restartOrigin: state.restartOrigin,
			});
		} else {
			this.publish({
				kind: "active",
				mode: "spelling",
				key: this.makeKey("spelling"),
				session: {
					...createSpellingSession({
						deckId: state.originDeck.id,
						cardIds: planResult.cardIds,
						startTime: this.now(),
					}),
					originDeck: state.originDeck,
				},
				restartOrigin: state.restartOrigin,
			});
		}
		return this.applied(undefined, planResult.omittedCardCount);
	}

	private async exitActive(state: InternalActiveState): Promise<LifecycleOutcome> {
		if (state.mode === "challenge") {
			this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
			return this.applied();
		}
		const answerEventCount = getAnswerEventCount(state);
		const activityAnswerCount = getActivityAnswerCount(state);
		if (activityAnswerCount > 0) {
			const occurredAt = this.now();
			await this.commit({
				records: [
					this.buildSessionRecord(state, {
						completed: false,
						occurredAt,
						answerCount: activityAnswerCount,
						durationSeconds: Math.max(
							0,
							Math.floor((occurredAt - state.session.startTime) / 1000),
						),
						cardCount: answerEventCount,
					}),
				],
			});
		}
		this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
		return this.applied();
	}

	private buildSessionRecord(
		state: Exclude<InternalActiveState, { mode: "challenge" }>,
		options: {
			completed: boolean;
			occurredAt: number;
			answerCount: number;
			durationSeconds: number;
			cardCount: number;
		},
	): SessionRecord {
		const originDeck = getOriginDeck(state.session);
		const durationSeconds = Math.max(0, Math.floor(options.durationSeconds));
		return {
			mode: state.mode,
			deckId: originDeck.id,
			deckName: originDeck.name,
			occurredAt: options.occurredAt,
			activity: {
				completion: options.completed ? "completed" : "partial",
				answerCount: Math.max(0, Math.floor(options.answerCount)),
				durationSeconds,
			},
			history:
				options.cardCount > 0
					? {
							cardCount: options.cardCount,
							durationSeconds,
						}
					: null,
		};
	}

	private snapshotCards(deckId: string, identities: readonly string[]): SessionCardSnapshot[] {
		return identities.flatMap((identity) => {
			const card = this.repository.getCard(deckId, identity);
			return card ? [snapshotCard(card)] : [];
		});
	}

	private snapshotSpellingCards(
		session: SpellingSession,
		result: SpellingResult,
	): SpellingIncorrectCardSnapshot[] {
		return result.incorrectCardIds.flatMap((identity) => {
			const card = this.repository.getCard(session.deckId, identity);
			const expectedAnswer = card ? extractSpellingWord(card.front) : null;
			return card && expectedAnswer
				? [
						{
							...snapshotCard(card),
							firstInput: result.firstInputs[identity] ?? "",
							expectedAnswer,
						},
					]
				: [];
		});
	}

	private async commit(commit: SessionCommit): Promise<SessionPersistenceReceipt> {
		try {
			const result = await this.repository.commitSession(commit);
			if (result.kind === "applied") return result.receipt;
			if (result.kind === "rejected")
				throw new SessionCommitRejection(
					result.reason === "challenge-progress-changed"
						? "challenge-progress-changed"
						: "current-card-unavailable",
				);
			throw new PersistenceFailure(result.message, result.retryable);
		} catch (error) {
			if (error instanceof SessionCommitRejection || error instanceof PersistenceFailure)
				throw error;
			throw new PersistenceFailure(errorMessage(error), true);
		}
	}

	private publish(state: InternalState): void {
		if (this.disposed) return;
		this.state = state;
		this.revision++;
		this.snapshot = this.buildSnapshot();
		for (const listener of this.listeners) listener();
	}

	private buildSnapshot(): SessionLifecycleSnapshot {
		if (this.state.kind === "idle") {
			return makeIdleSnapshot(this.revision, this.state.key, this.state.lastEnd);
		}
		if (this.state.kind === "result") return this.buildResultSnapshot(this.state);
		if (this.state.mode === "challenge") return this.buildChallengeSnapshot(this.state);
		const cardId =
			this.state.mode === "study"
				? getCurrentStudyCardId(this.state.session)
				: this.state.mode === "spelling"
					? getCurrentSpellingCardId(this.state.session)
					: (this.state.session.cardQueue[this.state.session.currentIndex] ?? null);
		const card = cardId
			? this.repository.getCard(this.state.session.deckId, cardId)
			: undefined;
		if (!card) throw new Error("Active session current card is unavailable");
		const common = {
			kind: "active" as const,
			revision: this.revision,
			originDeck: getOriginDeck(this.state.session),
			startTime: this.state.session.startTime,
			currentCard: snapshotCard(card),
			answerEventCount: getAnswerEventCount(this.state),
		};
		if (this.state.mode === "study") {
			const progress = getStudyProgress(this.state.session);
			return {
				...common,
				mode: "study",
				reference: {
					kind: "active",
					mode: "study",
					revision: this.revision,
					key: this.state.key,
				},
				direction: this.state.session.direction,
				canPrevious: canUndoStudyAnswer(this.state.session),
				progress: {
					...progress,
					completed: this.state.session.answerEvents.length,
				},
			};
		}
		if (this.state.mode === "practice") {
			const total = this.state.session.totalQuestions;
			const current = Math.min(this.state.session.currentIndex + 1, total);
			return {
				...common,
				mode: "practice",
				reference: {
					kind: "active",
					mode: "practice",
					revision: this.revision,
					key: this.state.key,
				},
				direction: this.state.session.direction,
				canPrevious: previousPracticeCard(this.state.session) !== null,
				progress: {
					current,
					completed: this.state.session.history.length,
					total,
					percent: total > 0 ? (current / total) * 100 : 0,
					label: `${current}/${total}`,
				},
			};
		}
		const total = this.state.session.selectedCardIds.length;
		const completed = this.state.session.completedCardIds.length;
		return {
			...common,
			mode: "spelling",
			reference: {
				kind: "active",
				mode: "spelling",
				revision: this.revision,
				key: this.state.key,
			},
			phase: this.state.session.phase,
			progress: {
				current: completed,
				completed,
				total,
				percent: total > 0 ? (completed / total) * 100 : 0,
				label: `${completed}/${total}`,
			},
		};
	}

	private buildResultSnapshot(state: InternalResultState): ResultLifecycleSnapshot {
		if (state.mode === "challenge") return this.buildChallengeResultSnapshot(state);
		if (state.mode === "study") {
			return {
				kind: "result",
				mode: "study",
				revision: this.revision,
				reference: {
					kind: "result",
					mode: "study",
					revision: this.revision,
					key: state.key,
				},
				originDeck: state.originDeck,
				completedAt: state.completedAt,
				cardCount: state.cardCount,
				totalReviews: state.totalReviews,
				timeSpent: state.timeSpent,
				ratingCounts: state.ratingCounts,
				restartOrigin: state.restartOrigin,
			};
		}
		if (state.mode === "practice") {
			return {
				kind: "result",
				mode: "practice",
				revision: this.revision,
				reference: {
					kind: "result",
					mode: "practice",
					revision: this.revision,
					key: state.key,
				},
				originDeck: state.originDeck,
				completedAt: state.completedAt,
				...state.result,
				incorrectCards: state.incorrectCards,
				restartOrigin: state.restartOrigin,
			};
		}
		return {
			kind: "result",
			mode: "spelling",
			revision: this.revision,
			reference: {
				kind: "result",
				mode: "spelling",
				revision: this.revision,
				key: state.key,
			},
			originDeck: state.originDeck,
			completedAt: state.completedAt,
			...state.result,
			incorrectCards: state.incorrectCards,
			restartOrigin: state.restartOrigin,
		};
	}

	private matchesReference(reference: LifecycleReference): boolean {
		if (reference.revision !== this.revision || reference.key !== this.state.key) return false;
		if (reference.kind !== this.state.kind) return false;
		if (reference.kind === "active" && this.state.kind === "active") {
			return reference.mode === this.state.mode;
		}
		if (reference.kind === "result" && this.state.kind === "result") {
			return reference.mode === this.state.mode;
		}
		return reference.kind === "idle" && this.state.kind === "idle";
	}

	private applied(
		feedback?: SpellingLifecycleFeedback,
		omittedCardCount?: number,
	): LifecycleOutcome {
		return {
			kind: "applied",
			snapshot: this.snapshot,
			...(feedback ? { feedback } : {}),
			...(omittedCardCount === undefined ? {} : { omittedCardCount }),
		};
	}

	private rejected(reason: LifecycleRejection): LifecycleOutcome {
		return { kind: "rejected", reason, snapshot: this.snapshot };
	}

	private failed(
		code: "persistence-failed" | "read-failed" | "invariant-violated",
		error: unknown,
		retryable: boolean,
	): LifecycleOutcome {
		if (error instanceof StartRejectionError) return this.rejected(error.reason);
		return {
			kind: "failed",
			failure: { code, message: errorMessage(error), retryable },
			snapshot: this.snapshot,
		};
	}

	private makeKey(prefix: string): string {
		return `${prefix}-${this.nextKey++}`;
	}

	private tryAcquire(kind: "interactive" | "background"): boolean {
		if (this.busyDone) return false;
		this.busyKind = kind;
		this.busyDone = new Promise<void>((resolve) => {
			this.releaseBusy = resolve;
		});
		return true;
	}

	/**
	 * Interactive intents never lose to background reconciliation: they wait out a
	 * background flush, but two interactive intents still produce `busy` for the
	 * second one so double submits stay rejected.
	 */
	private async acquireInteractive(): Promise<boolean> {
		while (true) {
			if (this.busyDone === null) return this.tryAcquire("interactive");
			if (this.busyKind === "interactive") return false;
			await this.busyDone;
		}
	}

	private async acquireBackground(): Promise<void> {
		while (this.busyDone !== null) await this.busyDone;
		this.tryAcquire("background");
	}

	private unlock(): void {
		const release = this.releaseBusy;
		this.releaseBusy = null;
		this.busyDone = null;
		this.busyKind = null;
		release?.();
		this.pumpSourceReconcile();
	}

	/** Folds repeated repository notifications into one background reconciliation. */
	private sourceChanged(change: SessionSourceChange): void {
		if (this.disposed) return;
		// A session's own answer commit bumps the progress revision; once its new
		// state is published the cached revisions match again and this is a no-op.
		if (
			this.state.kind === "active" &&
			this.state.mode === "challenge" &&
			change.deckStructureRevision === this.state.structureRevision &&
			change.challengeProgressRevision === this.state.progressRevision
		)
			return;
		// Changes that land while a start is in flight stay pending until the new
		// active state exists, then the unlock flush reconciles against it.
		this.sourceReconcilePending = true;
		this.pumpSourceReconcile();
	}

	private pumpSourceReconcile(): void {
		if (this.disposed || !this.sourceReconcilePending || this.busyDone !== null) return;
		if (this.state.kind !== "active" || this.state.mode !== "challenge") return;
		this.sourceReconcilePending = false;
		this.tryAcquire("background");
		void this.reconcileChallengeSources()
			.catch((error: unknown) => {
				console.error("Failed to reconcile challenge source changes", error);
			})
			.finally(() => this.unlock());
	}

	private async reconcileChallengeSources(): Promise<void> {
		if (this.state.kind !== "active" || this.state.mode !== "challenge") return;
		await this.revalidateActiveChallenge(this.state);
	}
}

class StartRejectionError extends Error {
	constructor(readonly reason: LifecycleRejection) {
		super(reason);
	}
}

function makeIdleSnapshot(
	revision: number,
	key: string,
	lastEnd: SourceChangeEndSnapshot | null,
): IdleLifecycleSnapshot {
	return {
		kind: "idle",
		revision,
		reference: { kind: "idle", revision, key },
		lastEnd,
	};
}

function snapshotCard(card: FlashCard): SessionCardSnapshot {
	return {
		identity: card.id,
		currentDeckId: card.sourceFile,
		front: card.front,
		back: card.back,
		...(card.explanation ? { explanation: card.explanation } : {}),
		sourceFile: card.sourceFile,
		indexInFile: card.indexInFile,
	};
}

function getOriginDeck(
	session: StudySession | PracticeSession | SpellingSession,
): SessionOriginDeckSnapshot {
	return session.originDeck ?? { id: session.deckId, name: session.deckId };
}

function getAnswerEventCount(state: InternalActiveState): number {
	return state.mode === "study"
		? state.session.answerEvents.length
		: state.mode === "practice"
			? state.session.history.length
			: Object.keys(state.session.firstAttempts).length;
}

function getActivityAnswerCount(state: InternalActiveState): number {
	return state.mode === "study"
		? (state.session.attemptCount ?? state.session.answerEvents.length)
		: state.mode === "practice"
			? (state.session.attemptCount ?? state.session.history.length)
			: state.session.attempts.length;
}

interface MutableSessionCommit {
	cardSchedules: SessionCardSchedule[];
	spellingAttempts: SessionSpellingAttempt[];
	records: SessionRecord[];
	challenge?: SessionChallengeCommit;
}

function emptyCommit(): MutableSessionCommit {
	return { cardSchedules: [], spellingAttempts: [], records: [] };
}

function hasCommitContent(commit: SessionCommit): boolean {
	return Boolean(
		commit.cardSchedules?.length ||
		commit.spellingAttempts?.length ||
		commit.records?.length ||
		commit.challenge,
	);
}

function toRestartOrigin(
	request: Extract<SessionStartRequest, { mode: "study" }>,
): Extract<SessionRestartOrigin, { mode: "study" }>;
function toRestartOrigin(
	request: Extract<SessionStartRequest, { mode: "practice" }>,
): Extract<SessionRestartOrigin, { mode: "practice" }>;
function toRestartOrigin(
	request: Extract<SessionStartRequest, { mode: "spelling" }>,
): Extract<SessionRestartOrigin, { mode: "spelling" }>;
function toRestartOrigin(
	request: Extract<SessionStartRequest, { mode: "challenge" }>,
): Extract<SessionRestartOrigin, { mode: "challenge" }>;
function toRestartOrigin(request: SessionStartRequest): SessionRestartOrigin {
	if (request.mode === "study")
		return {
			mode: "study",
			deckId: request.deckId,
			studyOrder: request.studyOrder,
			direction: request.direction,
		};
	if (request.mode === "practice")
		return {
			mode: "practice",
			deckId: request.deckId,
			direction: request.direction,
			selection: { ...request.selection },
		};
	if (request.mode === "spelling")
		return {
			mode: "spelling",
			deckId: request.deckId,
			selection: { ...request.selection },
		};
	return { mode: "challenge", challengeMode: request.challengeMode };
}

function reconcileActiveState(
	state: Exclude<InternalActiveState, { mode: "challenge" }>,
	change: ContinuitySessionChange,
): InternalActiveState | null {
	if (state.mode === "study") {
		const session = reconcileStudySession(state.session, change);
		return session ? { ...state, session } : null;
	}
	if (state.mode === "practice") {
		const session = reconcilePracticeSession(state.session, change);
		return session ? { ...state, session } : null;
	}
	const session = reconcileSpellingSession(state.session, change);
	return session ? { ...state, session } : null;
}

function reconcileStudySession(
	session: StudySession,
	change: ContinuitySessionChange,
): StudySession | null {
	const cardQueue = session.cardQueue.filter((identity) =>
		change.availableIdentities.has(identity),
	);
	if (cardQueue.length === 0) return null;
	return {
		...session,
		cardQueue,
		currentIndex: reconcileCurrentIndex(session.cardQueue, session.currentIndex, cardQueue),
		repeatQueue: session.repeatQueue.filter((identity) =>
			change.availableIdentities.has(identity),
		),
		unavailableCardIds: mergeUnavailableIdentities(
			session.unavailableCardIds,
			change.deletedIdentities,
		),
	};
}

function reconcilePracticeSession(
	session: PracticeSession,
	change: ContinuitySessionChange,
): PracticeSession | null {
	const cardQueue = session.cardQueue.filter((identity) =>
		change.availableIdentities.has(identity),
	);
	if (cardQueue.length === 0) return null;
	const deletedUnanswered = Array.from(change.deletedIdentities).filter(
		(identity) => session.answers[identity] === undefined,
	).length;
	return {
		...session,
		cardQueue,
		currentIndex: reconcileCurrentIndex(session.cardQueue, session.currentIndex, cardQueue),
		totalQuestions: Math.max(
			session.history.length,
			session.totalQuestions - deletedUnanswered,
		),
		unavailableCardIds: mergeUnavailableIdentities(
			session.unavailableCardIds,
			change.deletedIdentities,
		),
	};
}

function reconcileSpellingSession(
	session: SpellingSession,
	change: ContinuitySessionChange,
): SpellingSession | null {
	const spellableIdentities = change.spellableIdentitiesByDeck
		? new Set(
				Array.from(change.spellableIdentitiesByDeck.values()).flatMap((identities) => [
					...identities,
				]),
			)
		: change.availableIdentities;
	const selectedCardIds = session.selectedCardIds.filter((identity) =>
		spellableIdentities.has(identity),
	);
	const cardQueue = session.cardQueue.filter((identity) => spellableIdentities.has(identity));
	if (selectedCardIds.length === 0 || cardQueue.length === 0) return null;
	const previousCurrentIdentity = session.cardQueue[session.currentIndex];
	const firstAttempts = Object.fromEntries(
		Object.entries(session.firstAttempts).filter(([identity]) =>
			spellableIdentities.has(identity),
		),
	);
	const unavailableIdentities = new Set([
		...change.deletedIdentities,
		...session.selectedCardIds.filter((identity) => !spellableIdentities.has(identity)),
	]);
	return {
		...session,
		selectedCardIds,
		cardQueue,
		currentIndex: reconcileSpellingCurrentIndex(
			session.cardQueue,
			session.currentIndex,
			cardQueue,
		),
		phase:
			previousCurrentIdentity && spellableIdentities.has(previousCurrentIdentity)
				? session.phase
				: "retrieval",
		firstAttempts,
		completedCardIds: session.completedCardIds.filter((identity) =>
			spellableIdentities.has(identity),
		),
		unavailableCardIds: mergeUnavailableIdentities(
			session.unavailableCardIds,
			unavailableIdentities,
		),
	};
}

function reconcileCurrentIndex(
	previousQueue: string[],
	previousIndex: number,
	nextQueue: string[],
): number {
	const currentIdentity = previousQueue[previousIndex];
	if (currentIdentity) {
		const currentNextIndex = nextQueue.indexOf(currentIdentity);
		if (currentNextIndex !== -1) return currentNextIndex;
	}
	const nextIdentities = new Set(nextQueue);
	const survivingBefore = previousQueue
		.slice(0, previousIndex)
		.filter((identity) => nextIdentities.has(identity)).length;
	return Math.min(survivingBefore, nextQueue.length - 1);
}

function reconcileSpellingCurrentIndex(
	previousQueue: string[],
	previousIndex: number,
	nextQueue: string[],
): number {
	const currentIdentity = previousQueue[previousIndex];
	if (currentIdentity) {
		const occurrence = previousQueue
			.slice(0, previousIndex + 1)
			.filter((identity) => identity === currentIdentity).length;
		let seen = 0;
		for (let index = 0; index < nextQueue.length; index++) {
			if (nextQueue[index] !== currentIdentity) continue;
			seen++;
			if (seen === occurrence) return index;
		}
	}
	const nextIdentities = new Set(nextQueue);
	const survivingBefore = previousQueue
		.slice(0, previousIndex)
		.filter((identity) => nextIdentities.has(identity)).length;
	return Math.min(survivingBefore, nextQueue.length - 1);
}

function mergeUnavailableIdentities(
	current: string[] | undefined,
	unavailable: ReadonlySet<string>,
): string[] {
	return Array.from(new Set([...(current ?? []), ...unavailable]));
}
