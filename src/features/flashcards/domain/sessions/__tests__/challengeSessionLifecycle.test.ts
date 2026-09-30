import { describe, expect, it, vi } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
vi.mock("obsidian", () => ({ normalizePath: (path: string) => path }));
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import { FlashcardRepository } from "../../storage/flashcardRepository";
import { MemoryFlashcardAuthority } from "../../storage/__tests__/memoryFlashcardAuthority";
import {
	createSessionLifecycle,
	type SessionLifecycle,
	type ChallengeLifecycleAction,
} from "../sessionLifecycle";
import {
	normalizeChallengeProgress,
	selectEligibleChallengeCards,
	type ChallengeMode,
} from "../challengeSessionEngine";

function card(index: number, deckId = "a"): FlashCard {
	return {
		id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
		front: "apple",
		back: `释义 ${index}`,
		sourceFile: deckId,
		indexInFile: index,
		fsrsCard: { ...createEmptyCard(), state: State.Review, reps: 1 },
	};
}
function deck(id: string, cards: FlashCard[]): Deck {
	return { id, name: id, filePath: id, cards, tag: "#word", studyCount: 0, lastStudied: null };
}
async function harness(count: number) {
	const settings = { ...DEFAULT_SETTINGS, wordLearningDecks: { a: true, b: true } };
	const authority = new MemoryFlashcardAuthority(settings);
	const repo = new FlashcardRepository({ authority, deckIndexCache: null });
	await repo.load();
	const store = repo.createContinuityStateStore();
	const state = await store.load();
	const cards = Array.from({ length: count }, (_, index) => card(index));
	await store.commit({ ...state, decks: new Map([["a", deck("a", cards)]]) });
	let time = new Date("2026-09-27T12:00:00").getTime();
	const options = { now: () => time, shuffle: (ids: string[]) => [...ids], random: () => 0.9 };
	const wiring = createSessionLifecycle(repo, options);
	return {
		...wiring,
		repo,
		authority,
		store,
		options,
		settings,
		tick: () => {
			time += 1000;
		},
		start: (challengeMode: ChallengeMode = "normal", intent: "new" | "continue" = "new") =>
			wiring.lifecycle.start({ mode: "challenge", challengeMode, intent }),
	};
}
function active(lifecycle: SessionLifecycle) {
	const snapshot = lifecycle.getSnapshot();
	if (snapshot.kind !== "active" || snapshot.mode !== "challenge")
		throw new Error("Expected active challenge");
	return snapshot;
}
function result(lifecycle: SessionLifecycle) {
	const snapshot = lifecycle.getSnapshot();
	if (snapshot.kind !== "result" || snapshot.mode !== "challenge")
		throw new Error("Expected challenge result");
	return snapshot;
}
async function act(lifecycle: SessionLifecycle, action: ChallengeLifecycleAction) {
	const outcome = await lifecycle.act(active(lifecycle).reference, action);
	expect(outcome.kind).toBe("applied");
	return outcome;
}

