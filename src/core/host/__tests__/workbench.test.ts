import { describe, expect, it, vi } from "vite-plus/test";
import { BookOpen, Languages, Layers } from "lucide-react";
import { DEFAULT_SETTINGS, type FeatureSettingsOwner } from "../settingsSlices";
import type { FlashcardSettings } from "../../shared/types";
import {
	createWorkbench,
	SettingsScopeViolation,
	WorkbenchDisposedError,
	type AnyWorkbenchModule,
	type WorkbenchModule,
	type WorkbenchHost,
} from "../workbench";

interface FakeRibbon {
	icon: string;
	title: string;
	onClick: () => void;
	remove: ReturnType<typeof vi.fn>;
}

interface FakeCommand {
	id: string;
	name: string;
	hotkeys?: unknown;
	editorCheckCallback?: (checking: boolean, editor: { getSelection(): string }) => boolean;
	callback?: () => void;
}

function createFakePlugin() {
	const ribbonEls: FakeRibbon[] = [];
	const commands = new Map<string, FakeCommand>();
	return {
		ribbonEls,
		commands,
		plugin: {
			registerView: vi.fn(),
			addRibbonIcon: vi.fn((icon: string, title: string, onClick: () => void) => {
				const el: FakeRibbon = { icon, title, onClick, remove: vi.fn() };
				ribbonEls.push(el);
				return el;
			}),
			addCommand: vi.fn((command: FakeCommand) => {
				commands.set(command.id, command);
				return command;
			}),
			removeCommand: vi.fn((id: string) => {
				commands.delete(id);
			}),
		},
	};
}

function createFakeApp() {
	const setViewState = vi.fn().mockResolvedValue(undefined);
	const revealLeaf = vi.fn().mockResolvedValue(undefined);
	const leaf = { setViewState };
	const app = {
		workspace: {
			rightSplit: {},
			leaves: {} as Record<string, unknown[]>,
			getLeavesOfType(type: string) {
				return this.leaves[type] ?? [];
			},
			getLeaf: vi.fn(() => leaf),
			getRightLeaf: vi.fn(() => leaf),
			revealLeaf,
		},
	};
	return { app, setViewState, revealLeaf };
}

function setup(
	modules: AnyWorkbenchModule[],
	readSettings: () => FlashcardSettings = () => DEFAULT_SETTINGS,
) {
	const fakePlugin = createFakePlugin();
	const fakeApp = createFakeApp();
	const commitSettings = vi.fn().mockResolvedValue(undefined);
	const hosts = new Map<FeatureSettingsOwner, unknown>();
	const workbench = createWorkbench({
		app: fakeApp.app as never,
		plugin: fakePlugin.plugin as never,
		readSettings,
		commitSettings,
		// Capture the per-module host the workbench hands out.
		createModules: () =>
			modules.map((entry) => ({
				id: entry.id,
				render: (host: never) => {
					hosts.set(entry.id, host);
					entry.render(host);
				},
				stop: () => entry.stop(),
			})) as AnyWorkbenchModule[],
	});
	return {
		...fakePlugin,
		...fakeApp,
		workbench,
		commitSettings,
		host: <TOwner extends FeatureSettingsOwner>(
			id: TOwner = "translation" as TOwner,
		): WorkbenchHost<TOwner> => hosts.get(id) as WorkbenchHost<TOwner>,
	};
}

function feature<TOwner extends FeatureSettingsOwner>(
	id: TOwner,
	render: WorkbenchModule<TOwner>["render"],
): WorkbenchModule<TOwner> {
	return { id, render, stop: vi.fn() };
}

