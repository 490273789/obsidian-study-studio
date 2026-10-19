import { describe, expect, it, vi } from "vite-plus/test";
import {
	DECK_INDEX_CACHE_VERSION,
	createDeckIndexCacheStore,
	type DeckIndexCache,
} from "../deckIndexCache";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

function createAdapter(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const directories = new Set<string>();
	return {
		exists: vi.fn(async (path: string) => files.has(path) || directories.has(path)),
		mkdir: vi.fn(async (path: string) => {
			directories.add(path);
		}),
		read: vi.fn(async (path: string) => {
			const value = files.get(path);
			if (value === undefined) throw new Error("not found");
			return value;
		}),
		write: vi.fn(async (path: string, value: string) => {
			files.set(path, value);
		}),
		files,
	};
}

function cache(decks: Record<string, { id: string }>): DeckIndexCache<{ id: string }> {
	return {
		version: DECK_INDEX_CACHE_VERSION,
		updatedAt: "2026-09-11T00:00:00.000Z",
		availableTags: ["#学习"],
		decks,
	};
}

describe("DeckIndexCacheStore", () => {
	it("stores and reads one derived deck snapshot outside data.json", async () => {
		const adapter = createAdapter();
		const store = createDeckIndexCacheStore<{ id: string }>(
			adapter as never,
			".obsidian/plugins/study",
		);
		if (!store) throw new Error("Expected cache store");
		const snapshot = cache({ "notes/a.md": { id: "a" } });

		await store.save(snapshot);

		expect(adapter.files.get(".obsidian/plugins/study/cache/deck-index.json")).toContain(
			"notes/a.md",
		);
		await expect(store.load()).resolves.toEqual(snapshot);
	});

	it("returns null for a missing or malformed snapshot instead of rebuilding", async () => {
		const missing = createDeckIndexCacheStore<{ id: string }>(
			createAdapter() as never,
			".obsidian/plugins/study",
		);
		if (!missing) throw new Error("Expected cache store");
		await expect(missing.load()).resolves.toBeNull();

		const malformed = createDeckIndexCacheStore<{ id: string }>(
			createAdapter({
				".obsidian/plugins/study/cache/deck-index.json": "not-json",
			}) as never,
			".obsidian/plugins/study",
		);
		if (!malformed) throw new Error("Expected cache store");
		await expect(malformed.load()).resolves.toBeNull();

		const wrongVersion = createDeckIndexCacheStore<{ id: string }>(
			createAdapter({
				".obsidian/plugins/study/cache/deck-index.json": JSON.stringify({
					...cache({ "notes/a.md": { id: "a" } }),
					version: 99,
				}),
			}) as never,
			".obsidian/plugins/study",
		);
		if (!wrongVersion) throw new Error("Expected cache store");
		await expect(wrongVersion.load()).resolves.toBeNull();
	});
});
