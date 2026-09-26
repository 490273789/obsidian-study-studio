import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

import { DEFAULT_SETTINGS } from "../../../../core/host/settingsSlices";
import { WorkbenchStore, type StorageBackend } from "../../../../core/storage/workbenchStore";
import {
	FlashcardAuthorityConflictError,
	type LearningStateDocument,
} from "../../domain/storage/persistenceTypes";
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
	it("isolates replacement learning and preserves other partitions while notifying peer authorities", async () => {
		const backend = createBackend({
			schemaVersion: 2,
			settings: { ...DEFAULT_SETTINGS, dailyNewCards: 27 },
			learning: emptyLearning(),
			other: { nested: ["preserved"] },
		});
		const store = new WorkbenchStore(backend);
		const authority = new WorkbenchFlashcardAuthority({ store });
		const peer = new WorkbenchFlashcardAuthority({ store });
		const ownChange = vi.fn();
		const peerChange = vi.fn();
		authority.subscribe(ownChange);
		peer.subscribe(peerChange);
		const initial = await authority.read();
		const learning = emptyLearning();
		learning.decks["deck-1"] = { studyCount: 1, lastStudied: null };
		const expected = structuredClone(learning);

		const result = await authority.commit(initial.version, { learning });
		learning.decks["deck-1"]!.studyCount = 99;
		learning.continuity.issues.length = 10;

		expect(store.getPartition("learning")).toEqual(expected);
		expect(store.getPartition("other")).toEqual({ nested: ["preserved"] });
		expect(store.getSettings().dailyNewCards).toBe(27);
		expect(backend.data).toMatchObject({
			learning: expected,
			other: { nested: ["preserved"] },
		});
		expect(result.version).toBe(initial.version + 1);
		expect(ownChange).not.toHaveBeenCalled();
		expect(peerChange).toHaveBeenCalledExactlyOnceWith({
			kind: "learning",
			version: result.version,
		});
		authority.dispose();
		peer.dispose();
	});

	it.each([false, true])(
		"preserves committed data and revisions after write failure (migration: %s)",
		async (discardLegacy) => {
			const backend = createBackend({
				schemaVersion: 2,
				settings: DEFAULT_SETTINGS,
				learning: emptyLearning(),
				decks: { legacy: { name: "Retained on failure" } },
			});
			const store = new WorkbenchStore(backend);
			const authority = new WorkbenchFlashcardAuthority({ store });
			const initial = await authority.read();
			const before = structuredClone(store.getRawDocument());
			const changed = vi.fn();
			store.subscribe(changed);
			vi.spyOn(backend, "saveData").mockRejectedValueOnce(new Error("disk full"));
			const learning = emptyLearning();
			learning.decks["deck-1"] = { studyCount: 1, lastStudied: null };

			await expect(
				authority.commit(initial.version, { learning, discardLegacy }),
			).rejects.toThrow("disk full");
			expect(store.getRawDocument()).toEqual(before);
			expect(backend.data).toEqual(before);
			expect(store.getRevision()).toBe(initial.version);
			expect(changed).not.toHaveBeenCalled();
			await expect(
				authority.commit(initial.version, { learning, discardLegacy }),
			).resolves.toEqual({ version: initial.version + 1 });
			authority.dispose();
		},
	);

	it("rejects a learning replacement queued behind a newer settings commit", async () => {
		const backend = createBackend({
			schemaVersion: 2,
			settings: DEFAULT_SETTINGS,
			learning: emptyLearning(),
		});
		const store = new WorkbenchStore(backend);
		const authority = new WorkbenchFlashcardAuthority({ store });
		const initial = await authority.read();
		const save = vi.spyOn(backend, "saveData");
		const settingsWrite = store.saveSettings({ ...store.getSettings(), dailyNewCards: 42 });
		const learning = emptyLearning();
		learning.decks["deck-1"] = { studyCount: 1, lastStudied: null };
		const result = authority.commit(initial.version, { learning });

		await expect(result).rejects.toBeInstanceOf(FlashcardAuthorityConflictError);
		await settingsWrite;
		expect(store.getSettings().dailyNewCards).toBe(42);
		expect(store.getPartition("learning")).toEqual(emptyLearning());
		expect(store.getRevision()).toBe(initial.version + 1);
		expect(save).toHaveBeenCalledTimes(1);
		authority.dispose();
	});

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
