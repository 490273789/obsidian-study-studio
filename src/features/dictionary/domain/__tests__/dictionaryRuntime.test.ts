import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DictionaryRuntime } from "../dictionaryRuntime";
import { DEFAULT_DICTIONARY_SETTINGS } from "../configuration";
import { createMemoryDictionaryFavoriteStore, formatDictionaryFavorite } from "../favorite-file";
import type { DictionarySettingsStore } from "../types";

vi.mock("../compiled-source", () => ({ CompiledDictionarySource: class {} }));
vi.mock("../importer", () => ({ LocalDictionaryImporter: class {} }));
vi.mock("../local-administration", () => ({
	LocalDictionaryAdministrationModule: class {
		refreshCatalog() {}
		cancelActiveOperations() {}
	},
}));
vi.mock("../favoriteSession", () => ({
	DictionaryFavoriteSession: class {
		refreshSettings() {}
		dispose() {}
	},
}));
const lookup = vi.hoisted(() => vi.fn());
vi.mock("../cambridge", () => ({
	CambridgeDictionarySource: class {
		lookup = lookup;
	},
}));
afterEach(() => vi.restoreAllMocks());

describe("dictionary selection settings", () => {
	it("copies source configuration once and preserves isolated settings with live history", async () => {
		let dictionary = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
		dictionary.sources = [
			{ id: "first", kind: "cambridge", label: "First", enabled: true },
			{ id: "second", kind: "cambridge", label: "Second", enabled: true },
		];
		let release!: () => void;
		const saving = new Promise<void>((resolve) => {
			release = resolve;
		});
		const store: DictionarySettingsStore = {
			getDictionarySettings: () => dictionary,
			updateDictionarySettings: async (mutate) => {
				await saving;
				const draft = structuredClone(dictionary);
				mutate(draft);
				dictionary = draft;
				return true;
			},
			getLocalDictionaryAdministrationState: () => dictionary,
		};
		lookup.mockImplementation(async ({ text }: { text: string }) => ({
			word: text,
			sourceId: "first",
			sourceLabel: "First",
			attribution: "",
			pronunciations: [],
			sections: [],
			suggestions: [],
		}));
		const runtime = new DictionaryRuntime({
			settings: store,
			language: () => "zh",
			notify: vi.fn(),
			app: { vault: { configDir: ".obsidian" } },
			plugin: { manifest: { id: "test" } },
			ai: { subscribe: () => () => {} },
			net: {},
		} as never);
		const clone = vi.spyOn(globalThis, "structuredClone");
		const session = runtime.createSelectionLookupSession("word", [
			"second",
			"first",
			"second",
			"missing",
		])!;
		expect(dictionary.sources.map((source) => source.id)).toEqual(["first", "second"]);
		// A committed catalog change must not retarget this already accepted lookup.
		dictionary.sources[0]!.label = "Changed";
		dictionary.sources[0]!.enabled = false;
		dictionary.history = ["external"];
		release();
		await vi.waitFor(() => expect(session.getSnapshot().status).toBe("ready"));
		expect(session.getSnapshot().sources.map((source) => source.id)).toEqual([
			"second",
			"first",
		]);
		await session.send({ type: "settings-changed" });
		expect(session.getSnapshot().sources.map((source) => source.label)).toEqual([
			"Second",
			"First",
		]);
		expect(session.getSnapshot().history).toEqual(["word", "external"]);
		console.info(
			`dictionary selection benchmark: two sources + refresh: ${clone.mock.calls.length} structuredClone calls (includes 1 history persistence clone)`,
		);
		expect(clone.mock.calls.length).toBe(2);
		clone.mockRestore();
		session.dispose();
		runtime.dispose();
	});

	it("wires createFavoriteBatch through the unified favorite store and category mutex", async () => {
		const dictionary = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
		dictionary.favoriteCategories = [{ id: "target", name: "单词", path: "words.md" }];
		dictionary.selectedFavoriteCategoryId = "target";
		dictionary.favoriteAiConfigId = "engine";
		const settingsStore: DictionarySettingsStore = {
			getDictionarySettings: () => dictionary,
			updateDictionarySettings: async () => true,
			getLocalDictionaryAdministrationState: () => dictionary,
		};
		const favoriteStore = createMemoryDictionaryFavoriteStore({
			"Lists/words.txt": "apple\nbanana\n",
			"words.md": formatDictionaryFavorite({
				path: "words.md",
				word: "apple",
				meaning: "已有释义",
				note: "",
			}),
		});
		const generate = vi.fn(async () => ({
			text: JSON.stringify({
				definitions: [{ partOfSpeech: "n.", meanings: ["香蕉"] }],
				phonetic: "bəˈnɑːnə",
				morphology: [],
				example: {
					sentence: "I ate a banana.",
					translation: "我吃了一根香蕉。",
				},
			}),
		}));
		const runtime = new DictionaryRuntime({
			settings: settingsStore,
			favoriteStore,
			language: () => "zh",
			notify: vi.fn(),
			app: { vault: { configDir: ".obsidian" } },
			plugin: { manifest: { id: "test" } },
			ai: {
				subscribe: () => () => {},
				getSnapshot: () => ({
					settings: {
						engines: [
							{
								id: "engine",
								kind: "llm",
								name: "DeepSeek",
								provider: "deepseek",
								baseUrl: "https://api.deepseek.com",
								secretId: "key-1",
								model: "deepseek-v4-flash",
							},
						],
						defaults: { llm: "engine", asr: null },
					},
					models: {},
					loadingModels: [],
					testing: [],
				}),
				generate,
			},
			net: {},
		} as never);

		const batch = runtime.createFavoriteBatch();
		expect(batch.pathSuggestions("lists/")).toEqual(["Lists/words.txt"]);
		await batch.start("Lists/words.txt", "target");

		expect(generate).toHaveBeenCalledTimes(1);
		expect(batch.getSnapshot()).toMatchObject({
			status: "success",
			total: 2,
			processed: 2,
			saved: 1,
			skipped: 1,
			failed: 0,
		});
		expect((await favoriteStore.find("words.md", "apple"))?.meaning).toBe("已有释义");
		expect((await favoriteStore.find("words.md", "banana"))?.meaning).toBe("n. 香蕉");
		await expect(batch.openTarget()).resolves.toBe(true);
		await expect(runtime.categories.runExclusive(async () => true)).resolves.toBe(true);

		batch.dispose();
		runtime.dispose();
	});
});
