import { describe, expect, it, vi } from "vitest";
import type {
	ActionFor,
	ActivePracticeSnapshot,
	ActiveSpellingSnapshot,
	ActiveStudySnapshot,
	LifecycleOutcome,
	LifecycleReference,
	SessionLifecycle,
	SessionLifecycleSnapshot,
	SessionStartRequest,
	SpellingLifecycleFeedback,
} from "../../domain/sessions/sessionLifecycle";
import {
	createAnswerPresentationTransition,
	shouldAutoPronounceSpellingFeedback,
	type AnswerPresentationClock,
	type AnswerPresentationAction,
} from "../answerPresentationTransition";
import type { PronunciationRuntime } from "../../domain/pronunciation";

class ScriptedLifecycle implements SessionLifecycle {
	async revalidateChallenge(): Promise<void> {}
	readonly listeners = new Set<() => void>();
	readonly actions: Array<{ reference: LifecycleReference; action: unknown }> = [];
	onAct: (reference: LifecycleReference, action: unknown) => Promise<LifecycleOutcome> =
		async () => ({
			kind: "rejected",
			reason: "action-not-available",
			snapshot: this.snapshot,
		});

	constructor(private snapshot: SessionLifecycleSnapshot) {}

	getSnapshot(): SessionLifecycleSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(_request: SessionStartRequest): Promise<LifecycleOutcome> {
		return { kind: "rejected", reason: "invalid-state", snapshot: this.snapshot };
	}

	async act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome> {
		this.actions.push({ reference, action });
		return this.onAct(reference, action);
	}

	publish(snapshot: SessionLifecycleSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}
}

class FakeClock implements AnswerPresentationClock {
	readonly delays: number[] = [];
	private sequence = 0;
	private readonly tasks = new Map<number, () => void>();

	setTimeout(callback: () => void, delay: number): unknown {
		const id = ++this.sequence;
		this.delays.push(delay);
		this.tasks.set(id, callback);
		return id;
	}

	clearTimeout(handle: unknown): void {
		this.tasks.delete(handle as number);
	}

	runNext(): void {
		const next = this.tasks.entries().next().value as [number, () => void] | undefined;
		if (!next) throw new Error("Expected a pending presentation timer");
		this.tasks.delete(next[0]);
		next[1]();
	}

	get pendingCount(): number {
		return this.tasks.size;
	}
}

function activeStudy(
	cardId: string,
	revision: number,
	overrides: Partial<ActiveStudySnapshot> = {},
): ActiveStudySnapshot {
	return {
		kind: "active",
		mode: "study",
		revision,
		reference: { kind: "active", mode: "study", revision, key: `study-${revision}` },
		originDeck: { id: "deck", name: "Deck" },
		startTime: 0,
		currentCard: card(cardId),
		progress: progress(revision, 3),
		answerEventCount: revision - 1,
		direction: "normal",
		canPrevious: true,
		...overrides,
	};
}

function activePractice(
	cardId: string,
	revision: number,
	overrides: Partial<ActivePracticeSnapshot> = {},
): ActivePracticeSnapshot {
	return {
		kind: "active",
		mode: "practice",
		revision,
		reference: { kind: "active", mode: "practice", revision, key: `practice-${revision}` },
		originDeck: { id: "deck", name: "Deck" },
		startTime: 0,
		currentCard: card(cardId),
		progress: progress(revision, 3),
		answerEventCount: revision - 1,
		direction: "normal",
		canPrevious: true,
		...overrides,
	};
}

function activeSpelling(
	cardId: string,
	revision: number,
	phase: ActiveSpellingSnapshot["phase"] = "retrieval",
): ActiveSpellingSnapshot {
	return {
		kind: "active",
		mode: "spelling",
		revision,
		reference: { kind: "active", mode: "spelling", revision, key: `spelling-${revision}` },
		originDeck: { id: "deck", name: "Deck" },
		startTime: 0,
		currentCard: card(cardId),
		progress: progress(revision, 3),
		answerEventCount: revision - 1,
		phase,
	};
}

function idle(revision: number): SessionLifecycleSnapshot {
	return {
		kind: "idle",
		revision,
		reference: { kind: "idle", revision, key: `idle-${revision}` },
		lastEnd: null,
	};
}

