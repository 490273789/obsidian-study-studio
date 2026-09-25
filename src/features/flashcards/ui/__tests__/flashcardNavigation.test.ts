import { describe, expect, it, vi } from "vitest";
import type { DeckHome, DeckHomeAction, DeckHomeOutcome } from "../../domain/decks/deckHome";
import type {
	ActionFor,
	ActiveStudySnapshot,
	LifecycleOutcome,
	LifecycleReference,
	SessionLifecycle,
	SessionLifecycleSnapshot,
	SessionStartRequest,
	StudyResultSnapshot,
} from "../../domain/sessions/sessionLifecycle";
import { FlashcardNavigation } from "../flashcardNavigation";

class ScriptedLifecycle implements SessionLifecycle {
	readonly listeners = new Set<() => void>();
	readonly actions: Array<{ reference: LifecycleReference; action: unknown }> = [];
	startImpl: (request: SessionStartRequest) => Promise<LifecycleOutcome> = async () =>
		rejected(this.snapshot);
	actImpl: (reference: LifecycleReference, action: unknown) => Promise<LifecycleOutcome> =
		async () => rejected(this.snapshot);

	constructor(private snapshot: SessionLifecycleSnapshot) {}

	getSnapshot(): SessionLifecycleSnapshot {
		return this.snapshot;
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	start(request: SessionStartRequest): Promise<LifecycleOutcome> {
		return this.startImpl(request);
	}
	act<R extends LifecycleReference>(
		reference: R,
		action: ActionFor<R>,
	): Promise<LifecycleOutcome> {
		this.actions.push({ reference, action });
		return this.actImpl(reference, action);
	}
	publish(snapshot: SessionLifecycleSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}
}

class ScriptedHome implements Pick<DeckHome, "act"> {
	readonly actions: DeckHomeAction[] = [];
	actImpl: (action: DeckHomeAction) => Promise<DeckHomeOutcome> = async () => ({
		kind: "applied",
	});
	act(action: DeckHomeAction): Promise<DeckHomeOutcome> {
		this.actions.push(action);
		return this.actImpl(action);
	}
}

function idle(
	revision = 1,
	lastEnd: {
		id: string;
		reason: "source-change";
		mode: "study";
		originDeck: { id: string; name: string };
		answerEventCount: number;
	} | null = null,
): SessionLifecycleSnapshot {
	return { kind: "idle", revision, reference: { kind: "idle", key: "idle", revision }, lastEnd };
}

function active(revision = 1, key = "active"): ActiveStudySnapshot {
	return {
		kind: "active",
		mode: "study",
		revision,
		reference: { kind: "active", mode: "study", key, revision },
		originDeck: { id: "deck", name: "Deck" },
		startTime: 0,
		currentCard: {
			identity: "one",
			currentDeckId: "deck",
			front: "one",
			back: "one",
			sourceFile: "deck.md",
			indexInFile: 0,
		},
		progress: { current: 1, completed: 0, total: 1, percent: 0, label: "1/1" },
		answerEventCount: 0,
		direction: "normal",
		canPrevious: false,
	};
}

function result(revision = 1, key = "result"): StudyResultSnapshot {
	return {
		kind: "result",
		mode: "study",
		revision,
		reference: { kind: "result", mode: "study", key, revision },
		originDeck: { id: "deck", name: "Deck" },
		completedAt: 0,
		cardCount: 1,
		totalReviews: 1,
		timeSpent: 1,
		ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 },
		setupDefaults: {
			mode: "study",
			deckId: "deck",
			studyOrder: "sequential",
			direction: "normal",
		},
	};
}