describe("challenge lifecycle", () => {
	it.each([0, 1, 5, 14, 15, 16, 30, 34])(
		"partitions %i cards without duplicates",
		async (count) => {
			const h = await harness(count);
			const outcome = await h.start();
			if (!count) {
				expect(outcome.kind).toBe("rejected");
				return;
			}
			const levels = h.repo.getChallengeProgress()!.round!.levels;
			expect(levels.map((level) => level.length)).toEqual(
				Array.from({ length: Math.ceil(count / 15) }, (_, i) =>
					Math.min(15, count - 15 * i),
				),
			);
			expect(new Set(levels.flat().map((question) => question.identity)).size).toBe(count);
		},
	);

	it("selects learned spellable stable cards across enabled decks, retaining duplicate words", () => {
		const good = card(1);
		const newCard = { ...card(2), fsrsCard: createEmptyCard() };
		const decks = [
			deck("a", [good, newCard, { ...card(3), front: "中文" }, { ...card(4), id: "legacy" }]),
			deck("b", [card(5, "b")]),
			deck("disabled", [card(6, "disabled")]),
		];
		expect(
			selectEligibleChallengeCards(decks, { a: true, b: true }).map(
				(entry) => entry.identity,
			),
		).toEqual([good.id, card(5).id]);
	});

	it.each(["normal", "reversed", "spelling", "random"] as const)(
		"retries errors until independently correct in %s mode",
		async (mode) => {
			const h = await harness(1);
			await h.start(mode);
			const before = structuredClone(h.repo.getDeck("a")!.cards[0]!.fsrsCard);
			const questionMode = active(h.lifecycle).questionMode;
			h.tick();
			await act(
				h.lifecycle,
				questionMode === "spelling"
					? { kind: "reveal" }
					: { kind: "answer", correct: false },
			);
			expect(active(h.lifecycle).phase).toBe("feedback");
			expect(active(h.lifecycle).progress.completed).toBe(0);
			await act(h.lifecycle, { kind: "continue" });
			expect(active(h.lifecycle).questionMode).toBe(questionMode);
			h.tick();
			await act(
				h.lifecycle,
				questionMode === "spelling"
					? { kind: "answer", input: " APPLE " }
					: { kind: "answer", correct: true },
			);
			expect(result(h.lifecycle).levelResult).toMatchObject({
				totalQuestions: 1,
				firstTryCorrectCount: 0,
				retryCount: 1,
			});
			expect(result(h.lifecycle).roundComplete).toBe(true);
			expect(h.repo.getDeck("a")!.cards[0]!.fsrsCard).toEqual(before);
			expect(h.repo.getSpellingProgress()).toEqual({});
			const today = h.repo.getLearningFootprint(new Date(h.options.now())).today;
			expect(today.answers.challenge).toBe(2);
			expect(today.completedSessions.challenge).toBe(1);
			expect(today.completedAnswers.challenge).toBe(2);
		},
	);

	it("puts a wrong card after the remaining cards and rejects stale actions", async () => {
		const h = await harness(3);
		await h.start();
		const first = active(h.lifecycle);
		await act(h.lifecycle, { kind: "answer", correct: false });
		expect(
			(await h.lifecycle.act(first.reference, { kind: "answer", correct: true })).kind,
		).toBe("rejected");
		await act(h.lifecycle, { kind: "continue" });
		expect(active(h.lifecycle).currentCard.identity).toBe(card(1).id);
		await act(h.lifecycle, { kind: "answer", correct: true });
		await act(h.lifecycle, { kind: "answer", correct: true });
		expect(active(h.lifecycle).currentCard.identity).toBe(card(0).id);
		await act(h.lifecycle, { kind: "answer", correct: true });
		expect(result(h.lifecycle).levelResult.firstTryCorrectCount).toBe(2);
	});

	it("restarts an unfinished level with original questions and preserves real activity", async () => {
		const h = await harness(16);
		await h.start("random");
		const checkpoint = h.repo.getChallengeProgress();
		h.tick();
		await act(h.lifecycle, { kind: "answer", input: "apple" });
		await act(h.lifecycle, { kind: "exit" });
		const restored = createSessionLifecycle(h.repo, h.options).lifecycle;
		await restored.start({ mode: "challenge", challengeMode: "random", intent: "continue" });
		expect(active(restored).currentCard.identity).toBe(card(0).id);
		expect(active(restored).progress.completed).toBe(0);
		expect(h.repo.getChallengeProgress()).toEqual(checkpoint);
		for (let i = 0; i < 15; i++) {
			h.tick();
			await act(restored, { kind: "answer", input: "apple" });
		}
		const completed = result(restored);
		expect(completed.levelResult).toMatchObject({ firstTryCorrectCount: 15, retryCount: 0 });
		expect(h.repo.getLearningFootprint(new Date(h.options.now())).today.answers.challenge).toBe(
			16,
		);
		await restored.act(completed.reference, { kind: "dismiss" });
		await restored.start({ mode: "challenge", challengeMode: "random", intent: "continue" });
		expect(active(restored).roundProgress.level).toBe(2);
		expect(active(restored).currentCard.identity).toBe(card(15).id);
	});

	it("commits completion exactly once and rolls back failed answers and replacements", async () => {
		const h = await harness(1);
		await h.start();
		const before = active(h.lifecycle);
		const persistedBefore = await h.authority.read();
		const progressBefore = h.repo.getChallengeProgress();
		const activityBefore = h.repo.getLearningFootprint(new Date(h.options.now())).today;
		const listener = vi.fn();
		const unsubscribe = h.lifecycle.subscribe(listener);
		h.tick();
		h.authority.failNextCommit = true;
		expect(
			(await h.lifecycle.act(before.reference, { kind: "answer", correct: true })).kind,
		).toBe("failed");
		expect(h.lifecycle.getSnapshot()).toBe(before);
		expect(await h.authority.read()).toEqual(persistedBefore);
		expect(h.repo.getChallengeProgress()).toEqual(progressBefore);
		expect(h.repo.getLearningFootprint(new Date(h.options.now())).today).toEqual(
			activityBefore,
		);
		expect(h.repo.getStudyHistory()).toHaveLength(0);
		expect(listener).not.toHaveBeenCalled();
		await act(h.lifecycle, { kind: "answer", correct: true });
		expect(
			(await h.lifecycle.act(before.reference, { kind: "answer", correct: true })).kind,
		).toBe("rejected");
		expect(h.repo.getStudyHistory()).toHaveLength(1);
		expect(h.repo.getChallengeProgress()!.round!.completedLevelCount).toBe(1);
		const activity = h.repo.getLearningFootprint(new Date(h.options.now())).today;
		expect(activity.answers.challenge).toBe(1);
		expect(activity.seconds.challenge).toBe(1);
		expect(activity.completedAnswers.challenge).toBe(1);
		expect(activity.completedSessions.challenge).toBe(1);
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		await h.lifecycle.act(result(h.lifecycle).reference, { kind: "dismiss" });
		const saved = h.repo.getChallengeProgress();
		h.authority.failNextCommit = true;
		expect((await h.start("spelling")).kind).toBe("failed");
		expect(h.repo.getChallengeProgress()).toEqual(saved);
	});

	it("rolls back a failed partial answer, and records a retry and completion only once", async () => {
		const h = await harness(1);
		await h.start("spelling");
		const before = active(h.lifecycle);
		const persistedBefore = await h.authority.read();
		h.tick();
		h.authority.failNextCommit = true;
		expect((await h.lifecycle.act(before.reference, { kind: "reveal" })).kind).toBe("failed");
		expect(h.lifecycle.getSnapshot()).toBe(before);
		expect(await h.authority.read()).toEqual(persistedBefore);
		await act(h.lifecycle, { kind: "reveal" });
		const partial = h.repo.getLearningFootprint(new Date(h.options.now())).today;
		expect(partial.answers.challenge).toBe(1);
		expect(partial.seconds.challenge).toBe(1);
		expect(partial.completedAnswers.challenge).toBe(0);
		expect(partial.completedSessions.challenge).toBe(0);
		expect(h.repo.getStudyHistory()).toHaveLength(0);
		const feedbackPersistence = await h.authority.read();
		h.tick();
		await act(h.lifecycle, { kind: "continue" });
		expect(await h.authority.read()).toEqual(feedbackPersistence);
		h.tick();
		await act(h.lifecycle, { kind: "answer", input: "apple" });
		expect(result(h.lifecycle).levelResult).toMatchObject({
			firstTryCorrectCount: 0,
			retryCount: 1,
			durationSeconds: 3,
		});
		const completed = h.repo.getLearningFootprint(new Date(h.options.now())).today;
		expect(completed.answers.challenge).toBe(2);
		expect(completed.seconds.challenge).toBe(3);
		expect(completed.completedAnswers.challenge).toBe(2);
		expect(completed.completedSessions.challenge).toBe(1);
		expect(h.repo.getStudyHistory()).toHaveLength(1);
		expect(h.repo.getChallengeProgress()!.round!.completedLevelCount).toBe(1);
	});

	it("uses edited/moved cards, removes deleted cards, and ignores newly learned cards", async () => {
		const h = await harness(3);
		await h.start();
		const state = await h.store.load();
		await h.store.commit({
			...state,
			decks: new Map([
				["b", deck("b", [{ ...card(0, "b"), front: "pear" }, card(2, "b"), card(99, "b")])],
			]),
		});
		await h.lifecycle.revalidateChallenge();
		expect(active(h.lifecycle).currentCard).toMatchObject({
			front: "pear",
			currentDeckId: "b",
		});
		expect(active(h.lifecycle).removedCardCount).toBe(1);
		await act(h.lifecycle, { kind: "answer", correct: true });
		await act(h.lifecycle, { kind: "answer", correct: true });
		expect(result(h.lifecycle).levelResult.totalQuestions).toBe(2);
		expect(result(h.lifecycle).removedCardCount).toBe(1);
	});

	it("ends for source changes without completing when all remaining cards disappear", async () => {
		const h = await harness(2);
		await h.start();
		await act(h.lifecycle, { kind: "answer", correct: true });
		const state = await h.store.load();
		await h.store.commit({ ...state, decks: new Map() });
		await h.lifecycle.revalidateChallenge();
		expect(h.lifecycle.getSnapshot()).toMatchObject({
			kind: "idle",
			lastEnd: { mode: "challenge", reason: "source-change" },
		});
		expect(h.repo.getStudyHistory()).toHaveLength(0);
		expect(
			h.repo.getLearningFootprint(new Date(h.options.now())).today.completedSessions
				.challenge,
		).toBe(0);
	});

	it("ends for source changes when the active level is emptied despite a later level surviving", async () => {
		const h = await harness(16);
		await h.start();
		h.tick();
		await act(h.lifecycle, { kind: "answer", correct: true });
		const state = await h.store.load();
		await h.store.commit({
			...state,
			decks: new Map([["a", deck("a", [card(15)])]]),
		});
		await h.lifecycle.revalidateChallenge();
		expect(h.lifecycle.getSnapshot()).toMatchObject({
			kind: "idle",
			lastEnd: { mode: "challenge", reason: "source-change", answerEventCount: 1 },
		});
		expect(h.repo.getChallengeProgress()?.round).toBeNull();
		expect(h.repo.getStudyHistory()).toHaveLength(0);
		const today = h.repo.getLearningFootprint(new Date(h.options.now())).today;
		expect(today.answers.challenge).toBe(1);
		expect(today.completedSessions.challenge).toBe(0);
	});

	it("omits deleted future levels before advancing to the surviving next level", async () => {
		const h = await harness(46);
		await h.start();
		const state = await h.store.load();
		await h.store.commit({
			...state,
			decks: new Map([
				["a", deck("a", [...Array.from({ length: 15 }, (_, i) => card(i)), card(45)])],
			]),
		});
		await h.lifecycle.revalidateChallenge();
		for (let index = 0; index < 15; index++) {
			h.tick();
			await act(h.lifecycle, { kind: "answer", correct: true });
		}
		const completed = result(h.lifecycle);
		expect(completed.levelResult).toMatchObject({
			levelIndex: 0,
			totalQuestions: 15,
			firstTryCorrectCount: 15,
		});
		expect(completed.roundSummary).toMatchObject({ completedLevels: 1, totalLevels: 2 });
		await h.lifecycle.act(completed.reference, { kind: "next-level" });
		expect(active(h.lifecycle)).toMatchObject({
			currentCard: { identity: card(45).id },
			roundProgress: { level: 2, totalLevels: 2 },
		});
		const round = h.repo.getChallengeProgress()!.round!;
		expect(round.completedLevelCount).toBe(1);
		expect(round.completedLevels).toMatchObject([{ levelIndex: 0, totalQuestions: 15 }]);
	});

	it("continues past deleted current and future levels without inflating completed levels", async () => {
		const h = await harness(46);
		await h.start();
		for (let index = 0; index < 15; index++) {
			h.tick();
			await act(h.lifecycle, { kind: "answer", correct: true });
		}
		const completed = result(h.lifecycle);
		await h.lifecycle.act(completed.reference, { kind: "next-level" });
		await act(h.lifecycle, { kind: "exit" });
		const state = await h.store.load();
		await h.store.commit({
			...state,
			decks: new Map([
				["a", deck("a", [...Array.from({ length: 15 }, (_, i) => card(i)), card(45)])],
			]),
		});
		const restored = createSessionLifecycle(h.repo, h.options).lifecycle;
		await restored.start({ mode: "challenge", challengeMode: "normal", intent: "continue" });
		expect(active(restored)).toMatchObject({
			currentCard: { identity: card(45).id },
			roundProgress: { level: 2, totalLevels: 2 },
		});
		const round = h.repo.getChallengeProgress()!.round!;
		expect(round.completedLevelCount).toBe(1);
		expect(round.completedLevels).toMatchObject([{ levelIndex: 0, totalQuestions: 15 }]);
		expect(
			h.repo.getLearningFootprint(new Date(h.options.now())).today.completedSessions
				.challenge,
		).toBe(1);
	});

	it("normalizes old or corrupt challenge records independently", () => {
		expect(normalizeChallengeProgress(undefined)).toBeNull();
		expect(
			normalizeChallengeProgress({ version: 55, lastMode: "random", round: null }),
		).toBeNull();
		expect(
			normalizeChallengeProgress({ version: 1, lastMode: "spelling", round: null }),
		).toEqual({ version: 1, lastMode: "spelling", round: null });
	});
});

