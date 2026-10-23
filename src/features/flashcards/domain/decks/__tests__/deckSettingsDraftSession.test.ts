import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import {
	createDeckSettingsDraftSession,
	type DeckSettingsRepositoryPort,
} from "../deckSettingsDraftSession";
import type { Deck, FlashCard } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { FlashcardStudySettings } from "../../../settings/slice";

const STABLE_UUID_1 = "550e8400-e29b-41d4-a716-446655440001";
const STABLE_UUID_2 = "550e8400-e29b-41d4-a716-446655440002";

function createMockCard(id: string, front = "word"): FlashCard {
	return {
		id,
		front,
		back: "meaning",
		sourceFile: "test.md",
		indexInFile: 0,
		fsrsCard: createEmptyCard(),
	};
}

function createMockDeck(
	options: {
		id?: string;
		name?: string;
		cards?: FlashCard[];
	} = {},
): Deck {
	return {
		id: options.id ?? "deck-1",
		name: options.name ?? "Test Deck",
		filePath: "test.md",
		tag: "test",
		cards: options.cards ?? [
			createMockCard(STABLE_UUID_1, "hello"),
			createMockCard(STABLE_UUID_2, "world"),
		],
		studyCount: 0,
		lastStudied: null,
	};
}

function createDefaultSettings(): FlashcardStudySettings {
	return {
		...DEFAULT_SETTINGS,
		deckStudySettings: {},
		wordLearningDecks: {},
	};
}

