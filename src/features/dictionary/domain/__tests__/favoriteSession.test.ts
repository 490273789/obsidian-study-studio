import { describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteSession } from "../favoriteSession";
import { normalizeDictionarySettings } from "../configuration";
import {
	FavoriteSaveError,
	createMemoryDictionaryFavoriteStore,
	type StoredDictionaryFavorite,
} from "../favorite-file";
import {
	FavoriteCategoryError,
	favoriteCategoryPath,
	favoriteCategoryPathSuggestions,
} from "../favorite-categories";
import type { DictionarySettingsStore } from "../types";
import type { FavoriteGeneratedDraft } from "../favorite-ai";
import { TransportError } from "../../../../core/net/types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const draft: FavoriteGeneratedDraft = {
	meaning: "n. 交换",
	note: "/test/\n\nThis is a test.\n这是一个测试。",
};

function setupWordSession() {
	const settings = normalizeDictionarySettings({
		favoriteAiConfigId: "favorite",
		favoritePath: "word.md",
	});
	const file = {
		pathSuggestions: vi.fn(() => [] as string[]),
		ensureFile: vi.fn(async () => async () => undefined),
		moveFile: vi.fn(async () => async () => undefined),
		find: vi.fn(async (): Promise<StoredDictionaryFavorite | null> => null),
		save: vi.fn(async () => "word.md"),
		open: vi.fn(async () => true),
	};
	const generate = vi.fn(async (_word: string, _config: string, _signal: AbortSignal) => draft);
	let engine: string | null = "favorite connection";
	const store = {
		getDictionarySettings: () => settings,
		updateDictionarySettings: vi.fn(async (mutate) => {
			mutate(settings);
			return true;
		}),
	} as unknown as DictionarySettingsStore;
	const session = new DictionaryFavoriteSession(store, file, {
		generator: { generate },
		language: () => "zh",
		engineKey: () => engine,
	});
	return {
		session,
		file,
		generate,
		settings,
		setEngine: (key: string | null) => {
			engine = key;
		},
	};
}

function setupCategorySession(
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
	const session = new DictionaryFavoriteSession(
		store,
		files,
		{
			generator: { generate: async () => draft },
			language: () => "zh",
			engineKey: () => "test-engine",
		},
		changed,
	);
	return {
		session,
		files,
		settings,
		changed,
		fail: () => {
			fails = true;
		},
	};
}

