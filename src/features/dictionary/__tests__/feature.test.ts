import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../domain/dictionaryRuntime", () => ({
	DictionaryRuntime: class {
		readonly query = {
			getSnapshot: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			send: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn(),
		};
		readonly favoriteController = { prefill: vi.fn(), resetSession: vi.fn() };
		readonly dispose = vi.fn();
		readonly applySettings = vi.fn();
		constructor(readonly options?: { net: unknown }) {
			runtimeSpies.instances.push(this);
		}
	},
}));

vi.mock("../obsidian/modals", () => ({
	DictionaryLookupModal: class {
		open() {}
		close() {}
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
		viewSpies.definitions.clear();
		noticeSpy.mockClear();
	});

	afterEach(() => vi.restoreAllMocks());

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
		await view.props.onOpenFavorite("again");
		expect(favoriteModalSpies.instances).toHaveLength(2);
		feature.stop();
		expect(favoriteModalSpies.instances[1]!.close).toHaveBeenCalledOnce();
	});

	it("opens favorites in the right sidebar when configured and resets only after its last leaf closes", async () => {
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

		await view.props.onOpenFavorite("sidebar word");
		await view.props.onOpenFavorite("another word");
		expect(fake.activateView.mock.calls).toEqual([
			[VIEW_TYPE_DICTIONARY_FAVORITE, { rightSidebar: true }],
			[VIEW_TYPE_DICTIONARY_FAVORITE, { rightSidebar: true }],
		]);
		expect(controller.prefill.mock.calls).toEqual([["sidebar word"], ["another word"]]);
		expect(favoriteModalSpies.instances).toHaveLength(0);

		const sidebar = viewSpies.definitions.get(VIEW_TYPE_DICTIONARY_FAVORITE)!;
		sidebar.onClose?.();
		await Promise.resolve();
		expect(controller.resetSession).not.toHaveBeenCalled();
		leaves.length = 0;
		sidebar.onClose?.();
		await Promise.resolve();
		expect(controller.resetSession).toHaveBeenCalledOnce();
		feature.stop();
	});

	it("reads the current opening preference and keeps a sidebar draft when the modal closes", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const leaves: unknown[] = [];
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings, {
			workspace: { getLeavesOfType: () => leaves },
		});
		fake.activateView.mockImplementation(async () => {
			leaves.push({});
		});
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

		await view.props.onOpenFavorite("word");
		await fake.host.settings.update({
			dictionary: {
				...fake.host.settings.read().dictionary,
				favoriteOpenMode: "sidebar",
			},
		});
		await view.props.onOpenFavorite("word");
		expect(favoriteModalSpies.instances[0]!.close).toHaveBeenCalledOnce();
		expect(controller.resetSession).not.toHaveBeenCalled();
		await fake.host.settings.update({
			dictionary: {
				...fake.host.settings.read().dictionary,
				favoriteOpenMode: "modal",
			},
		});
		await view.props.onOpenFavorite("word");
		expect(favoriteModalSpies.instances).toHaveLength(2);
		favoriteModalSpies.instances[1]!.close();
		expect(controller.resetSession).not.toHaveBeenCalled();
		expect(controller.prefill.mock.calls).toEqual([["word"], ["word"], ["word"]]);
		feature.stop();
	});

	it("reports sidebar activation failure and leaves the existing modal available", async () => {
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
		await view.props.onOpenFavorite("word");
		await fake.host.settings.update({
			dictionary: {
				...fake.host.settings.read().dictionary,
				favoriteOpenMode: "sidebar",
			},
		});
		fake.activateView.mockRejectedValueOnce(new Error("unavailable"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		await view.props.onOpenFavorite("another word");
		expect(noticeSpy).toHaveBeenCalledWith(dictionaryStrings("zh").favoriteOpenFailed);
		expect(favoriteModalSpies.instances[0]!.close).not.toHaveBeenCalled();
		feature.stop();
	});

	it("keeps the latest favorite when sidebar activations complete out of order", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", {
			...enabledSettings,
			dictionary: { ...enabledSettings.dictionary, favoriteOpenMode: "sidebar" },
		});
		const completions: (() => void)[] = [];
		fake.activateView.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					completions.push(resolve);
				}),
		);
		feature.render(fake.host);
		const view = viewSpies.definitions.get("flashcard-dictionary-view")!.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		const first = view.props.onOpenFavorite("first");
		const latest = view.props.onOpenFavorite("latest");
		completions[1]!();
		await latest;
		completions[0]!();
		await first;
		const controller = (
			runtimeSpies.instances[0] as {
				favoriteController: { prefill: ReturnType<typeof vi.fn> };
			}
		).favoriteController;
		expect(controller.prefill.mock.calls).toEqual([["latest"]]);
		feature.stop();
	});

	it("keeps a newly opened modal when an older sidebar activation finishes", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", {
			...enabledSettings,
			dictionary: { ...enabledSettings.dictionary, favoriteOpenMode: "sidebar" },
		});
		let finishActivation!: () => void;
		fake.activateView.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishActivation = resolve;
				}),
		);
		feature.render(fake.host);
		const view = viewSpies.definitions.get("flashcard-dictionary-view")!.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		const pending = view.props.onOpenFavorite("sidebar word");
		await fake.host.settings.update({
			dictionary: {
				...fake.host.settings.read().dictionary,
				favoriteOpenMode: "modal",
			},
		});
		await view.props.onOpenFavorite("modal word");
		finishActivation();
		await pending;
		const controller = (
			runtimeSpies.instances[0] as {
				favoriteController: { prefill: ReturnType<typeof vi.fn> };
			}
		).favoriteController;
		expect(controller.prefill.mock.calls).toEqual([["modal word"]]);
		expect(favoriteModalSpies.instances[0]!.close).not.toHaveBeenCalled();
		feature.stop();
	});

	it("does not prefill a disposed controller after pending sidebar activation completes", async () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", {
			...enabledSettings,
			dictionary: { ...enabledSettings.dictionary, favoriteOpenMode: "sidebar" },
		});
		let finishActivation!: () => void;
		fake.activateView.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishActivation = resolve;
				}),
		);
		feature.render(fake.host);
		const view = viewSpies.definitions.get("flashcard-dictionary-view")!.render({
			language: "zh",
			theme: "dark",
		} as never) as React.ReactElement<DictionaryViewProps>;
		const pending = view.props.onOpenFavorite("word");
		feature.stop();
		finishActivation();
		await pending;
		const controller = (
			runtimeSpies.instances[0] as {
				favoriteController: { prefill: ReturnType<typeof vi.fn> };
			}
		).favoriteController;
		expect(controller.prefill).not.toHaveBeenCalled();
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
		expect(entry.icon).toBe("book-open");
		expect(entry.title("zh")).toBe(dictionaryStrings("zh").displayName);
		expect(entry.openCommandId).toBe("open-dictionary");
		expect(entry.openHotkeys).toEqual([{ modifiers: ["Alt"], key: "2" }]);
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