describe("workbench", () => {
	it("registers a view once however often the feature re-renders", () => {
		const { plugin, workbench } = setup([
			feature("translation", (host) =>
				host.registerView("view-a", () => ({ updateSettings() {} }) as never),
			),
		]);

		workbench.refresh();
		workbench.refresh();
		workbench.refresh();

		expect(plugin.registerView).toHaveBeenCalledTimes(1);
		expect(plugin.registerView).toHaveBeenCalledWith("view-a", expect.any(Function));
	});

	it("rebuilds a feature's chrome and removes the previous ribbon and commands", () => {
		const { plugin, commands, ribbonEls, workbench } = setup([
			feature("translation", (host) => {
				host.chrome((chrome) => {
					chrome.ribbon("book-open", "词典", () => {});
					chrome.command({ id: "open-dictionary", name: "词典", run: () => {} });
				});
			}),
		]);

		workbench.refresh();
		expect(ribbonEls).toHaveLength(1);
		expect(ribbonEls[0]!.remove).not.toHaveBeenCalled();
		expect(commands.has("open-dictionary")).toBe(true);

		workbench.refresh();
		expect(ribbonEls).toHaveLength(2);
		expect(ribbonEls[0]!.remove).toHaveBeenCalledTimes(1);
		expect(plugin.removeCommand).toHaveBeenCalledWith("open-dictionary");
		expect(commands.has("open-dictionary")).toBe(true);
	});

	it("clears chrome when a feature stops contributing it", () => {
		let enabled = true;
		const { commands, ribbonEls, workbench } = setup([
			feature("translation", (host) => {
				host.chrome((chrome) => {
					if (!enabled) return;
					chrome.ribbon("book-open", "词典", () => {});
					chrome.command({ id: "open-dictionary", name: "词典", run: () => {} });
				});
			}),
		]);

		workbench.refresh();
		enabled = false;
		workbench.refresh();

		expect(ribbonEls[0]!.remove).toHaveBeenCalledTimes(1);
		expect(commands.has("open-dictionary")).toBe(false);
	});

	it("runs a selection command only outside the checking pass and only with a selection", () => {
		const run = vi.fn();
		const { commands, workbench } = setup([
			feature("translation", (host) => {
				host.chrome((chrome) => {
					chrome.command({
						id: "translate-selection",
						name: "翻译选区",
						selection: { run },
					});
				});
			}),
		]);
		workbench.refresh();

		const command = commands.get("translate-selection")!;
		expect(command.editorCheckCallback?.(true, { getSelection: () => "  " })).toBe(false);
		expect(command.editorCheckCallback?.(true, { getSelection: () => "word" })).toBe(true);
		expect(run).not.toHaveBeenCalled();
		expect(command.editorCheckCallback?.(false, { getSelection: () => "word" })).toBe(true);
		expect(run).toHaveBeenCalledWith("word");
	});

	it("orders settings sections by their declared position and replaces by id", () => {
		const section = (id: string, order: number) => ({
			id,
			order,
			label: () => id,
			presentation: () => ({
				snapshot: { sectionId: id, generation: 0, groups: [] },
				invoke: async () => ({ status: "applied" as const }),
				dispose: () => undefined,
			}),
		});
		const { workbench } = setup([
			feature("translation", (host) => {
				host.settingsSection(section("flashcards", 0));
				host.settingsSection(section("dictionary", 3));
			}),
		]);
		workbench.addSettingsSection(section("ai", 1));

		workbench.refresh();
		expect(workbench.settingsSections().map((entry) => entry.id)).toEqual([
			"flashcards",
			"ai",
			"dictionary",
		]);

		// Re-registering the same id must replace, not duplicate.
		workbench.refresh();
		expect(workbench.settingsSections()).toHaveLength(3);
	});

	it("pushes committed settings into open views and stops every feature on dispose", () => {
		const updateSettings = vi.fn();
		const stopOrder: string[] = [];
		const firstStop = vi.fn(() => stopOrder.push("first"));
		const secondStop = vi.fn(() => stopOrder.push("second"));
		const features: AnyWorkbenchModule[] = [
			{
				id: "translation",
				render: (host) => host.registerView("view-a", () => ({ updateSettings }) as never),
				stop: firstStop,
			},
			{
				id: "dictionary",
				render: (host) => host.registerView("view-b", () => ({}) as never),
				stop: secondStop,
			},
		];
		const { app, workbench } = setup(features);
		app.workspace.leaves["view-a"] = [{ view: { updateSettings } }, { view: {} }];
		app.workspace.leaves["view-b"] = [{ view: {} }];

		workbench.refresh();

		expect(updateSettings).toHaveBeenCalledTimes(1);
		expect(updateSettings).toHaveBeenCalledWith();

		workbench.dispose();
		expect(firstStop).toHaveBeenCalledTimes(1);
		expect(secondStop).toHaveBeenCalledTimes(1);
		expect(stopOrder).toEqual(["second", "first"]);
	});

	it("reuses an existing leaf instead of opening a second one", async () => {
		const { app, workbench, setViewState, revealLeaf, host } = setup([
			feature("translation", (host) => host.registerView("view-a", () => ({}) as never)),
		]);
		workbench.refresh();

		app.workspace.leaves["view-a"] = [{ view: {} }];
		await host().activateView("view-a");
		expect(revealLeaf).toHaveBeenCalled();
		expect(setViewState).not.toHaveBeenCalled();

		app.workspace.leaves["view-a"] = [];
		await host().activateView("view-a");
		expect(setViewState).toHaveBeenCalledWith({ type: "view-a", active: true });
	});

	it("opens a right-sidebar leaf when asked", async () => {
		const { app, workbench, host } = setup([
			feature("translation", (host) => host.registerView("view-a", () => ({}) as never)),
		]);
		workbench.refresh();

		await host().activateView("view-a", { rightSidebar: true });
		expect(app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
	});

	it("reuses a right-sidebar view even when another leaf of that type is elsewhere", async () => {
		const { app, workbench, host, setViewState, revealLeaf } = setup([
			feature("translation", (host) => host.registerView("view-a", () => ({}) as never)),
		]);
		workbench.refresh();
		const elsewhere = { getRoot: () => ({}) };
		const sidebar = { getRoot: () => app.workspace.rightSplit };
		app.workspace.leaves["view-a"] = [elsewhere, sidebar];

		await host().activateView("view-a", { rightSidebar: true });
		expect(revealLeaf).toHaveBeenCalledWith(sidebar);
		expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(setViewState).not.toHaveBeenCalled();
	});

	it("creates a right-sidebar view when existing leaves are elsewhere", async () => {
		const { app, workbench, host, setViewState, revealLeaf } = setup([
			feature("translation", (host) => host.registerView("view-a", () => ({}) as never)),
		]);
		workbench.refresh();
		const elsewhere = { getRoot: () => ({}) };
		app.workspace.leaves["view-a"] = [elsewhere];

		await host().activateView("view-a", { rightSidebar: true });
		expect(app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(setViewState).toHaveBeenCalledWith({ type: "view-a", active: true });
		expect(revealLeaf).not.toHaveBeenCalledWith(elsewhere);
	});

	it("commits a settings patch through the host-owned writer", async () => {
		const { workbench, commitSettings, host } = setup([feature("translation", () => {})]);
		workbench.refresh();

		const patch = { translation: DEFAULT_SETTINGS.translation };
		await host().settings.update(patch);
		expect(commitSettings).toHaveBeenCalledWith(patch);
	});

	it("projects only shared and owner settings into a detached snapshot", () => {
		const { workbench, host } = setup([
			feature("translation", () => {}),
			feature("flashcards", () => {}),
		]);
		workbench.refresh();

		const snapshot = host("translation").settings.read();
		expect(Object.keys(snapshot).sort()).toEqual(["language", "translation"]);
		(snapshot.translation as { enabled: boolean }).enabled = !snapshot.translation.enabled;
		expect(host("translation").settings.read().translation.enabled).toBe(
			DEFAULT_SETTINGS.translation.enabled,
		);

		// @ts-expect-error Translation cannot read another owner's settings.
		void host("translation").settings.read().dictionary;
		// @ts-expect-error Only the flashcards owner can write the shared language.
		void host("translation").settings.setLanguage;
	});

	it("rejects a mixed authorized and unauthorized patch before persistence", async () => {
		const { workbench, host, commitSettings } = setup([feature("translation", () => {})]);
		workbench.refresh();

		await expect(
			host("translation").settings.update({
				translation: DEFAULT_SETTINGS.translation,
				dictionary: DEFAULT_SETTINGS.dictionary,
			} as never),
		).rejects.toEqual(
			expect.objectContaining<Partial<SettingsScopeViolation>>({
				name: "SettingsScopeViolation",
				moduleId: "translation",
				unauthorizedKeys: ["dictionary"],
			}),
		);
		expect(commitSettings).not.toHaveBeenCalled();
	});

	it("lets flashcards atomically update both owned slices and change shared language explicitly", async () => {
		const { workbench, host, commitSettings } = setup([feature("flashcards", () => {})]);
		workbench.refresh();
		const patch = {
			dailyNewCards: 11,
			pronunciation: {
				...DEFAULT_SETTINGS.pronunciation,
				spellingAutoPlay: !DEFAULT_SETTINGS.pronunciation.spellingAutoPlay,
			},
		};

		await host("flashcards").settings.update(patch);
		await host("flashcards").settings.setLanguage("en");

		expect(commitSettings).toHaveBeenNthCalledWith(1, patch);
		expect(commitSettings).toHaveBeenNthCalledWith(2, { language: "en" });
	});

	it("rejects shared language when smuggled through an owner patch", async () => {
		const { workbench, host, commitSettings } = setup([feature("flashcards", () => {})]);
		workbench.refresh();

		await expect(
			host("flashcards").settings.update({ language: "en" } as never),
		).rejects.toEqual(
			expect.objectContaining<Partial<SettingsScopeViolation>>({
				name: "SettingsScopeViolation",
				moduleId: "flashcards",
				unauthorizedKeys: ["language"],
			}),
		);
		expect(commitSettings).not.toHaveBeenCalled();
	});

	it("renders and updates only the owner whose committed settings changed", () => {
		const translationRender = vi.fn();
		const dictionaryRender = vi.fn();
		const translationViewUpdate = vi.fn();
		const dictionaryViewUpdate = vi.fn();
		const { app, workbench } = setup([
			feature("translation", (host) => {
				translationRender();
				host.registerView("translation-view", () => ({ updateSettings() {} }) as never);
			}),
			feature("dictionary", (host) => {
				dictionaryRender();
				host.registerView("dictionary-view", () => ({ updateSettings() {} }) as never);
			}),
		]);
		workbench.refresh();
		app.workspace.leaves["translation-view"] = [
			{ view: { updateSettings: translationViewUpdate } },
		];
		app.workspace.leaves["dictionary-view"] = [
			{ view: { updateSettings: dictionaryViewUpdate } },
		];

		workbench.settingsChanged(DEFAULT_SETTINGS, {
			...DEFAULT_SETTINGS,
			dictionary: {
				...DEFAULT_SETTINGS.dictionary,
				enabled: !DEFAULT_SETTINGS.dictionary.enabled,
			},
		});

		expect(translationRender).toHaveBeenCalledTimes(1);
		expect(dictionaryRender).toHaveBeenCalledTimes(2);
		expect(translationViewUpdate).not.toHaveBeenCalled();
		expect(dictionaryViewUpdate).toHaveBeenCalledTimes(1);
	});

	it("fans a shared language change out to every module and view", () => {
		const translationRender = vi.fn();
		const dictionaryRender = vi.fn();
		const translationViewUpdate = vi.fn();
		const dictionaryViewUpdate = vi.fn();
		const { app, workbench } = setup([
			feature("translation", (host) => {
				translationRender();
				host.registerView("translation-view", () => ({ updateSettings() {} }) as never);
			}),
			feature("dictionary", (host) => {
				dictionaryRender();
				host.registerView("dictionary-view", () => ({ updateSettings() {} }) as never);
			}),
		]);
		workbench.refresh();
		app.workspace.leaves["translation-view"] = [
			{ view: { updateSettings: translationViewUpdate } },
		];
		app.workspace.leaves["dictionary-view"] = [
			{ view: { updateSettings: dictionaryViewUpdate } },
		];

		workbench.settingsChanged(DEFAULT_SETTINGS, {
			...DEFAULT_SETTINGS,
			language: DEFAULT_SETTINGS.language === "zh" ? "en" : "zh",
		});

		expect(translationRender).toHaveBeenCalledTimes(2);
		expect(dictionaryRender).toHaveBeenCalledTimes(2);
		expect(translationViewUpdate).toHaveBeenCalledTimes(1);
		expect(dictionaryViewUpdate).toHaveBeenCalledTimes(1);
	});

	it("rejects owner updates after disposal", async () => {
		const { workbench, host, commitSettings } = setup([feature("translation", () => {})]);
		workbench.refresh();
		const settings = host("translation").settings;
		workbench.dispose();

		await expect(
			settings.update({ translation: DEFAULT_SETTINGS.translation }),
		).rejects.toBeInstanceOf(WorkbenchDisposedError);
		expect(commitSettings).not.toHaveBeenCalled();
	});

	it("generates one open command per available catalog entry and keeps its id", () => {
		const openFirst = vi.fn();
		const openSecond = vi.fn();
		const { commands, plugin, workbench } = setup([
			feature("flashcards", (host) =>
				host.catalog({
					id: "first",
					icon: Layers,
					title: () => "First",
					openCommandId: "open-first",
					openHotkeys: [{ modifiers: ["Alt"], key: "W" }],
					settingsSectionId: "first",
					available: () => true,
					open: openFirst,
				}),
			),
			feature("translation", (host) =>
				host.catalog({
					id: "second",
					icon: BookOpen,
					title: () => "Second",
					openCommandId: "open-second",
					settingsSectionId: "second",
					available: () => false,
					open: openSecond,
				}),
			),
		]);

		workbench.refresh();

		expect([...commands.keys()]).toEqual(["open-first"]);
		expect(commands.get("open-first")!.name).toBe("First");
		expect(commands.get("open-first")!.hotkeys).toEqual([{ modifiers: ["Alt"], key: "W" }]);
		commands.get("open-first")!.callback?.();
		expect(openFirst).toHaveBeenCalledTimes(1);
		expect(openSecond).not.toHaveBeenCalled();
		expect(plugin.addCommand).toHaveBeenCalledTimes(1);
	});

	it("rebinds configured catalog and standalone commands after settings change", () => {
		let settings: FlashcardSettings = {
			...DEFAULT_SETTINGS,
			featureOpenShortcuts: { ...DEFAULT_SETTINGS.featureOpenShortcuts },
		};
		const { commands, plugin, workbench, host } = setup(
			[
				feature("flashcards", (host) =>
					host.catalog({
						id: "flashcards",
						icon: Layers,
						title: () => "Flashcards",
						openCommandId: "open-flashcards",
						shortcutKey: "flashcards",
						settingsSectionId: "flashcards",
						available: () => true,
						open: vi.fn(),
					}),
				),
				feature("selectionHelper", (host) =>
					host.chrome((chrome) =>
						chrome.command({
							id: "open-selection-dictionary-assistant",
							name: "Lookup assistant",
							shortcutKey: "selectionHelper",
							run: vi.fn(),
						}),
					),
				),
			],
			() => settings,
		);

		workbench.refresh();
		expect(host("selectionHelper").configuredOpenShortcut()).toBe("Alt+1");
		expect(commands.get("open-flashcards")?.hotkeys).toEqual([
			{ modifiers: ["Alt"], key: "4" },
		]);
		expect(commands.get("open-selection-dictionary-assistant")?.hotkeys).toEqual([
			{ modifiers: ["Alt"], key: "1" },
		]);

		const previous = settings;
		settings = {
			...settings,
			featureOpenShortcuts: {
				...settings.featureOpenShortcuts,
				flashcards: "",
				selectionHelper: "Ctrl+K",
			},
		};
		workbench.settingsChanged(previous, settings);
		expect(host("selectionHelper").configuredOpenShortcut()).toBe("Ctrl+K");
		expect(commands.get("open-flashcards")?.hotkeys).toEqual([]);
		expect(commands.get("open-selection-dictionary-assistant")?.hotkeys).toEqual([
			{ modifiers: ["Ctrl"], key: "K" },
		]);
		expect(plugin.removeCommand).toHaveBeenCalledWith("open-flashcards");
		expect(plugin.removeCommand).toHaveBeenCalledWith("open-selection-dictionary-assistant");
	});

	it("drops the generated command once a feature reports itself unavailable", () => {
		let available = true;
		const { commands, workbench } = setup([
			feature("translation", (host) =>
				host.catalog({
					id: "only",
					icon: Languages,
					title: () => "Only",
					openCommandId: "open-only",
					settingsSectionId: "only",
					available: () => available,
					open: vi.fn(),
				}),
			),
		]);

		workbench.refresh();
		expect(commands.has("open-only")).toBe(true);

		available = false;
		workbench.refresh();
		expect(commands.has("open-only")).toBe(false);
	});

	it("forwards section refresh sources and unscoped shared refreshes to the settings tab", () => {
		const { workbench, host } = setup([feature("translation", () => {})]);
		const tab = { refresh: vi.fn(), select: vi.fn(), open: vi.fn() };
		workbench.setSettingsTab(tab);
		workbench.refresh();

		host("translation").settingsTab.refresh("translation");
		workbench.settingsTab.refresh();
		expect(tab.refresh).toHaveBeenNthCalledWith(1, "translation");
		expect(tab.refresh).toHaveBeenNthCalledWith(2, undefined);
	});

	it("projects available sibling entries in declared order and excludes the caller", () => {
		const openTranslation = vi.fn();
		const { workbench, host } = setup([
			feature("translation", (h) =>
				h.catalog({
					id: "translation",
					icon: Languages,
					order: 10,
					title: (language) => (language === "zh" ? "翻译" : "Translation"),
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => true,
					open: openTranslation,
				}),
			),
			feature("dictionary", (h) =>
				h.catalog({
					id: "dictionary",
					icon: BookOpen,
					order: 20,
					title: () => "Dictionary",
					openCommandId: "open-dictionary",
					settingsSectionId: "sec-dictionary",
					available: () => true,
					open: vi.fn(),
				}),
			),
			feature("flashcards", (h) =>
				h.catalog({
					id: "flashcards",
					icon: Layers,
					order: 0,
					title: () => "Flashcards",
					openCommandId: "open-flashcards",
					settingsSectionId: "sec-flashcards",
					available: () => true,
					open: vi.fn(),
				}),
			),
		]);
		workbench.refresh();

		const shortcuts = host("flashcards").featureShortcuts();
		expect(shortcuts.map((shortcut) => shortcut.id)).toEqual(["translation", "dictionary"]);
		expect(shortcuts[0]!.title).toBe("翻译");
		expect(shortcuts[0]!.icon).toBe(Languages);
		shortcuts[0]!.open();
		expect(openTranslation).toHaveBeenCalledTimes(1);
	});

	it("filters unavailable entries and re-checks availability when opening", () => {
		let available = true;
		const openEntry = vi.fn();
		const mockSettingsTab = { refresh: vi.fn(), select: vi.fn(), open: vi.fn() };
		const { workbench, host } = setup([
			feature("translation", (h) =>
				h.catalog({
					id: "translation",
					icon: Languages,
					order: 10,
					title: () => "Translation",
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => available,
					open: openEntry,
				}),
			),
			feature("flashcards", () => {}),
		]);
		workbench.setSettingsTab(mockSettingsTab);
		workbench.refresh();

		const shortcuts = host("flashcards").featureShortcuts();
		expect(shortcuts).toHaveLength(1);
		available = false;
		shortcuts[0]!.open();
		expect(openEntry).not.toHaveBeenCalled();
		expect(mockSettingsTab.open).toHaveBeenCalledWith("sec-translation");
		expect(host("flashcards").featureShortcuts()).toHaveLength(0);
	});

	it("keeps the projection reference stable until the catalog signature changes", () => {
		let available = true;
		const { workbench, host } = setup([
			feature("translation", (h) =>
				h.catalog({
					id: "translation",
					icon: Languages,
					order: 10,
					title: () => "Translation",
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => available,
					open: vi.fn(),
				}),
			),
			feature("flashcards", () => {}),
		]);
		workbench.refresh();

		const h = host("flashcards");
		const first = h.featureShortcuts();
		expect(h.featureShortcuts()).toBe(first);
		available = false;
		const second = h.featureShortcuts();
		expect(second).not.toBe(first);
		expect(second).toHaveLength(0);
	});

	it("repaints open landing views when a sibling becomes unavailable", () => {
		let available = true;
		const landingUpdate = vi.fn();
		const { workbench, app } = setup([
			feature("translation", (h) =>
				h.catalog({
					id: "translation",
					icon: Languages,
					order: 10,
					title: () => "Translation",
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => available,
					open: vi.fn(),
				}),
			),
			feature("flashcards", (h) => {
				h.registerView("landing-view", () => ({ updateSettings() {} }) as never);
			}),
		]);
		app.workspace.leaves["landing-view"] = [{ view: { updateSettings: landingUpdate } }];
		workbench.refresh();
		landingUpdate.mockClear();

		available = false;
		workbench.settingsChanged(DEFAULT_SETTINGS, {
			...DEFAULT_SETTINGS,
			translation: { ...DEFAULT_SETTINGS.translation, promptTemplate: "changed" },
		});
		expect(landingUpdate).toHaveBeenCalledTimes(1);
	});

	it("does not repaint landing views when only non-catalog settings change", () => {
		const landingUpdate = vi.fn();
		const { workbench, app } = setup([
			feature("translation", (h) =>
				h.catalog({
					id: "translation",
					icon: Languages,
					order: 10,
					title: () => "Translation",
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => true,
					open: vi.fn(),
				}),
			),
			feature("flashcards", (h) => {
				h.registerView("landing-view", () => ({ updateSettings() {} }) as never);
			}),
		]);
		app.workspace.leaves["landing-view"] = [{ view: { updateSettings: landingUpdate } }];
		workbench.refresh();
		landingUpdate.mockClear();

		workbench.settingsChanged(DEFAULT_SETTINGS, {
			...DEFAULT_SETTINGS,
			translation: { ...DEFAULT_SETTINGS.translation, promptTemplate: "changed" },
		});
		expect(landingUpdate).not.toHaveBeenCalled();
	});

	it("rolls back chrome, settings sections, and catalog entries when module render fails", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { workbench, ribbonEls, commands } = setup([
			feature("translation", (host) => {
				host.chrome((chrome) => {
					chrome.ribbon("icon-t", "Translation", () => {});
					chrome.command({ id: "cmd-t", name: "Translation Command", run: () => {} });
				});
				host.catalog({
					id: "translation",
					icon: BookOpen,
					title: () => "Translation",
					openCommandId: "open-translation",
					settingsSectionId: "sec-translation",
					available: () => true,
					open: () => {},
				});
				host.settingsSection({
					id: "sec-translation",
					order: 10,
					label: () => "Translation",
					presentation: () => ({
						snapshot: {} as never,
						invoke: async () => ({ status: "applied" }),
						dispose: () => {},
					}),
				});
				throw new Error("render failed");
			}),
		]);

		workbench.refresh();

		expect(workbench.settingsSections()).toEqual([]);
		expect(ribbonEls).toHaveLength(1);
		expect(ribbonEls[0]?.remove).toHaveBeenCalled();
		expect(commands.has("cmd-t")).toBe(false);
		expect(commands.has("open-translation")).toBe(false);
		consoleSpy.mockRestore();
	});
});
