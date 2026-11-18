import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
	CardDirection,
	Deck,
	FlashCard,
	FlashcardSettings,
	SpellingCardProgress,
	StudySettings,
	StudyRating,
} from "../../../../../core/shared/types";
import { createSessionLifecycle, type SessionLifecycleRepository } from "../sessionLifecycle";
import type {
	SessionCommit,
	SessionCommitResult,
	SessionSourceChange,
} from "../sessionPersistence";
import type { PendingStudyHistoryEntry } from "../../history/studyHistory";
import type { LearningActivityRecord } from "../../history/dailyLearningActivity";

const DECK_ID = "notes/deck.md";

function makeCard(id: string, front = `front ${id}`, indexInFile = 0): FlashCard {
	return {
		id,
		front,
		back: `back ${id}`,
		fsrsCard: createEmptyCard(new Date("2026-08-01T00:00:00.000Z")),
		sourceFile: DECK_ID,
		indexInFile,
	};
}

function makeDeck(cards: FlashCard[]): Deck {
	return {
		id: DECK_ID,
		name: "Deck",
		filePath: DECK_ID,
		tag: "#word",
		cards,
		studyCount: 0,
		lastStudied: null,
	};
}

class MemoryLifecycleRepository implements SessionLifecycleRepository {
	getRevision() {
		return this.commits.length;
	}
	getDeckStructureRevision() {
		return this.structureRevision;
	}
	structureRevision = 0;
	getChallengeProgressRevision() {
		return 0;
	}
	getAllDecks() {
		return [...this.decks.values()];
	}
	getChallengeProgress() {
		return null;
	}
	readonly decks = new Map<string, Deck>();
	readonly history: PendingStudyHistoryEntry[] = [];
	readonly activity: LearningActivityRecord[] = [];
	readonly spellingProgress: Record<string, SpellingCardProgress> = {};
	commits: SessionCommit[] = [];
	failNextCommit = false;
	rejectNextCommit: "card-missing" | "challenge-progress-changed" | null = null;
	commitBarrier: Promise<void> | null = null;
	settings: Pick<FlashcardSettings, "wordLearningDecks"> = {
		wordLearningDecks: { [DECK_ID]: true },
	};
	private readonly sourceChangeListeners = new Set<(change: SessionSourceChange) => void>();

	constructor(cards: FlashCard[]) {
		this.decks.set(DECK_ID, makeDeck(cards));
	}

	subscribeSourceChanges(listener: (change: SessionSourceChange) => void): () => void {
		this.sourceChangeListeners.add(listener);
		return () => this.sourceChangeListeners.delete(listener);
	}

	emitSourceChange(): void {
		const change: SessionSourceChange = {
			deckStructureRevision: this.structureRevision,
			challengeProgressRevision: 0,
		};
		for (const listener of this.sourceChangeListeners) listener(change);
	}

	getDeck(id: string): Deck | undefined {
		return this.decks.get(id);
	}

	getCard(deckId: string, cardId: string): FlashCard | undefined {
		const origin = this.decks.get(deckId)?.cards.find((card) => card.id === cardId);
		if (origin) return origin;
		for (const deck of this.decks.values()) {
			const card = deck.cards.find((candidate) => candidate.id === cardId);
			if (card) return card;
		}
		return undefined;
	}

	getCardsForDay(deckId: string): FlashCard[] {
		return [...(this.decks.get(deckId)?.cards ?? [])];
	}

	getEffectiveStudySettings(): StudySettings {
		return {
			dailyNewCards: 20,
			dailyReviewCards: 100,
			studyOrder: "sequential",
			fsrsParameters: { requestRetention: 0.9, maximumInterval: 365 },
		};
	}

	getSettings(): Pick<FlashcardSettings, "wordLearningDecks"> {
		return this.settings;
	}

	getSpellingProgress(): Record<string, SpellingCardProgress> {
		return Object.fromEntries(
			Object.entries(this.spellingProgress).map(([identity, progress]) => [
				identity,
				{ ...progress },
			]),
		);
	}

	rateStudyCard(card: Card): { fsrsCard: Card; repeatInSession: boolean } {
		return {
			fsrsCard: { ...card, reps: card.reps + 1, state: State.Review },
			repeatInSession: false,
		};
	}

