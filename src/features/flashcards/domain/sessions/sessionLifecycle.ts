import type { Card } from "ts-fsrs";
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
	SpellingCardProgress,
	SpellingResult,
	SpellingSelection,
	SpellingSession,
	StudyRating,
	StudySession,
	StudySettings,
	ViewState,
} from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import { shuffleArray } from "../../../../core/shared/utils";
import type { StudyCardScheduler } from "./studySessionEngine";
import {
	answerStudyCard,
	canUndoStudyAnswer,
	createStudySession,
	getCurrentStudyCardId,
	getStudyProgress,
	undoStudyAnswer,
} from "./studySessionEngine";
import { answerPracticeCard, createPracticeSession, previousPracticeCard } from "./sessionEngine";
import {
	answerSpellingCard,
	createSpellingSession,
	getCurrentSpellingCardId,
} from "./spellingSessionEngine";
import { planRetryIncorrectSession, planSessionQueue } from "./sessionPlanner";

export interface SessionCardSnapshot {
	readonly identity: string;
	readonly currentDeckId: string;
	readonly front: string;
	readonly back: string;
	readonly explanation?: string;
	readonly sourceFile: string;
	readonly indexInFile: number;
}

export interface SessionProgressSnapshot {
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

export interface IdleLifecycleReference extends ReferenceBase {
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

export interface PracticeResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "practice";
}

export interface SpellingResultReference extends ReferenceBase {
	readonly kind: "result";
	readonly mode: "spelling";
}

export type LifecycleReference =
	| IdleLifecycleReference
	| ActiveStudyReference
	| ActivePracticeReference
	| ActiveSpellingReference
	| PracticeResultReference
	| SpellingResultReference;

export interface SourceChangeEndSnapshot {
	readonly id: string;
	readonly reason: "source-change";
	readonly mode: "study" | "practice" | "spelling";
	readonly originDeck: Readonly<SessionOriginDeckSnapshot>;
	readonly answerEventCount: number;
}

export interface IdleLifecycleSnapshot {
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

export type ActiveLifecycleSnapshot =
	| ActiveStudySnapshot
	| ActivePracticeSnapshot
	| ActiveSpellingSnapshot;

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
	  };

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
	readonly setupDefaults: Readonly<Extract<SessionStartRequest, { mode: "practice" }>>;
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
	readonly setupDefaults: Readonly<Extract<SessionStartRequest, { mode: "spelling" }>>;
}

export type ResultLifecycleSnapshot = PracticeResultSnapshot | SpellingResultSnapshot;

export function getRestartViewState(
	setupDefaults:
		| Readonly<Extract<SessionStartRequest, { mode: "practice" }>>
		| Readonly<Extract<SessionStartRequest, { mode: "spelling" }>>,
): ViewState {
	if (setupDefaults.selection.kind === "study-day") {
		if (setupDefaults.mode === "practice") {
			return {
				type: "study-setup",
				deckId: setupDefaults.deckId,
				initialStudyOrder: setupDefaults.selection.studyOrder,
				initialDirection: setupDefaults.direction,
			};
		}
		return {
			type: "study-setup",
			deckId: setupDefaults.deckId,
		};
	}

	if (setupDefaults.mode === "practice") {
		return {
			type: "practice-setup",
			deckId: setupDefaults.deckId,
			initialSelection: setupDefaults.selection,
			initialDirection: setupDefaults.direction,
		};
	}

	return {
		type: "spelling-setup",
		deckId: setupDefaults.deckId,
		initialSelection: setupDefaults.selection,
	};
}

export type SessionLifecycleSnapshot =
	| IdleLifecycleSnapshot
	| ActiveLifecycleSnapshot
	| ResultLifecycleSnapshot;

export type StudyLifecycleAction =
	| { readonly kind: "answer"; readonly rating: StudyRating }
	| { readonly kind: "previous" }
	| { readonly kind: "exit" };

