import type {
	ActivePracticeReference,
	ActiveSpellingReference,
	ActiveStudyReference,
	LifecycleRejection,
	LifecycleOutcome,
	SessionLifecycle,
	SessionLifecycleSnapshot,
	SpellingLifecycleFeedback,
} from "../domain/sessions/sessionLifecycle";
import type { StudyRating } from "../../../core/shared/types";
import type { PronunciationOutcome, PronunciationRuntime } from "../domain/pronunciation/types";

export type AnswerPresentationAction =
	| {
			readonly kind: "study-answer";
			readonly reference: ActiveStudyReference;
			readonly rating: StudyRating;
	  }
	| { readonly kind: "study-previous"; readonly reference: ActiveStudyReference }
	| {
			readonly kind: "practice-answer";
			readonly reference: ActivePracticeReference;
			readonly correct: boolean;
	  }
	| { readonly kind: "practice-previous"; readonly reference: ActivePracticeReference }
	| {
			readonly kind: "spelling-answer";
			readonly reference: ActiveSpellingReference;
			readonly input: string;
	  };

export type AnswerPresentationActionKind = AnswerPresentationAction["kind"];

export interface AnswerPresentationSnapshot {
	readonly lifecycle: SessionLifecycleSnapshot;
	readonly activity:
		| { readonly kind: "idle" }
		| { readonly kind: "transitioning"; readonly action: AnswerPresentationActionKind };
	readonly spellingFeedback: Readonly<SpellingLifecycleFeedback> | null;
}

export type AnswerPresentationOutcome =
	| {
			readonly kind: "applied";
			readonly studyCompleted: boolean;
			readonly feedback?: Readonly<SpellingLifecycleFeedback>;
	  }
	| { readonly kind: "rejected"; readonly reason: LifecycleRejection | "inactive" }
	| { readonly kind: "failed"; readonly message: string; readonly retryable: boolean }
	| { readonly kind: "cancelled" };