	async commitSession(commit: SessionCommit): Promise<SessionCommitResult> {
		if (this.rejectNextCommit) {
			const reason = this.rejectNextCommit;
			this.rejectNextCommit = null;
			return { kind: "rejected", reason, message: "rejected", retryable: true };
		}
		if (this.failNextCommit) {
			this.failNextCommit = false;
			return { kind: "failed", message: "disk unavailable", retryable: true };
		}
		if (this.commitBarrier) await this.commitBarrier;
		this.commits.push(commit);
		for (const schedule of commit.cardSchedules ?? []) {
			const card = this.getCard(schedule.deckId, schedule.cardId);
			if (card) card.fsrsCard = schedule.fsrsCard;
		}
		for (const attempt of commit.spellingAttempts ?? []) {
			const current = this.spellingProgress[attempt.cardId] ?? {
				attempts: 0,
				correctAttempts: 0,
				correctStreak: 0,
				lastAttemptAt: attempt.attemptedAt,
			};
			this.spellingProgress[attempt.cardId] = {
				...current,
				attempts: current.attempts + 1,
				correctAttempts: current.correctAttempts + (attempt.correct ? 1 : 0),
				correctStreak: attempt.correct ? current.correctStreak + 1 : 0,
				lastAttemptAt: attempt.attemptedAt,
			};
		}
		for (const record of commit.records ?? []) {
			if (record.history) {
				this.history.push({
					deckId: record.deckId,
					deckName: record.deckName,
					mode: record.mode,
					cardCount: record.history.cardCount,
					duration: record.history.durationSeconds,
					occurredAt: record.occurredAt,
				});
			}
			this.activity.push({
				kind: "session",
				mode: record.mode,
				completion: record.activity.completion,
				answerCount: record.activity.answerCount,
				...(record.activity.completedAnswerCount === undefined
					? {}
					: { completedAnswerCount: record.activity.completedAnswerCount }),
				durationSeconds: record.activity.durationSeconds,
				occurredAt: record.occurredAt,
			});
			if (record.mode === "study" && record.activity.completion === "completed") {
				const deck = this.decks.get(record.deckId);
				if (deck) deck.studyCount++;
			}
		}
		return { kind: "applied", receipt: { challengeProgressRevision: 0 } };
	}
}

function makeLifecycle(cards: FlashCard[]) {
	const repository = new MemoryLifecycleRepository(cards);
	let now = 1_000;
	const wiring = createSessionLifecycle(repository, {
		now: () => now,
		shuffle: (identities) => [...identities],
	});
	return {
		...wiring,
		repository,
		setNow(value: number) {
			now = value;
		},
	};
}

async function completeStudy(
	subject: ReturnType<typeof makeLifecycle>,
	ratings: StudyRating[],
	direction: CardDirection = "normal",
) {
	await subject.lifecycle.start({
		mode: "study",
		deckId: DECK_ID,
		studyOrder: "sequential",
		direction,
	});
	for (const rating of ratings) {
		const active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active study");
		expect(
			await subject.lifecycle.act(active.reference, { kind: "answer", rating }),
		).toMatchObject({
			kind: "applied",
		});
	}
	const result = subject.lifecycle.getSnapshot();
	if (result.kind !== "result" || result.mode !== "study") throw new Error("study result");
	return result;
}

async function answerPractice(subject: ReturnType<typeof makeLifecycle>, correct: boolean) {
	const active = subject.lifecycle.getSnapshot();
	if (active.kind !== "active" || active.mode !== "practice") throw new Error("active practice");
	return subject.lifecycle.act(active.reference, { kind: "answer", correct });
}