function rejected(snapshot: SessionLifecycleSnapshot): LifecycleOutcome {
	return { kind: "rejected", reason: "stale-reference", snapshot };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function flush(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

function mounted(initial: SessionLifecycleSnapshot = idle()) {
	const lifecycle = new ScriptedLifecycle(initial);
	const home = new ScriptedHome();
	const notify = vi.fn();
	const navigation = new FlashcardNavigation({
		lifecycle,
		home,
		ownerId: "view-a",
		language: "zh",
		notify,
	});
	const cleanup = navigation.mount();
	return { lifecycle, home, notify, navigation, cleanup };
}

describe("FlashcardNavigation", () => {
	it("only navigates to deck destinations accepted by DeckHome", async () => {
		const { navigation, home } = mounted();
		for (const destination of ["study", "practice", "spelling", "word-list"] as const) {
			home.actImpl = async () => ({ kind: "navigation", destination, deckId: "deck" });
			await navigation.navigate(destination, "deck");
			expect(navigation.getSnapshot().view).toEqual({
				type: destination === "word-list" ? "word-list" : `${destination}-setup`,
				deckId: "deck",
			});
		}
		home.actImpl = async () => ({ kind: "rejected", reason: "deck-empty" });
		await navigation.navigate("study", "missing");
		expect(navigation.getSnapshot().view).toEqual({ type: "word-list", deckId: "deck" });
	});

	it("does not let an older navigation overwrite home or a newer navigation", async () => {
		const { navigation, home } = mounted();
		const first = deferred<DeckHomeOutcome>();
		home.actImpl = async () => first.promise;
		const pending = navigation.navigate("study", "deck");
		navigation.home();
		first.resolve({ kind: "navigation", destination: "study", deckId: "deck" });
		await pending;
		expect(navigation.getSnapshot().view).toEqual({ type: "home" });

		const older = deferred<DeckHomeOutcome>();
		home.actImpl = async (action) =>
			action.kind === "navigate" && action.deckId === "old"
				? older.promise
				: { kind: "navigation", destination: "word-list", deckId: "new" };
		const oldPending = navigation.navigate("study", "old");
		await navigation.navigate("word-list", "new");
		older.resolve({ kind: "navigation", destination: "study", deckId: "old" });
		await oldPending;
		expect(navigation.getSnapshot().view).toEqual({ type: "word-list", deckId: "new" });
	});

	it("reports failed starts and suppresses their completion after cleanup", async () => {
		const { navigation, lifecycle, notify, cleanup } = mounted();
		lifecycle.startImpl = async () => ({
			kind: "failed",
			failure: { code: "persistence-failed", message: "保存失败", retryable: true },
			snapshot: idle(),
		});
		await navigation.start({
			mode: "study",
			deckId: "deck",
			studyOrder: "sequential",
			direction: "normal",
		});
		expect(notify).toHaveBeenCalledWith("保存失败");
		const late = deferred<LifecycleOutcome>();
		lifecycle.startImpl = async () => late.promise;
		const pending = navigation.start({
			mode: "study",
			deckId: "deck",
			studyOrder: "sequential",
			direction: "normal",
		});
		cleanup();
		late.resolve({
			kind: "failed",
			failure: { code: "persistence-failed", message: "不应显示", retryable: true },
			snapshot: idle(),
		});
		await pending;
		expect(notify).not.toHaveBeenCalledWith("不应显示");
	});

	it("cancels an exit confirmation when its reference changes, including a revision-only change", async () => {
		const initial = active(1, "same");
		const { navigation, lifecycle } = mounted(initial);
		const pending = navigation.exit(initial.reference);
		expect(navigation.getSnapshot().confirmation).not.toBeNull();
		lifecycle.publish(active(2, "same"));
		await pending;
		expect(navigation.getSnapshot().confirmation).toBeNull();
		expect(lifecycle.actions).toEqual([]);
	});

	it("routes home only after a successful exit and reports failed or busy exits", async () => {
		const initial = active();
		const { navigation, lifecycle, notify } = mounted(initial);
		navigation.stats();
		lifecycle.actImpl = async () => ({
			kind: "failed",
			failure: { code: "persistence-failed", message: "退出失败", retryable: true },
			snapshot: initial,
		});
		const failed = navigation.exit(initial.reference);
		navigation.respond(navigation.getSnapshot().confirmation!.id, true);
		await failed;
		expect(notify).toHaveBeenCalledWith("退出失败");
		expect(navigation.getSnapshot().view).toEqual({ type: "stats" });

		const busy = active(2, "busy");
		lifecycle.publish(busy);
		lifecycle.actImpl = async () => ({ kind: "rejected", reason: "busy", snapshot: busy });
		const rejected = navigation.exit(busy.reference);
		navigation.respond(navigation.getSnapshot().confirmation!.id, true);
		await rejected;
		expect(navigation.getSnapshot().view).toEqual({ type: "stats" });

		const applied = active(3, "applied");
		lifecycle.publish(applied);
		lifecycle.actImpl = async () => {
			const ended = idle(4);
			lifecycle.publish(ended);
			return { kind: "applied", snapshot: ended };
		};
		const successful = navigation.exit(applied.reference);
		navigation.respond(navigation.getSnapshot().confirmation!.id, true);
		await successful;
		expect(navigation.getSnapshot().view).toEqual({ type: "home" });
	});

	it("ignores an old confirmation response and blocks confirmation execution after teardown", async () => {
		const { navigation, cleanup } = mounted(active());
		const execute = vi.fn(async () => undefined);
		const first = navigation.confirm(
			{ title: "a", message: "a", confirmText: "ok", tone: "primary" },
			execute,
		);
		const firstId = navigation.getSnapshot().confirmation?.id;
		const second = navigation.confirm(
			{ title: "b", message: "b", confirmText: "ok", tone: "primary" },
			execute,
		);
		const secondId = navigation.getSnapshot().confirmation?.id;
		expect(firstId).not.toBe(secondId);
		navigation.respond(firstId!, true);
		expect(navigation.getSnapshot().confirmation?.id).toBe(secondId);
		navigation.respond(secondId!, true);
		cleanup();
		await Promise.all([first, second]);
		expect(execute).not.toHaveBeenCalled();
	});

	it("does not execute a confirmed callback when a new confirmation replaces it in the same turn", async () => {
		const { navigation } = mounted(active());
		const firstExecute = vi.fn(async () => undefined);
		const secondExecute = vi.fn(async () => undefined);
		const first = navigation.confirm(
			{ title: "first", message: "first", confirmText: "ok", tone: "primary" },
			firstExecute,
		);
		navigation.respond(navigation.getSnapshot().confirmation!.id, true);
		const second = navigation.confirm(
			{ title: "second", message: "second", confirmText: "ok", tone: "primary" },
			secondExecute,
		);
		navigation.respond(navigation.getSnapshot().confirmation!.id, true);
		await Promise.all([first, second]);
		expect(firstExecute).not.toHaveBeenCalled();
		expect(secondExecute).toHaveBeenCalledOnce();
	});

	it("uses the reference at result click time and does not route a later lifecycle", async () => {
		const initial = result(1, "result-a");
		const { navigation, lifecycle } = mounted(initial);
		const pendingOutcome = deferred<LifecycleOutcome>();
		lifecycle.actImpl = async () => pendingOutcome.promise;
		const pending = navigation.result(initial.reference, "restart");
		const replacement = result(2, "result-b");
		lifecycle.publish(replacement);
		pendingOutcome.resolve({ kind: "applied", snapshot: idle(3) });
		await pending;
		expect(navigation.getSnapshot().view).toEqual({ type: "home" });
		expect(lifecycle.actions[0]).toMatchObject({
			reference: initial.reference,
			action: { kind: "dismiss" },
		});
	});

	it("routes result home, restart, and retry through their lifecycle actions", async () => {
		const initial = result();
		const { navigation, lifecycle } = mounted(initial);
		lifecycle.actImpl = async (_reference, action) => {
			const next =
				(action as { kind: string }).kind === "retry-incorrect"
					? active(2, "retry")
					: idle(2);
			lifecycle.publish(next);
			return { kind: "applied", snapshot: next };
		};
		await navigation.result(initial.reference, "restart");
		expect(navigation.getSnapshot().view).toEqual({
			type: "study-setup",
			deckId: "deck",
			initialStudyOrder: "sequential",
			initialDirection: "normal",
		});
		lifecycle.publish(initial);
		await navigation.result(initial.reference, "home");
		expect(navigation.getSnapshot().view).toEqual({ type: "home" });
		lifecycle.publish(initial);
		await navigation.result(initial.reference, "retry-incorrect");
		expect(navigation.getSnapshot().view).toEqual({ type: "home" });
		expect(lifecycle.actions.map(({ action }) => (action as { kind: string }).kind)).toEqual([
			"dismiss",
			"dismiss",
			"retry-incorrect",
		]);
	});

	it("returns every mounted view home on a source-change end, acknowledges once per shared lifecycle", async () => {
		const lifecycle = new ScriptedLifecycle(active());
		const home = new ScriptedHome();
		const first = new FlashcardNavigation({
			lifecycle,
			home,
			ownerId: "one",
			language: "zh",
			notify: vi.fn(),
		});
		const second = new FlashcardNavigation({
			lifecycle,
			home,
			ownerId: "two",
			language: "zh",
			notify: vi.fn(),
		});
		const cleanupOne = first.mount();
		const cleanupTwo = second.mount();
		first.stats();
		second.stats();
		lifecycle.actImpl = async () => {
			expect(first.getSnapshot().view).toEqual({ type: "home" });
			expect(second.getSnapshot().view).toEqual({ type: "home" });
			const acknowledged = idle(3);
			lifecycle.publish(acknowledged);
			return { kind: "applied", snapshot: acknowledged };
		};
		const ended = idle(2, {
			id: "ended",
			reason: "source-change",
			mode: "study",
			originDeck: { id: "deck", name: "Deck" },
			answerEventCount: 0,
		});
		lifecycle.publish(ended);
		expect(first.getSnapshot().view).toEqual({ type: "home" });
		expect(second.getSnapshot().view).toEqual({ type: "home" });
		expect(lifecycle.actions).toEqual([]);
		await flush();
		expect(
			lifecycle.actions.filter(
				({ action }) => (action as { kind: string }).kind === "acknowledge-end",
			),
		).toHaveLength(1);
		cleanupOne();
		cleanupTwo();
	});

	it("releases its owner, clears a pending confirmation, and supports setup-cleanup-setup", async () => {
		const { navigation, lifecycle, home, cleanup } = mounted(active());
		void navigation.confirm(
			{ title: "x", message: "x", confirmText: "ok", tone: "primary" },
			async () => undefined,
		);
		cleanup();
		expect(navigation.getSnapshot().confirmation).toBeNull();
		expect(lifecycle.listeners).toHaveLength(0);
		expect(home.actions).toContainEqual({ kind: "release-owner", ownerId: "view-a" });
		const secondCleanup = navigation.mount();
		expect(lifecycle.listeners).toHaveLength(1);
		secondCleanup();
	});

	it("releases the exact migration continuation when preparation completes after teardown", async () => {
		const { navigation, home, cleanup } = mounted();
		const prepared = deferred<DeckHomeOutcome>();
		home.actImpl = async (action) =>
			action.kind === "request-migration" ? prepared.promise : { kind: "applied" };
		const pending = navigation.requestMigration();
		cleanup();
		prepared.resolve({
			kind: "confirmation-required",
			continuation: "old",
			scope: { kind: "all" },
			sourceCount: 1,
			cardCount: 1,
		});
		await pending;
		expect(home.actions).toContainEqual({
			kind: "continue",
			ownerId: "view-a",
			continuation: "old",
			confirmed: false,
		});
	});

	it("keeps the first result navigation when a duplicate action arrives during its commit", async () => {
		const initial = result();
		const { navigation, lifecycle } = mounted(initial);
		const committed = deferred<LifecycleOutcome>();
		lifecycle.actImpl = async () => committed.promise;
		const first = navigation.result(initial.reference, "restart");
		await navigation.result(initial.reference, "restart");
		expect(lifecycle.actions).toHaveLength(1);
		const ended = idle(2);
		lifecycle.publish(ended);
		committed.resolve({ kind: "applied", snapshot: ended });
		await first;
		expect(navigation.getSnapshot().view).toMatchObject({
			type: "study-setup",
			deckId: "deck",
		});
	});

	it("cancels ordinary confirmations when source changes end their session", async () => {
		const { navigation, lifecycle } = mounted(active());
		const execute = vi.fn(async () => undefined);
		const pending = navigation.confirm(
			{ title: "delete", message: "delete", confirmText: "ok", tone: "danger" },
			execute,
		);
		const oldId = navigation.getSnapshot().confirmation!.id;
		lifecycle.publish(
			idle(2, {
				id: "ended",
				reason: "source-change",
				mode: "study",
				originDeck: { id: "deck", name: "Deck" },
				answerEventCount: 0,
			}),
		);
		expect(navigation.getSnapshot().confirmation).toBeNull();
		navigation.respond(oldId, true);
		await pending;
		expect(execute).not.toHaveBeenCalled();
	});
});
