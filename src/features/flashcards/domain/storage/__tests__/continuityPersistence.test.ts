import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import { WorkbenchStore } from "../../../../../core/storage/workbenchStore";
import type { DeckIndexCache } from "../../../../../core/storage/deckIndexCache";
import { WorkbenchFlashcardAuthority } from "../../../obsidian/workbenchFlashcardAuthority";
import { createCardIdentityContinuity } from "../../identity/cardIdentityContinuity";
import { createDeckHome } from "../../decks/deckHome";
import { FlashcardRepository, type SerializedDeck } from "../flashcardRepository";
import { decodePersistedLearning } from "../persistedLearningCodec";
import type { LearningStateDocument } from "../persistenceTypes";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";
import { answerCommit, mergeCommits, recordCommit, spellingCommit } from "./sessionCommitBuilders";

const PATH = "notes/words.md";
const ID = "550e8400-e29b-41d4-a716-446655440000";

function sourceCard(index: number): string {
	const identity =
		index === 0 ? ID : `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`;
	return `<!-- wsr-card-id: ${identity} -->\nword ${index}\n??\n释义 ${index}\n;;`;
}

async function fixture(cardCount = 2) {
	let data: unknown = { schemaVersion: 2, settings: DEFAULT_SETTINGS };
	const backend = {
		loadData: vi.fn(async () => structuredClone(data)),
		saveData: vi.fn(async (next: unknown) => {
			data = structuredClone(next);
		}),
	};
	const store = new WorkbenchStore(backend);
	let cached: DeckIndexCache<SerializedDeck> | null = null;
	const cache = {
		load: vi.fn(async () => structuredClone(cached)),
		save: vi.fn(async (next: DeckIndexCache<SerializedDeck>) => {
			cached = structuredClone(next);
		}),
		loadOrRebuild: vi.fn(),
		invalidateSource: vi.fn(),
		clear: vi.fn(),
	};
	const document = {
		path: PATH,
		basename: "words",
		content: `${DEFAULT_SETTINGS.flashcardTags[0]}\n${Array.from({ length: cardCount }, (_, index) => sourceCard(index)).join("\n")}`,
	};
	const sources = {
		list: vi.fn(async () => [{ ...document }]),
		replaceIfUnchanged: vi.fn().mockResolvedValue("written"),
	};
	function openRepository() {
		const repo = new FlashcardRepository({
			authority: new WorkbenchFlashcardAuthority({ store }),
			deckIndexCache: cache,
		});
		const identity = createCardIdentityContinuity({
			sources,
			state: repo.createContinuityStateStore(),
			createIdentity: () => {
				throw new Error("All source cards already have stable identities");
			},
		});
		return { repo, identity };
	}
	const { repo, identity } = openRepository();
	expect((await identity.synchronize()).kind).toBe("current");
	await vi.waitFor(() => expect(cache.save).toHaveBeenCalledOnce());
	expect(backend.saveData).toHaveBeenCalledOnce();
	backend.saveData.mockClear();
	cache.save.mockClear();
	return {
		backend,
		store,
		cache,
		document,
		repo,
		identity,
		openRepository,
		replaceExternalData(next: unknown) {
			data = structuredClone(next);
		},
	};
}