describe("SessionLifecycle", () => {
	it("publishes one mutually exclusive state and captures immutable result content", async () => {
		const subject = makeLifecycle([makeCard("one", "old one", 0), makeCard("two", "two", 1)]);
		const started = await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		expect(started.kind).toBe("applied");
		const first = subject.lifecycle.getSnapshot();
		expect(first).toMatchObject({ kind: "active", mode: "practice" });
		if (first.kind !== "active" || first.mode !== "practice") throw new Error("active");

		const blocked = await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		expect(blocked).toMatchObject({ kind: "rejected", reason: "invalid-state" });

		await subject.lifecycle.act(first.reference, { kind: "answer", correct: false });
		const second = subject.lifecycle.getSnapshot();
		if (second.kind !== "active" || second.mode !== "practice") throw new Error("active");
		subject.setNow(61_000);
		await subject.lifecycle.act(second.reference, { kind: "answer", correct: true });

		const result = subject.lifecycle.getSnapshot();
		expect(result).toMatchObject({
			kind: "result",
			mode: "practice",
			incorrectCards: [{ identity: "one", front: "old one" }],
		});
		subject.repository.getCard(DECK_ID, "one")!.front = "edited later";
		expect(subject.lifecycle.getSnapshot()).toBe(result);
		expect(
			result.kind === "result" && result.mode !== "study"
				? result.incorrectCards[0]?.front
				: "",
		).toBe("old one");
	});

	it("keeps the old snapshot on atomic persistence failure and allows the same reference to retry", async () => {
		const subject = makeLifecycle([makeCard("one")]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		const active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		subject.repository.failNextCommit = true;
		subject.setNow(61_000);

		const failed = await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		expect(failed).toMatchObject({
			kind: "failed",
			failure: { code: "persistence-failed", retryable: true },
		});
		expect(subject.lifecycle.getSnapshot()).toBe(active);

		const applied = await subject.lifecycle.act(active.reference, {
			kind: "answer",
			rating: 3,
		});
		expect(applied.kind).toBe("applied");
		const resultSnapshot = subject.lifecycle.getSnapshot();
		expect(resultSnapshot.kind).toBe("result");
		if (resultSnapshot.kind !== "result") throw new Error("result");
		expect(resultSnapshot.mode).toBe("study");
		expect(subject.repository.commits).toHaveLength(1);
		expect(subject.repository.commits[0]).toMatchObject({
			cardSchedules: [{ cardId: "one" }],
			records: [
				{
					mode: "study",
					deckId: DECK_ID,
					occurredAt: 61_000,
					activity: {
						completion: "completed",
						answerCount: 1,
						durationSeconds: 60,
					},
					history: { cardCount: 1, durationSeconds: 60 },
				},
			],
		});
	});

	it("rejects a reference after its state revision has been replaced", async () => {
		const subject = makeLifecycle([makeCard("one")]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		const active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });

		const stale = await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		expect(stale).toMatchObject({ kind: "rejected", reason: "stale-reference" });
	});

	it("rejects a duplicate command while an atomic commit is in flight", async () => {
		const subject = makeLifecycle([makeCard("one")]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		const active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		let releaseCommit = (): void => undefined;
		subject.repository.commitBarrier = new Promise<void>((resolve) => {
			releaseCommit = resolve;
		});

		const first = subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		const duplicate = await subject.lifecycle.act(active.reference, {
			kind: "answer",
			rating: 3,
		});
		expect(duplicate).toMatchObject({ kind: "rejected", reason: "busy" });
		releaseCommit();
		await first;
	});

	it("reconciles past a deleted next study card after a committed answer without scheduling the previous card twice", async () => {
		const subject = makeLifecycle([
			makeCard("one", "one", 0),
			makeCard("two", "two", 1),
			makeCard("three", "three", 2),
		]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		const first = subject.lifecycle.getSnapshot();
		if (first.kind !== "active" || first.mode !== "study") throw new Error("active study");
		const presentedAfterFirst: string[] = [];
		subject.lifecycle.subscribe(() => {
			const snapshot = subject.lifecycle.getSnapshot();
			if (snapshot.kind === "active") presentedAfterFirst.push(snapshot.currentCard.identity);
		});
		let releaseCommit = (): void => undefined;
		subject.repository.commitBarrier = new Promise<void>((resolve) => {
			releaseCommit = resolve;
		});
		let reportCommitStarted = (): void => undefined;
		const commitStarted = new Promise<void>((resolve) => {
			reportCommitStarted = resolve;
		});
		const originalCommit = subject.repository.commitSession.bind(subject.repository);
		vi.spyOn(subject.repository, "commitSession").mockImplementation((commit) => {
			reportCommitStarted();
			return originalCommit(commit);
		});
		const rate = vi.spyOn(subject.repository, "rateStudyCard");
		const answer = subject.lifecycle.act(first.reference, { kind: "answer", rating: 3 });
		await commitStarted;
		subject.repository.decks.get(DECK_ID)!.cards = subject.repository.decks
			.get(DECK_ID)!
			.cards.filter((card) => card.id !== "two");
		const reconcile = subject.continuitySessions.reconcile({
			availableIdentities: new Set(["one", "three"]),
			deletedIdentities: new Set(["two"]),
		});
		releaseCommit();
		expect(await answer).toMatchObject({ kind: "failed" });
		await reconcile;
		const next = subject.lifecycle.getSnapshot();
		expect(next).toMatchObject({
			kind: "active",
			mode: "study",
			currentCard: { identity: "three" },
			answerEventCount: 1,
		});
		expect(presentedAfterFirst).toEqual(["three"]);
		expect(
			await subject.lifecycle.act(first.reference, { kind: "answer", rating: 3 }),
		).toMatchObject({ kind: "rejected", reason: "stale-reference" });
		expect(rate).toHaveBeenCalledOnce();
		if (next.kind !== "active" || next.mode !== "study") throw new Error("active study");
		await subject.lifecycle.act(next.reference, { kind: "answer", rating: 3 });
		expect(
			subject.repository.commits.flatMap((commit) => commit.cardSchedules ?? []),
		).toMatchObject([
			{ cardId: "one", fsrsCard: { reps: 1 } },
			{ cardId: "three", fsrsCard: { reps: 1 } },
		]);
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "result",
			mode: "study",
			cardCount: 2,
			totalReviews: 2,
		});
	});

	it("persists study undo through the same lifecycle seam", async () => {
		const subject = makeLifecycle([makeCard("one", "one", 0), makeCard("two", "two", 1)]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		let active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		expect(active.canPrevious).toBe(true);

		await subject.lifecycle.act(active.reference, { kind: "previous" });
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "study",
			currentCard: { identity: "one" },
			answerEventCount: 0,
		});
		expect(subject.repository.getCard(DECK_ID, "one")?.fsrsCard.reps).toBe(0);

		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 });
		expect(subject.repository.activity).toEqual([
			{
				kind: "session",
				mode: "study",
				completion: "completed",
				answerCount: 3,
				durationSeconds: 0,
				occurredAt: 1_000,
			},
		]);
	});

	it("counts only spelling retrievals and freezes incorrect result details", async () => {
		const identity = "550e8400-e29b-41d4-a716-446655440000";
		const subject = makeLifecycle([makeCard(identity, "science")]);
		await subject.lifecycle.start({
			mode: "spelling",
			deckId: DECK_ID,
			selection: { kind: "range", startIndex: 1, endIndex: 1 },
		});
		let active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "spelling") throw new Error("active");

		await subject.lifecycle.act(active.reference, { kind: "answer", input: "sciense" });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "spelling") throw new Error("active");
		expect(active).toMatchObject({ phase: "correction", answerEventCount: 1 });
		expect(subject.repository.commits).toHaveLength(1);

		await subject.lifecycle.act(active.reference, { kind: "answer", input: "still wrong" });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "spelling") throw new Error("active");
		expect(subject.repository.commits).toHaveLength(1);

		await subject.lifecycle.act(active.reference, { kind: "answer", input: "science" });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "spelling") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", input: "science" });

		const result = subject.lifecycle.getSnapshot();
		expect(result).toMatchObject({
			kind: "result",
			mode: "spelling",
			firstTryIncorrectCount: 1,
			incorrectCards: [
				{
					identity,
					firstInput: "sciense",
					expectedAnswer: "science",
				},
			],
		});
		expect(subject.repository.commits).toHaveLength(2);
		expect(subject.repository.commits[1]).toMatchObject({
			spellingAttempts: [{ cardId: identity, correct: true }],
			records: [
				{
					mode: "spelling",
					activity: { completion: "completed", answerCount: 4 },
					history: { cardCount: 1 },
				},
			],
		});
		expect(subject.repository.history).toMatchObject([{ mode: "spelling", cardCount: 1 }]);
		if (result.kind !== "result" || result.mode !== "spelling") throw new Error("result");
		subject.repository.getCard(DECK_ID, identity)!.front = "science / fair";
		const retry = await subject.lifecycle.act(result.reference, { kind: "retry-incorrect" });
		expect(retry).toMatchObject({ kind: "rejected", reason: "no-retryable-cards" });
		expect(subject.lifecycle.getSnapshot()).toBe(result);
	});

	it("counts every practice submission after returning to a previous card", async () => {
		const subject = makeLifecycle([makeCard("one"), makeCard("two")]);
		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		let active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: false });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "previous" });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: true });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: true });

		expect(subject.repository.activity).toEqual([
			{
				kind: "session",
				mode: "practice",
				completion: "completed",
				answerCount: 3,
				durationSeconds: 0,
				occurredAt: 1_000,
			},
		]);
	});

	it("revalidates incorrect retry identities against the current card index", async () => {
		const subject = makeLifecycle([makeCard("one", "one", 0), makeCard("two", "two", 1)]);
		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		let active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: false });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: false });
		const result = subject.lifecycle.getSnapshot();
		if (result.kind !== "result" || result.mode !== "practice") throw new Error("result");

		subject.repository.decks.get(DECK_ID)!.cards = [];
		subject.repository.decks.set("notes/moved.md", {
			...makeDeck([
				{
					...makeCard("two", "moved two", 0),
					sourceFile: "notes/moved.md",
				},
			]),
			id: "notes/moved.md",
			name: "Moved",
			filePath: "notes/moved.md",
		});
		const retried = await subject.lifecycle.act(result.reference, { kind: "retry-incorrect" });
		expect(retried).toMatchObject({ kind: "applied", omittedCardCount: 1 });
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "practice",
			currentCard: {
				identity: "two",
				currentDeckId: "notes/moved.md",
				front: "moved two",
			},
		});
	});

	it("records partial practice activity when explicit exit or source change ends the lifecycle", async () => {
		const subject = makeLifecycle([makeCard("one", "one", 0), makeCard("two", "two", 1)]);
		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		let active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: true });
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		subject.setNow(31_000);
		await subject.lifecycle.act(active.reference, { kind: "exit" });
		expect(subject.repository.history).toMatchObject([
			{ mode: "practice", cardCount: 1, duration: 30 },
		]);
		expect(subject.repository.activity).toMatchObject([
			{
				kind: "session",
				mode: "practice",
				completion: "partial",
				answerCount: 1,
				durationSeconds: 30,
				occurredAt: 31_000,
			},
		]);

		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.continuitySessions.reconcile({
			availableIdentities: new Set(),
			deletedIdentities: new Set(["one", "two"]),
		});
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "idle",
			lastEnd: { reason: "source-change", answerEventCount: 0 },
		});
		expect(subject.repository.history).toHaveLength(1);

		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await subject.lifecycle.act(active.reference, { kind: "answer", correct: true });
		subject.setNow(61_000);
		await subject.continuitySessions.reconcile({
			availableIdentities: new Set(),
			deletedIdentities: new Set(["one", "two"]),
		});
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "idle",
			lastEnd: { reason: "source-change", answerEventCount: 1 },
		});
		expect(subject.repository.history).toMatchObject([
			{ mode: "practice", cardCount: 1 },
			{ mode: "practice", cardCount: 1 },
		]);
	});

	it("captures one occurrence time when a partial session ends across local midnight", async () => {
		const repository = new MemoryLifecycleRepository([makeCard("one"), makeCard("two")]);
		const beforeMidnight = new Date(2026, 8, 17, 23, 59, 59, 900).getTime();
		const afterMidnight = new Date(2026, 8, 18, 0, 0, 0, 100).getTime();
		const times = [
			new Date(2026, 8, 17, 23, 0).getTime(),
			new Date(2026, 8, 17, 23, 0).getTime(),
			new Date(2026, 8, 17, 23, 30).getTime(),
			beforeMidnight,
			afterMidnight,
		];
		const { lifecycle } = createSessionLifecycle(repository, {
			now: () => times.shift() ?? afterMidnight,
			shuffle: (identities) => [...identities],
		});
		await lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: 2 },
		});
		let active = lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await lifecycle.act(active.reference, { kind: "answer", correct: true });
		active = lifecycle.getSnapshot();
		if (active.kind !== "active" || active.mode !== "practice") throw new Error("active");
		await lifecycle.act(active.reference, { kind: "exit" });

		expect(repository.history[0]?.occurredAt).toBe(beforeMidnight);
		expect(repository.activity[0]?.occurredAt).toBe(beforeMidnight);
	});

	it("reconciles a long practice queue without repeated linear membership scans", async () => {
		const cards = Array.from({ length: 120 }, (_, index) =>
			makeCard(`card-${index}`, `card ${index}`, index),
		);
		const subject = makeLifecycle(cards);
		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "range", startIndex: 1, endIndex: cards.length },
		});

		for (let index = 0; index < 60; index++) {
			const active = subject.lifecycle.getSnapshot();
			if (active.kind !== "active" || active.mode !== "practice") {
				throw new Error("Expected an active practice session");
			}
			await subject.lifecycle.act(active.reference, { kind: "answer", correct: true });
		}

		const includes = vi.spyOn(Array.prototype, "includes");
		let includesCallCount = 0;
		try {
			const availableIdentities = new Set(cards.map((card) => card.id));
			availableIdentities.delete("card-60");
			await subject.continuitySessions.reconcile({
				availableIdentities,
				deletedIdentities: new Set(["card-60"]),
			});
			includesCallCount = includes.mock.calls.length;
		} finally {
			includes.mockRestore();
		}
		expect(includesCallCount).toBeLessThanOrEqual(1);

		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "practice",
			currentCard: { identity: "card-61" },
		});
	});

	it("creates a study result snapshot upon completion with rating counts, rejects retry-incorrect, and dismisses to idle", async () => {
		const subject = makeLifecycle([makeCard("one"), makeCard("two")]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});

		const active1 = subject.lifecycle.getSnapshot();
		if (active1.kind !== "active" || active1.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active1.reference, { kind: "answer", rating: 3 });

		const active2 = subject.lifecycle.getSnapshot();
		if (active2.kind !== "active" || active2.mode !== "study") throw new Error("active");
		await subject.lifecycle.act(active2.reference, { kind: "answer", rating: 4 });

		const result = subject.lifecycle.getSnapshot();
		expect(result.kind).toBe("result");
		if (result.kind !== "result" || result.mode !== "study") throw new Error("result");

		expect(result.cardCount).toBe(2);
		expect(result.totalReviews).toBe(2);
		expect(result.ratingCounts).toEqual({
			1: 0,
			2: 0,
			3: 1,
			4: 1,
			5: 0,
		});
		expect(result.restartOrigin).toEqual({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});

		// retry-incorrect should be rejected for study results
		const retry = await subject.lifecycle.act(result.reference, {
			kind: "retry-incorrect",
		});
		expect(retry).toMatchObject({
			kind: "rejected",
			reason: "action-not-available",
		});

		// dismiss should transition to idle
		const dismiss = await subject.lifecycle.act(result.reference, {
			kind: "dismiss",
		});
		expect(dismiss.kind).toBe("applied");
		expect(subject.lifecycle.getSnapshot().kind).toBe("idle");
	});

	it("surfaces repository semantic rejections as typed lifecycle rejections", async () => {
		const subject = makeLifecycle([makeCard("one")]);
		await subject.lifecycle.start({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "sequential",
			direction: "normal",
		});
		const active = subject.lifecycle.getSnapshot();
		if (active.kind !== "active") throw new Error("active");

		subject.repository.rejectNextCommit = "card-missing";
		expect(
			await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 }),
		).toMatchObject({ kind: "rejected", reason: "current-card-unavailable" });
		expect(subject.lifecycle.getSnapshot()).toBe(active);

		subject.repository.rejectNextCommit = "challenge-progress-changed";
		expect(
			await subject.lifecycle.act(active.reference, { kind: "answer", rating: 3 }),
		).toMatchObject({ kind: "rejected", reason: "challenge-progress-changed" });
		expect(subject.lifecycle.getSnapshot()).toBe(active);
	});

	it("rejects continuing a challenge when no progress can be resumed", async () => {
		const subject = makeLifecycle([makeCard("one")]);
		expect(
			await subject.lifecycle.start({
				mode: "challenge",
				challengeMode: "normal",
				intent: "continue",
			}),
		).toMatchObject({ kind: "rejected", reason: "no-challenge-progress" });
	});
});