function practiceResult(revision: number): SessionLifecycleSnapshot {
	return {
		kind: "result",
		mode: "practice",
		revision,
		reference: {
			kind: "result",
			mode: "practice",
			revision,
			key: `practice-result-${revision}`,
		},
		originDeck: { id: "deck", name: "Deck" },
		completedAt: 1,
		direction: "normal",
		totalQuestions: 1,
		correctCount: 1,
		incorrectCount: 0,
		accuracy: 1,
		timeSpent: 1,
		incorrectCards: [],
		setupDefaults: {
			mode: "practice",
			deckId: "deck",
			direction: "normal",
			selection: { kind: "random", questionCount: 1 },
		},
	};
}

function card(identity: string) {
	return {
		identity,
		currentDeckId: "deck",
		front: identity,
		back: `back ${identity}`,
		sourceFile: "deck.md",
		indexInFile: 0,
	};
}

function progress(current: number, total: number) {
	return {
		current,
		completed: current - 1,
		total,
		percent: (current / total) * 100,
		label: `${current}/${total}`,
	};
}

function feedback(kind: SpellingLifecycleFeedback["kind"]): SpellingLifecycleFeedback {
	return {
		kind,
		submittedInput: "helo",
		expectedAnswer: "hello",
		diff: [],
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function flushPromises(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

// Session key, callback revision and answer count deliberately vary independently.
function sessionCard(
	mode: "study" | "practice",
	revision: number,
	answerEventCount = 0,
	identity = "hello",
	direction: "normal" | "reversed" = "normal",
) {
	const reference = { kind: "active" as const, mode, revision, key: "session" };
	return mode === "study"
		? activeStudy(identity, revision, {
				reference: { ...reference, mode },
				answerEventCount,
				direction,
			})
		: activePractice(identity, revision, {
				reference: { ...reference, mode },
				answerEventCount,
				direction,
			});
}

describe.each(["study", "practice"] as const)("%s card presentation", (mode) => {
	function setup(direction: "normal" | "reversed" = "normal") {
		const initial = sessionCard(mode, 1, 0, "hello", direction);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		const speak = vi.fn().mockResolvedValue({ status: "success", source: "local" });
		const stop = vi.fn();
		const runtime = { speak, stop } as unknown as PronunciationRuntime;
		const subject = createAnswerPresentationTransition({
			lifecycle,
			clock,
			pronunciationRuntime: runtime,
			wordLearningDecks: { deck: true },
		});
		const unsubscribe = subject.subscribe(() => undefined);
		const local = (kind: "card-reveal" | "card-toggle-auto-pronunciation") =>
			subject.act({ kind, reference: (lifecycle.getSnapshot() as typeof initial).reference });
		const answer = (): AnswerPresentationAction =>
			mode === "study"
				? {
						kind: "study-answer",
						reference: initial.reference as ActiveStudySnapshot["reference"],
						rating: 1,
					}
				: {
						kind: "practice-answer",
						reference: initial.reference as ActivePracticeSnapshot["reference"],
						correct: false,
					};
		return { initial, lifecycle, clock, speak, stop, subject, unsubscribe, local, answer };
	}

	it("reads a frozen card snapshot and reveals without writing or delaying", async () => {
		const test = setup();
		expect(test.subject.getSnapshot().cardPresentation).toEqual({
			answerVisible: false,
			autoPronunciationEnabled: false,
			pronunciationEnabled: true,
			pronunciationWord: "hello",
		});
		await test.local("card-reveal");
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(true);
		expect(Object.isFrozen(test.subject.getSnapshot().cardPresentation)).toBe(true);
		expect(test.lifecycle.actions).toHaveLength(0);
		expect(test.clock.pendingCount).toBe(0);
		test.unsubscribe();
	});

	it("plays a forward word once, stops on disable and permits explicit re-enabling", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		expect(test.speak).toHaveBeenCalledWith("hello", "auto");
		await test.local("card-reveal");
		await test.local("card-reveal");
		test.lifecycle.publish(sessionCard(mode, 2));
		test.subject.setWordLearningDecks({ deck: true });
		expect(test.speak).toHaveBeenCalledTimes(1);
		test.stop.mockClear();
		await test.local("card-toggle-auto-pronunciation");
		expect(test.stop).toHaveBeenCalledTimes(1);
		await test.local("card-toggle-auto-pronunciation");
		expect(test.speak).toHaveBeenCalledTimes(2);
		test.unsubscribe();
	});

	it("waits for the reverse answer and hides it again on the next encounter", async () => {
		const test = setup("reversed");
		await test.local("card-toggle-auto-pronunciation");
		expect(test.speak).not.toHaveBeenCalled();
		await test.local("card-reveal");
		await test.local("card-reveal");
		expect(test.speak).toHaveBeenCalledTimes(1);
		test.lifecycle.publish(sessionCard(mode, 2, 1, "hello", "reversed"));
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: true,
		});
		expect(test.speak).toHaveBeenCalledTimes(1);
		await test.local("card-reveal");
		expect(test.speak).toHaveBeenCalledTimes(2);
		test.unsubscribe();
	});

	it("resets A to B to A and undo with the same session key", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		test.lifecycle.publish(sessionCard(mode, 2, 1, "world"));
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		await test.local("card-reveal");
		test.lifecycle.publish(sessionCard(mode, 3, 0, "hello"));
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: true,
		});
		expect(test.speak.mock.calls.map(([word]) => word)).toEqual(["hello", "world", "hello"]);
		test.unsubscribe();
	});

	it("gives the same identity and word another opportunity only after committed delay", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		const next = sessionCard(mode, 2, 1);
		test.lifecycle.onAct = async () => {
			test.lifecycle.publish(next);
			return { kind: "applied", snapshot: next };
		};
		const pending = test.subject.act(test.answer());
		await flushPromises();
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(true);
		expect(test.speak).toHaveBeenCalledTimes(1);
		expect(await test.local("card-reveal")).toEqual({ kind: "rejected", reason: "busy" });
		test.clock.runNext();
		await pending;
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		expect(test.speak).toHaveBeenCalledTimes(2);
		test.unsubscribe();
	});

	it("preserves explanation/source-only changes but resets either card face", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		const moved = sessionCard(mode, 2);
		test.lifecycle.publish({
			...moved,
			currentCard: {
				...moved.currentCard,
				explanation: "new explanation",
				sourceFile: "moved.md",
				indexInFile: 5,
			},
		});
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(true);
		expect(test.speak).toHaveBeenCalledTimes(1);
		const backEdited = sessionCard(mode, 3);
		test.lifecycle.publish({
			...backEdited,
			currentCard: { ...backEdited.currentCard, back: "edited answer" },
		});
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		expect(test.speak).toHaveBeenCalledTimes(2);
		await test.local("card-reveal");
		const frontEdited = sessionCard(mode, 4);
		test.lifecycle.publish({
			...frontEdited,
			currentCard: { ...frontEdited.currentCard, front: "changed", back: "edited answer" },
		});
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		expect(test.speak).toHaveBeenLastCalledWith("changed", "auto");
		test.unsubscribe();
	});

	it.each(["failed", "rejected"] as const)(
		"preserves visibility and playback after a %s submission",
		async (kind) => {
			const test = setup();
			await test.local("card-toggle-auto-pronunciation");
			await test.local("card-reveal");
			test.lifecycle.onAct = async () =>
				kind === "failed"
					? {
							kind,
							snapshot: test.initial,
							failure: {
								code: "persistence-failed",
								message: "unavailable",
								retryable: true,
							},
						}
					: { kind, snapshot: test.initial, reason: "action-not-available" };
			test.stop.mockClear();
			expect((await test.subject.act(test.answer())).kind).toBe(kind);
			expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(true);
			expect(test.speak).toHaveBeenCalledTimes(1);
			expect(test.stop).not.toHaveBeenCalled();
			expect(test.clock.pendingCount).toBe(0);
			test.unsubscribe();
		},
	);

	it("rejects old callback revisions and mismatched session/mode references", async () => {
		const test = setup();
		test.lifecycle.publish(sessionCard(mode, 2));
		for (const reference of [
			test.initial.reference,
			{ ...test.initial.reference, revision: 2, key: "old session" },
			{
				...test.initial.reference,
				revision: 2,
				mode: mode === "study" ? ("practice" as const) : ("study" as const),
			},
		]) {
			expect(await test.subject.act({ kind: "card-reveal", reference })).toEqual({
				kind: "rejected",
				reason: "stale-reference",
			});
		}
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		test.unsubscribe();
		expect(await test.local("card-reveal")).toEqual({ kind: "rejected", reason: "inactive" });
	});

	it("honors committed eligibility changes without repeating metadata-only playback", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		test.stop.mockClear();
		const moved = sessionCard(mode, 2);
		test.lifecycle.publish({
			...moved,
			currentCard: { ...moved.currentCard, currentDeckId: "other" },
		});
		expect(test.stop).toHaveBeenCalledTimes(1);
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: true,
			pronunciationEnabled: false,
			pronunciationWord: null,
		});
		test.subject.setWordLearningDecks({ other: true });
		expect(test.speak).toHaveBeenCalledTimes(1);
		test.subject.setWordLearningDecks({});
		expect(test.subject.getSnapshot().cardPresentation.pronunciationEnabled).toBe(false);
		test.unsubscribe();
	});

	it("retains causal changes that end with the original card signature during a delay", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		const answered = sessionCard(mode, 2, 1, "world");
		test.lifecycle.onAct = async () => {
			test.lifecycle.publish(answered);
			return { kind: "applied", snapshot: answered };
		};
		const pending = test.subject.act(test.answer());
		await flushPromises();
		test.lifecycle.publish(sessionCard(mode, 3));
		test.clock.runNext();
		await pending;
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: true,
		});
		expect(test.speak.mock.calls.map(([word]) => word)).toEqual(["hello", "hello"]);
		test.unsubscribe();
	});

	it("resets autoplay on mode/session changes and on cleanup/setup replay", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		const otherMode = mode === "study" ? "practice" : "study";
		test.lifecycle.publish(sessionCard(otherMode, 2));
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: false,
		});
		await test.local("card-toggle-auto-pronunciation");
		const restarted = sessionCard(otherMode, 3);
		test.lifecycle.publish({
			...restarted,
			reference: { ...restarted.reference, key: "new session" },
		} as typeof restarted);
		expect(test.subject.getSnapshot().cardPresentation.autoPronunciationEnabled).toBe(false);
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		test.unsubscribe();
		const unsubscribeAgain = test.subject.subscribe(() => undefined);
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: false,
		});
		unsubscribeAgain();
	});

	it("clears card controls in inactive modes and stops playback", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		test.stop.mockClear();
		test.lifecycle.publish(idle(2));
		expect(test.stop).toHaveBeenCalledTimes(1);
		expect(test.subject.getSnapshot().cardPresentation).toEqual({
			answerVisible: false,
			autoPronunciationEnabled: false,
			pronunciationEnabled: false,
			pronunciationWord: null,
		});
		expect(
			await test.subject.act({ kind: "card-reveal", reference: test.initial.reference }),
		).toEqual({ kind: "rejected", reason: "action-not-available" });
		test.lifecycle.publish(sessionCard(mode, 3));
		expect(test.subject.getSnapshot().cardPresentation.autoPronunciationEnabled).toBe(false);
		test.unsubscribe();
	});

	it("ignores a late commit result after cleanup and a new subscription", async () => {
		const test = setup();
		const completion = deferred<LifecycleOutcome>();
		test.lifecycle.onAct = () => completion.promise;
		const pending = test.subject.act(test.answer());
		test.unsubscribe();
		const next = sessionCard(mode, 3, 2, "world");
		test.lifecycle.publish(next);
		const unsubscribeAgain = test.subject.subscribe(() => undefined);
		completion.resolve({ kind: "applied", snapshot: sessionCard(mode, 2, 1) });
		expect(await pending).toEqual({ kind: "cancelled" });
		expect(test.subject.getSnapshot().lifecycle).toBe(next);
		expect(test.clock.pendingCount).toBe(0);
		unsubscribeAgain();
	});

	it("preserves a newer reconciliation that arrives before the action result", async () => {
		const test = setup();
		const completion = deferred<LifecycleOutcome>();
		test.lifecycle.onAct = () => completion.promise;
		const pending = test.subject.act(test.answer());
		const committed = sessionCard(mode, 2, 1);
		const reconciled = sessionCard(mode, 3, 1, "changed");
		test.lifecycle.publish(committed);
		test.lifecycle.publish(reconciled);
		completion.resolve({ kind: "applied", snapshot: committed });
		await flushPromises();
		test.clock.runNext();
		await pending;
		expect(test.subject.getSnapshot().lifecycle).toBe(reconciled);
		test.unsubscribe();
	});

	it("remembers leaving the active mode even if it returns during a delay", async () => {
		const test = setup();
		await test.local("card-toggle-auto-pronunciation");
		await test.local("card-reveal");
		const next = sessionCard(mode, 2, 1);
		test.lifecycle.onAct = async () => {
			test.lifecycle.publish(next);
			return { kind: "applied", snapshot: next };
		};
		const pending = test.subject.act(test.answer());
		await flushPromises();
		test.lifecycle.publish(idle(3));
		test.lifecycle.publish(sessionCard(mode, 4));
		test.clock.runNext();
		await pending;
		expect(test.subject.getSnapshot().cardPresentation).toMatchObject({
			answerVisible: false,
			autoPronunciationEnabled: false,
		});
		expect(test.speak).toHaveBeenCalledTimes(1);
		test.unsubscribe();
	});

	it("applies eligibility without enabling autoplay or revealing the answer", async () => {
		const test = setup("reversed");
		test.subject.setWordLearningDecks({});
		await test.local("card-toggle-auto-pronunciation");
		test.subject.setWordLearningDecks({ deck: true });
		expect(test.speak).not.toHaveBeenCalled();
		expect(test.subject.getSnapshot().cardPresentation.answerVisible).toBe(false);
		await test.local("card-reveal");
		expect(test.speak).toHaveBeenCalledTimes(1);
		test.unsubscribe();
	});

	it("keeps automatic errors silent without retrying on duplicate reveal", async () => {
		const test = setup();
		test.speak.mockRejectedValueOnce(new Error("playback failed"));
		await test.local("card-toggle-auto-pronunciation");
		await flushPromises();
		await test.local("card-reveal");
		expect(test.speak).toHaveBeenCalledTimes(1);
		await test.local("card-toggle-auto-pronunciation");
		test.speak.mockImplementationOnce(() => {
			throw new Error("no playback");
		});
		expect((await test.local("card-toggle-auto-pronunciation")).kind).toBe("applied");
		test.unsubscribe();
	});
});

