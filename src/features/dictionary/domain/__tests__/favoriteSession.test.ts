import { describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteSession } from "../favoriteSession";
import { normalizeDictionarySettings } from "../configuration";
import { FavoriteSaveError, type StoredDictionaryFavorite } from "../favorite-file";
import { FavoriteCategoryManager } from "../favorite-categories";
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
		pathSuggestions: vi.fn((_query: string) => [] as string[]),
		ensureFile: vi.fn(async (_path: string) => async () => undefined),
		moveFile: vi.fn(async (_from: string, _to: string) => async () => undefined),
		find: vi.fn(
			async (_path: string, _word: string): Promise<StoredDictionaryFavorite | null> => null,
		),
		save: vi.fn(async (_entry: unknown) => "word.md"),
		open: vi.fn(async (_path: string) => true),
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
	const categories = new FavoriteCategoryManager(store, file);
	const session = new DictionaryFavoriteSession(categories, file, {
		generator: { generate },
		language: () => "zh",
		configId: () => settings.favoriteAiConfigId,
		engineKey: () => engine,
	});
	return {
		session,
		categories,
		file,
		generate,
		settings,
		setEngine: (key: string | null) => {
			engine = key;
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

describe("DictionaryFavoriteSession - integration with FavoriteCategoryManager", () => {
	it("delegates selectCategory to the category manager", async () => {
		const { session, categories, settings } = setupWordSession();
		await categories.create("新分类", "words/new.md", false);
		const targetId = settings.favoriteCategories[1]!.id;

		await session.selectCategory(targetId);
		expect(settings.selectedFavoriteCategoryId).toBe(targetId);
		expect(session.getSnapshot().selectedCategoryId).toBe(targetId);
		expect(session.getSnapshot().path).toBe("words/new.md");
	});

	it("automatically reloads existing word entry when category changes", async () => {
		const { session, categories, file } = setupWordSession();
		file.find.mockImplementation(async (path: string, word: string) => {
			if (path === "words/second.md" && word === "apple") {
				return { word: "apple", meaning: "在第二分类中的苹果", note: "笔记2", path };
			}
			return null;
		});

		await session.prefill("apple");
		expect(session.getSnapshot().meaning).toBe("");

		const created = await categories.create("第二分类", "words/second.md", true);
		await Promise.resolve();

		expect(session.getSnapshot().selectedCategoryId).toBe(created.id);
		expect(session.getSnapshot().path).toBe("words/second.md");
		expect(session.getSnapshot().meaning).toBe("在第二分类中的苹果");
	});

	it("delegates runExclusive and pathSuggestions to the category manager", async () => {
		const { session, categories, file } = setupWordSession();
		file.pathSuggestions.mockReturnValue(["words/suggested.md"]);

		expect(session.pathSuggestions("words")).toEqual(["words/suggested.md"]);

		const runSpy = vi.spyOn(categories, "runExclusive");
		const result = await session.runExclusive(async () => "executed");
		expect(runSpy).toHaveBeenCalled();
		expect(result).toBe("executed");
	});
});