describe("study lapse practice", () => {
	const one = "550e8400-e29b-41d4-a716-446655440000";
	const two = "7d444840-9dc0-11d1-b245-5ffdce74fad2";
	const good = "33333333-3333-4333-8333-333333333333";
	const cards = () => [
		makeCard(one, "one", 0),
		makeCard(two, "two", 1),
		makeCard(good, "good", 2),
	];

	it("practices the deduplicated ever-Again/Hard set with study direction and records practice without scheduling", async () => {
		const subject = makeLifecycle(cards());
		const rate = vi.spyOn(subject.repository, "rateStudyCard");
		rate.mockImplementationOnce((card) => ({
			fsrsCard: { ...card, reps: card.reps + 1, state: State.Review },
			repeatInSession: true,
		}));
		const result = await completeStudy(subject, [1, 2, 3, 2], "reversed");
		expect(result.lapseCards?.map((card) => card.identity)).toEqual([one, two]);
		const schedules = cards().map((card) => ({
			...subject.repository.getCard(DECK_ID, card.id)!.fsrsCard,
		}));
		const studyCommitCount = subject.repository.commits.length;
		rate.mockClear();
		expect(
			await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
		).toMatchObject({
			kind: "applied",
			omittedCardCount: 0,
		});
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "practice",
			direction: "reversed",
			currentCard: { identity: one },
			progress: { total: 2 },
		});
		await answerPractice(subject, false);
		expect(subject.lifecycle.getSnapshot()).toMatchObject({ currentCard: { identity: two } });
		subject.setNow(31_000);
		await answerPractice(subject, true);
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "result",
			mode: "practice",
			direction: "reversed",
			totalQuestions: 2,
			correctCount: 1,
			incorrectCount: 1,
			restartOrigin: { selection: { kind: "identities", cardIds: [one, two] } },
		});
		expect(rate).not.toHaveBeenCalled();
		expect(
			cards().map((card) => subject.repository.getCard(DECK_ID, card.id)!.fsrsCard),
		).toEqual(schedules);
		expect(subject.repository.commits.slice(studyCommitCount)).toEqual([
			{
				records: [
					expect.objectContaining({
						mode: "practice",
						history: { cardCount: 2, durationSeconds: 30 },
					}),
				],
			},
		]);
		expect(subject.repository.history.map((entry) => entry.mode)).toEqual([
			"study",
			"practice",
		]);
		expect(subject.repository.decks.get(DECK_ID)!.studyCount).toBe(1);
	});

	it("uses current content for moved identities and omits deleted cards even if the origin deck disappeared", async () => {
		const subject = makeLifecycle(cards());
		const result = await completeStudy(subject, [1, 2, 3], "reversed");
		subject.repository.decks.delete(DECK_ID);
		subject.repository.decks.set("notes/moved.md", {
			...makeDeck([{ ...makeCard(two, "current two"), sourceFile: "notes/moved.md" }]),
			id: "notes/moved.md",
			filePath: "notes/moved.md",
			name: "Moved",
		});
		expect(
			await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
		).toMatchObject({
			kind: "applied",
			omittedCardCount: 1,
		});
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "practice",
			direction: "reversed",
			progress: { total: 1 },
			originDeck: { id: DECK_ID, name: "Deck" },
			currentCard: { identity: two, front: "current two", currentDeckId: "notes/moved.md" },
		});
		expect(result.lapseCards?.[1]?.front).toBe("two");
	});

	it.each([false, true])(
		"retains the study result when there are no available lapse cards (deleted: %s)",
		async (deleted) => {
			const subject = makeLifecycle(cards());
			const result = await completeStudy(subject, deleted ? [1, 2, 3] : [3, 4, 5]);
			if (deleted) subject.repository.decks.get(DECK_ID)!.cards = [makeCard(good)];
			expect(
				await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
			).toMatchObject({
				kind: "rejected",
				reason: "no-eligible-cards",
			});
			expect(subject.lifecycle.getSnapshot()).toBe(result);
		},
	);

	it.each([1, 2])(
		"retains both state and reference if startup card read %s fails, then allows retry",
		async (failingRead) => {
			const subject = makeLifecycle([makeCard(one)]);
			const result = await completeStudy(subject, [1]);
			const originalGetCard = subject.repository.getCard.bind(subject.repository);
			let calls = 0;
			const getCard = vi
				.spyOn(subject.repository, "getCard")
				.mockImplementation((deckId, cardId) => {
					if (++calls === failingRead) throw new Error("index unavailable");
					return originalGetCard(deckId, cardId);
				});
			expect(
				await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
			).toMatchObject({
				kind: "failed",
				failure: { message: "index unavailable" },
			});
			expect(subject.lifecycle.getSnapshot()).toBe(result);
			expect(subject.continuitySessions.hasActiveSession()).toBe(false);
			getCard.mockRestore();
			expect(
				await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
			).toMatchObject({ kind: "applied" });
		},
	);

	it("rejects a stale study result reference after a new practice starts", async () => {
		const subject = makeLifecycle([makeCard(one)]);
		const result = await completeStudy(subject, [1]);
		await subject.lifecycle.act(result.reference, { kind: "practice-lapses" });
		const active = subject.lifecycle.getSnapshot();
		expect(
			await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
		).toMatchObject({
			kind: "rejected",
			reason: "stale-reference",
		});
		expect(subject.lifecycle.getSnapshot()).toBe(active);
	});

	it("keeps the original exact set through incorrect retry and revalidates it on replay", async () => {
		const subject = makeLifecycle(cards());
		const result = await completeStudy(subject, [1, 2, 3], "reversed");
		await subject.lifecycle.act(result.reference, { kind: "practice-lapses" });
		await answerPractice(subject, false);
		await answerPractice(subject, true);
		let practiceResult = subject.lifecycle.getSnapshot();
		if (practiceResult.kind !== "result" || practiceResult.mode !== "practice")
			throw new Error("practice result");
		await subject.lifecycle.act(practiceResult.reference, { kind: "retry-incorrect" });
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			direction: "reversed",
			progress: { total: 1 },
			currentCard: { identity: one },
		});
		await answerPractice(subject, true);
		practiceResult = subject.lifecycle.getSnapshot();
		if (practiceResult.kind !== "result" || practiceResult.mode !== "practice")
			throw new Error("practice result");
		await subject.lifecycle.act(practiceResult.reference, { kind: "restart-practice" });
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			direction: "reversed",
			progress: { total: 2 },
			currentCard: { identity: one },
		});
		await answerPractice(subject, true);
		await answerPractice(subject, true);
		practiceResult = subject.lifecycle.getSnapshot();
		if (practiceResult.kind !== "result" || practiceResult.mode !== "practice")
			throw new Error("practice result");
		subject.repository.decks.get(DECK_ID)!.cards = [
			makeCard(two, "edited two"),
			makeCard(good),
		];
		expect(
			await subject.lifecycle.act(practiceResult.reference, { kind: "restart-practice" }),
		).toMatchObject({ kind: "applied", omittedCardCount: 1 });
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			progress: { total: 1 },
			currentCard: { identity: two, front: "edited two" },
		});
		await answerPractice(subject, true);
		practiceResult = subject.lifecycle.getSnapshot();
		if (practiceResult.kind !== "result" || practiceResult.mode !== "practice")
			throw new Error("practice result");
		subject.repository.decks.get(DECK_ID)!.cards = [makeCard(good)];
		expect(
			await subject.lifecycle.act(practiceResult.reference, { kind: "restart-practice" }),
		).toMatchObject({ kind: "rejected", reason: "no-eligible-cards" });
		expect(subject.lifecycle.getSnapshot()).toBe(practiceResult);
	});

	it.each(["initial-start", "replay"] as const)(
		"restores the original lapse set after a card is temporarily unavailable at %s",
		async (unavailableAt) => {
			const subject = makeLifecycle(cards());
			let result: ReturnType<typeof subject.lifecycle.getSnapshot> = await completeStudy(
				subject,
				[1, 2, 3],
				"reversed",
			);
			if (unavailableAt === "replay") {
				await subject.lifecycle.act(result.reference, { kind: "practice-lapses" });
				await answerPractice(subject, true);
				await answerPractice(subject, true);
				result = subject.lifecycle.getSnapshot();
			}
			if (result.kind !== "result") throw new Error("result");
			subject.repository.decks.get(DECK_ID)!.cards = [makeCard(one), makeCard(good)];
			expect(
				await subject.lifecycle.act(result.reference, {
					kind: unavailableAt === "replay" ? "restart-practice" : "practice-lapses",
				}),
			).toMatchObject({ kind: "applied", omittedCardCount: 1 });
			expect(subject.lifecycle.getSnapshot()).toMatchObject({
				mode: "practice",
				progress: { total: 1 },
				currentCard: { identity: one },
			});
			await answerPractice(subject, true);
			result = subject.lifecycle.getSnapshot();
			if (result.kind !== "result" || result.mode !== "practice")
				throw new Error("practice result");
			expect(result.restartOrigin.selection).toEqual({
				kind: "identities",
				cardIds: [one, two],
			});

			subject.repository.decks.get(DECK_ID)!.cards = [
				makeCard(two, "restored two"),
				makeCard(one),
				makeCard(good),
			];
			expect(
				await subject.lifecycle.act(result.reference, { kind: "restart-practice" }),
			).toMatchObject({ kind: "applied", omittedCardCount: 0 });
			expect(subject.lifecycle.getSnapshot()).toMatchObject({
				direction: "reversed",
				progress: { total: 2 },
				currentCard: { identity: one },
			});
			await answerPractice(subject, true);
			expect(subject.lifecycle.getSnapshot()).toMatchObject({
				currentCard: { identity: two, front: "restored two" },
			});
			await answerPractice(subject, true);
			expect(subject.lifecycle.getSnapshot()).toMatchObject({
				kind: "result",
				mode: "practice",
				totalQuestions: 2,
			});
		},
	);

	it("uses the existing active practice reconciliation without admitting new cards", async () => {
		const subject = makeLifecycle(cards());
		const result = await completeStudy(subject, [1, 2, 3]);
		await subject.lifecycle.act(result.reference, { kind: "practice-lapses" });
		subject.repository.decks.get(DECK_ID)!.cards = [
			makeCard(two),
			makeCard(good),
			makeCard("new"),
		];
		await subject.continuitySessions.reconcile({
			availableIdentities: new Set([two, good, "new"]),
			deletedIdentities: new Set([one]),
		});
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "active",
			mode: "practice",
			progress: { total: 1 },
			currentCard: { identity: two },
		});
		await answerPractice(subject, true);
		expect(subject.lifecycle.getSnapshot()).toMatchObject({
			kind: "result",
			mode: "practice",
			totalQuestions: 1,
		});
	});

	it("keeps ordinary practice replay behavior outside the exact-set action", async () => {
		const subject = makeLifecycle([makeCard(one)]);
		await subject.lifecycle.start({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: { kind: "random", questionCount: 1 },
		});
		await answerPractice(subject, true);
		const result = subject.lifecycle.getSnapshot();
		if (result.kind !== "result") throw new Error("result");
		expect(
			await subject.lifecycle.act(result.reference, { kind: "restart-practice" }),
		).toMatchObject({ kind: "rejected", reason: "action-not-available" });
		expect(
			await subject.lifecycle.act(result.reference, { kind: "practice-lapses" }),
		).toMatchObject({ kind: "rejected", reason: "action-not-available" });
		expect(result.restartOrigin).toMatchObject({
			mode: "practice",
			selection: { kind: "random", questionCount: 1 },
		});
	});
});