describe("AnswerPresentationTransition", () => {
	it("retains the answered study card, rejects duplicate input, then publishes once after 200 ms", async () => {
		const initial = activeStudy("one", 1);
		const next = activeStudy("two", 2);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		lifecycle.onAct = async () => {
			lifecycle.publish(next);
			return { kind: "applied", snapshot: next };
		};
		const subject = createAnswerPresentationTransition({ lifecycle, clock });
		const listener = vi.fn();
		const unsubscribe = subject.subscribe(listener);

		const pending = subject.act({
			kind: "study-previous",
			reference: initial.reference,
		});
		await flushPromises();

		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "one" } },
			activity: { kind: "transitioning", action: "study-previous" },
		});
		expect(await subject.act({ kind: "study-previous", reference: initial.reference })).toEqual(
			{ kind: "rejected", reason: "busy" },
		);
		expect(clock.delays).toEqual([200]);

		clock.runNext();
		expect(await pending).toEqual({ kind: "applied", studyCompleted: false });
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "two" } },
			activity: { kind: "idle" },
		});
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
	});

	it("publishes the latest lifecycle snapshot when reconciliation happens during the delay", async () => {
		const initial = activeStudy("one", 1);
		const answered = activeStudy("two", 2);
		const reconciled = activeStudy("three", 3);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		lifecycle.onAct = async () => {
			lifecycle.publish(answered);
			return { kind: "applied", snapshot: answered };
		};
		const subject = createAnswerPresentationTransition({ lifecycle, clock });
		const unsubscribe = subject.subscribe(() => undefined);

		const pending = subject.act({
			kind: "study-previous",
			reference: initial.reference,
		});
		await flushPromises();
		lifecycle.publish(reconciled);
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "one" } },
			activity: { kind: "transitioning" },
		});

		clock.runNext();
		expect(await pending).toMatchObject({ kind: "applied" });
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "three" } },
			activity: { kind: "idle" },
		});
		unsubscribe();
	});

	it("uses the completion delays for study completion and practice results", async () => {
		const cases = [
			{
				initial: activeStudy("one", 1),
				next: idle(2),
				action: { kind: "study-answer" as const, rating: 3 as const },
				delay: 300,
				studyCompleted: true,
			},
			{
				initial: activePractice("one", 1),
				next: practiceResult(2),
				action: { kind: "practice-answer" as const, correct: true },
				delay: 300,
				studyCompleted: false,
			},
		];

		for (const testCase of cases) {
			const lifecycle = new ScriptedLifecycle(testCase.initial);
			const clock = new FakeClock();
			lifecycle.onAct = async () => {
				lifecycle.publish(testCase.next);
				return { kind: "applied", snapshot: testCase.next };
			};
			const subject = createAnswerPresentationTransition({ lifecycle, clock });
			const unsubscribe = subject.subscribe(() => undefined);
			const pending =
				testCase.action.kind === "study-answer"
					? subject.act({
							...testCase.action,
							reference: testCase.initial
								.reference as ActiveStudySnapshot["reference"],
						})
					: subject.act({
							...testCase.action,
							reference: testCase.initial
								.reference as ActivePracticeSnapshot["reference"],
						});
			await flushPromises();
			expect(clock.delays).toEqual([testCase.delay]);
			clock.runNext();
			expect(await pending).toEqual({
				kind: "applied",
				studyCompleted: testCase.studyCompleted,
			});
			unsubscribe();
		}
	});

	it("releases immediately on lifecycle failure and returns the failure for the adapter", async () => {
		const initial = activeStudy("one", 1);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		lifecycle.onAct = async () => ({
			kind: "failed",
			failure: { code: "persistence-failed", message: "disk unavailable", retryable: true },
			snapshot: initial,
		});
		const subject = createAnswerPresentationTransition({ lifecycle, clock });
		const unsubscribe = subject.subscribe(() => undefined);

		expect(
			await subject.act({ kind: "study-answer", reference: initial.reference, rating: 3 }),
		).toEqual({ kind: "failed", message: "disk unavailable", retryable: true });
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "one" } },
			activity: { kind: "idle" },
		});
		expect(clock.pendingCount).toBe(0);
		unsubscribe();
	});

	it("publishes incorrect spelling feedback immediately and clears it on a different card", async () => {
		const initial = activeSpelling("one", 1);
		const correction = activeSpelling("one", 2, "correction");
		const nextCard = activeSpelling("two", 3);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		lifecycle.onAct = async () => {
			lifecycle.publish(correction);
			return {
				kind: "applied",
				snapshot: correction,
				feedback: feedback("retrieval-incorrect"),
			};
		};
		const subject = createAnswerPresentationTransition({ lifecycle, clock });
		const unsubscribe = subject.subscribe(() => undefined);

		expect(
			await subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "helo",
			}),
		).toEqual({
			kind: "applied",
			studyCompleted: false,
			feedback: feedback("retrieval-incorrect"),
		});
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { phase: "correction", currentCard: { identity: "one" } },
			activity: { kind: "idle" },
			spellingFeedback: { kind: "retrieval-incorrect" },
		});
		expect(clock.pendingCount).toBe(0);

		lifecycle.publish(nextCard);
		expect(subject.getSnapshot().spellingFeedback).toBeNull();
		unsubscribe();
	});

	it("holds correct spelling feedback through pronunciation preparation and its remaining delay", async () => {
		const initial = activeSpelling("one", 1);
		const next = activeSpelling("two", 2);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		const preparation = deferred<number>();
		const prepareSpellingAdvance = vi.fn(() => preparation.promise);
		lifecycle.onAct = async () => {
			lifecycle.publish(next);
			return {
				kind: "applied",
				snapshot: next,
				feedback: feedback("retrieval-correct"),
			};
		};
		const subject = createAnswerPresentationTransition({
			lifecycle,
			clock,
			prepareSpellingAdvance,
		});
		const unsubscribe = subject.subscribe(() => undefined);

		const pending = subject.act({
			kind: "spelling-answer",
			reference: initial.reference,
			input: "hello",
		});
		await flushPromises();
		expect(prepareSpellingAdvance).toHaveBeenCalledWith(feedback("retrieval-correct"));
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "one" } },
			activity: { kind: "transitioning" },
			spellingFeedback: { kind: "retrieval-correct" },
		});
		expect(clock.pendingCount).toBe(0);

		preparation.resolve(550);
		await flushPromises();
		expect(clock.delays).toEqual([550]);
		clock.runNext();
		expect(await pending).toMatchObject({ kind: "applied" });
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "two" } },
			activity: { kind: "idle" },
			spellingFeedback: null,
		});
		unsubscribe();
	});

	it("cancels a pending timer on the last unsubscribe and resumes from the latest lifecycle", async () => {
		const initial = activeStudy("one", 1);
		const next = activeStudy("two", 2);
		const lifecycle = new ScriptedLifecycle(initial);
		const clock = new FakeClock();
		lifecycle.onAct = async () => {
			lifecycle.publish(next);
			return { kind: "applied", snapshot: next };
		};
		const subject = createAnswerPresentationTransition({ lifecycle, clock });
		const unsubscribe = subject.subscribe(() => undefined);
		const pending = subject.act({
			kind: "study-previous",
			reference: initial.reference,
		});
		await flushPromises();
		expect(clock.pendingCount).toBe(1);

		unsubscribe();
		expect(clock.pendingCount).toBe(0);
		expect(await pending).toEqual({ kind: "cancelled" });

		const unsubscribeAgain = subject.subscribe(() => undefined);
		expect(subject.getSnapshot()).toMatchObject({
			lifecycle: { currentCard: { identity: "two" } },
			activity: { kind: "idle" },
		});
		unsubscribeAgain();
	});

	describe("spelling auto pronunciation integration", () => {
		it("identifies correct feedback for auto pronunciation", () => {
			expect(shouldAutoPronounceSpellingFeedback("retrieval-correct")).toBe(true);
			expect(shouldAutoPronounceSpellingFeedback("correction-correct")).toBe(true);
			expect(shouldAutoPronounceSpellingFeedback("retrieval-incorrect")).toBe(false);
			expect(shouldAutoPronounceSpellingFeedback("correction-incorrect")).toBe(false);
		});

		it("auto-pronounces and advances with zero delay on successful playback", async () => {
			const initial = activeSpelling("one", 1);
			const next = activeSpelling("two", 2);
			const lifecycle = new ScriptedLifecycle(initial);
			const clock = new FakeClock();
			const speakMock = vi.fn().mockResolvedValue({ status: "success", source: "local" });
			const runtime = {
				getSnapshot: () => ({
					settings: { spellingAutoPlay: true },
				}),
				speak: speakMock,
				stop: vi.fn(),
			} as unknown as PronunciationRuntime;

			lifecycle.onAct = async () => {
				lifecycle.publish(next);
				return {
					kind: "applied",
					snapshot: next,
					feedback: feedback("retrieval-correct"),
				};
			};

			const subject = createAnswerPresentationTransition({
				lifecycle,
				clock,
				pronunciationRuntime: runtime,
			});
			const unsubscribe = subject.subscribe(() => undefined);

			const pending = subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "hello",
			});
			await flushPromises();

			expect(speakMock).toHaveBeenCalledWith("hello", "auto");
			expect(clock.delays).toContain(0);
			expect(clock.pendingCount).toBe(1);
			clock.runNext();

			expect(await pending).toMatchObject({ kind: "applied" });
			expect(subject.getSnapshot().activity.kind).toBe("idle");
			unsubscribe();
		});

		it("restores remaining 550ms delay on pronunciation failure", async () => {
			const initial = activeSpelling("one", 1);
			const next = activeSpelling("two", 2);
			const lifecycle = new ScriptedLifecycle(initial);
			const clock = new FakeClock();
			let now = 1000;
			const speakMock = vi.fn().mockImplementation(async () => {
				now += 100;
				return { status: "failed", reason: "playback" };
			});
			const runtime = {
				getSnapshot: () => ({
					settings: { spellingAutoPlay: true },
				}),
				speak: speakMock,
				stop: vi.fn(),
			} as unknown as PronunciationRuntime;

			lifecycle.onAct = async () => {
				lifecycle.publish(next);
				return {
					kind: "applied",
					snapshot: next,
					feedback: feedback("retrieval-correct"),
				};
			};

			const subject = createAnswerPresentationTransition({
				lifecycle,
				clock,
				pronunciationRuntime: runtime,
				now: () => now,
			});
			const unsubscribe = subject.subscribe(() => undefined);

			const pending = subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "hello",
			});
			await flushPromises();

			expect(speakMock).toHaveBeenCalledWith("hello", "auto");
			// 550 - 100 = 450
			expect(clock.delays).toContain(450);
			clock.runNext();

			expect(await pending).toMatchObject({ kind: "applied" });
			unsubscribe();
		});

		it("stops playback when the 8000ms maximum wait times out", async () => {
			const initial = activeSpelling("one", 1);
			const next = activeSpelling("two", 2);
			const lifecycle = new ScriptedLifecycle(initial);
			const clock = new FakeClock();
			let now = 1000;
			const stopMock = vi.fn();
			const speakMock = vi.fn().mockReturnValue(new Promise(() => undefined));
			const runtime = {
				getSnapshot: () => ({
					settings: { spellingAutoPlay: true },
				}),
				speak: speakMock,
				stop: stopMock,
			} as unknown as PronunciationRuntime;

			lifecycle.onAct = async () => {
				lifecycle.publish(next);
				return {
					kind: "applied",
					snapshot: next,
					feedback: feedback("retrieval-correct"),
				};
			};

			const subject = createAnswerPresentationTransition({
				lifecycle,
				clock,
				pronunciationRuntime: runtime,
				now: () => now,
			});
			const unsubscribe = subject.subscribe(() => undefined);

			const pending = subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "hello",
			});
			await flushPromises();

			expect(clock.delays).toContain(8000);
			now += 8000;
			clock.runNext(); // trigger timeout
			await flushPromises();

			expect(stopMock).toHaveBeenCalled();
			expect(clock.delays).toContain(0);
			clock.runNext(); // trigger 0ms delay

			expect(await pending).toMatchObject({ kind: "applied" });
			unsubscribe();
		});

		it("skips pronunciation and uses standard 550ms delay when autoplay is disabled", async () => {
			const initial = activeSpelling("one", 1);
			const next = activeSpelling("two", 2);
			const lifecycle = new ScriptedLifecycle(initial);
			const clock = new FakeClock();
			const speakMock = vi.fn();
			const runtime = {
				getSnapshot: () => ({
					settings: { spellingAutoPlay: false },
				}),
				speak: speakMock,
				stop: vi.fn(),
			} as unknown as PronunciationRuntime;

			lifecycle.onAct = async () => {
				lifecycle.publish(next);
				return {
					kind: "applied",
					snapshot: next,
					feedback: feedback("retrieval-correct"),
				};
			};

			const subject = createAnswerPresentationTransition({
				lifecycle,
				clock,
				pronunciationRuntime: runtime,
			});
			const unsubscribe = subject.subscribe(() => undefined);

			const pending = subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "hello",
			});
			await flushPromises();

			expect(speakMock).not.toHaveBeenCalled();
			expect(clock.delays).toEqual([550]);
			clock.runNext();

			expect(await pending).toMatchObject({ kind: "applied" });
			unsubscribe();
		});

		it("stops pronunciation on cancellation during playback", async () => {
			const initial = activeSpelling("one", 1);
			const next = activeSpelling("two", 2);
			const lifecycle = new ScriptedLifecycle(initial);
			const clock = new FakeClock();
			const stopMock = vi.fn();
			const speakMock = vi.fn().mockReturnValue(new Promise(() => undefined));
			const runtime = {
				getSnapshot: () => ({
					settings: { spellingAutoPlay: true },
				}),
				speak: speakMock,
				stop: stopMock,
			} as unknown as PronunciationRuntime;

			lifecycle.onAct = async () => {
				lifecycle.publish(next);
				return {
					kind: "applied",
					snapshot: next,
					feedback: feedback("retrieval-correct"),
				};
			};

			const subject = createAnswerPresentationTransition({
				lifecycle,
				clock,
				pronunciationRuntime: runtime,
			});
			const unsubscribe = subject.subscribe(() => undefined);

			const pending = subject.act({
				kind: "spelling-answer",
				reference: initial.reference,
				input: "hello",
			});
			await flushPromises();

			unsubscribe();
			expect(stopMock).toHaveBeenCalled();
			expect(await pending).toEqual({ kind: "cancelled" });
		});
	});
});

