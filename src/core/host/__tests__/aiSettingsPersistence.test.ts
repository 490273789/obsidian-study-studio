import { expect, it, vi } from "vite-plus/test";
import FlashcardPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settingsSlices";
import type { AiSettings } from "../../ai";
import type { TranslationSettings } from "../../../features/translation/domain/types";
import { createDictionarySettingsStore } from "../../../features/dictionary/obsidian/settingsStore";
import type { WorkbenchHost } from "../workbench";

const captureDictionaryHost = vi.hoisted(() =>
	vi.fn<(host: WorkbenchHost<"dictionary">) => void>(),
);

vi.mock("obsidian", () => ({
	Plugin: class {
		addSettingTab() {}
		removeCommand() {}
		addRibbonIcon() {
			return { remove() {} };
		}
		addCommand() {
			return {};
		}
		registerView() {}
		registerEvent() {}
	},
	ItemView: class {},
	WorkspaceLeaf: class {},
	Modal: class {},
	AbstractInputSuggest: class {},
	Notice: vi.fn(),
	Platform: { isDesktopApp: true },
}));
vi.mock("../settingsTab", () => ({ FlashcardSettingTab: class {} }));
vi.mock("../../../features", () => ({
	createWorkbenchModules: () => [
		{ id: "dictionary", render: captureDictionaryHost, stop: () => undefined },
	],
	createAiEngineTesters: () => ({}),
}));

/**
 * The composition root's settings writer is the only path a feature may use, so
 * these tests guard that a queued patch is applied to the settings committed at
 * write time, and that it never resurrects a slice another feature changed.
 */
async function createPlugin() {
	const app = { workspace: { getLeavesOfType: () => [] }, vault: { getMarkdownFiles: () => [] } };
	const host = {
		app,
		loadData: vi.fn().mockResolvedValue(null),
		saveData: vi.fn().mockResolvedValue(undefined),
	};
	const plugin = new FlashcardPlugin(app as never, {} as never);
	Object.assign(plugin, host);
	await plugin.onload();
	const commit: (patch: Partial<typeof plugin.settings>) => Promise<void> = Reflect.get(
		plugin,
		"commitSettings",
	);
	return { plugin, commit, host };
}

it("applies concurrent feature patches to the settings committed at write time", async () => {
	const { plugin, commit } = await createPlugin();
	const ai: AiSettings = {
		engines: [
			{
				id: "engine",
				kind: "llm",
				name: "Translate",
				provider: "deepseek",
				baseUrl: "https://api.deepseek.com",
				secretId: "key-id",
				model: "deepseek-v4-flash",
			},
		],
		defaults: { llm: "engine", asr: null },
	};

	await Promise.all([
		plugin.aiService.saveEngine(ai.engines[0]!),
		commit({ dailyNewCards: 42 }),
		commit({ studyOrder: "sequential" }),
	]);

	// Every patch survives; none of them overwrote a slice it did not mention.
	expect(plugin.settings.ai).toEqual(ai);
	expect(plugin.settings.dailyNewCards).toBe(42);
	expect(plugin.settings.studyOrder).toBe("sequential");
	const stored = plugin.store.getSettings();
	expect(stored.ai).toEqual(ai);
	expect(stored.dailyNewCards).toBe(42);
	expect(stored.studyOrder).toBe("sequential");
});

it("keeps feature slices independent of each other", async () => {
	const { plugin, commit } = await createPlugin();
	const translation: TranslationSettings = {
		...plugin.settings.translation,
		enabled: true,
		direction: "en-zh",
		promptTemplate: "Translate with context",
	};
	const ai = plugin.settings.ai;

	await commit({ translation });
	await commit({ dailyReviewCards: 7 });

	expect(plugin.settings.translation).toEqual(translation);
	expect(plugin.settings.ai).toEqual(ai);
	expect(plugin.settings.dailyReviewCards).toBe(7);
	const stored = plugin.store.getSettings();
	expect(stored.translation).toEqual(translation);
	expect(stored.dailyReviewCards).toBe(7);
});

it("applies a local patch after an in-flight external settings reload", async () => {
	const { plugin, commit, host } = await createPlugin();
	let resolveLoad!: (document: unknown) => void;
	host.loadData.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveLoad = resolve;
			}),
	);
	const reload = plugin.onExternalSettingsChange();
	await vi.waitFor(() => expect(resolveLoad).toBeTypeOf("function"));
	const localPatch = commit({ dailyNewCards: 42 });
	resolveLoad({ settings: { language: "en" } });
	await Promise.all([reload, localPatch]);

	expect(plugin.settings).toMatchObject({ language: "en", dailyNewCards: 42 });
	expect(plugin.store.getSettings()).toMatchObject({ language: "en", dailyNewCards: 42 });
});

const localEngine = {
	id: "local-engine",
	kind: "llm",
	name: "Local",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	secretId: "key-id",
	model: "deepseek-v4-flash",
} as const;
const syncedEngine = { ...localEngine, id: "synced-engine", name: "Synced" };

it("applies a queued AI edit to the engine registry loaded by sync", async () => {
	const { plugin, host } = await createPlugin();
	let resolveLoad!: (document: unknown) => void;
	host.loadData.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveLoad = resolve;
			}),
	);
	const reload = plugin.onExternalSettingsChange();
	await vi.waitFor(() => expect(resolveLoad).toBeTypeOf("function"));
	const localSave = plugin.aiService.saveEngine(localEngine);
	await Promise.resolve();
	resolveLoad({
		settings: { ai: { engines: [syncedEngine], defaults: { llm: syncedEngine.id } } },
	});
	await Promise.all([reload, localSave]);

	expect(plugin.aiService.getSnapshot().settings.engines).toEqual([syncedEngine, localEngine]);
	expect(plugin.settings.ai).toEqual(plugin.aiService.getSnapshot().settings);
	expect(plugin.store.getSettings().ai).toEqual(plugin.settings.ai);
});