describe("continuity learning persistence", () => {
	it("rebuilds a missing deferred cache without losing FSRS or deck study metadata", async () => {
		const f = await fixture();
		const card = f.repo.getCard(PATH, ID)!;
		await f.repo.commitSession(
			mergeCommits(
				answerCommit({
					deckId: PATH,
					cardId: ID,
					fsrsCard: { ...card.fsrsCard, reps: 3 },
				}),
				recordCommit({
					mode: "study",
					deckId: PATH,
					deckName: "words",
					occurredAt: Date.now(),
					activity: { completion: "completed", answerCount: 1, durationSeconds: 0 },
				}),
			),
		);
		const before = structuredClone(f.store.getPartition("learning"));
		f.repo.dispose();
		f.cache.load.mockResolvedValueOnce(null);
		const reopened = f.openRepository();
		f.backend.saveData.mockClear();
		expect((await reopened.identity.synchronize()).kind).toBe("current");
		expect(reopened.repo.getDeck(PATH)?.studyCount).toBe(1);
		expect(reopened.repo.getCard(PATH, ID)?.fsrsCard.reps).toBe(3);
		expect(f.backend.saveData).not.toHaveBeenCalled();
		expect(f.store.getPartition("learning")).toEqual(before);
		reopened.repo.dispose();
	});

	it("keeps committed source conditions isolated from later state edits", async () => {
		const f = await fixture();
		const stateStore = f.repo.createContinuityStateStore();
		const first = await stateStore.load();
		first.continuity.sources[PATH] = { type: "legacy", cardCount: 1 };
		await stateStore.commit(first);
		const next = await stateStore.load();
		const condition = next.continuity.sources[PATH]!;
		if (condition.type !== "legacy") throw new Error("Expected legacy condition");
		condition.cardCount = 2;
		await stateStore.commit(next);
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		expect(
			f.store.getPartition<LearningStateDocument>("learning")?.continuity.sources[PATH],
		).toEqual({
			type: "legacy",
			cardCount: 2,
		});
		f.repo.dispose();
	});

	it.each([false, true])(
		"isolates history in the comparison baseline (restored: %s)",
		async (restored) => {
			const f = await fixture();
			const now = Date.now();
			await f.repo.recordWordListVisit(PATH, "words", now - 6_000, now);
			let { repo, identity } = f;
			if (restored) {
				repo.dispose();
				({ repo, identity } = f.openRepository());
				await repo.load();
			}
			f.backend.saveData.mockClear();
			repo.getStudyHistory()[0]!.duration = 12;
			expect((await identity.synchronize()).kind).toBe("current");
			expect(f.backend.saveData).toHaveBeenCalledOnce();
			expect(
				f.store.getPartition<LearningStateDocument>("learning")?.studyHistory[0]?.duration,
			).toBe(12);
			repo.dispose();
		},
	);

	it("opens and refreshes a 2413-card deck without rewriting unchanged learning", async () => {
		const f = await fixture(2413);
		const home = createDeckHome({
			repository: f.repo,
			identity: f.identity,
			saveSettingsPatch: vi.fn(),
			exportDeck: vi.fn(),
			report: vi.fn(),
		});
		for (let index = 0; index < 3; index++) {
			expect(await home.act({ kind: "refresh" })).toEqual({ kind: "applied" });
		}
		expect(home.getSnapshot().totals.totalCards).toBe(2413);
		expect(f.backend.saveData).not.toHaveBeenCalled();
		home.dispose();
		f.repo.dispose();
	});

	it("skips the first refresh after restoring persisted learning with different key order", async () => {
		const f = await fixture();
		f.repo.dispose();
		const learning = f.store.getPartition<LearningStateDocument>("learning")!;
		const reordered = JSON.parse(JSON.stringify(learning), (_key, value: unknown) =>
			value && typeof value === "object" && !Array.isArray(value)
				? Object.fromEntries(Object.entries(value).reverse())
				: value,
		);
		await f.store.savePartition("learning", reordered);
		f.backend.saveData.mockClear();
		const reopened = f.openRepository();
		expect((await reopened.identity.synchronize()).kind).toBe("current");
		expect(f.backend.saveData).not.toHaveBeenCalled();
		expect(reopened.repo.getAllDecks()[0]?.cards).toHaveLength(2);
		reopened.repo.dispose();
	});

	it("updates source content in memory and the cache without a learning write", async () => {
		const f = await fixture();
		const revision = f.repo.getRevision();
		f.document.content = f.document.content.replace("word 0", "updated word");
		f.document.basename = "renamed";
		f.document.content += "\n";
		expect((await f.identity.synchronize()).kind).toBe("current");
		expect(f.repo.getCard(PATH, ID)?.front).toBe("updated word");
		expect(f.repo.getDeck(PATH)?.name).toBe("renamed");
		expect(f.repo.getRevision()).toBeGreaterThan(revision);
		expect(f.backend.saveData).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(f.cache.save).toHaveBeenCalledOnce());
		expect(f.cache.save.mock.calls[0]?.[0].decks[PATH]?.cards[0]?.front).toBe("updated word");
		f.repo.dispose();
	});

	it("updates available tags without rewriting learning", async () => {
		const f = await fixture();
		const state = await f.repo.createContinuityStateStore().load();
		state.availableTags = [...state.availableTags!, "#discovered"];
		await f.repo.createContinuityStateStore().commit(state);
		expect(f.repo.getAvailableTags()).toContain("#discovered");
		expect(f.backend.saveData).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(f.cache.save).toHaveBeenCalledOnce());
		expect(f.cache.save.mock.calls[0]?.[0].availableTags).toContain("#discovered");
		f.repo.dispose();
	});

	it("persists each journal change and its removal before skipping an identical state", async () => {
		const f = await fixture();
		const state = await f.repo.createContinuityStateStore().load();
		state.continuity.journal = {
			id: "migration",
			type: "migration",
			sources: [],
			completedSources: [],
			pendingSources: [PATH],
		};
		await f.repo.createContinuityStateStore().commit(state);
		expect(f.backend.saveData).toHaveBeenCalledOnce();
		state.continuity.journal.completedSources = [PATH];
		state.continuity.journal.pendingSources = [];
		await f.repo.createContinuityStateStore().commit(state);
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		expect(f.store.getPartition<LearningStateDocument>("learning")?.continuity.journal).toEqual(
			state.continuity.journal,
		);
		state.continuity.journal = null;
		await f.repo.createContinuityStateStore().commit(state);
		await f.repo.createContinuityStateStore().commit(state);
		expect(f.backend.saveData).toHaveBeenCalledTimes(3);
		expect(
			f.store.getPartition<LearningStateDocument>("learning")?.continuity.journal,
		).toBeNull();
		f.repo.dispose();
	});

	it("rebuilds the comparison baseline after an authority conflict", async () => {
		const f = await fixture();
		const authority = new MemoryFlashcardAuthority(
			DEFAULT_SETTINGS,
			decodePersistedLearning(f.store.getPartition("learning")),
		);
		const repo = new FlashcardRepository({ authority, deckIndexCache: f.cache });
		const state = await repo.createContinuityStateStore().load();
		state.continuity.sources[PATH] = { type: "last-known-good", reason: "source-failure" };
		authority.conflictNextCommit = true;
		const commit = vi.spyOn(authority, "commit");
		await repo.createContinuityStateStore().commit(state);
		expect(commit).toHaveBeenCalledTimes(2);
		await repo.createContinuityStateStore().commit(state);
		expect(commit).toHaveBeenCalledTimes(2);
		expect((await authority.read()).content).toMatchObject({
			kind: "current",
			learning: { continuity: state.continuity },
		});
		repo.dispose();
		f.repo.dispose();
	});

	it("persists added and deleted identities, then skips the next unchanged synchronization", async () => {
		const f = await fixture(1);
		f.document.content += `\n${sourceCard(1)}`;
		await f.identity.synchronize();
		expect(
			Object.keys(f.store.getPartition<LearningStateDocument>("learning")!.cards),
		).toHaveLength(2);
		expect(f.backend.saveData).toHaveBeenCalledOnce();
		f.document.content = `${DEFAULT_SETTINGS.flashcardTags[0]}\n${sourceCard(0)}`;
		await f.identity.synchronize();
		expect(Object.keys(f.store.getPartition<LearningStateDocument>("learning")!.cards)).toEqual(
			[ID],
		);
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		await f.identity.synchronize();
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		f.repo.dispose();
	});

	it("does not advance the comparison baseline when persistence fails", async () => {
		const f = await fixture(1);
		f.document.content += `\n${sourceCard(1)}`;
		f.backend.saveData.mockRejectedValueOnce(new Error("disk full"));
		expect((await f.identity.synchronize()).kind).toBe("failed");
		expect(f.repo.getDeck(PATH)?.cards).toHaveLength(1);
		expect((await f.identity.synchronize()).kind).toBe("current");
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		expect(f.repo.getDeck(PATH)?.cards).toHaveLength(2);
		await f.identity.synchronize();
		expect(f.backend.saveData).toHaveBeenCalledTimes(2);
		f.repo.dispose();
	});

	it("compares against learning committed by a session transition", async () => {
		const f = await fixture();
		const card = f.repo.getCard(PATH, ID)!;
		await f.repo.commitSession(
			mergeCommits(
				answerCommit({
					deckId: PATH,
					cardId: ID,
					fsrsCard: { ...card.fsrsCard, reps: 2 },
				}),
				spellingCommit({ cardId: ID, correct: false, attemptedAt: Date.now() }),
				recordCommit({
					mode: "study",
					deckId: PATH,
					deckName: "words",
					occurredAt: Date.now(),
					activity: { completion: "completed", answerCount: 1, durationSeconds: 0 },
				}),
			),
		);
		const learning = structuredClone(f.store.getPartition("learning"));
		f.backend.saveData.mockClear();
		await f.identity.synchronize();
		expect(f.backend.saveData).not.toHaveBeenCalled();
		expect(f.store.getPartition("learning")).toEqual(learning);
		f.repo.dispose();
	});

	it("uses the latest external learning snapshot as the comparison baseline", async () => {
		const f = await fixture();
		// The store partition is compact; decode it before editing the in-memory doc.
		const learning = structuredClone(decodePersistedLearning(f.store.getPartition("learning")));
		learning.decks[PATH]!.studyCount = 17;
		learning.cards[ID]!.fsrsCard.reps = 9;
		f.replaceExternalData({ ...f.store.getRawDocument(), learning });
		await f.store.reloadExternalSettings();
		await vi.waitFor(() => expect(f.repo.getDeck(PATH)?.studyCount).toBe(17));
		f.backend.saveData.mockClear();
		await f.identity.synchronize();
		expect(f.backend.saveData).not.toHaveBeenCalled();
		expect(f.repo.getCard(PATH, ID)?.fsrsCard.reps).toBe(9);
		f.repo.dispose();
	});
});
