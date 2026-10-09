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
		remove: vi.fn(async (path: string) => {
			files.delete(path);
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
	it("stores derived deck content outside data.json and invalidates one source", async () => {
		const adapter = createAdapter();
		const store = createDeckIndexCacheStore<{ id: string }>(
			adapter as never,
			".obsidian/plugins/study",
		);
		if (!store) throw new Error("Expected cache store");

		await store.save(cache({ "notes/a.md": { id: "a" }, "notes/b.md": { id: "b" } }));
		expect(adapter.files.get(".obsidian/plugins/study/cache/deck-index.json")).toContain(
			"notes/a.md",
		);

		await store.invalidateSource("notes/a.md");
		await expect(store.load()).resolves.toMatchObject({ decks: { "notes/b.md": { id: "b" } } });
		await store.clear();
		await expect(store.load()).resolves.toBeNull();
	});

	it("rebuilds after a malformed cache without making cache data authoritative", async () => {
		const adapter = createAdapter({
			".obsidian/plugins/study/cache/deck-index.json": "not-json",
		});
		const store = createDeckIndexCacheStore<{ id: string }>(
			adapter as never,
			".obsidian/plugins/study",
		);
		if (!store) throw new Error("Expected cache store");
		const build = vi.fn(async () => cache({ "notes/rebuilt.md": { id: "rebuilt" } }));

		await expect(store.loadOrRebuild(build)).resolves.toMatchObject({
			decks: { "notes/rebuilt.md": { id: "rebuilt" } },
		});
		expect(build).toHaveBeenCalledOnce();
	});
});
