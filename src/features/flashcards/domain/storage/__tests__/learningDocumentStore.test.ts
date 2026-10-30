import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { Deck } from "../../../../../core/shared/types";
import {
	equalLearningDocument,
	equalLearningValue,
	LearningDocumentStore,
} from "../learningDocumentStore";
import type { LearningStateDocument } from "../persistenceTypes";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";

function emptyLearning(): LearningStateDocument {
	return {
		cards: {},
		decks: {},
		studyHistory: [],
		spellingProgress: {},
		continuity: { sources: {}, issues: [], journal: null },
	};
}

function decks(): Map<string, Deck> {
	return new Map([
		[
			"deck",
			{
				id: "deck",
				name: "Deck",
				filePath: "deck.md",
				tag: "#deck",
				cards: [],
				studyCount: 0,
				lastStudied: null,
			},
		],
	]);
}

function fixture() {
	const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS);
	let store!: LearningDocumentStore;
	const onConflict = vi.fn(async () => {
		await store.read();
	});
	store = new LearningDocumentStore({
		authority,
		onAuthorityChange: () => {},
		onConflict,
	});
	return { authority, store, onConflict };
}

function candidate(learning: LearningStateDocument) {
	const install = vi.fn();
	return { build: () => ({ learning, install }), install };
}

describe("LearningDocumentStore", () => {
	it("commits a candidate and records the deck baseline it describes", async () => {
		const { authority, store } = fixture();
		const learning = emptyLearning();
		const deckMap = decks();
		const { build, install } = candidate(learning);

		await store.commit(build, { baselineDecks: () => deckMap });

		expect(install).toHaveBeenCalledOnce();
		expect(await authority.read()).toMatchObject({ version: 1 });
		expect(store.getCommittedCardStates(deckMap, false)).toBe(learning.cards);
		expect(store.getCommittedCardStates(new Map(), false)).toBeUndefined();
		expect(store.getCommittedCardStates(deckMap, true)).toBeUndefined();
	});

	it("retries a version conflict through the owner and installs on success", async () => {
		const { authority, store, onConflict } = fixture();
		authority.conflictNextCommit = true;
		const { build, install } = candidate(emptyLearning());

		await store.commit(build, { baselineDecks: () => decks() });

		expect(onConflict).toHaveBeenCalledOnce();
		expect(install).toHaveBeenCalledOnce();
		expect(await authority.read()).toMatchObject({ version: 2 });
	});

	it("installs an unchanged document without another authority commit", async () => {
		const { authority, store } = fixture();
		const learning = emptyLearning();
		const deckMap = decks();
		store.recordBaseline(learning, deckMap);
		const commit = vi.spyOn(authority, "commit");
		const { build, install } = candidate(learning);

		await store.commit(build, { skipUnchanged: true, baselineDecks: () => deckMap });

		expect(commit).not.toHaveBeenCalled();
		expect(install).toHaveBeenCalledOnce();
		expect(store.getCommittedCardStates(deckMap, false)).toBe(learning.cards);
	});

	it("publishes revisions and dedupes unchanged source changes", () => {
		const { store } = fixture();
		const revisions = vi.fn();
		const sources = vi.fn();
		store.subscribeRevision(revisions);
		store.subscribeSourceChanges(sources);

		store.publishRevision(2, 0);
		store.publishRevision(2, 0);
		store.publishRevision(3, 1);

		expect(revisions).toHaveBeenCalledTimes(3);
		expect(sources).toHaveBeenCalledTimes(2);
		expect(sources).toHaveBeenLastCalledWith({
			deckStructureRevision: 3,
			challengeProgressRevision: 1,
		});
	});

	it("serializes queued operations and rejects new work after dispose", async () => {
		const { store } = fixture();
		const order: string[] = [];
		const first = store.enqueueOperation(async () => {
			order.push("first");
		});
		const second = store.enqueueOperation(async () => {
			order.push("second");
		});
		await Promise.all([first, second]);
		expect(order).toEqual(["first", "second"]);

		store.dispose();
		await expect(store.enqueueOperation(async () => {})).rejects.toMatchObject({
			message: "Flashcard persistence is disposed",
		});
	});

	describe("equalLearningValue", () => {
		it("compares primitive and null values", () => {
			expect(equalLearningValue(1, 1)).toBe(true);
			expect(equalLearningValue(1, 2)).toBe(false);
			expect(equalLearningValue("a", "a")).toBe(true);
			expect(equalLearningValue("a", "b")).toBe(false);
			expect(equalLearningValue(null, null)).toBe(true);
			expect(equalLearningValue(null, {})).toBe(false);
			expect(equalLearningValue(undefined, null)).toBe(false);
		});

		it("compares structured objects regardless of key insertion order", () => {
			const a = { first: 1, second: { nested: true, count: 5 } };
			const b = { second: { count: 5, nested: true }, first: 1 };
			expect(equalLearningValue(a, b)).toBe(true);

			const c = { first: 1, second: { count: 6, nested: true } };
			expect(equalLearningValue(a, c)).toBe(false);

			const d = { first: 1 };
			expect(equalLearningValue(a, d)).toBe(false);
		});

		it("compares arrays by order and element equality", () => {
			expect(equalLearningValue([1, 2, 3], [1, 2, 3])).toBe(true);
			expect(equalLearningValue([1, 2, 3], [1, 3, 2])).toBe(false);
			expect(equalLearningValue([1, 2], [1, 2, 3])).toBe(false);
			expect(equalLearningValue([{ a: 1 }], [{ a: 1 }])).toBe(true);
			expect(equalLearningValue([], {})).toBe(false);
		});
	});

	describe("equalLearningDocument", () => {
		it("returns true for same reference and undefined comparisons", () => {
			const doc = emptyLearning();
			expect(equalLearningDocument(doc, doc)).toBe(true);
			expect(equalLearningDocument(undefined, undefined)).toBe(true);
			expect(equalLearningDocument(doc, undefined)).toBe(false);
			expect(equalLearningDocument(undefined, doc)).toBe(false);
		});

		it("returns true for equivalent deep structures", () => {
			const a = emptyLearning();
			const b = emptyLearning();
			expect(equalLearningDocument(a, b)).toBe(true);
		});

		it("short-circuits early when scalar or metadata fields differ", () => {
			const base = emptyLearning();
			const diffJournalSeq = { ...base, journalSeq: 42 };
			expect(equalLearningDocument(base, diffJournalSeq)).toBe(false);

			const diffContinuity = {
				...base,
				continuity: {
					sources: { "a.md": { type: "current" as const } },
					issues: [],
					journal: null,
				},
			};
			expect(equalLearningDocument(base, diffContinuity)).toBe(false);

			const diffDecks = {
				...base,
				decks: { d1: { studyCount: 3, lastStudied: null } },
			};
			expect(equalLearningDocument(base, diffDecks)).toBe(false);
		});

		it("detects differences inside card states", () => {
			const base = emptyLearning();
			const a = {
				...base,
				cards: {
					c1: {
						fsrsCard: { reps: 1, stability: 2 } as any,
					},
				},
			};
			const b = {
				...base,
				cards: {
					c1: {
						fsrsCard: { reps: 1, stability: 3 } as any,
					},
				},
			};
			const c = {
				...base,
				cards: {
					c1: {
						fsrsCard: { reps: 1, stability: 2 } as any,
					},
				},
			};
			expect(equalLearningDocument(a, b)).toBe(false);
			expect(equalLearningDocument(a, c)).toBe(true);
		});
	});
});
