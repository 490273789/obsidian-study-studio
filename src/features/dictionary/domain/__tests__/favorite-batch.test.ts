import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError } from "../../../../core/net/types";
import { DEFAULT_DICTIONARY_SETTINGS } from "../configuration";
import {
	FavoriteBatchController,
	FavoriteBatchError,
	parseFavoriteBatchLines,
	type FavoriteBatchStore,
} from "../favorite-batch";
import { FavoriteCategoryManager } from "../favorite-categories";
import { FavoriteSaveError, favoriteWordKey } from "../favorite-file";
import type { DictionarySettingsStore } from "../types";

function setup(content: string, initialWords: string[] = []) {
	const dictionary = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
	dictionary.favoriteCategories = [{ id: "target", name: "单词", path: "words.md" }];
	dictionary.selectedFavoriteCategoryId = "target";
	dictionary.favoriteAiConfigId = "engine";
	const settings: DictionarySettingsStore = {
		getDictionarySettings: () => dictionary,
		updateDictionarySettings: async () => true,
		getLocalDictionaryAdministrationState: () => dictionary,
		setLocalDictionaryAdministrationState: () => undefined,
		save: async () => undefined,
	};
	const categories = new FavoriteCategoryManager(
		settings,
		{
			ensureFile: async () => async () => undefined,
			moveFile: async () => async () => undefined,
			pathSuggestions: () => [],
		},
		() => undefined,
	);
	const words = new Set(initialWords.map(favoriteWordKey));
	const read = vi.fn(async () => content);
	const generate = vi.fn(async (word: string) => ({ meaning: `释义 ${word}`, note: "笔记" }));
	const saveNew = vi.fn<FavoriteBatchStore["saveNew"]>(async (entry) => {
		const key = favoriteWordKey(entry.word);
		if (words.has(key)) return "skipped";
		words.add(key);
		return "saved";
	});
	const inspect = vi.fn(async () => [...words]);
	const store: FavoriteBatchStore = { inspect, saveNew, open: vi.fn(async () => true) };
	const controller = new FavoriteBatchController({
		categories,
		settings,
		source: { read, pathSuggestions: () => [] },
		store,
		generator: { generate },
		hasAiConfig: (id) => id === "engine",
		language: () => "zh",
	});
	return { controller, categories, dictionary, generate, inspect, read, saveNew, words };
}

