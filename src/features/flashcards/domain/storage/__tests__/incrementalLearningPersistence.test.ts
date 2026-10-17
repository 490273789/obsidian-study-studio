import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import type { SessionWriteSet } from "../sessionCommitFormat";
import { FlashcardRepository, type SerializedDeck } from "../flashcardRepository";
import type { LearningStateDocument } from "../persistenceTypes";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

const EMPTY_TRANSITION: SessionWriteSet = {
	cardUpdates: [],
	incrementStudyCountFor: [],
	historyEntries: [],
	spellingAttempts: [],
};

function makeCard(id: string, index: number): FlashCard {
	return {
		id,
		front: `word ${index}`,
		back: `meaning ${index}`,
		fsrsCard: createEmptyCard(new Date("2026-10-13T00:00:00Z")),
		sourceFile: "deck.md",
		indexInFile: index,
	};
}

async function fixture(count = 2) {
	const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
	const commit = vi.spyOn(authority, "commit");
	const repo = new FlashcardRepository({ authority });
	const state = await repo.createContinuityStateStore().load();
	const deck: Deck = {
		id: "deck.md",
		name: "words",
		filePath: "deck.md",
		tag: "#flashcard",
		cards: Array.from({ length: count }, (_, index) => makeCard(`c${index}`, index)),
		studyCount: 2,
		lastStudied: null,
	};
	state.decks.set(deck.id, deck);
	await repo.commit(state);
	const baseline = commit.mock.calls[0]![1].learning;
	commit.mockClear();
	return { authority, commit, repo, baseline };
}

function answer(repo: FlashcardRepository, reps: number): Promise<unknown> {
	const card = repo.getCard("deck.md", "c0")!;
	return repo.commitSessionTransition({
		...EMPTY_TRANSITION,
		cardUpdates: [{ deckId: "deck.md", cardId: "c0", fsrsCard: { ...card.fsrsCard, reps } }],
	});
}

async function readLearning(authority: MemoryFlashcardAuthority): Promise<LearningStateDocument> {
	const snapshot = await authority.read();
	if (snapshot.content.kind !== "current" || !snapshot.content.learning) {
		throw new Error("Expected committed learning");
	}
	return snapshot.content.learning;
}

