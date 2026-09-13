import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import { DEFAULT_SETTINGS } from "../../../../core/host/settingsSlices";
import { WorkbenchStore, type StorageBackend } from "../../../../core/storage/workbenchStore";
import type { LearningStateDocument } from "../../domain/storage/persistenceTypes";
import { WorkbenchFlashcardAuthority } from "../workbenchFlashcardAuthority";

function createBackend(data: unknown): StorageBackend & { data: unknown } {
	return {
		data,
		async loadData() {
			return this.data;
		},
		async saveData(nextData: unknown) {
			this.data = structuredClone(nextData);
		},
	};
}

function emptyLearning(): LearningStateDocument {
	return {
		cards: {},
		decks: {},
		studyHistory: [],
		spellingProgress: {},
		continuity: { sources: {}, issues: [], journal: null },
	};
}

describe("WorkbenchFlashcardAuthority", () => {
	it("hides its own commit echo but forwards external learning replacements", async () => {
		const backend = createBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: emptyLearning(),
		});
		const store = new WorkbenchStore(backend);
		const authority = new WorkbenchFlashcardAuthority({ store });
		const change = vi.fn();
		authority.subscribe(change);
		const initial = await authority.read();

		await authority.commit(initial.version, { learning: emptyLearning() });
		expect(change).not.toHaveBeenCalled();

		backend.data = {
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: { ...emptyLearning(), studyHistory: [{ deckId: "synced" }] },
		};
		await store.reloadExternalSettings();

		await vi.waitFor(() =>
			expect(change).toHaveBeenCalledWith({ kind: "external", version: 2 }),
		);
		authority.dispose();
	});

	it("projects only the flashcard study settings", async () => {
		const store = new WorkbenchStore(
			createBackend({
				schemaVersion: 2,
				settings: { ...DEFAULT_SETTINGS, dailyNewCards: 27 },
			}),
		);
		const authority = new WorkbenchFlashcardAuthority({ store });

		const snapshot = await authority.read();

		expect(snapshot.settings.dailyNewCards).toBe(27);
		expect(snapshot.settings).not.toHaveProperty("ai");
		expect(snapshot.settings).not.toHaveProperty("pronunciation");
		authority.dispose();
	});

	it("preserves local legacy backup when committing with discardLegacy", async () => {
		const legacyDoc = {
			schemaVersion: 1,
			decks: { "d-1": { id: "d-1", name: "Deck 1" } },
			studyHistory: [{ deckId: "d-1" }],
		};
		const store = new WorkbenchStore(createBackend(legacyDoc));
		const write = vi.fn().mockResolvedValue(undefined);
		const exists = vi.fn().mockResolvedValue(false);
		const adapter = { exists, write } as unknown as import("obsidian").DataAdapter;

		const authority = new WorkbenchFlashcardAuthority({
			store,
			adapter,
			pluginDirectory: "plugins/study-studio",
		});

		const initial = await authority.read();
		expect(initial.content.kind).toBe("legacy");

		await authority.commit(initial.version, {
			learning: emptyLearning(),
			discardLegacy: true,
		});

		expect(exists).toHaveBeenCalledWith("plugins/study-studio/data.backup-v1.json");
		expect(write).toHaveBeenCalledWith(
			"plugins/study-studio/data.backup-v1.json",
			expect.stringContaining('"decks"'),
		);

		// Raw document in store should have discarded legacy fields
		expect(store.getRawDocument()).not.toHaveProperty("decks");
		expect(store.getRawDocument()).not.toHaveProperty("studyHistory");
		expect(store.getRawDocument()).toHaveProperty("learning");
		authority.dispose();
	});

	it("does not overwrite existing backup file", async () => {
		const legacyDoc = {
			schemaVersion: 1,
			decks: { "d-1": { id: "d-1", name: "Deck 1" } },
		};
		const store = new WorkbenchStore(createBackend(legacyDoc));
		const write = vi.fn().mockResolvedValue(undefined);
		const exists = vi.fn().mockResolvedValue(true);
		const adapter = { exists, write } as unknown as import("obsidian").DataAdapter;

		const authority = new WorkbenchFlashcardAuthority({
			store,
			adapter,
			pluginDirectory: "plugins/study-studio",
		});

		const initial = await authority.read();
		await authority.commit(initial.version, {
			learning: emptyLearning(),
			discardLegacy: true,
		});

		expect(exists).toHaveBeenCalledWith("plugins/study-studio/data.backup-v1.json");
		expect(write).not.toHaveBeenCalled();
		authority.dispose();
	});

	it("proceeds with commit even if local backup attempt throws", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const legacyDoc = {
			schemaVersion: 1,
			decks: { "d-1": { id: "d-1", name: "Deck 1" } },
		};
		const store = new WorkbenchStore(createBackend(legacyDoc));
		const write = vi.fn().mockRejectedValue(new Error("disk full"));
		const exists = vi.fn().mockResolvedValue(false);
		const adapter = { exists, write } as unknown as import("obsidian").DataAdapter;

		const authority = new WorkbenchFlashcardAuthority({
			store,
			adapter,
			pluginDirectory: "plugins/study-studio",
		});

		const initial = await authority.read();
		const result = await authority.commit(initial.version, {
			learning: emptyLearning(),
			discardLegacy: true,
		});

		expect(result.version).toBeGreaterThan(0);
		expect(warnSpy).toHaveBeenCalledWith(
			"Failed to preserve the local legacy data backup:",
			expect.any(Error),
		);
		authority.dispose();
		warnSpy.mockRestore();
	});
});
