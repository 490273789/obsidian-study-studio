import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BookOpen } from "lucide-react";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { dictionaryStrings } from "../strings/dictionary";
import { createDictionaryFeature, VIEW_TYPE_DICTIONARY_FAVORITE } from "../feature";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import type { ReactViewOptions } from "../../../core/host/reactItemView";
import type { DictionaryViewProps } from "../ui/DictionaryView";
import type React from "react";

const noticeSpy = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: class {
		constructor(message: string) {
			noticeSpy(message);
		}
	},
	Platform: { isDesktopApp: false },
	requestUrl: vi.fn(),
}));

const runtimeSpies = vi.hoisted(() => ({ instances: [] as unknown[] }));
const editorSpies = vi.hoisted(() => ({ instances: [] as unknown[] }));
const favoriteModalSpies = vi.hoisted(() => ({
	instances: [] as {
		open: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn<() => void>>;
		updateSettings: ReturnType<typeof vi.fn>;
	}[],
}));
const batchModalSpies = vi.hoisted(() => ({
	instances: [] as { open: ReturnType<typeof vi.fn>; forceClose: ReturnType<typeof vi.fn> }[],
}));
const viewSpies = vi.hoisted(() => ({
	definitions: new Map<string, ReactViewOptions<{ language: "zh" | "en" }>>(),
}));

vi.mock("../../../core/host/reactItemView", () => ({
	createReactItemView: (options: ReactViewOptions<{ language: "zh" | "en" }>) => {
		viewSpies.definitions.set(options.type, options);
		return vi.fn();
	},
}));

vi.mock("../obsidian/favoriteModal", () => ({
	DictionaryFavoriteModal: class {
		readonly open = vi.fn();
		readonly close = vi.fn(() => this.onClosed());
		readonly updateSettings = vi.fn();
		constructor(
			_app: unknown,
			_controller: unknown,
			_language: unknown,
			private onClosed: () => void,
		) {
			favoriteModalSpies.instances.push(this);
		}
	},
}));

vi.mock("../obsidian/favoriteBatchModal", () => ({
	DictionaryFavoriteBatchModal: class {
		readonly open = vi.fn();
		readonly forceClose = vi.fn();
		constructor() {
			batchModalSpies.instances.push(this);
		}
	},
}));

vi.mock("../obsidian/favoriteCategoryModal", () => ({
	FavoriteCategoryModal: class {
		open() {}
	},
}));

vi.mock("../domain/dictionaryRuntime", () => ({
	DictionaryRuntime: class {
		readonly query = {
			getSnapshot: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			send: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn(),
		};
		readonly favoriteController = {
			prefill: vi.fn(),
			resetSession: vi.fn(),
			getSnapshot: () => ({ status: "idle" }),
			subscribe: vi.fn(() => vi.fn()),
		};
		readonly dispose = vi.fn();
		readonly applySettings = vi.fn();
		constructor(readonly options?: { net: unknown }) {
			runtimeSpies.instances.push(this);
		}
	},
}));

vi.mock("../obsidian/settingsEditor", () => ({
	DictionarySettingsEditor: class {
		readonly activate = vi.fn();
		readonly hide = vi.fn();
		readonly presentation = vi.fn(() => ({ generation: 1, groups: [] }));
		constructor() {
			editorSpies.instances.push(this);
		}
	},
}));

const enabledSettings = {
	...DEFAULT_SETTINGS,
	dictionary: { ...DEFAULT_SETTINGS.dictionary, enabled: true },
};