describe("challenge reconciliation and concurrency", () => {
	it("clears an ended checkpoint, retaining the last chosen mode", async () => {
		const h = await harness(2);
		await h.start("reversed");
		const state = await h.store.load();
		await h.store.commit({ ...state, decks: new Map() });
		await h.lifecycle.revalidateChallenge();
		expect(h.repo.getChallengeProgress()).toEqual({
			version: 1,
			lastMode: "reversed",
			round: null,
		});
		expect((await h.start("reversed", "continue")).kind).toBe("rejected");
	});
	it("rejects stale replacement requests without losing the checkpoint", async () => {
		const h = await harness(2);
		await h.start();
		await act(h.lifecycle, { kind: "exit" });
		const saved = h.repo.getChallengeProgress();
		const outcome = await h.lifecycle.start({
			mode: "challenge",
			challengeMode: "random",
			intent: "new",
			expectedRoundId: "old-round",
		});
		expect(outcome).toMatchObject({ kind: "rejected", reason: "stale-reference" });
		expect(h.repo.getChallengeProgress()).toEqual(saved);
	});
	it("serializes concurrent submissions from two views", async () => {
		const h = await harness(2);
		await h.start();
		const reference = active(h.lifecycle).reference;
		const outcomes = await Promise.all([
			h.lifecycle.act(reference, { kind: "answer", correct: true }),
			h.lifecycle.act(reference, { kind: "answer", correct: true }),
		]);
		expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["applied", "rejected"]);
		expect(active(h.lifecycle).progress.completed).toBe(1);
		expect(h.repo.getLearningFootprint(new Date(h.options.now())).today.answers.challenge).toBe(
			1,
		);
	});
	it("prevents a stale storage transition from replacing another round", async () => {
		const h = await harness(2);
		await h.start();
		const saved = h.repo.getChallengeProgress()!;
		await act(h.lifecycle, { kind: "exit" });
		await h.start("spelling");
		const current = h.repo.getChallengeProgress();
		await expect(
			h.repo.commitSessionTransition({
				cardUpdates: [],
				spellingAttempts: [],
				incrementStudyCountFor: [],
				historyEntries: [],
				challengeProgress: saved,
				expectedChallengeProgress: saved,
			}),
		).rejects.toThrow("Challenge progress changed");
		expect(h.repo.getChallengeProgress()).toEqual(current);
	});
	it("revalidates disabled spelling decks before accepting an answer", async () => {
		const h = await harness(2);
		await h.start();
		const saved = await h.authority.read();
		if (saved.content.kind !== "current") throw new Error("Expected current document");
		const revision = h.repo.getRevision();
		h.authority.replaceExternal(
			{ ...h.settings, wordLearningDecks: { a: false } },
			saved.content.learning,
		);
		await vi.waitFor(() => expect(h.repo.getRevision()).toBeGreaterThan(revision));
		const before = active(h.lifecycle);
		expect(
			(await h.lifecycle.act(before.reference, { kind: "answer", correct: true })).kind,
		).toBe("rejected");
		expect(h.lifecycle.getSnapshot()).toMatchObject({
			kind: "idle",
			lastEnd: { reason: "source-change" },
		});
		expect(h.repo.getLearningFootprint(new Date(h.options.now())).today.answers.challenge).toBe(
			0,
		);
	});
});