describe("DictionaryFavoriteSession - word draft and AI generation", () => {
	it("saves the final word after changing the form without requesting a rename", async () => {
		const { session, file } = setupWordSession();
		file.find.mockResolvedValueOnce({
			word: "apple",
			meaning: "苹果",
			note: "old",
			path: "word.md",
		});
		await session.prefill("apple");
		session.setWord("banana");
		session.setMeaning("香蕉");
		session.setNote("");
		await session.save();
		expect(file.save).toHaveBeenCalledExactlyOnceWith({
			word: "banana",
			meaning: "香蕉",
			note: "",
			path: "word.md",
		});
	});

	it.each([
		["migration-required", "迁移卡片身份"],
		["source-needs-repair", "修复题库"],
		["source-changing", "重试保存"],
		["invalid-card-content", "释义不能为空"],
	] as const)(
		"shows an actionable %s failure without clearing the learner's draft",
		async (reason, message) => {
			const { session, file } = setupWordSession();
			await session.prefill("apple");
			session.setMeaning("新释义");
			session.setNote("新笔记");
			file.save.mockRejectedValueOnce(new FavoriteSaveError(reason));
			await session.save();
			expect(session.getSnapshot()).toMatchObject({
				status: "error",
				meaning: "新释义",
				note: "新笔记",
			});
			expect(session.getSnapshot().message).toContain(message);
		},
	);

	it("replaces both draft fields without saving and permits subsequent manual edits", async () => {
		const { session, file } = setupWordSession();
		await session.prefill("exchange");
		session.setMeaning("old meaning");
		session.setNote("old note");
		await session.generateAi();
		expect(session.getSnapshot()).toMatchObject({ ...draft, status: "success" });
		expect(file.save).not.toHaveBeenCalled();
		session.setNote("edited");
		await session.save();
		expect(file.save).toHaveBeenCalledWith({
			word: "exchange",
			meaning: draft.meaning,
			note: "edited",
			path: "word.md",
		});
	});

	it("keeps the complete old draft on failure and supports retry", async () => {
		const { session, generate } = setupWordSession();
		await session.prefill("exchange");
		session.setMeaning("old");
		session.setNote("note");
		generate.mockRejectedValueOnce(new TransportError("invalid-response"));
		await session.generateAi();
		expect(session.getSnapshot()).toMatchObject({
			meaning: "old",
			note: "note",
			status: "error",
		});
		await session.generateAi();
		expect(session.getSnapshot()).toMatchObject(draft);
	});

	it("locks semantic edits and save while generating and coalesces repeated clicks", async () => {
		const { session, file, generate } = setupWordSession();
		const pending = deferred<FavoriteGeneratedDraft>();
		await session.prefill("exchange");
		generate.mockReturnValueOnce(pending.promise);
		const request = session.generateAi();
		await session.generateAi();
		session.setMeaning("ignored");
		session.setNote("ignored");
		await session.save();
		expect(session.getSnapshot()).toMatchObject({
			status: "generating",
			meaning: "",
			note: "",
		});
		expect(generate).toHaveBeenCalledOnce();
		expect(file.save).not.toHaveBeenCalled();
		pending.resolve(draft);
		await request;
	});

	it.each(["reset", "clear", "word", "dispose", "config"])(
		"cancels on %s and ignores late replies",
		async (action) => {
			const { session, generate, setEngine } = setupWordSession();
			const pending = deferred<FavoriteGeneratedDraft>();
			await session.prefill("exchange");
			generate.mockReturnValueOnce(pending.promise);
			const request = session.generateAi();
			const signal = generate.mock.calls[0]![2];
			if (action === "reset") session.resetSession();
			if (action === "clear") session.clear();
			if (action === "word") await session.prefill("other");
			if (action === "dispose") session.dispose();
			if (action === "config") {
				setEngine(null);
				session.refreshSettings();
			}
			expect(signal.aborted).toBe(true);
			pending.resolve(draft);
			await request;
			expect(session.getSnapshot().meaning).not.toBe(draft.meaning);
		},
	);

	it("discards late file prefill and preserves generated content through settings refresh", async () => {
		const { session, file } = setupWordSession();
		const lookup = deferred<StoredDictionaryFavorite | null>();
		file.find.mockReturnValueOnce(lookup.promise);
		const prefill = session.prefill("exchange");
		await session.generateAi();
		lookup.resolve({ word: "exchange", meaning: "stale", note: "stale", path: "word.md" });
		await prefill;
		session.refreshSettings();
		await Promise.resolve();
		expect(session.getSnapshot()).toMatchObject(draft);
		expect(file.find).toHaveBeenCalledOnce();
	});

	it("does not let an earlier failed file-open unlock the generation", async () => {
		const { session, file, generate } = setupWordSession();
		const opened = deferred<boolean>();
		const pending = deferred<FavoriteGeneratedDraft>();
		await session.prefill("exchange");
		file.open.mockReturnValueOnce(opened.promise);
		const opening = session.openSavedFile();
		generate.mockReturnValueOnce(pending.promise);
		const request = session.generateAi();
		opened.resolve(false);
		await opening;
		await session.openSavedFile();
		session.setMeaning("ignored");
		await session.save();
		expect(session.getSnapshot()).toMatchObject({ status: "generating", meaning: "" });
		expect(file.open).toHaveBeenCalledOnce();
		expect(file.save).not.toHaveBeenCalled();
		pending.resolve(draft);
		await request;
	});

	it("opens the current category file or explicit target path", async () => {
		const { session, file } = setupWordSession();
		file.open.mockResolvedValue(true);

		await session.openSavedFile();
		expect(file.open).toHaveBeenCalledWith("word.md");

		await session.openSavedFile("other/target.md");
		expect(file.open).toHaveBeenCalledWith("other/target.md");
	});

	it("cannot let an old generation overwrite a reopened session's request", async () => {
		const { session, generate } = setupWordSession();
		const old = deferred<FavoriteGeneratedDraft>();
		const next = deferred<FavoriteGeneratedDraft>();
		await session.prefill("exchange");
		generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
		const first = session.generateAi();
		session.resetSession();
		await session.prefill("new");
		const second = session.generateAi();
		old.resolve(draft);
		await first;
		expect(session.getSnapshot()).toMatchObject({
			word: "new",
			status: "generating",
			meaning: "",
		});
		next.resolve({ ...draft, meaning: "adj. 新的" });
		await second;
		expect(session.getSnapshot().meaning).toBe("adj. 新的");
	});

	it.each(["success", "failure"])(
		"finishes a %s save when external settings change the path",
		async (outcome) => {
			const { session, file, settings } = setupWordSession();
			const saved = deferred<string>();
			await session.prefill("exchange");
			file.save.mockReturnValueOnce(saved.promise);
			const request = session.save();
			settings.favoriteCategories[0]!.path = "new.md";
			session.refreshSettings();
			expect(session.getSnapshot().status).toBe("saving");
			if (outcome === "success") saved.resolve("word.md");
			else saved.reject(new Error("write failed"));
			await request;
			expect(session.getSnapshot()).toMatchObject({
				status: outcome === "success" ? "success" : "error",
				path: "new.md",
			});
		},
	);

	it("lets an accepted save finish without altering a reopened session", async () => {
		const { session, file } = setupWordSession();
		const saved = deferred<string>();
		await session.prefill("exchange");
		file.save.mockReturnValueOnce(saved.promise);
		const request = session.save();
		session.resetSession();
		await session.prefill("other");
		saved.resolve("word.md");
		await request;
		expect(session.getSnapshot()).toMatchObject({
			word: "other",
			status: "idle",
			meaning: "",
		});
	});

	it("does not request missing engines, unsupported input, or during ordinary prefill", async () => {
		const { session, generate, settings, setEngine } = setupWordSession();
		await session.prefill("exchange");
		expect(generate).not.toHaveBeenCalled();
		settings.favoriteAiConfigId = null;
		await session.generateAi();
		settings.favoriteAiConfigId = "deleted";
		setEngine(null);
		await session.generateAi();
		await session.prefill("中文");
		await session.generateAi();
		expect(generate).not.toHaveBeenCalled();
		expect(session.getSnapshot().status).toBe("error");
	});
});