it("merges queued dictionary history writes with the dictionary settings loaded by sync", async () => {
	const { plugin, host } = await createPlugin();
	const dictionaryHost = captureDictionaryHost.mock.lastCall?.[0];
	if (!dictionaryHost) throw new Error("Expected the dictionary settings capability");
	const dictionarySettings = createDictionarySettingsStore(dictionaryHost.settings);
	let resolveLoad!: (document: unknown) => void;
	host.loadData.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveLoad = resolve;
			}),
	);
	const reload = plugin.onExternalSettingsChange();
	await vi.waitFor(() => expect(resolveLoad).toBeTypeOf("function"));
	const localWrites = ["apple", "pear"].map((word) =>
		dictionarySettings.updateDictionarySettings((draft) => {
			draft.history.unshift(word);
		}),
	);
	resolveLoad({
		settings: {
			dictionary: {
				enabled: true,
				history: ["synced"],
				sources: [{ id: "youdao", kind: "youdao", enabled: false, label: "Synced source" }],
			},
		},
	});
	expect(await Promise.all([reload, ...localWrites])).toEqual([undefined, true, true]);

	expect(dictionarySettings.getDictionarySettings()).toMatchObject({
		enabled: true,
		history: ["pear", "apple", "synced"],
		sources: expect.arrayContaining([
			expect.objectContaining({ id: "youdao", enabled: false, label: "Synced source" }),
		]),
	});
	expect(plugin.store.getSettings().dictionary).toEqual(
		dictionarySettings.getDictionarySettings(),
	);
});

it("authorizes settings returned by deferred feature updates", async () => {
	const { plugin, host } = await createPlugin();
	const dictionaryHost = captureDictionaryHost.mock.lastCall?.[0];
	if (!dictionaryHost) throw new Error("Expected the dictionary settings capability");
	const previous = plugin.settings;

	await expect(
		dictionaryHost.settings.update((current) => {
			expect(Object.keys(current).sort()).toEqual(["dictionary", "language"]);
			current.dictionary.history.push("mutated");
			return { dictionary: current.dictionary, language: "en" };
		}),
	).rejects.toMatchObject({ moduleId: "dictionary", unauthorizedKeys: ["language"] });

	expect(plugin.settings).toBe(previous);
	expect(plugin.settings.dictionary.history).toEqual([]);
	expect(host.saveData).not.toHaveBeenCalled();
});

it("publishes the newer sync registry when a local write was already in flight", async () => {
	const { plugin, host } = await createPlugin();
	let resolveSave!: () => void;
	host.saveData.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				resolveSave = resolve;
			}),
	);
	const localSave = plugin.aiService.saveEngine(localEngine);
	await vi.waitFor(() => expect(resolveSave).toBeTypeOf("function"));
	host.loadData.mockResolvedValueOnce({ settings: { ai: { engines: [syncedEngine] } } });
	const reload = plugin.onExternalSettingsChange();
	resolveSave();
	await Promise.all([reload, localSave]);

	expect(plugin.aiService.getSnapshot().settings.engines).toEqual([syncedEngine]);
	expect(plugin.settings.ai).toEqual(plugin.aiService.getSnapshot().settings);
	expect(plugin.store.getSettings().ai).toEqual(plugin.settings.ai);
});

it("publishes settings that still contain every slice the host owns", async () => {
	const { plugin, commit } = await createPlugin();

	await commit({ language: "en" });

	expect(plugin.settings.language).toBe("en");
	expect(plugin.settings.flashcardTags).toEqual(DEFAULT_SETTINGS.flashcardTags);
	expect(plugin.settings.pronunciation).toEqual(DEFAULT_SETTINGS.pronunciation);
	expect(plugin.settings.dictionary).toEqual(DEFAULT_SETTINGS.dictionary);
});

it("does not persist or publish a no-op patch", async () => {
	const { plugin, commit, host } = await createPlugin();
	const settingsChanged = vi.fn();
	plugin.workbench = { settingsChanged } as never;

	await commit({ language: plugin.settings.language });

	expect(host.saveData).not.toHaveBeenCalled();
	expect(settingsChanged).not.toHaveBeenCalled();
});

it("routes a committed transition through the workbench with both snapshots", async () => {
	const { plugin, commit } = await createPlugin();
	const previous = plugin.settings;
	const settingsChanged = vi.fn();
	plugin.workbench = { settingsChanged } as never;

	await commit({ dictionary: { ...previous.dictionary, enabled: true } });

	expect(settingsChanged).toHaveBeenCalledOnce();
	expect(settingsChanged).toHaveBeenCalledWith(previous, plugin.settings);
});

it("keeps a durable commit when workbench notification fails", async () => {
	const { plugin, commit, host } = await createPlugin();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	plugin.workbench = {
		settingsChanged: () => {
			throw new Error("render failed");
		},
	} as never;

	await commit({ dailyNewCards: 19 });

	expect(plugin.settings.dailyNewCards).toBe(19);
	expect(plugin.store.getSettings().dailyNewCards).toBe(19);
	expect(host.saveData).toHaveBeenCalledOnce();
	expect(consoleError).toHaveBeenCalledWith(
		"Failed to route committed settings through the workbench:",
		expect.any(Error),
	);
	consoleError.mockRestore();
});