describe("incremental learning persistence", () => {
	it("answers in a 2413-card deck without reading unrelated card identities", async () => {
		const f = await fixture(2413);
		let unrelatedReads = 0;
		for (const card of f.repo.getDeck("deck.md")!.cards.slice(1)) {
			const id = card.id;
			Object.defineProperty(card, "id", {
				enumerable: true,
				get() {
					unrelatedReads++;
					return id;
				},
			});
		}
		for (let reps = 1; reps <= 3; reps++) await answer(f.repo, reps);
		expect(unrelatedReads).toBe(0);
		const latest = f.commit.mock.calls[f.commit.mock.calls.length - 1]![1].learning;
		expect(latest.cards).not.toBe(f.baseline.cards);
		expect(latest.cards.c1).toBe(f.baseline.cards.c1);
		expect(latest.cards.c0?.fsrsCard.reps).toBe(3);
		expect(f.baseline.cards.c0?.fsrsCard.reps).toBe(0);
		expect(Object.keys((await readLearning(f.authority)).cards)).toHaveLength(2413);
		f.repo.dispose();
	});

	it("reuses the cards record for spelling, deck statistics, and word-list history", async () => {
		const f = await fixture();
		await f.repo.commitSessionTransition({
			...EMPTY_TRANSITION,
			incrementStudyCountFor: ["deck.md"],
			spellingAttempts: [{ cardId: "c0", correct: true, attemptedAt: Date.now() }],
		});
		const now = Date.now();
		await f.repo.recordWordListVisit("deck.md", "words", now - 6_000, now);
		for (const [, candidate] of f.commit.mock.calls) {
			expect(candidate.learning.cards).toBe(f.baseline.cards);
		}
		const saved = await readLearning(f.authority);
		expect(saved.decks["deck.md"]?.studyCount).toBe(3);
		expect(saved.spellingProgress.c0?.attempts).toBe(1);
		expect(saved.studyHistory).toHaveLength(1);
		f.repo.dispose();
	});

	it("keeps the committed baseline and live card unchanged on failure before retrying", async () => {
		const f = await fixture();
		f.authority.failNextCommit = true;
		await expect(answer(f.repo, 5)).rejects.toMatchObject({ code: "authority-write-failed" });
		expect(f.repo.getCard("deck.md", "c0")?.fsrsCard.reps).toBe(0);
		expect((await readLearning(f.authority)).cards.c0?.fsrsCard.reps).toBe(0);
		await answer(f.repo, 1);
		const saved = f.commit.mock.calls[f.commit.mock.calls.length - 1]![1].learning;
		expect(saved.cards.c0?.fsrsCard.reps).toBe(1);
		expect(saved.cards.c1).toBe(f.baseline.cards.c1);
		expect(f.baseline.cards.c0?.fsrsCard.reps).toBe(0);
		f.repo.dispose();
	});

	it("rebuilds from external card changes when a commit conflicts", async () => {
		const f = await fixture();
		const external = await readLearning(f.authority);
		external.cards.c1!.fsrsCard.reps = 9;
		external.cards.remote = structuredClone(external.cards.c1!);
		const commit = f.authority.commit.bind(f.authority);
		f.commit.mockImplementationOnce(async (version, candidate) => {
			f.authority.replaceExternal(DEFAULT_SETTINGS, external);
			return commit(version, candidate);
		});
		await answer(f.repo, 2);
		const saved = await readLearning(f.authority);
		expect(saved.cards.c0?.fsrsCard.reps).toBe(2);
		expect(saved.cards.c1?.fsrsCard.reps).toBe(9);
		expect(saved.cards.remote?.fsrsCard.reps).toBe(9);
		expect(Object.keys(saved.cards)).toHaveLength(3);
		f.repo.dispose();
	});

	it("realigns additions, deletions, and moves through continuity before the next answer", async () => {
		const f = await fixture();
		await answer(f.repo, 1);
		const state = await f.repo.createContinuityStateStore().load();
		const original = state.decks.get("deck.md")!;
		const moved = { ...original.cards[0]!, sourceFile: "moved.md" };
		state.decks.set("deck.md", { ...original, cards: [makeCard("added", 0)] });
		state.decks.set("moved.md", { ...original, id: "moved.md", cards: [moved] });
		await f.repo.commit(state);
		// The answer still carries the original deck ID; stable identity locates the move.
		await f.repo.commitSessionTransition({
			...EMPTY_TRANSITION,
			cardUpdates: [
				{ deckId: "deck.md", cardId: "c0", fsrsCard: { ...moved.fsrsCard, reps: 2 } },
			],
		});
		const saved = await readLearning(f.authority);
		expect(Object.keys(saved.cards).sort()).toEqual(["added", "c0"]);
		expect(saved.cards.c0?.fsrsCard.reps).toBe(2);
		expect(f.repo.getCard("moved.md", "c0")?.fsrsCard.reps).toBe(2);
		f.repo.dispose();
	});

	it("fully builds the first session after hydration when the cache contains an unpersisted identity", async () => {
		const f = await fixture();
		const learning = await readLearning(f.authority);
		const deck = f.repo.getDeck("deck.md")!;
		const serialized: SerializedDeck = {
			...deck,
			cards: deck.cards.map((card) => ({
				...card,
				fsrsCard: learning.cards[card.id]!.fsrsCard,
			})),
		};
		delete learning.cards.c1;
		f.repo.dispose();
		const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS, learning);
		const cache = {
			load: vi.fn(async () => ({
				version: 1 as const,
				updatedAt: "",
				availableTags: [],
				decks: { "deck.md": serialized },
			})),
			save: vi.fn(),
			loadOrRebuild: vi.fn(),
			invalidateSource: vi.fn(),
			clear: vi.fn(),
		};
		const repo = new FlashcardRepository({ authority, deckIndexCache: cache });
		await repo.loadDeckIndex();
		await answer(repo, 1);
		expect(Object.keys((await readLearning(authority)).cards).sort()).toEqual(["c0", "c1"]);
		const revision = repo.getRevision();
		const external = await readLearning(authority);
		external.cards.c1!.fsrsCard.reps = 7;
		authority.replaceExternal(DEFAULT_SETTINGS, external);
		await vi.waitFor(() => expect(repo.getRevision()).toBeGreaterThan(revision));
		await answer(repo, 2);
		expect((await readLearning(authority)).cards.c1?.fsrsCard.reps).toBe(7);
		repo.dispose();
	});
});
