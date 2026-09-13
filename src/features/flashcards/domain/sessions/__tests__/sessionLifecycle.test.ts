import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";
import type {
	Deck,
	FlashCard,
	FlashcardSettings,
	SpellingCardProgress,
	StudySettings,
} from "../../../../../core/shared/types";
import {
	createSessionLifecycle,
	getRestartViewState,
	type SessionLifecycleRepository,
	type SessionPersistenceTransition,
} from "../sessionLifecycle";

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
	readonly decks = new Map<string, Deck>();
	readonly history: SessionPersistenceTransition["historyEntries"][number][] = [];
	readonly spellingProgress: Record<string, SpellingCardProgress> = {};
	commits: SessionPersistenceTransition[] = [];
	failNextCommit = false;
	commitBarrier: Promise<void> | null = null;
	settings: Pick<FlashcardSettings, "wordLearningDecks"> = {
		wordLearningDecks: { [DECK_ID]: true },
	};

	constructor(cards: FlashCard[]) {
		this.decks.set(DECK_ID, makeDeck(cards));
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

	async commitSessionTransition(transition: SessionPersistenceTransition): Promise<void> {
		if (this.failNextCommit) {
			this.failNextCommit = false;
			throw new Error("disk unavailable");
		}
		if (this.commitBarrier) await this.commitBarrier;
		this.commits.push(transition);
		for (const update of transition.cardUpdates) {
			const card = this.getCard(update.deckId, update.cardId);
			if (card) card.fsrsCard = update.fsrsCard;
		}
		for (const attempt of transition.spellingAttempts) {
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
		for (const deckId of transition.incrementStudyCountFor) {
			const deck = this.decks.get(deckId);
			if (deck) deck.studyCount++;
		}
		this.history.push(...transition.historyEntries);
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
		expect(result.kind === "result" ? result.incorrectCards[0]?.front : "").toBe("old one");
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
		expect(subject.lifecycle.getSnapshot().kind).toBe("idle");
		expect(subject.repository.commits).toHaveLength(1);
		expect(subject.repository.commits[0]).toMatchObject({
			cardUpdates: [{ cardId: "one" }],
			incrementStudyCountFor: [DECK_ID],
			historyEntries: [{ mode: "study", cardCount: 1, duration: 60 }],
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
			historyEntries: [{ mode: "spelling", cardCount: 1 }],
		});
		expect(subject.repository.history).toMatchObject([{ mode: "spelling", cardCount: 1 }]);
		if (result.kind !== "result" || result.mode !== "spelling") throw new Error("result");
		subject.repository.getCard(DECK_ID, identity)!.front = "science / fair";
		const retry = await subject.lifecycle.act(result.reference, { kind: "retry-incorrect" });
		expect(retry).toMatchObject({ kind: "rejected", reason: "no-retryable-cards" });
		expect(subject.lifecycle.getSnapshot()).toBe(result);
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

	describe("getRestartViewState", () => {
		it("maps study-day practice setup defaults back to study-setup", () => {
			const viewState = getRestartViewState({
				mode: "practice",
				deckId: DECK_ID,
				direction: "reversed",
				selection: {
					kind: "study-day",
					dayIndex: 2,
					studyOrder: "sequential",
				},
			});

			expect(viewState).toEqual({
				type: "study-setup",
				deckId: DECK_ID,
				initialStudyOrder: "sequential",
				initialDirection: "reversed",
			});
		});

		it("maps study-day spelling setup defaults back to study-setup", () => {
			const viewState = getRestartViewState({
				mode: "spelling",
				deckId: DECK_ID,
				selection: {
					kind: "study-day",
					dayIndex: 1,
				},
			});

			expect(viewState).toEqual({
				type: "study-setup",
				deckId: DECK_ID,
			});
		});

		it("maps practice random count defaults to practice-setup", () => {
			const viewState = getRestartViewState({
				mode: "practice",
				deckId: DECK_ID,
				direction: "normal",
				selection: {
					kind: "random",
					questionCount: 50,
				},
			});

			expect(viewState).toEqual({
				type: "practice-setup",
				deckId: DECK_ID,
				initialSelection: { kind: "random", questionCount: 50 },
				initialDirection: "normal",
			});
		});

		it("maps practice range defaults to practice-setup", () => {
			const viewState = getRestartViewState({
				mode: "practice",
				deckId: DECK_ID,
				direction: "reversed",
				selection: {
					kind: "range",
					startIndex: 10,
					endIndex: 25,
				},
			});

			expect(viewState).toEqual({
				type: "practice-setup",
				deckId: DECK_ID,
				initialSelection: { kind: "range", startIndex: 10, endIndex: 25 },
				initialDirection: "reversed",
			});
		});

		it("maps spelling smart defaults to spelling-setup", () => {
			const viewState = getRestartViewState({
				mode: "spelling",
				deckId: DECK_ID,
				selection: {
					kind: "smart",
					questionCount: 20,
				},
			});

			expect(viewState).toEqual({
				type: "spelling-setup",
				deckId: DECK_ID,
				initialSelection: { kind: "smart", questionCount: 20 },
			});
		});

		it("maps spelling range defaults to spelling-setup", () => {
			const viewState = getRestartViewState({
				mode: "spelling",
				deckId: DECK_ID,
				selection: {
					kind: "range",
					startIndex: 5,
					endIndex: 15,
				},
			});

			expect(viewState).toEqual({
				type: "spelling-setup",
				deckId: DECK_ID,
				initialSelection: { kind: "range", startIndex: 5, endIndex: 15 },
			});
		});
	});
});