describe("DeckSettingsDraftSession - Deep Domain Module", () => {
	function setup(
		overrides: {
			decks?: Deck[];
			settings?: FlashcardStudySettings;
			saveSettingsPatch?: (patch: any) => Promise<void>;
		} = {},
	) {
		let currentSettings = overrides.settings ?? createDefaultSettings();
		let currentDecks = overrides.decks ?? [createMockDeck()];
		const saveSettingsPatch = vi.fn(overrides.saveSettingsPatch ?? (async () => {}));
		const report = vi.fn();

		const repository: DeckSettingsRepositoryPort = {
			getAllDecks: () => currentDecks,
			getSettings: () => currentSettings,
		};

		const session = createDeckSettingsDraftSession({
			repository,
			saveSettingsPatch,
			report,
		});

		return {
			session,
			repository,
			saveSettingsPatch,
			report,
			setDecks: (decks: Deck[]) => {
				currentDecks = decks;
			},
			setSettings: (settings: FlashcardStudySettings) => {
				currentSettings = settings;
			},
		};
	}

	it("returns null snapshot when no draft is open", () => {
		const { session } = setup();
		expect(session.getSnapshot()).toBeNull();
		expect(session.isLocked("deck-1", "owner-1")).toBe(false);
	});

	it("rejects open when deck is missing", () => {
		const { session } = setup();
		const outcome = session.open("non-existent", "owner-1");
		expect(outcome).toEqual({ kind: "rejected", reason: "deck-missing" });
		expect(session.getSnapshot()).toBeNull();
	});

	it("opens draft with default global settings and computes daysToComplete", () => {
		const { session } = setup();
		const outcome = session.open("deck-1", "owner-1");
		expect(outcome).toEqual({ kind: "applied" });

		const snapshot = session.getSnapshot()!;
		expect(snapshot).not.toBeNull();
		expect(snapshot.ownerId).toBe("owner-1");
		expect(snapshot.deckId).toBe("deck-1");
		expect(snapshot.useCustom).toBe(false);
		expect(snapshot.dailyNewCards).toBe(20);
		expect(snapshot.daysToComplete).toBe("1"); // 2 cards / 20 = 1 day
		expect(snapshot.isSaving).toBe(false);
	});

	it("locks out another view when draft is active", () => {
		const { session } = setup();
		session.open("deck-1", "owner-1");

		expect(session.isLocked("deck-1", "owner-2")).toBe(true);
		expect(session.isLocked("deck-1", "owner-1")).toBe(false);

		const conflict = session.open("deck-1", "owner-2");
		expect(conflict).toEqual({
			kind: "rejected",
			reason: "draft-owned-by-another-view",
		});
	});

	it("mutates fields and recalculates daysToComplete when dailyNewCards changes", () => {
		const deck = createMockDeck({
			cards: Array.from({ length: 100 }, (_, i) => createMockCard(`c${i}`, `word${i}`)),
		});
		const { session } = setup({ decks: [deck] });
		session.open("deck-1", "owner-1");

		session.change("owner-1", { field: "dailyNewCards", value: 10 });
		let snapshot = session.getSnapshot()!;
		expect(snapshot.dailyNewCards).toBe(10);
		expect(snapshot.daysToComplete).toBe("10"); // 100 / 10 = 10

		session.change("owner-1", { field: "daysToComplete", value: "20" });
		snapshot = session.getSnapshot()!;
		expect(snapshot.daysToComplete).toBe("20");
		expect(snapshot.dailyNewCards).toBe(5); // 100 / 20 = 5
	});

	it("rejects changes from a non-owner", () => {
		const { session } = setup();
		session.open("deck-1", "owner-1");

		const outcome = session.change("owner-2", { field: "useCustom", value: true });
		expect(outcome).toEqual({
			kind: "rejected",
			reason: "draft-owned-by-another-view",
		});
	});

	it("saves settings and resets draft", async () => {
		const { session, saveSettingsPatch } = setup();
		session.open("deck-1", "owner-1");
		session.change("owner-1", { field: "useCustom", value: true });
		session.change("owner-1", { field: "dailyNewCards", value: 5 });

		const saveOutcome = await session.save("owner-1");
		expect(saveOutcome).toEqual({ kind: "applied" });
		expect(saveSettingsPatch).toHaveBeenCalledOnce();
		expect(saveSettingsPatch).toHaveBeenCalledWith({
			deckId: "deck-1",
			overrides: expect.objectContaining({
				dailyNewCards: 5,
			}),
			wordLearningEnabled: false,
		});
		expect(session.getSnapshot()).toBeNull();
	});

	it("rejects word learning enable when cards lack stable identities", async () => {
		const deck = createMockDeck({
			cards: [createMockCard("volatile-id", "test")], // no stable identity
		});
		const { session, saveSettingsPatch } = setup({ decks: [deck] });
		session.open("deck-1", "owner-1");
		session.change("owner-1", { field: "wordLearningEnabled", value: true });

		const saveOutcome = await session.save("owner-1");
		expect(saveOutcome).toEqual({
			kind: "rejected",
			reason: "stable-card-identity-required",
		});
		expect(saveSettingsPatch).not.toHaveBeenCalled();
	});

	it("reports failure and retains draft when save throws error", async () => {
		const { session, report } = setup({
			saveSettingsPatch: async () => {
				throw new Error("disk full");
			},
		});
		session.open("deck-1", "owner-1");

		const saveOutcome = await session.save("owner-1");
		expect(saveOutcome).toEqual({
			kind: "failed",
			message: "disk full",
		});
		expect(report).toHaveBeenCalledWith({
			kind: "settings-save-failed",
			message: "disk full",
		});
		expect(session.getSnapshot()).not.toBeNull();
		expect(session.getSnapshot()!.isSaving).toBe(false);
	});

	it("cancels draft and clears owner lock", () => {
		const { session } = setup();
		session.open("deck-1", "owner-1");
		expect(session.getSnapshot()).not.toBeNull();

		session.cancel("owner-1");
		expect(session.getSnapshot()).toBeNull();
		expect(session.isLocked("deck-1", "owner-1")).toBe(false);
	});

	it("releases owner on unmount and clears draft when not saving", () => {
		const { session } = setup();
		session.open("deck-1", "owner-1");

		session.releaseOwner("owner-1");
		expect(session.getSnapshot()).toBeNull();
	});
});
