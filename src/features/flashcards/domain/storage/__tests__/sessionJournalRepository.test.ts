import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { SessionWriteSet } from "../sessionCommitFormat";
import { FlashcardRepository } from "../flashcardRepository";
import type { LearningStateDocument } from "../persistenceTypes";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";
import {
	MemorySessionJournal,
	createManualJournalTimer,
	type ManualJournalTimer,
} from "./memorySessionJournal";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

const DECK_ID = "deck.md";
const NOW = new Date("2026-10-17T12:00:00Z").getTime();

function emptyTransition(): SessionWriteSet {
	return {
		cardUpdates: [],
		spellingAttempts: [],
		incrementStudyCountFor: [],
		historyEntries: [],
	};
}

function makeCard(id: string, index: number): FlashCard {
	return {
		id,
		front: `word ${index}`,
		back: `meaning ${index}`,
		fsrsCard: createEmptyCard(new Date("2026-10-13T00:00:00Z")),
		sourceFile: DECK_ID,
		indexInFile: index,
	};
}

interface FixtureOptions {
	journal?: MemorySessionJournal;
	threshold?: number;
}

interface Fixture {
	authority: MemoryFlashcardAuthority;
	repo: FlashcardRepository;
	journal: MemorySessionJournal;
	commit: ReturnType<typeof vi.spyOn>;
	timer: ManualJournalTimer;
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
	const journal = options.journal ?? new MemorySessionJournal();
	const timer = createManualJournalTimer();
	const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
	const commit = vi.spyOn(authority, "commit");
	const repo = new FlashcardRepository({
		authority,
		sessionJournal: journal,
		journalFlushThreshold: options.threshold ?? 128,
		journalTimer: timer.timer,
	});
	const state = await repo.createContinuityStateStore().load();
	const deck: Deck = {
		id: DECK_ID,
		name: "words",
		filePath: DECK_ID,
		tag: "#flashcard",
		studyCount: 3,
		lastStudied: null,
		cards: Array.from({ length: 3 }, (_, index) => makeCard(`c${index}`, index)),
	};
	state.decks.set(deck.id, deck);
	await repo.commit(state);
	commit.mockClear();
	return { authority, repo, journal, commit, timer };
}

function answer(repo: FlashcardRepository, cardId: string, reps: number): Promise<unknown> {
	const card = repo.getCard(DECK_ID, cardId)!;
	return repo.commitSessionTransition({
		...emptyTransition(),
		cardUpdates: [{ deckId: DECK_ID, cardId, fsrsCard: { ...card.fsrsCard, reps } }],
	});
}

function spelling(
	repo: FlashcardRepository,
	cardId: string,
	correct: boolean,
	attemptedAt: number,
): Promise<unknown> {
	return repo.commitSessionTransition({
		...emptyTransition(),
		spellingAttempts: [{ cardId, correct, attemptedAt }],
	});
}

async function readLearning(authority: MemoryFlashcardAuthority): Promise<LearningStateDocument> {
	const snapshot = await authority.read();
	if (snapshot.content.kind !== "current" || !snapshot.content.learning) {
		throw new Error("Expected committed learning");
	}
	return snapshot.content.learning;
}

function openRepository(
	authority: MemoryFlashcardAuthority,
	journal: MemorySessionJournal,
): { repo: FlashcardRepository; timer: ManualJournalTimer } {
	const timer = createManualJournalTimer();
	return {
		repo: new FlashcardRepository({
			authority,
			sessionJournal: journal,
			journalTimer: timer.timer,
		}),
		timer,
	};
}

