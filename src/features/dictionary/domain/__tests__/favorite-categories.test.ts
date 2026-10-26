import { describe, expect, it, vi } from "vite-plus/test";
import {
	FavoriteCategoryError,
	FavoriteCategoryManager,
	favoriteCategoryPath,
	favoriteCategoryPathSuggestions,
} from "../favorite-categories";
import { normalizeDictionarySettings } from "../configuration";
import { createMemoryDictionaryFavoriteStore } from "../favorite-file";
import type { DictionarySettingsStore } from "../types";

function setup(
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
	return {
		manager: new FavoriteCategoryManager(store, files, changed),
		files,
		settings,
		changed,
		fail: () => {
			fails = true;
		},
	};
}

describe("favorite category administration", () => {
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

	it("creates a file and selects a new category from the favorite form", async () => {
		const { manager, files, settings } = setup();
		const created = await manager.create(" 四级 ", "Words/four", true);
		expect(created).toMatchObject({ name: "四级", path: "Words/four.md" });
		expect(settings.selectedFavoriteCategoryId).toBe(created.id);
		expect(await files.open("Words/four.md")).toBe(true);
	});

	it("can associate an existing file from settings without changing the selection", async () => {
		const { manager, files, settings } = setup({ "old.md": "", "existing.md": "content" });
		const created = await manager.create("existing", "existing.md", false);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(await files.open(created.path)).toBe(true);
		expect(await files.find(created.path, "apple")).toBeNull();
	});

	it("rejects duplicate names, paths and invalid paths", async () => {
		const { manager } = setup();
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
		const { manager, files, fail } = setup();
		fail();
		await expect(manager.create("new", "new.md", true)).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await files.open("new.md")).toBe(false);
	});

	it("moves the source on edit and restores it if settings saving fails", async () => {
		const first = setup();
		await first.manager.edit("default", "Renamed", "moved.md");
		expect(first.settings.favoriteCategories[0]).toMatchObject({
			name: "Renamed",
			path: "moved.md",
		});
		expect(await first.files.open("old.md")).toBe(false);
		expect(await first.files.open("moved.md")).toBe(true);
		const second = setup();
		second.fail();
		await expect(second.manager.edit("default", "Renamed", "moved.md")).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await second.files.open("old.md")).toBe(true);
		expect(await second.files.open("moved.md")).toBe(false);
	});

	it("deletes only configuration, selects the first remaining category, and protects the last", async () => {
		const { manager, files, settings } = setup();
		await expect(manager.remove("default")).rejects.toEqual(
			new FavoriteCategoryError("last-category"),
		);
		const second = await manager.create("second", "second.md", true);
		await manager.remove(second.id);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(settings.favoriteCategories).toHaveLength(1);
		expect(await files.open("second.md")).toBe(true);
	});

	it("serializes favorite writes against category file moves", async () => {
		const { manager, files } = setup();
		let finishWrite!: () => void;
		const writing = manager.saveFavorite(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		await expect(manager.edit("default", "renamed", "new.md")).rejects.toEqual(
			new FavoriteCategoryError("busy"),
		);
		finishWrite();
		await writing;
		let finishMove!: (undo: () => Promise<void>) => void;
		vi.spyOn(files, "moveFile").mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishMove = resolve;
				}),
		);
		const moving = manager.edit("default", "renamed", "new.md");
		await expect(manager.saveFavorite(async () => undefined)).rejects.toEqual(
			new FavoriteCategoryError("busy"),
		);
		finishMove(async () => undefined);
		await moving;
	});
});