export interface AnswerPresentationClock {
	setTimeout(callback: () => void, delay: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface CreateAnswerPresentationTransitionOptions {
	lifecycle: SessionLifecycle;
	clock?: AnswerPresentationClock;
	pronunciationRuntime?: PronunciationRuntime;
	now?: () => number;
	prepareSpellingAdvance?: (feedback: SpellingLifecycleFeedback) => Promise<number>;
}

export interface AnswerPresentationTransition {
	getSnapshot(): AnswerPresentationSnapshot;
	subscribe(listener: () => void): () => void;
	act(action: AnswerPresentationAction): Promise<AnswerPresentationOutcome>;
}

interface PendingDelay {
	handle: unknown;
	resolve: (completed: boolean) => void;
}

const browserClock: AnswerPresentationClock = {
	setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const DEFAULT_SPELLING_FEEDBACK_DELAY = 550;
const MAX_AUTO_PRONUNCIATION_WAIT_MS = 8000;

export function shouldAutoPronounceSpellingFeedback(feedbackKind: string): boolean {
	return feedbackKind === "retrieval-correct" || feedbackKind === "correction-correct";
}

export function createAnswerPresentationTransition(
	options: CreateAnswerPresentationTransitionOptions,
): AnswerPresentationTransition {
	return new DefaultAnswerPresentationTransition(options);
}

class DefaultAnswerPresentationTransition implements AnswerPresentationTransition {
	private readonly listeners = new Set<() => void>();
	private readonly clock: AnswerPresentationClock;
	private readonly pronunciationRuntime?: PronunciationRuntime;
	private readonly now: () => number;
	private readonly prepareSpellingAdvance: (
		feedback: SpellingLifecycleFeedback,
	) => Promise<number>;
	private latestLifecycle: SessionLifecycleSnapshot;
	private presentedLifecycle: SessionLifecycleSnapshot;
	private activity: AnswerPresentationSnapshot["activity"] = { kind: "idle" };
	private spellingFeedback: SpellingLifecycleFeedback | null = null;
	private feedbackCardIdentity: string | null = null;
	private snapshot: AnswerPresentationSnapshot;
	private unsubscribeLifecycle: (() => void) | null = null;
	private generation = 0;
	private pendingDelay: PendingDelay | null = null;
	private cancelPendingSpellingAdvance: (() => void) | null = null;

	constructor(private readonly options: CreateAnswerPresentationTransitionOptions) {
		this.clock = options.clock ?? browserClock;
		this.pronunciationRuntime = options.pronunciationRuntime;
		this.now = options.now ?? Date.now;
		this.prepareSpellingAdvance =
			options.prepareSpellingAdvance ??
			((feedback) => this.defaultPrepareSpellingAdvance(feedback));
		this.latestLifecycle = options.lifecycle.getSnapshot();
		this.presentedLifecycle = this.latestLifecycle;
		this.snapshot = this.buildSnapshot();
	}

	getSnapshot(): AnswerPresentationSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		const firstSubscriber = this.listeners.size === 0;
		this.listeners.add(listener);
		if (firstSubscriber) this.activate();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.deactivate();
		};
	}

	async act(action: AnswerPresentationAction): Promise<AnswerPresentationOutcome> {
		if (this.listeners.size === 0) return { kind: "rejected", reason: "inactive" };
		if (this.activity.kind !== "idle") return { kind: "rejected", reason: "busy" };

		const generation = ++this.generation;
		this.activity = { kind: "transitioning", action: action.kind };
		this.publish();
		const outcome = await this.applyLifecycleAction(action);
		this.latestLifecycle = outcome.snapshot;

		if (!this.isCurrent(generation)) return { kind: "cancelled" };
		if (outcome.kind === "rejected") {
			this.settle();
			return { kind: "rejected", reason: outcome.reason };
		}
		if (outcome.kind === "failed") {
			this.settle();
			return {
				kind: "failed",
				message: outcome.failure.message,
				retryable: outcome.failure.retryable,
			};
		}

		const studyCompleted = action.kind === "study-answer" && outcome.snapshot.kind === "idle";
		if (action.kind === "spelling-answer") {
			if (!outcome.feedback) {
				this.settle();
				return { kind: "rejected", reason: "action-not-available" };
			}
			const feedback = cloneFeedback(outcome.feedback);
			this.spellingFeedback = feedback;
			this.feedbackCardIdentity = getCurrentCardIdentity(this.presentedLifecycle);
			this.publish();
			if (isIncorrectSpellingFeedback(feedback)) {
				this.settle();
				return { kind: "applied", studyCompleted: false, feedback };
			}
			const delay = await this.prepareSpellingAdvance(feedback);
			if (!this.isCurrent(generation)) return { kind: "cancelled" };
			if (!(await this.waitForDelay(Math.max(0, delay), generation))) {
				return { kind: "cancelled" };
			}
			this.settle();
			return { kind: "applied", studyCompleted: false, feedback };
		}

		const delay = getTransitionDelay(action.kind, outcome.snapshot);
		if (!(await this.waitForDelay(delay, generation))) return { kind: "cancelled" };
		this.settle();
		return { kind: "applied", studyCompleted };
	}

	private activate(): void {
		this.cancelPendingTransition();
		this.latestLifecycle = this.options.lifecycle.getSnapshot();
		this.presentedLifecycle = this.latestLifecycle;
		this.activity = { kind: "idle" };
		this.spellingFeedback = null;
		this.feedbackCardIdentity = null;
		this.snapshot = this.buildSnapshot();
		this.unsubscribeLifecycle = this.options.lifecycle.subscribe(() => {
			this.latestLifecycle = this.options.lifecycle.getSnapshot();
			if (this.activity.kind === "idle") {
				this.presentedLifecycle = this.latestLifecycle;
				this.clearFeedbackForDifferentCard();
				this.publish();
			}
		});
	}

	private deactivate(): void {
		this.unsubscribeLifecycle?.();
		this.unsubscribeLifecycle = null;
		this.cancelPendingTransition();
		this.latestLifecycle = this.options.lifecycle.getSnapshot();
		this.presentedLifecycle = this.latestLifecycle;
		this.activity = { kind: "idle" };
		this.spellingFeedback = null;
		this.feedbackCardIdentity = null;
		this.snapshot = this.buildSnapshot();
	}

	private applyLifecycleAction(action: AnswerPresentationAction): Promise<LifecycleOutcome> {
		switch (action.kind) {
			case "study-answer":
				return this.options.lifecycle.act(action.reference, {
					kind: "answer",
					rating: action.rating,
				});
			case "study-previous":
				return this.options.lifecycle.act(action.reference, { kind: "previous" });
			case "practice-answer":
				return this.options.lifecycle.act(action.reference, {
					kind: "answer",
					correct: action.correct,
				});
			case "practice-previous":
				return this.options.lifecycle.act(action.reference, { kind: "previous" });
			case "spelling-answer":
				return this.options.lifecycle.act(action.reference, {
					kind: "answer",
					input: action.input,
				});
		}
	}

	private waitForDelay(delay: number, generation: number): Promise<boolean> {
		return new Promise((resolve) => {
			const handle = this.clock.setTimeout(() => {
				this.pendingDelay = null;
				resolve(this.isCurrent(generation));
			}, delay);
			this.pendingDelay = { handle, resolve };
		});
	}

	private settle(): void {
		this.presentedLifecycle = this.latestLifecycle;
		this.activity = { kind: "idle" };
		this.clearFeedbackForDifferentCard();
		this.publish();
	}

	private clearFeedbackForDifferentCard(): void {
		if (
			this.feedbackCardIdentity !== null &&
			getCurrentCardIdentity(this.presentedLifecycle) === this.feedbackCardIdentity
		) {
			return;
		}
		this.spellingFeedback = null;
		this.feedbackCardIdentity = null;
	}

	private cancelPendingTransition(): void {
		this.generation++;
		this.pronunciationRuntime?.stop();
		if (this.cancelPendingSpellingAdvance) {
			this.cancelPendingSpellingAdvance();
			this.cancelPendingSpellingAdvance = null;
		}
		if (this.pendingDelay) {
			this.clock.clearTimeout(this.pendingDelay.handle);
			this.pendingDelay.resolve(false);
			this.pendingDelay = null;
		}
	}

	private async defaultPrepareSpellingAdvance(
		feedback: SpellingLifecycleFeedback,
	): Promise<number> {
		if (!this.pronunciationRuntime || !shouldAutoPronounceSpellingFeedback(feedback.kind)) {
			return DEFAULT_SPELLING_FEEDBACK_DELAY;
		}

		const autoPlay = this.pronunciationRuntime.getSnapshot().settings.spellingAutoPlay;
		if (!autoPlay) {
			return DEFAULT_SPELLING_FEEDBACK_DELAY;
		}

		const startedAt = this.now();
		let timeoutHandle: unknown = null;

		const timedTimeout = new Promise<{ status: "cancelled" }>((resolve) => {
			timeoutHandle = this.clock.setTimeout(() => {
				this.pronunciationRuntime?.stop();
				resolve({ status: "cancelled" });
			}, MAX_AUTO_PRONUNCIATION_WAIT_MS);
		});

		let cancelAdvance: (() => void) | null = null;
		const cancelledPromise = new Promise<{ status: "cancelled" }>((resolve) => {
			cancelAdvance = () => resolve({ status: "cancelled" });
		});
		this.cancelPendingSpellingAdvance = cancelAdvance;

		let speaking: Promise<PronunciationOutcome>;
		try {
			speaking = Promise.resolve(
				this.pronunciationRuntime.speak(feedback.expectedAnswer, "auto"),
			).catch(() => ({ status: "failed" as const, reason: "playback" as const }));
		} catch {
			speaking = Promise.resolve({ status: "failed" as const, reason: "playback" as const });
		}

		const outcome = await Promise.race([speaking, timedTimeout, cancelledPromise]);
		this.cancelPendingSpellingAdvance = null;
		if (timeoutHandle !== null) {
			this.clock.clearTimeout(timeoutHandle);
		}

		if (outcome.status === "success") {
			return 0;
		}

		const elapsed = this.now() - startedAt;
		return Math.max(0, DEFAULT_SPELLING_FEEDBACK_DELAY - elapsed);
	}

	private isCurrent(generation: number): boolean {
		return this.listeners.size > 0 && generation === this.generation;
	}

	private publish(): void {
		this.snapshot = this.buildSnapshot();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("Failed to publish an answer presentation transition:", error);
			}
		}
	}

	private buildSnapshot(): AnswerPresentationSnapshot {
		const activity = Object.freeze({ ...this.activity });
		return Object.freeze({
			lifecycle: this.presentedLifecycle,
			activity,
			spellingFeedback: this.spellingFeedback
				? Object.freeze(cloneFeedback(this.spellingFeedback))
				: null,
		});
	}
}

function getTransitionDelay(
	action: Exclude<AnswerPresentationActionKind, "spelling-answer">,
	next: SessionLifecycleSnapshot,
): number {
	if (action === "study-answer" && (next.kind === "idle" || next.kind === "result")) return 300;
	if (action === "practice-answer" && next.kind === "result") return 300;
	return 200;
}

function isIncorrectSpellingFeedback(feedback: SpellingLifecycleFeedback): boolean {
	return feedback.kind === "retrieval-incorrect" || feedback.kind === "correction-incorrect";
}

function getCurrentCardIdentity(snapshot: SessionLifecycleSnapshot): string | null {
	return snapshot.kind === "active" ? snapshot.currentCard.identity : null;
}

function cloneFeedback(feedback: SpellingLifecycleFeedback): SpellingLifecycleFeedback {
	return {
		...feedback,
		diff: feedback.diff.map((segment) => ({ ...segment })),
	};
}
