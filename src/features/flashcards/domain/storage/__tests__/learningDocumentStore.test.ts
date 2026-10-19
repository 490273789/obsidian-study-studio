import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { Deck } from "../../../../../core/shared/types";
import { LearningDocumentStore } from "../learningDocumentStore";
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
});
