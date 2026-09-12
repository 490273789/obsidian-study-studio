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
});
