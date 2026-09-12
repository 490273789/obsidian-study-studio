import { expect, it, vi } from "vitest";
import FlashcardPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settingsSlices";
import { WorkbenchStore } from "../../storage/workbenchStore";
import type { AiSettings } from "../../ai";
import type { TranslationSettings } from "../../../features/translation/domain/types";

vi.mock("obsidian", () => ({
	Plugin: class {
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
	Notice: vi.fn(),
	Platform: { isDesktopApp: true },
}));
vi.mock("../settingsTab", () => ({ FlashcardSettingTab: class {} }));
vi.mock("../aiAdapter", () => ({ createObsidianAiService: vi.fn() }));
vi.mock("../../../features/flashcards/domain/pronunciation", () => ({
	createPronunciationRuntime: vi.fn(),
}));
vi.mock("../../../features/flashcards/domain/decks/deckPdfExporter", () => ({
	exportDeckToPdf: vi.fn(),
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
	plugin.app = app as never;
	plugin.store = new WorkbenchStore(host as never);
	plugin.settings = await plugin.store.loadSettings();
	const commit: (patch: Partial<typeof plugin.settings>) => Promise<void> = Reflect.get(
		plugin,
		"commitSettings",
	);
	return { plugin, commit, host };
}

it("applies concurrent feature patches to the settings committed at write time", async () => {
	const { plugin, commit } = await createPlugin();
	const persistAi: (ai: AiSettings) => Promise<void> = Reflect.get(plugin, "persistAiSettings");
	const ai: AiSettings = {
		configs: [
			{
				id: "engine",
				name: "Translate",
				provider: "deepseek",
				baseUrl: "https://api.deepseek.com",
				secretId: "key-id",
				model: "deepseek-v4-flash",
			},
		],
		defaultConfigId: "engine",
	};

	await Promise.all([
		persistAi(ai),
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