export type PracticeLifecycleAction =
	| { readonly kind: "answer"; readonly correct: boolean }
	| { readonly kind: "previous" }
	| { readonly kind: "exit" };

export type SpellingLifecycleAction =
	| { readonly kind: "answer"; readonly input: string }
	| { readonly kind: "exit" };

export type ResultLifecycleAction =
	| { readonly kind: "retry-incorrect" }
	| { readonly kind: "dismiss" };

export type IdleLifecycleAction = {
	readonly kind: "acknowledge-end";
	readonly noticeId: string;
};

export type ActionFor<R extends LifecycleReference> = R extends ActiveStudyReference
	? StudyLifecycleAction
	: R extends ActivePracticeReference
		? PracticeLifecycleAction
		: R extends ActiveSpellingReference
			? SpellingLifecycleAction
			: R extends PracticeResultReference | SpellingResultReference
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

export interface PendingSessionHistoryEntry {
	readonly deckId: string;
	readonly deckName: string;
	readonly mode: "study" | "practice" | "spelling";
	readonly cardCount: number;
	readonly duration: number;
}

export interface SessionPersistenceTransition {
	readonly cardUpdates: readonly {
		readonly deckId: string;
		readonly cardId: string;
		readonly fsrsCard: Card;
	}[];
	readonly spellingAttempts: readonly {
		readonly cardId: string;
		readonly correct: boolean;
		readonly attemptedAt: number;
	}[];
	readonly incrementStudyCountFor: readonly string[];
	readonly historyEntries: readonly PendingSessionHistoryEntry[];
}

export interface SessionLifecycleRepository extends StudyCardScheduler {
	getDeck(id: string): Deck | undefined;
	getCard(deckId: string, cardId: string): FlashCard | undefined;
	getEffectiveStudySettings(deckId: string): StudySettings;
	getSettings(): Pick<FlashcardStudySettings, "wordLearningDecks">;
	getSpellingProgress(): Record<string, SpellingCardProgress>;
	commitSessionTransition(transition: SessionPersistenceTransition): Promise<void>;
}

export interface SessionLifecycle {
	getSnapshot(): SessionLifecycleSnapshot;
	subscribe(listener: () => void): () => void;
	start(request: SessionStartRequest): Promise<LifecycleOutcome>;
	act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome>;
}

export interface SessionLifecycleWiring {
	readonly lifecycle: SessionLifecycle;
	readonly continuitySessions: ContinuitySessionAdapter;
}

export interface CreateSessionLifecycleOptions {
	now?: () => number;
	shuffle?: (identities: string[]) => string[];
}

type InternalActiveState =
	| {
			kind: "active";
			mode: "study";
			key: string;
			session: StudySession;
			setupDefaults: Extract<SessionStartRequest, { mode: "study" }>;
	  }
	| {
			kind: "active";
			mode: "practice";
			key: string;
			session: PracticeSession;
			setupDefaults: Extract<SessionStartRequest, { mode: "practice" }>;
	  }
	| {
			kind: "active";
			mode: "spelling";
			key: string;
			session: SpellingSession;
			setupDefaults: Extract<SessionStartRequest, { mode: "spelling" }>;
	  };

type InternalResultState =
	| {
			kind: "result";
			mode: "practice";
			key: string;
			originDeck: SessionOriginDeckSnapshot;
			completedAt: number;
			result: PracticeResult;
			incorrectCards: SessionCardSnapshot[];
			setupDefaults: Extract<SessionStartRequest, { mode: "practice" }>;
	  }
	| {
			kind: "result";
			mode: "spelling";
			key: string;
			originDeck: SessionOriginDeckSnapshot;
			completedAt: number;
			result: SpellingResult;
			incorrectCards: SpellingIncorrectCardSnapshot[];
			setupDefaults: Extract<SessionStartRequest, { mode: "spelling" }>;
	  };

