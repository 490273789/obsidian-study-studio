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
	let beforeNextWrite: (() => void) | undefined;
	const changed = vi.fn();
	const store = {
		getDictionarySettings: () => settings,
		updateDictionarySettings: vi.fn(async (mutate: (draft: typeof settings) => void) => {
			if (fails) return false;
			const before = beforeNextWrite;
			beforeNextWrite = undefined;
			before?.();
			const draft = structuredClone(settings);
			try {
				mutate(draft);
				Object.assign(settings, draft);
				return true;
			} catch {
				return false;
			}
		}),
	} as unknown as DictionarySettingsStore;
	const manager = new FavoriteCategoryManager(store, files, changed);
	return {
		manager,
		files,
		settings,
		changed,
		beforeWrite: (change: () => void) => {
			beforeNextWrite = change;
		},
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

	it("rechecks names in the queued settings write and rolls back an unclaimed file", async () => {
		const { manager, files, settings, beforeWrite } = setupCategoryManager();
		beforeWrite(() =>
			settings.favoriteCategories.push({ id: "synced", name: "NEW", path: "synced.md" }),
		);
		await expect(manager.create("new", "new.md", true)).rejects.toMatchObject({
			reason: "duplicate-name",
		});
		expect(settings.favoriteCategories.map(({ id }) => id)).toEqual(["default", "synced"]);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(await files.open("new.md")).toBe(false);
	});

	it("keeps a new file that a synchronized category claims before the queued write", async () => {
		const { manager, files, settings, beforeWrite } = setupCategoryManager();
		beforeWrite(() =>
			settings.favoriteCategories.push({ id: "synced", name: "Synced", path: "new.md" }),
		);
		await expect(manager.create("new", "new.md", true)).rejects.toMatchObject({
			reason: "duplicate-path",
		});
		expect(settings.favoriteCategories.map(({ id }) => id)).toEqual(["default", "synced"]);
		expect(await files.open("new.md")).toBe(true);
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

	it("keeps the committed file move if its notification fails", async () => {
		const { manager, changed, files } = setupCategoryManager();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			changed.mockImplementationOnce(() => {
				throw new Error("notification failed");
			});
			await manager.edit("default", "Edited", "renamed.md");
			expect(manager.path).toBe("renamed.md");
			expect(await files.open("renamed.md")).toBe(true);
			expect(logged).toHaveBeenCalledOnce();
		} finally {
			logged.mockRestore();
		}
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

	it("rolls back a case-only path edit when its settings write fails", async () => {
		const { manager, files, fail } = setupCategoryManager();
		fail();
		await expect(manager.edit("default", "名", "OLD.md")).rejects.toMatchObject({
			reason: "save-failed",
		});
		expect(await files.open("old.md")).toBe(true);
		expect(await files.open("OLD.md")).toBe(false);
	});

	it.each(["deleted", "edited"] as const)(
		"rolls back a move when a category was %s by sync",
		async (operation) => {
			const { manager, files, settings, beforeWrite, changed } = setupCategoryManager();
			beforeWrite(() => {
				expect(files.pathSuggestions("renamed")).toEqual(["renamed.md"]);
				settings.favoriteCategories =
					operation === "deleted"
						? [{ id: "other", name: "Other", path: "other.md" }]
						: [{ ...settings.favoriteCategories[0]!, name: "Synced name" }];
			});
			await expect(manager.edit("default", "Local name", "renamed.md")).rejects.toMatchObject(
				{ reason: "conflict" },
			);
			expect(settings.favoriteCategories[0]?.name).toBe(
				operation === "deleted" ? "Other" : "Synced name",
			);
			expect(await files.open("old.md")).toBe(true);
			expect(await files.open("renamed.md")).toBe(false);
			expect(changed).not.toHaveBeenCalled();
		},
	);

	it("preserves a moved document claimed by sync and reports that recovery is incomplete", async () => {
		const { manager, files, settings, beforeWrite } = setupCategoryManager();
		beforeWrite(() =>
			settings.favoriteCategories.push({ id: "synced", name: "Synced", path: "renamed.md" }),
		);
		await expect(manager.edit("default", "Local name", "renamed.md")).rejects.toMatchObject({
			reason: "recovery-incomplete",
		});
		expect(settings.favoriteCategories.map(({ path }) => path)).toEqual([
			"old.md",
			"renamed.md",
		]);
		expect(await files.find("renamed.md", "apple")).toMatchObject({ word: "apple" });
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

	it("refuses to remove a category which became the last one while waiting for the settings write", async () => {
		const { manager, files, settings, beforeWrite } = setupCategoryManager();
		const selected = await manager.create("Other", "other.md", true);
		beforeWrite(() => {
			settings.favoriteCategories = [selected];
		});
		await expect(manager.remove(selected.id)).rejects.toMatchObject({
			reason: "last-category",
		});
		expect(settings.favoriteCategories).toEqual([selected]);
		expect(settings.selectedFavoriteCategoryId).toBe(selected.id);
		expect(await files.open("other.md")).toBe(true);
	});

	it("keeps an updated category when it changes before a queued removal", async () => {
		const { manager, settings, beforeWrite } = setupCategoryManager();
		const other = await manager.create("Other", "other.md");
		beforeWrite(() => {
			settings.favoriteCategories[1]!.name = "Synced";
		});
		await expect(manager.remove(other.id)).rejects.toMatchObject({ reason: "conflict" });
		expect(settings.favoriteCategories[1]?.name).toBe("Synced");
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

	it("rejects selection when sync removes a category before the queued write", async () => {
		const { manager, settings, beforeWrite } = setupCategoryManager();
		const other = await manager.create("Other", "other.md");
		beforeWrite(() => {
			settings.favoriteCategories.pop();
		});
		await expect(manager.select(other.id)).rejects.toMatchObject({ reason: "conflict" });
		expect(settings.selectedFavoriteCategoryId).toBe("default");
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