describe("challenge answer presentation", () => {
	it("serializes challenge answers and retains error feedback until the shared continue action", async () => {
		const initial = {
			...activeStudy("one", 1),
			mode: "challenge" as const,
			reference: {
				kind: "active" as const,
				mode: "challenge" as const,
				revision: 1,
				key: "challenge",
			},
			sourceDeck: { id: "deck", name: "Deck" },
			questionMode: "spelling" as const,
			phase: "question" as const,
			feedback: null,
			roundProgress: {
				level: 1,
				totalLevels: 1,
				passedInLevel: 0,
				currentLevelTotal: 1,
				completedAcrossRound: 0,
				totalAcrossRound: 1,
			},
			removedCardCount: 0,
		};
		const feedback = {
			...initial,
			revision: 2,
			reference: { ...initial.reference, revision: 2 },
			phase: "feedback" as const,
			feedback: { correct: false as const, expectedAnswer: "one", submittedInput: "wrong" },
		};
		const lifecycle = new ScriptedLifecycle(initial);
		lifecycle.onAct = async () => {
			lifecycle.publish(feedback);
			return { kind: "applied", snapshot: feedback };
		};
		const clock = new FakeClock();
		const transition = createAnswerPresentationTransition({ lifecycle, clock });
		const unsubscribe = transition.subscribe(() => {});
		const pending = transition.act({
			kind: "challenge-answer",
			reference: initial.reference,
			input: "wrong",
		});
		await flushPromises();
		expect(transition.getSnapshot().lifecycle).toBe(initial);
		expect(lifecycle.actions[0]?.action).toEqual({ kind: "answer", input: "wrong" });
		expect(
			(
				await transition.act({
					kind: "challenge-answer",
					reference: initial.reference,
					input: "one",
				})
			).kind,
		).toBe("rejected");
		clock.runNext();
		await pending;
		expect(transition.getSnapshot().lifecycle).toEqual(feedback);
		expect(clock.pendingCount).toBe(0);
		unsubscribe();
		expect(lifecycle.getSnapshot()).toEqual(feedback);
	});
});