describe("favorite batch", () => {
	it("keeps physical line numbers, trims the BOM and blanks, and detects invalid or duplicate words", () => {
		expect(parseFavoriteBatchLines("\uFEFF Apple \r\n\r\napple\ntry out\n123\n")).toMatchObject(
			[
				{ line: 1, word: "Apple", kind: "word" },
				{ line: 3, word: "apple", kind: "duplicate" },
				{ line: 4, word: "try out", kind: "word" },
				{ line: 5, word: "123", kind: "invalid" },
			],
		);
		expect(parseFavoriteBatchLines(`${"a".repeat(129)}\n`)[0]?.kind).toBe("invalid");
	});

	it("skips source duplicates and existing favorites before sending AI requests", async () => {
		const { controller, generate, saveNew } = setup("APPLE\napple\nbanana\n123\n", ["apple"]);
		await controller.start("list.txt", "target");
		expect(generate).toHaveBeenCalledExactlyOnceWith(
			"banana",
			"engine",
			expect.any(AbortSignal),
		);
		expect(saveNew).toHaveBeenCalledExactlyOnceWith({
			path: "words.md",
			word: "banana",
			meaning: "释义 banana",
			note: "笔记",
		});
		expect(controller.getSnapshot()).toMatchObject({
			status: "partial",
			total: 4,
			processed: 4,
			saved: 1,
			skipped: 2,
			failed: 1,
			failures: [{ line: 4, word: "123" }],
		});
	});

	it("continues after a word's AI failure and reruns only words still absent", async () => {
		const { controller, generate, saveNew } = setup("apple\nbanana\n");
		generate.mockRejectedValueOnce(new TransportError("invalid-response"));
		await controller.start("list.md", "target");
		expect(controller.getSnapshot()).toMatchObject({
			status: "partial",
			saved: 1,
			failed: 1,
			failures: [{ line: 1, word: "apple" }],
		});
		await controller.start("list.md", "target");
		expect(controller.getSnapshot()).toMatchObject({
			status: "success",
			saved: 1,
			skipped: 1,
			failed: 0,
		});
		expect(generate).toHaveBeenCalledTimes(3);
		expect(saveNew).toHaveBeenCalledTimes(2);
	});

	it("preflights a missing or uneditable destination before any AI request", async () => {
		const { controller, generate, inspect } = setup("apple\n");
		inspect.mockRejectedValueOnce(new FavoriteBatchError("target-missing"));
		await controller.start("list.txt", "target");
		expect(controller.getSnapshot()).toMatchObject({ status: "failed", processed: 0 });
		expect(generate).not.toHaveBeenCalled();
		inspect.mockRejectedValueOnce(new FavoriteSaveError("migration-required"));
		await controller.start("list.txt", "target");
		expect(controller.getSnapshot().message).toContain("迁移");
		expect(generate).not.toHaveBeenCalled();
	});

	it.each(["", "removed-config"])(
		"rejects unavailable favorite AI configuration %j before reading or generating",
		async (configId) => {
			const { controller, dictionary, read, inspect, generate } = setup("apple\n");
			dictionary.favoriteAiConfigId = configId;
			await controller.start("list.txt", "target");
			expect(controller.getSnapshot()).toMatchObject({ status: "failed", processed: 0 });
			expect(controller.getSnapshot().message).toContain("AI");
			expect(read).not.toHaveBeenCalled();
			expect(inspect).not.toHaveBeenCalled();
			expect(generate).not.toHaveBeenCalled();
		},
	);

	it("rejects a source that is the target, and releases the category after an empty input", async () => {
		const { controller, categories, read, generate } = setup("\n\n");
		await controller.start("words.md", "target");
		expect(read).not.toHaveBeenCalled();
		await controller.start("list.txt", "target");
		expect(controller.getSnapshot()).toMatchObject({ status: "failed", total: 0 });
		await expect(categories.saveFavorite(async () => true)).resolves.toBe(true);
		expect(generate).not.toHaveBeenCalled();
	});

	it("stops after a target failure but keeps the first saved word", async () => {
		const { controller, generate, saveNew } = setup("apple\nbanana\ncarrot\n");
		saveNew.mockRejectedValueOnce(new FavoriteSaveError("invalid-card-content"));
		saveNew.mockResolvedValueOnce("saved");
		saveNew.mockRejectedValueOnce(new FavoriteSaveError("source-changing"));
		await controller.start("list.txt", "target");
		expect(controller.getSnapshot()).toMatchObject({
			status: "partial",
			processed: 3,
			saved: 1,
			failed: 2,
		});
		expect(generate).toHaveBeenCalledTimes(3);
	});

	it("aborts the active AI request and leaves accepted writes to settle", async () => {
		const { controller, categories, generate, saveNew } = setup("apple\nbanana\n");
		let resolveGeneration!: (value: { meaning: string; note: string }) => void;
		generate.mockImplementationOnce(
			() => new Promise((resolve) => (resolveGeneration = resolve)),
		);
		const run = controller.start("list.txt", "target");
		await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
		await expect(categories.saveFavorite(async () => true)).rejects.toMatchObject({
			reason: "busy",
		});
		controller.stop();
		resolveGeneration({ meaning: "迟到释义", note: "" });
		await run;
		expect(controller.getSnapshot()).toMatchObject({ status: "stopped", saved: 0 });
		expect(saveNew).not.toHaveBeenCalled();
		await expect(categories.saveFavorite(async () => true)).resolves.toBe(true);
	});

	it("waits for an accepted save before finishing a stop request", async () => {
		const { controller, generate, saveNew } = setup("apple\nbanana\n");
		let finishSave!: (outcome: "saved" | "skipped") => void;
		saveNew.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)));
		const run = controller.start("list.txt", "target");
		await vi.waitFor(() => expect(saveNew).toHaveBeenCalledTimes(1));
		controller.stop();
		expect(controller.getSnapshot().status).toBe("running");
		finishSave("saved");
		await run;
		expect(controller.getSnapshot()).toMatchObject({
			status: "stopped",
			processed: 1,
			saved: 1,
		});
		expect(generate).toHaveBeenCalledTimes(1);
	});
});
