import { describe, expect, it, vi } from "vite-plus/test";
import { normalizeDictionarySettings } from "../configuration";
import {
	FavoriteCategoryError,
	favoriteCategoryPath,
	favoriteCategoryPathSuggestions,
	FavoriteCategoryManager,
} from "../favorite-categories";
import { createMemoryDictionaryFavoriteStore } from "../favorite-file";
import type { DictionarySettingsStore } from "../types";

function setupCategoryManager(
	initialFiles: Record<string, string> = { "old.md": "## apple\n??\n苹果\n::\n\n;;\n" },
) {
	const settings = normalizeDictionarySettings({ favoritePath: "old.md" });
	const files = createMemoryDictionaryFavoriteStore(initialFiles);
	let fails = false;
	const changed = vi.fn();
	const store = {
		getDictionarySettings: () => settings,
		updateDictionarySettings: vi.fn(async (mutate: (draft: typeof settings) => void) => {
			if (fails) return false;
			mutate(settings);
			return true;
		}),
	} as unknown as DictionarySettingsStore;
	const manager = new FavoriteCategoryManager(store, files, changed);
	return {
		manager,
		files,
		settings,
		changed,
		fail: () => {
			fails = true;
		},
	};
}

describe("FavoriteCategoryManager - administration & file mutex", () => {
	it("suggests matching folders and Markdown paths before applying the result limit", () => {
		const hidden = Array.from({ length: 320 }, (_, index) => `.agents/${index}.md`);
		const paths = [
			...hidden,
			"Words/",
			"Words/Grammar/",
			"Words/Grammar/verbs.md",
			"archive/Words.md",
		];
		expect(favoriteCategoryPathSuggestions(paths, "WORDS\\")).toEqual([
			"Words/",
			"Words/Grammar/",
			"Words/Grammar/verbs.md",
		]);
		expect(favoriteCategoryPathSuggestions(paths, "words")).toEqual([
			"Words/",
			"Words/Grammar/",
			"Words/Grammar/verbs.md",
			"archive/Words.md",
		]);
		expect(favoriteCategoryPathSuggestions(paths, "")).toHaveLength(300);
	});

	it("migrates the legacy path without creating or moving its file", () => {
		const settings = normalizeDictionarySettings({ favoritePath: "words/old.md" });
		expect(settings.favoriteCategories).toEqual([
			{ id: "default", name: "默认收藏", path: "words/old.md" },
		]);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
	});

	it("creates a file and selects a new category", async () => {
		const { manager, files, settings, changed } = setupCategoryManager();
		const listener = vi.fn();
		const unsubscribe = manager.subscribe(listener);

		const created = await manager.create(" 四级 ", "Words/four", true);
		expect(created).toMatchObject({ name: "四级", path: "Words/four.md" });
		expect(settings.selectedFavoriteCategoryId).toBe(created.id);
		expect(manager.selectedCategoryId).toBe(created.id);
		expect(manager.path).toBe("Words/four.md");
		expect(await files.open("Words/four.md")).toBe(true);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
	});

	it("can associate an existing file without changing the selection", async () => {
		const { manager, files, settings } = setupCategoryManager({
			"old.md": "",
			"existing.md": "content",
		});
		const created = await manager.create("existing", "existing.md", false);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(manager.selectedCategoryId).toBe("default");
		expect(await files.open(created.path)).toBe(true);
		expect(await files.find(created.path, "apple")).toBeNull();
	});

	it("rejects duplicate names, paths and invalid paths", async () => {
		const { manager } = setupCategoryManager();
		await expect(manager.create(" 默认收藏 ", "new.md", true)).rejects.toEqual(
			new FavoriteCategoryError("duplicate-name"),
		);
		await expect(manager.create("other", "OLD.md", true)).rejects.toEqual(
			new FavoriteCategoryError("duplicate-path"),
		);
		for (const path of ["../escape.md", "/absolute.md", "folder/", "notes.txt"])
			expect(() => favoriteCategoryPath(path)).toThrow(FavoriteCategoryError);
	});

	it("rolls back a newly created file when settings cannot be saved", async () => {
		const { manager, files, fail } = setupCategoryManager();
		fail();
		await expect(manager.create("new", "new.md", true)).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await files.open("new.md")).toBe(false);
	});

	it("edits category name and moves the underlying file", async () => {
		const { manager, files, settings } = setupCategoryManager();
		await manager.edit("default", "已改名", "words/renamed");
		expect(settings.favoriteCategories).toEqual([
			{ id: "default", name: "已改名", path: "words/renamed.md" },
		]);
		expect(manager.path).toBe("words/renamed.md");
		expect(await files.open("words/renamed.md")).toBe(true);
		expect(await files.open("old.md")).toBe(false);
	});

	it("skips file operations when only the name changed", async () => {
		const { manager, files, settings } = setupCategoryManager();
		const moveSpy = vi.spyOn(files, "moveFile");
		await manager.edit("default", "仅改名", "old.md");
		expect(settings.favoriteCategories[0]?.name).toBe("仅改名");
		expect(moveSpy).not.toHaveBeenCalled();
	});

	it("rolls back a file move when persisting settings fails", async () => {
		const { manager, files, fail } = setupCategoryManager();
		fail();
		await expect(manager.edit("default", "名", "rollback.md")).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await files.open("old.md")).toBe(true);
		expect(await files.open("rollback.md")).toBe(false);
	});

	it("deletes a category and preserves its Markdown file", async () => {
		const { manager, files, settings } = setupCategoryManager();
		const created = await manager.create("other", "words/other.md", false);
		expect(settings.favoriteCategories).toHaveLength(2);

		await manager.remove(created.id);
		expect(settings.favoriteCategories).toEqual([
			{ id: "default", name: "默认收藏", path: "old.md" },
		]);
		expect(await files.open("words/other.md")).toBe(true);
	});

	it("refuses to delete the last remaining category", async () => {
		const { manager } = setupCategoryManager();
		await expect(manager.remove("default")).rejects.toEqual(
			new FavoriteCategoryError("last-category"),
		);
	});

	it("selects a category and notifies listeners", async () => {
		const { manager, settings } = setupCategoryManager();
		const created = await manager.create("other", "words/other.md", false);
		const listener = vi.fn();
		manager.subscribe(listener);

		await manager.select(created.id);
		expect(settings.selectedFavoriteCategoryId).toBe(created.id);
		expect(manager.selectedCategoryId).toBe(created.id);
		expect(manager.path).toBe("words/other.md");
		expect(listener).toHaveBeenCalled();

		// Selecting current category is a no-op
		listener.mockClear();
		await manager.select(created.id);
		expect(listener).not.toHaveBeenCalled();
	});

	it("serializes concurrent operations and rejects with busy", async () => {
		const { manager } = setupCategoryManager();
		let unlock: (() => void) | null = null;
		const slowOp = manager.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					unlock = resolve;
				}),
		);

		await expect(manager.create("other", "other.md", false)).rejects.toEqual(
			new FavoriteCategoryError("busy"),
		);

		unlock!();
		await slowOp;

		await expect(manager.create("other", "other.md", false)).resolves.toMatchObject({
			name: "other",
		});
	});
});