type InternalState =
	| { kind: "idle"; key: string; lastEnd: SourceChangeEndSnapshot | null }
	| InternalActiveState
	| InternalResultState;

type AnyLifecycleAction =
	| StudyLifecycleAction
	| PracticeLifecycleAction
	| SpellingLifecycleAction
	| ResultLifecycleAction
	| IdleLifecycleAction;

class PersistenceFailure extends Error {}

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
	private readonly now: () => number;
	private readonly shuffle: (identities: string[]) => string[];

	constructor(
		private readonly repository: SessionLifecycleRepository,
		options: CreateSessionLifecycleOptions,
	) {
		this.now = options.now ?? Date.now;
		this.shuffle = options.shuffle ?? shuffleArray;
	}

	getSnapshot(): SessionLifecycleSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(request: SessionStartRequest): Promise<LifecycleOutcome> {
		if (!this.tryAcquire()) return this.rejected("busy");
		try {
			if (this.state.kind !== "idle") return this.rejected("invalid-state");
			const deck = this.repository.getDeck(request.deckId);
			if (!deck) return this.rejected("deck-not-found");
			const active = this.createActiveState(request, deck);
			if (!active) return this.rejected("no-eligible-cards");
			this.publish(active);
			return this.applied();
		} catch (error) {
			return this.failed("read-failed", error, true);
		} finally {
			this.unlock();
		}
	}

	async act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome> {
		if (!this.tryAcquire()) return this.rejected("busy");
		try {
			if (!this.matchesReference(reference)) return this.rejected("stale-reference");
			return await this.applyAction(action as AnyLifecycleAction);
		} catch (error) {
			return error instanceof PersistenceFailure
				? this.failed("persistence-failed", error, true)
				: this.failed("invariant-violated", error, false);
		} finally {
			this.unlock();
		}
	}

	hasActiveSession(): boolean {
		return this.state.kind === "active";
	}

	async reconcile(change: ContinuitySessionChange): Promise<void> {
		await this.acquireWhenAvailable();
		try {
			if (this.state.kind !== "active") return;
			const current = this.state;
			const reconciled = reconcileActiveState(current, change);
			if (reconciled) {
				this.publish(reconciled);
				return;
			}

			const answerEventCount = getAnswerEventCount(current);
			if (answerEventCount > 0) {
				await this.commit({
					...emptyTransition(),
					historyEntries: [this.buildPartialHistory(current, answerEventCount)],
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

	private createActiveState(
		request: SessionStartRequest,
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
						setupDefaults: cloneStartRequest(request),
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
				setupDefaults: cloneStartRequest(request),
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
			setupDefaults: cloneStartRequest(request),
		};
	}

	private async applyAction(action: AnyLifecycleAction): Promise<LifecycleOutcome> {
		if (this.state.kind === "idle") return this.applyIdleAction(action);
		if (this.state.kind === "result") return this.applyResultAction(action);
		if (action.kind === "exit") return this.exitActive(this.state);
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
			await this.commit({
				...emptyTransition(),
				cardUpdates: [step.cardUpdate],
			});
			this.publish({ ...state, session: step.session });
			return this.applied();
		}
		if (action.kind !== "answer" || !("rating" in action)) {
			return this.rejected("action-not-available");
		}
		const cardId = getCurrentStudyCardId(state.session);
		const card = cardId ? this.repository.getCard(state.session.deckId, cardId) : undefined;
		if (!card) return this.rejected("current-card-unavailable");
		const step = answerStudyCard({
			session: state.session,
			card,
			rating: action.rating,
			scheduler: this.repository,
			now: this.now(),
		});
		const transition = emptyTransition();
		transition.cardUpdates.push(step.cardUpdate);
		if (step.type === "complete") {
			transition.incrementStudyCountFor.push(step.finishIntent.deckId);
			transition.historyEntries.push(
				this.buildHistory(state, step.finishIntent.cardCount, step.finishIntent.duration),
			);
		}
		await this.commit(transition);
		if (step.type === "complete") {
			this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
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
			...emptyTransition(),
			historyEntries: [
				this.buildHistory(state, step.result.totalQuestions, step.result.timeSpent),
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
			setupDefaults: state.setupDefaults,
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
		const transition = emptyTransition();
		if (state.session.phase === "retrieval") {
			transition.spellingAttempts.push({
				cardId: card.id,
				correct,
				attemptedAt: now,
			});
		}
		if (step.type === "complete") {
			transition.historyEntries.push(
				this.buildHistory(state, step.result.totalWords, step.result.timeSpent),
			);
		}
		if (!isEmptyTransition(transition)) await this.commit(transition);
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
				setupDefaults: state.setupDefaults,
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
		if (action.kind !== "retry-incorrect") {
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
				setupDefaults: state.setupDefaults,
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
				setupDefaults: state.setupDefaults,
			});
		}
		return this.applied(undefined, planResult.omittedCardCount);
	}

	private async exitActive(state: InternalActiveState): Promise<LifecycleOutcome> {
		const answerEventCount = getAnswerEventCount(state);
		if (answerEventCount > 0) {
			await this.commit({
				...emptyTransition(),
				historyEntries: [this.buildPartialHistory(state, answerEventCount)],
			});
		}
		this.publish({ kind: "idle", key: this.makeKey("idle"), lastEnd: null });
		return this.applied();
	}

	private buildPartialHistory(
		state: InternalActiveState,
		answerEventCount: number,
	): PendingSessionHistoryEntry {
		return this.buildHistory(
			state,
			answerEventCount,
			Math.max(0, Math.floor((this.now() - state.session.startTime) / 1000)),
		);
	}

	private buildHistory(
		state: InternalActiveState,
		cardCount: number,
		duration: number,
	): PendingSessionHistoryEntry {
		const originDeck = getOriginDeck(state.session);
		return {
			deckId: originDeck.id,
			deckName: originDeck.name,
			mode: state.mode,
			cardCount,
			duration: Math.max(0, duration),
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

	private async commit(transition: SessionPersistenceTransition): Promise<void> {
		try {
			await this.repository.commitSessionTransition(transition);
		} catch (error) {
			throw new PersistenceFailure(errorMessage(error));
		}
	}

	private publish(state: InternalState): void {
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
				setupDefaults: state.setupDefaults,
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
			setupDefaults: state.setupDefaults,
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

	private tryAcquire(): boolean {
		if (this.busyDone) return false;
		this.busyDone = new Promise<void>((resolve) => {
			this.releaseBusy = resolve;
		});
		return true;
	}

	private async acquireWhenAvailable(): Promise<void> {
		while (!this.tryAcquire()) {
			await this.busyDone;
		}
	}

	private unlock(): void {
		const release = this.releaseBusy;
		this.releaseBusy = null;
		this.busyDone = null;
		release?.();
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

function emptyTransition(): {
	cardUpdates: Array<{ deckId: string; cardId: string; fsrsCard: Card }>;
	spellingAttempts: Array<{ cardId: string; correct: boolean; attemptedAt: number }>;
	incrementStudyCountFor: string[];
	historyEntries: PendingSessionHistoryEntry[];
} {
	return {
		cardUpdates: [],
		spellingAttempts: [],
		incrementStudyCountFor: [],
		historyEntries: [],
	};
}

function isEmptyTransition(transition: SessionPersistenceTransition): boolean {
	return (
		transition.cardUpdates.length === 0 &&
		transition.spellingAttempts.length === 0 &&
		transition.incrementStudyCountFor.length === 0 &&
		transition.historyEntries.length === 0
	);
}

function cloneStartRequest<T extends SessionStartRequest>(request: T): T {
	return {
		...request,
		...("selection" in request ? { selection: { ...request.selection } } : {}),
	} as T;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function reconcileActiveState(
	state: InternalActiveState,
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
