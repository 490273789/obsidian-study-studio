import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));
import type { DeckIndexCache } from "../../../../../core/storage/deckIndexCache";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import {
	FlashcardRepository,
	type SerializedDeck,
	type LearningStateDocument,
} from "../flashcardRepository";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";
import { recordCommit } from "./sessionCommitBuilders";

const PATH = "notes/words.md";
const ID = "550e8400-e29b-41d4-a716-446655440000";

function fixture() {
	const fsrsCard = {
		due: "2026-10-13T00:00:00.000Z",
		stability: 5,
		difficulty: 4,
		elapsed_days: 1,
		scheduled_days: 5,
		reps: 2,
		lapses: 0,
		state: 2,
		last_review: null,
		learning_steps: 0,
	};
	const learning: LearningStateDocument = {
		cards: { [ID]: { fsrsCard } },
		decks: { [PATH]: { studyCount: 7, lastStudied: null } },
		studyHistory: [],
		spellingProgress: {},
		continuity: { sources: { [PATH]: { type: "current" } }, issues: [], journal: null },
	};
	const cacheDocument: DeckIndexCache<SerializedDeck> = {
		version: 1,
		updatedAt: "2026-10-13T00:00:00.000Z",
		availableTags: ["#word"],
		decks: {
			[PATH]: {
				id: PATH,
				filePath: PATH,
				name: "Words",
				tag: "#word",
				studyCount: 0,
				lastStudied: null,
				cards: [
					{
						id: ID,
						front: "apple",
						back: "苹果",
						sourceFile: PATH,
						indexInFile: 0,
						fsrsCard: { ...fsrsCard, reps: 0 },
					},
				],
			},
		},
	};
	const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS, learning);
	const cache = {
		load: vi.fn(async (): Promise<DeckIndexCache<SerializedDeck> | null> =>
			structuredClone(cacheDocument),
		),
		save: vi.fn(),
		loadOrRebuild: vi.fn(),
		invalidateSource: vi.fn(),
		clear: vi.fn(),
	};
	const repo = new FlashcardRepository({ authority, deckIndexCache: cache });
	return { repo, authority, cache, learning, cacheDocument };
}