describe("session journal integration", () => {
	it("appends pure answers without committing data.json and merges on disposal", async () => {
		const f = await fixture();
		const revision = f.repo.getRevision();

		await answer(f.repo, "c0", 1);
		await answer(f.repo, "c0", 2);
		await answer(f.repo, "c1", 1);

		expect(f.commit).not.toHaveBeenCalled();
		expect(f.journal.entries()).toHaveLength(3);
		expect(f.journal.entries().map((entry) => entry.seq)).toEqual([1, 2, 3]);
		expect(f.repo.getCard(DECK_ID, "c0")!.fsrsCard.reps).toBe(2);
		expect(f.repo.getRevision()).toBeGreaterThan(revision);
		expect((await readLearning(f.authority)).cards.c0?.fsrsCard.reps).toBe(0);

		f.repo.dispose();
		await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1));
		expect(f.journal.entries()).toHaveLength(0);
		const learning = await readLearning(f.authority);
		expect(learning.journalSeq).toBe(3);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);
		expect(learning.cards.c1?.fsrsCard.reps).toBe(1);
	});

	it("merges once when the journal reaches its threshold and keeps the sequence monotonic", async () => {
		const f = await fixture({ threshold: 2 });

		await answer(f.repo, "c0", 1);
		expect(f.commit).not.toHaveBeenCalled();
		expect(f.journal.entries()).toHaveLength(1);

		await answer(f.repo, "c0", 2);
		expect(f.commit).toHaveBeenCalledTimes(1);
		expect(f.journal.entries()).toHaveLength(0);
		const merged = await readLearning(f.authority);
		expect(merged.journalSeq).toBe(2);
		expect(merged.cards.c0?.fsrsCard.reps).toBe(2);

		await answer(f.repo, "c0", 3);
		expect(f.commit).toHaveBeenCalledTimes(1);
		expect(f.journal.entries().map((entry) => entry.seq)).toEqual([3]);

		f.repo.dispose();
		await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(2));
		expect((await readLearning(f.authority)).journalSeq).toBe(3);
		expect(f.journal.entries()).toHaveLength(0);
	});

	it("merges the journal before a session-record commit", async () => {
		const f = await fixture();
		await answer(f.repo, "c0", 1);
		await answer(f.repo, "c0", 2);
		expect(f.commit).not.toHaveBeenCalled();

		await f.repo.commitSessionTransition({
			...emptyTransition(),
			incrementStudyCountFor: [DECK_ID],
			historyEntries: [
				{
					deckId: DECK_ID,
					deckName: "words",
					mode: "study",
					cardCount: 2,
					duration: 5,
					occurredAt: NOW,
				},
			],
		});

		expect(f.commit).toHaveBeenCalledTimes(2);
		expect(f.journal.entries()).toHaveLength(0);
		const learning = await readLearning(f.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);
		expect(learning.decks[DECK_ID]?.studyCount).toBe(4);
		expect(learning.studyHistory).toHaveLength(1);
	});

	it("recovers a crashed session by replaying the journal and stays idempotent", async () => {
		const journal = new MemorySessionJournal();
		const first = await fixture({ journal });
		await answer(first.repo, "c0", 1);
		await answer(first.repo, "c0", 2);
		expect(journal.entries()).toHaveLength(2);
		expect(first.commit).not.toHaveBeenCalled();

		// Simulate a crash: nothing flushed and the repository is not disposed.
		const reopened = openRepository(first.authority, journal);
		await reopened.repo.load();
		expect(first.commit).toHaveBeenCalledTimes(1);
		expect(journal.entries()).toHaveLength(0);
		let learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);
		expect(reopened.repo.getCard(DECK_ID, "c0")!.fsrsCard.reps).toBe(2);

		const restarted = openRepository(first.authority, journal);
		const commitsBefore = first.commit.mock.calls.length;
		await restarted.repo.load();
		expect(first.commit.mock.calls.length).toBe(commitsBefore);
		learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);
		restarted.repo.dispose();
		reopened.repo.dispose();
	});

	it("never double-counts spelling attempts across recovery or an interrupted truncation", async () => {
		const journal = new MemorySessionJournal();
		const first = await fixture({ journal, threshold: 2 });
		journal.failNextClear = true;
		await spelling(first.repo, "c0", true, 100);
		await spelling(first.repo, "c0", false, 200);
		expect(first.commit).toHaveBeenCalledTimes(1);
		// The merge committed but truncation failed; the journal still has both lines.
		expect(journal.entries()).toHaveLength(2);
		let learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.spellingProgress.c0).toMatchObject({
			attempts: 2,
			correctAttempts: 1,
			correctStreak: 0,
			lastAttemptAt: 200,
			lastIncorrectAt: 200,
		});

		const reopened = openRepository(first.authority, journal);
		const commitsBefore = first.commit.mock.calls.length;
		await reopened.repo.load();
		// The already-merged lines are dropped, not replayed, and no extra write happens.
		expect(journal.entries()).toHaveLength(0);
		expect(first.commit.mock.calls.length).toBe(commitsBefore);
		learning = await readLearning(first.authority);
		expect(learning.spellingProgress.c0?.attempts).toBe(2);
		expect(learning.spellingProgress.c0?.correctAttempts).toBe(1);
		reopened.repo.dispose();
	});

	it("replays unmerged spelling attempts exactly once from a crashed run", async () => {
		const journal = new MemorySessionJournal();
		const first = await fixture({ journal });
		await spelling(first.repo, "c0", true, 100);
		await spelling(first.repo, "c0", false, 200);
		expect(journal.entries()).toHaveLength(2);

		const reopened = openRepository(first.authority, journal);
		await reopened.repo.load();
		const learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.spellingProgress.c0).toMatchObject({
			attempts: 2,
			correctAttempts: 1,
			correctStreak: 0,
			lastAttemptAt: 200,
		});
		expect(journal.entries()).toHaveLength(0);
		reopened.repo.dispose();
	});

	it("falls back to a full document commit when a journal append fails", async () => {
		const f = await fixture();
		f.journal.failNextAppend = true;
		await answer(f.repo, "c0", 1);
		expect(f.commit).toHaveBeenCalledTimes(1);
		expect(f.journal.entries()).toHaveLength(0);
		let learning = await readLearning(f.authority);
		expect(learning.journalSeq).toBeUndefined();
		expect(learning.cards.c0?.fsrsCard.reps).toBe(1);

		await answer(f.repo, "c0", 2);
		expect(f.journal.entries()).toHaveLength(1);
		f.journal.failNextAppend = true;
		await answer(f.repo, "c0", 3);
		expect(f.commit).toHaveBeenCalledTimes(2);
		expect(f.journal.entries()).toHaveLength(0);
		learning = await readLearning(f.authority);
		expect(learning.journalSeq).toBe(1);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(3);
	});

	it("merges the journal before a continuity commit without a second write", async () => {
		const f = await fixture();
		await answer(f.repo, "c0", 1);
		const state = await f.repo.createContinuityStateStore().load();
		await f.repo.createContinuityStateStore().commit(state);

		expect(f.commit).toHaveBeenCalledTimes(1);
		expect(f.journal.entries()).toHaveLength(0);
		const learning = await readLearning(f.authority);
		expect(learning.journalSeq).toBe(1);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(1);
	});

	it("merges pending answers before adopting an external Sync document", async () => {
		const f = await fixture();
		await answer(f.repo, "c0", 1);
		const external = await readLearning(f.authority);
		const externalLearning: LearningStateDocument = {
			...external,
			studyHistory: [
				...external.studyHistory,
				{
					date: "2026-10-16",
					deckId: "external",
					deckName: "external",
					mode: "study",
					cardCount: 1,
					duration: 3,
					timestamp: NOW,
				},
			],
		};
		f.authority.replaceExternal(DEFAULT_SETTINGS, externalLearning);

		await vi.waitFor(() => expect(f.journal.entries()).toHaveLength(0));
		const learning = await readLearning(f.authority);
		expect(learning.studyHistory.some((entry) => entry.deckId === "external")).toBe(true);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(1);
		expect(learning.journalSeq).toBe(1);
	});

	it("flushes an idle journal through the injected timer", async () => {
		const f = await fixture();
		await answer(f.repo, "c0", 1);
		expect(f.timer.pendingCount()).toBe(1);
		f.timer.runAll();
		await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1));
		expect(f.journal.entries()).toHaveLength(0);
		expect(f.timer.pendingCount()).toBe(0);
	});

	it("only replays entries above the journal sequence persisted in data.json", async () => {
		const journal = new MemorySessionJournal();
		const first = await fixture({ journal });
		await answer(first.repo, "c0", 1);
		await first.repo.flushJournal();
		expect(first.commit).toHaveBeenCalledTimes(1);
		expect((await readLearning(first.authority)).journalSeq).toBe(1);
		expect(journal.entries()).toHaveLength(0);

		await answer(first.repo, "c0", 2);
		await spelling(first.repo, "c0", true, 100);
		expect(journal.entries().map((entry) => entry.seq)).toEqual([2, 3]);

		const reopened = openRepository(first.authority, journal);
		await reopened.repo.load();
		const learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(3);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);
		expect(learning.spellingProgress.c0?.attempts).toBe(1);
		expect(journal.entries()).toHaveLength(0);
		reopened.repo.dispose();
	});

	it("does not let a journal read failure block startup and retries the merge", async () => {
		const journal = new MemorySessionJournal();
		const first = await fixture({ journal });
		await answer(first.repo, "c0", 1);
		await answer(first.repo, "c0", 2);
		const persisted = journal.content;

		const restarted = openRepository(first.authority, journal);
		journal.failNextLoad = true;
		journal.content = persisted;
		await restarted.repo.load();
		// The failed startup read never blocks load; the startup merge retries and
		// recovers both answers instead of dropping them.
		expect(first.commit).toHaveBeenCalledTimes(1);
		expect(journal.entries()).toHaveLength(0);
		let learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(2);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(2);

		await answer(restarted.repo, "c0", 3);
		expect(journal.entries().map((entry) => entry.seq)).toEqual([3]);
		restarted.repo.dispose();
		await vi.waitFor(() => expect(journal.entries()).toHaveLength(0));
		learning = await readLearning(first.authority);
		expect(learning.journalSeq).toBe(3);
		expect(learning.cards.c0?.fsrsCard.reps).toBe(3);
	});
});