describe("DictionaryFavoriteSession - category administration & file mutex", () => {
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
		const { session, files, settings } = setupCategorySession();
		const created = await session.createCategory(" 四级 ", "Words/four", true);
		expect(created).toMatchObject({ name: "四级", path: "Words/four.md" });
		expect(settings.selectedFavoriteCategoryId).toBe(created.id);
		expect(await files.open("Words/four.md")).toBe(true);
	});

	it("can associate an existing file from settings without changing the selection", async () => {
		const { session, files, settings } = setupCategorySession({
			"old.md": "",
			"existing.md": "content",
		});
		const created = await session.createCategory("existing", "existing.md", false);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(await files.open(created.path)).toBe(true);
		expect(await files.find(created.path, "apple")).toBeNull();
	});

	it("rejects duplicate names, paths and invalid paths", async () => {
		const { session } = setupCategorySession();
		await expect(session.createCategory(" 默认收藏 ", "new.md", true)).rejects.toEqual(
			new FavoriteCategoryError("duplicate-name"),
		);
		await expect(session.createCategory("other", "OLD.md", true)).rejects.toEqual(
			new FavoriteCategoryError("duplicate-path"),
		);
		for (const path of ["../escape.md", "/absolute.md", "folder/", "notes.txt"])
			expect(() => favoriteCategoryPath(path)).toThrow(FavoriteCategoryError);
	});

	it("rolls back a newly created file when settings cannot be saved", async () => {
		const { session, files, fail } = setupCategorySession();
		fail();
		await expect(session.createCategory("new", "new.md", true)).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await files.open("new.md")).toBe(false);
	});

	it("moves the file and updates its category when changing the path", async () => {
		const { session, files, settings } = setupCategorySession();
		await session.editCategory("default", "已改名", "words/renamed");
		expect(settings.favoriteCategories[0]).toMatchObject({
			name: "已改名",
			path: "words/renamed.md",
		});
		expect(await files.open("words/renamed.md")).toBe(true);
		expect(await files.open("old.md")).toBe(false);
		expect(await files.find("words/renamed.md", "apple")).not.toBeNull();
	});

	it("preserves the original file when editing only the category name", async () => {
		const { session, files, settings } = setupCategorySession();
		await session.editCategory("default", "仅改名", "old.md");
		expect(settings.favoriteCategories[0]).toMatchObject({ name: "仅改名", path: "old.md" });
		expect(await files.open("old.md")).toBe(true);
	});

	it("moves the file back when saving updated settings fails", async () => {
		const { session, files, fail } = setupCategorySession();
		fail();
		await expect(session.editCategory("default", "名", "rollback.md")).rejects.toEqual(
			new FavoriteCategoryError("save-failed"),
		);
		expect(await files.open("old.md")).toBe(true);
		expect(await files.open("rollback.md")).toBe(false);
	});

	it("retains the file and selects the first remaining category when deleting", async () => {
		const { session, files, settings } = setupCategorySession({
			"old.md": "old",
			"words/other.md": "other",
		});
		const created = await session.createCategory("other", "words/other.md", false);
		await session.selectCategory(created.id);
		expect(settings.selectedFavoriteCategoryId).toBe(created.id);
		await session.deleteCategory(created.id);
		expect(settings.favoriteCategories).toHaveLength(1);
		expect(settings.selectedFavoriteCategoryId).toBe("default");
		expect(await files.open("words/other.md")).toBe(true);
	});

	it("prevents deleting the last category", async () => {
		const { session } = setupCategorySession();
		await expect(session.deleteCategory("default")).rejects.toEqual(
			new FavoriteCategoryError("last-category"),
		);
	});

	it("prevents concurrent category or favorite writes with busy error", async () => {
		const { session } = setupCategorySession();
		let release!: () => void;
		const lock = new Promise<void>((yes) => (release = yes));
		const pending = session.runExclusive(() => lock);
		await expect(session.createCategory("other", "other.md", false)).rejects.toEqual(
			new FavoriteCategoryError("busy"),
		);
		await expect(session.save()).resolves.toBeUndefined();
		expect(session.getSnapshot().status).toBe("error");
		release();
		await pending;
		await expect(session.createCategory("other", "other.md", false)).resolves.toMatchObject({
			name: "other",
		});
	});

	it("remembers selection and preserves an edited draft while switching files", async () => {
		const { session, settings, file } = setupWordSession();
		settings.favoriteCategories.push({ id: "second", name: "第二类", path: "second.md" });
		session.refreshSettings();
		await session.prefill("apple");
		session.setMeaning("草稿");
		await session.selectCategory("second");
		expect(session.getSnapshot()).toMatchObject({
			selectedCategoryId: "second",
			path: "second.md",
			meaning: "草稿",
		});
		await session.save();
		expect(file.save).toHaveBeenCalledWith(
			expect.objectContaining({ path: "second.md", meaning: "草稿" }),
		);
	});
});