describe("deferred deck index", () => {
	it("restores learning without reading or waiting for the local cache", async () => {
		const f = fixture();
		f.cache.load.mockImplementation(() => new Promise(() => {}));
		await f.repo.load();
		expect(f.cache.load).not.toHaveBeenCalled();
		expect(f.repo.getDeck(PATH)?.studyCount).toBe(7);
		expect(f.repo.getAllDecks().flatMap((deck) => deck.cards)[0]?.fsrsCard.reps).toBe(2);
		expect(f.repo.hasAvailableTagsSnapshot()).toBe(false);
		f.repo.dispose();
	});

	it("shares the first hydration across concurrent consumers without writing learning", async () => {
		const f = fixture();
		let resolve!: (cache: DeckIndexCache<SerializedDeck>) => void;
		f.cache.load.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const commit = vi.spyOn(f.authority, "commit");
		const requests = [
			f.repo.loadDeckIndex(),
			f.repo.loadDeckIndex(),
			f.repo.createContinuityStateStore().load(),
		];
		await vi.waitFor(() => expect(f.cache.load).toHaveBeenCalledOnce());
		resolve(f.cacheDocument);
		await Promise.all(requests);
		expect(f.repo.getDeck(PATH)?.name).toBe("Words");
		expect(f.repo.getDeck(PATH)?.studyCount).toBe(7);
		expect(f.repo.getCard(PATH, ID)?.fsrsCard.reps).toBe(2);
		expect(f.repo.getAvailableTags()).toEqual(["#word"]);
		expect(f.repo.getRevision()).toBe(2);
		await f.repo.loadDeckIndex();
		expect(f.cache.load).toHaveBeenCalledOnce();
		expect(commit).not.toHaveBeenCalled();
		f.repo.dispose();
	});

	it("uses external learning received before the first cache read", async () => {
		const f = fixture();
		await f.repo.load();
		f.learning.cards[ID]!.fsrsCard.reps = 9;
		f.learning.decks[PATH]!.studyCount = 11;
		f.authority.replaceExternal(DEFAULT_SETTINGS, f.learning);
		await vi.waitFor(() => expect(f.repo.getRevision()).toBe(2));
		expect(f.cache.load).not.toHaveBeenCalled();
		await f.repo.loadDeckIndex();
		expect(f.repo.getCard(PATH, ID)?.fsrsCard.reps).toBe(9);
		expect(f.repo.getDeck(PATH)?.studyCount).toBe(11);
		f.repo.dispose();
	});

	it("rehydrates the index on external reload after a consumer has requested it", async () => {
		const f = fixture();
		await f.repo.loadDeckIndex();
		f.learning.cards[ID]!.fsrsCard.reps = 9;
		f.learning.decks[PATH]!.studyCount = 11;
		const revision = f.repo.getRevision();
		f.authority.replaceExternal(DEFAULT_SETTINGS, f.learning);
		await vi.waitFor(() => expect(f.repo.getRevision()).toBeGreaterThan(revision));
		expect(f.cache.load).toHaveBeenCalledTimes(2);
		expect(f.repo.getDeck(PATH)?.name).toBe("Words");
		expect(f.repo.getDeck(PATH)?.studyCount).toBe(11);
		expect(f.repo.getCard(PATH, ID)?.fsrsCard.reps).toBe(9);
		f.repo.dispose();
	});

	it("keeps migrated legacy decks ready without reading a derived cache", async () => {
		const f = fixture();
		vi.spyOn(f.authority, "read").mockResolvedValueOnce({
			version: 0,
			settings: DEFAULT_SETTINGS,
			content: { kind: "legacy", document: { decks: f.cacheDocument.decks } },
		});
		await f.repo.load();
		await f.repo.loadDeckIndex();
		expect(f.cache.load).not.toHaveBeenCalled();
		expect(f.repo.getCard(PATH, ID)?.front).toBe("apple");
		await vi.waitFor(() => expect(f.cache.save).toHaveBeenCalledOnce());
		f.repo.dispose();
	});

	it.each([
		{ kind: "word-list", cacheExists: true },
		{ kind: "session", cacheExists: true },
		{ kind: "word-list", cacheExists: false },
		{ kind: "session", cacheExists: false },
	])(
		"hydrates before a $kind write builds learning (cache exists: $cacheExists)",
		async ({ kind, cacheExists }) => {
			const f = fixture();
			if (!cacheExists) f.cache.load.mockResolvedValueOnce(null);
			await f.repo.load();
			if (kind === "word-list") await f.repo.recordWordListVisit(PATH, "Words", 0, 6_000);
			else
				await f.repo.commitSession(
					recordCommit({
						mode: "study",
						deckId: PATH,
						deckName: "Words",
						occurredAt: 1_000,
						activity: {
							completion: "completed",
							answerCount: 1,
							durationSeconds: 0,
						},
					}),
				);
			expect(f.cache.load).toHaveBeenCalledOnce();
			const snapshot = await f.authority.read();
			if (snapshot.content.kind !== "current") throw new Error("Expected current learning");
			expect(Object.keys(snapshot.content.learning!.decks)).toEqual([PATH]);
			expect(snapshot.content.learning?.decks[PATH]?.studyCount).toBe(
				kind === "session" ? 8 : 7,
			);
			expect(snapshot.content.learning?.cards[ID]?.fsrsCard.reps).toBe(2);
			f.repo.dispose();
		},
	);

	it("does not install a deferred result after disposal", async () => {
		const f = fixture();
		await f.repo.load();
		let resolve!: (cache: DeckIndexCache<SerializedDeck>) => void;
		f.cache.load.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const changed = vi.fn();
		f.repo.subscribe(changed);
		const loading = f.repo.loadDeckIndex();
		await vi.waitFor(() => expect(f.cache.load).toHaveBeenCalledOnce());
		f.repo.dispose();
		resolve(f.cacheDocument);
		await loading;
		expect(changed).not.toHaveBeenCalled();
		expect(f.repo.getDeck(PATH)?.name).not.toBe("Words");
	});
});
