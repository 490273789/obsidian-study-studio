import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import type { DeckIndexCache } from "../../../../../core/storage/deckIndexCache";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import { createFlashcardPersistence } from "../flashcardPersistence";
import type { LearningStateDocument, SerializedDeck } from "../persistenceTypes";
import type { SessionJournalStore } from "../sessionJournal";
import { answerCommit } from "./sessionCommitBuilders";
import { MemoryFlashcardAuthority } from "./memoryFlashcardAuthority";

const PATH = "notes/words.md";
const ID = "550e8400-e29b-41d4-a716-446655440000";

const FSRS_CARD = {
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

function fixture(journal?: SessionJournalStore) {
	const learning: LearningStateDocument = {
		cards: { [ID]: { fsrsCard: { ...FSRS_CARD } } },
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
						fsrsCard: { ...FSRS_CARD, reps: 0 },
					},
				],
			},
		},
	};
	const authority = new MemoryFlashcardAuthority(DEFAULT_SETTINGS, learning);
	const cache = {
		load: vi.fn(async () => structuredClone(cacheDocument)),
		save: vi.fn(),
	};
	const persistence = createFlashcardPersistence({
		authority,
		deckIndex: cache,
		journal: journal ? { store: journal } : null,
	});
	return { persistence, cache, authority };
}

describe("createFlashcardPersistence", () => {
	it("composes the consumer seams and keeps deck-index hydration lazy", async () => {
		const { persistence, cache } = fixture();
		await persistence.prepare();

		expect(cache.load).not.toHaveBeenCalled();
		expect(persistence.tags.hasSnapshot()).toBe(false);

		// The continuity store is production's hydration path for the
		// rebuildable index; cards and tags appear only after it loads.
		await persistence.continuity.load();

		expect(cache.load).toHaveBeenCalledOnce();
		expect(persistence.deckHome.getAllDecks().map((deck) => deck.id)).toEqual([PATH]);
		expect(persistence.sessions.getCard(PATH, ID)?.id).toBe(ID);
		expect(persistence.tags.hasSnapshot()).toBe(true);
		expect(persistence.tags.read()).toEqual(["#word"]);
		persistence.dispose();
	});

	it("routes grouped journal configuration into the session commit path", async () => {
		const append = vi.fn(async () => {});
		const journal: SessionJournalStore = {
			load: vi.fn(async () => []),
			append,
			clear: vi.fn(async () => {}),
		};
		const { persistence } = fixture(journal);
		await persistence.prepare();
		await persistence.continuity.load();

		const result = await persistence.sessions.commitSession(
			answerCommit({
				deckId: PATH,
				cardId: ID,
				fsrsCard: {
					...createEmptyCard(),
					due: new Date(FSRS_CARD.due),
					state: State.Review,
					reps: 3,
				},
			}),
		);

		expect(result.kind).toBe("applied");
		expect(append).toHaveBeenCalledOnce();
		persistence.dispose();
	});

	it("prepares once across concurrent callers and disposes idempotently", async () => {
		const { persistence, authority } = fixture();
		const read = vi.spyOn(authority, "read");

		await Promise.all([persistence.prepare(), persistence.prepare()]);

		expect(read).toHaveBeenCalledOnce();
		persistence.dispose();
		expect(() => persistence.dispose()).not.toThrow();
	});
});