describe("dictionary feature", () => {
	beforeEach(() => {
		runtimeSpies.instances.length = 0;
		editorSpies.instances.length = 0;
		favoriteModalSpies.instances.length = 0;
		batchModalSpies.instances.length = 0;
		viewSpies.definitions.clear();
		noticeSpy.mockClear();
	});

	afterEach(() => vi.restoreAllMocks());

	it("opens the main page without changing the query and focuses an existing search input", async () => {
		const root = {} as HTMLElement;
		const rootSplit = {};
		const focus = vi.fn();
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings, {
			workspace: {
				rootSplit,
				getLeavesOfType: () => [
					{
						getRoot: () => rootSplit,
						view: {
							containerEl: { contains: (element: HTMLElement) => element === root },
						},
					},
				],
			},
		});
		feature.render(fake.host);
		const definition = viewSpies.definitions.get("flashcard-dictionary-view")!;
		const acquired = definition.acquire!({ rootEl: root } as never);
		const attachInput = acquired.resource as unknown as (
			input: HTMLInputElement | null,
		) => void;
		const view = definition.render({
			language: "zh",
			theme: "dark",
			resource: attachInput,
		} as never) as React.ReactElement<DictionaryViewProps>;
		expect(view.props.searchInputRef).toBe(attachInput);
		attachInput({ focus } as unknown as HTMLInputElement);
		const runtime = runtimeSpies.instances[0] as { query: { send: ReturnType<typeof vi.fn> } };

		await Promise.resolve(fake.catalog.get("dictionary")!.open());
		expect(fake.activateView).toHaveBeenCalledWith("flashcard-dictionary-view", {
			mainTab: true,
		});
		expect(runtime.query.send).not.toHaveBeenCalled();
		expect(focus).toHaveBeenCalledOnce();

		// React may commit a newly opened view after activation has completed.
		attachInput(null);
		await Promise.resolve(fake.catalog.get("dictionary")!.open());
		expect(focus).toHaveBeenCalledOnce();
		attachInput({ focus } as unknown as HTMLInputElement);
		expect(focus).toHaveBeenCalledTimes(2);
		acquired.dispose();
		await Promise.resolve(fake.catalog.get("dictionary")!.open());
		expect(focus).toHaveBeenCalledTimes(2);
		feature.stop();
	});

	it("wires one batch modal to the dictionary search action and closes it on stop", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);
		feature.render(fake.host);
		const view = viewSpies.definitions.get("flashcard-dictionary-view")!.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		view.props.onOpenBatchFavorite();
		view.props.onOpenBatchFavorite();
		expect(batchModalSpies.instances).toHaveLength(1);
		expect(batchModalSpies.instances[0]!.open).toHaveBeenCalledOnce();
		feature.stop();
		expect(batchModalSpies.instances[0]!.forceClose).toHaveBeenCalledOnce();
	});

	it("opens favorites in one modal without activating a sidebar and closes it on stop", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);
		feature.render(fake.host);
		const definition = viewSpies.definitions.get("flashcard-dictionary-view")!;
		const view = definition.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		const runtime = runtimeSpies.instances[0] as {
			favoriteController: {
				prefill: ReturnType<typeof vi.fn>;
				resetSession: ReturnType<typeof vi.fn>;
			};
		};

		await view.props.onOpenFavorite("overlap");
		await view.props.onOpenFavorite("word");
		expect(runtime.favoriteController.prefill.mock.calls).toEqual([["overlap"], ["word"]]);
		expect(fake.activateView).not.toHaveBeenCalled();
		expect(favoriteModalSpies.instances).toHaveLength(1);
		expect(favoriteModalSpies.instances[0]!.open).toHaveBeenCalledOnce();
		feature.render(fake.host);
		expect(favoriteModalSpies.instances[0]!.updateSettings).toHaveBeenCalledOnce();

		favoriteModalSpies.instances[0]!.close();
		expect(runtime.favoriteController.resetSession).toHaveBeenCalledOnce();
		await feature.selectionAdapter.openFavorite?.("again");
		expect(favoriteModalSpies.instances).toHaveLength(2);
		feature.stop();
		expect(favoriteModalSpies.instances[1]!.close).toHaveBeenCalledOnce();
	});

	it("connects favorite sidebar activation and close notifications", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const leaves: unknown[] = [{}];
		const fake = createFakeWorkbenchHost(
			"dictionary",
			{
				...enabledSettings,
				dictionary: { ...enabledSettings.dictionary, favoriteOpenMode: "sidebar" },
			},
			{ workspace: { getLeavesOfType: () => leaves } },
		);
		feature.render(fake.host);
		const view = viewSpies.definitions.get("flashcard-dictionary-view")!.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		const controller = (
			runtimeSpies.instances[0] as {
				favoriteController: {
					prefill: ReturnType<typeof vi.fn>;
					resetSession: ReturnType<typeof vi.fn>;
				};
			}
		).favoriteController;

		const sidebar = viewSpies.definitions.get(VIEW_TYPE_DICTIONARY_FAVORITE)!;
		const first = sidebar.acquire!({} as never);
		const second = sidebar.acquire!({} as never);
		await view.props.onOpenFavorite("sidebar word");
		await view.props.onOpenFavorite("another word");
		expect(fake.activateView.mock.calls).toEqual([
			[VIEW_TYPE_DICTIONARY_FAVORITE, { rightSidebar: true }],
			[VIEW_TYPE_DICTIONARY_FAVORITE, { rightSidebar: true }],
		]);
		expect(controller.prefill.mock.calls).toEqual([["sidebar word"], ["another word"]]);
		expect(favoriteModalSpies.instances).toHaveLength(0);

		first.dispose();
		expect(controller.resetSession).not.toHaveBeenCalled();
		second.dispose();
		// The workspace may still list a leaf while its old view is closing.
		expect(leaves).toHaveLength(1);
		expect(controller.resetSession).toHaveBeenCalledOnce();
		feature.stop();
	});

	it("keeps its selection adapter inert before the feature lifetime starts", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});

		expect(feature.selectionAdapter.sources()).toEqual([]);
		expect(feature.selectionAdapter.startLookup("term", [])).toBeNull();
		await expect(feature.selectionAdapter.openInMainTab("term")).resolves.toBeUndefined();
	});

	it("registers its two views, its chrome, and its settings section", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([
			"flashcard-dictionary-view",
			"flashcard-dictionary-favorite-view",
		]);
		const entry = fake.catalog.get("dictionary")!;
		expect(entry.icon).toBe(BookOpen);
		expect(entry.title("zh")).toBe(dictionaryStrings("zh").displayName);
		expect(entry.openCommandId).toBe("open-dictionary");
		expect(entry.shortcutKey).toBe("dictionary");
		expect(entry.settingsSectionId).toBe("dictionary");
		expect(entry.available()).toBe(true);
		expect(fake.commands.map((command) => command.id)).toEqual(["dictionary-lookup-selection"]);
		expect(fake.ribbons).toEqual([]);
		expect([...fake.sections.keys()]).toEqual(["dictionary"]);
		// The section keeps the historical position after the AI 翻译 section.
		expect(fake.sections.get("dictionary")!.order).toBe(3);
		expect(fake.sections.get("dictionary")!.label("zh")).toBe(
			dictionaryStrings("zh").settingsHeading,
		);

		feature.stop();
	});

	it("keeps its views and settings section but adds no chrome while disabled", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", {
			...DEFAULT_SETTINGS,
			dictionary: { ...DEFAULT_SETTINGS.dictionary, enabled: false },
		});

		feature.render(fake.host);

		expect(fake.ribbons).toEqual([]);
		expect(fake.commands).toEqual([]);
		expect(fake.catalog.get("dictionary")!.available()).toBe(false);
		expect([...fake.views.keys()]).toHaveLength(2);
		expect([...fake.sections.keys()]).toEqual(["dictionary"]);

		feature.stop();
	});

	it("builds one runtime, applies settings on every render, and releases nested state on stop", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);

		feature.render(fake.host);
		feature.render(fake.host);

		expect(runtimeSpies.instances).toHaveLength(1);
		const runtime = runtimeSpies.instances[0] as {
			applySettings: { mock: { calls: unknown[] } };
			dispose: { mock: { calls: unknown[] } };
		};
		// Committed settings must reach the runtime on every render, the way the
		// composition root used to call applySettings() after publishing settings.
		expect(runtime.applySettings.mock.calls).toHaveLength(2);

		feature.stop();
		expect(runtime.dispose.mock.calls).toHaveLength(1);
		const editor = editorSpies.instances[0] as { hide: { mock: { calls: unknown[] } } };
		expect(editor.hide.mock.calls).toHaveLength(1);
	});

	it("passes the outbound port directly to the runtime", () => {
		const netRequest = vi.fn(async () => ({
			status: 200,
			text: JSON.stringify({ simple: { word: "test" } }),
			headers: { "content-type": "application/json" },
		}));
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: { request: netRequest } as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);
		feature.render(fake.host);

		const runtime = runtimeSpies.instances[0] as { options?: { net: unknown } };
		expect(runtime.options?.net).toEqual(expect.objectContaining({ request: netRequest }));

		feature.stop();
	});
});
