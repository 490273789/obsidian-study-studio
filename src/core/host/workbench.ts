import type { App, Command, Editor, Hotkey, ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import type { SettingsPresentation } from "../settings/presentation";
import type { FlashcardSettings, Language } from "../shared/types";
import {
	authorizeSettingsPatch,
	changedSettingsOwners,
	projectSettings,
	SettingsScopeViolation,
	validateSettingsOwnership,
	type FeatureSettingsOwner,
	type OwnedSettings,
	type ScopedWorkbenchSettings,
} from "./settingsSlices";
export { SettingsScopeViolation } from "./settingsSlices";

/**
 * One runtime module hosted by the workbench.
 *
 * `render` is the single entry point and must be idempotent: the workbench calls
 * it once at startup and again when this owner or shared context changes. Views
 * are registered once by the host; chrome is rebuilt on every call.
 */
export interface WorkbenchModule<TOwner extends FeatureSettingsOwner> {
	readonly id: TOwner;
	render(host: WorkbenchHost<TOwner>): void;
	/** Releases module-owned resources: runtimes, subscriptions, timers, modals. */
	stop(): void;
}

export interface WorkbenchCommand {
	id: string;
	name: string;
	hotkeys?: Hotkey[];
	/** Set for commands that only run with a non-empty editor selection. */
	selection?: { run(selection: string): void };
	/** Set for commands that take no selection. */
	run?(): void;
}

export interface WorkbenchChromeScope {
	/** At most one ribbon icon per feature; a later call replaces the earlier one. */
	ribbon(icon: string, title: string, onClick: () => void): void;
	command(spec: WorkbenchCommand): void;
}

/**
 * How one feature presents itself in the workbench: what it is called, which icon
 * represents it, and how to open it.
 *
 * Pushed on every render, exactly like a settings section, so a feature that is
 * currently disabled simply reports itself as unavailable instead of the host
 * guessing from settings.
 */
export interface WorkbenchCatalogEntry {
	/** Feature id; the same id replaces the previous entry. */
	id: string;
	title(language: Language): string;
	icon: string;
	/**
	 * Command id for the host-generated "open" command. Features keep the id they
	 * have always used so user-assigned hotkeys survive.
	 */
	openCommandId: string;
	/** Default hotkeys for the generated open command. */
	openHotkeys?: Hotkey[];
	/** Settings section that configures this feature; the home links to it. */
	settingsSectionId: string;
	/** Whether the feature currently offers an entry point. */
	available(): boolean;
	/** Opens or focuses the feature's primary view. */
	open(): void;
}

/** One section of the plugin settings tab, contributed by a feature or the host. */
export interface WorkbenchSettingsSection {
	id: string;
	/** Position in the settings tab; lower comes first. */
	order: number;
	label(language: Language): string;
	/** A fresh presentation generation, rebuilt on every render. */
	presentation(language: Language): SettingsPresentation;
	activate?(): void;
	hide?(): void;
}

/**
 * An Obsidian view owned by a feature. The host signals it after this owner or
 * shared context changes, so features do not walk leaves.
 */
export interface WorkbenchItemView extends ItemView {
	updateSettings(): void;
}

/**
 * The host's settings tab, as features see it: the tab itself owns section
 * selection, re-rendering, and opening Obsidian settings.
 */
export interface WorkbenchSettingsTab {
	/** Re-renders the settings tab in place. */
	refresh(): void;
	/** Selects a section for the next render. */
	select(sectionId: string): void;
	/** Opens the plugin settings, optionally selecting a section first. */
	open(sectionId?: string): void;
}

/**
 * The capabilities a feature may use. Deliberately narrow: the host owns
 * registration, activation, chrome lifetime, the settings document, and the
 * settings tab. Shared services reach features through their factory, not here.
 */
interface BaseWorkbenchSettings<TOwner extends FeatureSettingsOwner> {
	/** A detached snapshot containing only shared settings and this owner's settings. */
	read(): ScopedWorkbenchSettings<TOwner>;
	/** Atomically commits one or more settings keys owned by this module. */
	update(patch: Readonly<Partial<OwnedSettings<TOwner>>>): Promise<void>;
}

export type WorkbenchSettings<TOwner extends FeatureSettingsOwner> = BaseWorkbenchSettings<TOwner> &
	(TOwner extends "flashcards"
		? { setLanguage(language: Language): Promise<void> }
		: Record<never, never>);

export interface WorkbenchHost<TOwner extends FeatureSettingsOwner> {
	/** The Obsidian application, for vault, workspace, and secret access. */
	readonly app: App;
	/** Owner-scoped committed settings; unrelated slices do not cross this seam. */
	readonly settings: WorkbenchSettings<TOwner>;
	/** The plugin settings tab. */
	readonly settingsTab: WorkbenchSettingsTab;
	/** Registers one Obsidian view. Repeated calls for the same type are ignored. */
	registerView(type: string, factory: (leaf: WorkspaceLeaf) => WorkbenchItemView): void;
	/** Rebuilds this feature's chrome; the previous ribbon and commands are removed first. */
	chrome(build: (chrome: WorkbenchChromeScope) => void): void;
	/** Opens or focuses one of this feature's views. */
	activateView(
		type: string,
		options?: { rightSidebar?: boolean; mainTab?: boolean },
	): Promise<void>;
	/** Contributes a settings section for this feature. Same id replaces the previous one. */
	settingsSection(section: WorkbenchSettingsSection): void;
	/** Contributes this feature's catalog entry. Same id replaces the previous one. */
	catalog(entry: WorkbenchCatalogEntry): void;
	/** Opens a feature by its catalog id, or opens its settings if unavailable. */
	openFeature(featureId: string): void;
}

export interface Workbench {
	/** Re-renders every registered module against committed settings. */
	refresh(): void;
	/** Routes one committed local or external settings transition to affected modules and views. */
	settingsChanged(previous: FlashcardSettings, next: FlashcardSettings): void;
	/** Contributes a host-owned shared settings section, such as AI engines. */
	addSettingsSection(section: WorkbenchSettingsSection): void;
	/** Settings sections from the host and every feature, ordered. */
	settingsSections(): WorkbenchSettingsSection[];
	/** Catalog entries of every feature, in feature order. */
	catalog(): WorkbenchCatalogEntry[];
	/**
	 * Declares the workbench's own chrome (its ribbon and commands). Rebuilt on
	 * every refresh like a feature's chrome, so it relabels on a language change.
	 */
	ring(build: (chrome: WorkbenchChromeScope) => void): void;
	/** The settings tab registers itself here so features can reach it. */
	setSettingsTab(tab: WorkbenchSettingsTab): void;
	/** The settings-tab capability, for host-owned sections created outside features. */
	readonly settingsTab: WorkbenchSettingsTab;
	/** Releases every module. */
	dispose(): void;
}

export interface WorkbenchOptions {
	app: App;
	plugin: Plugin;
	readSettings(): FlashcardSettings;
	/** Commits a settings patch; must publish the committed settings on success. */
	commitSettings(patch: Partial<FlashcardSettings>): Promise<void>;
	createModules(): AnyWorkbenchModule[];
}

export type AnyWorkbenchModule = {
	[TOwner in FeatureSettingsOwner]: WorkbenchModule<TOwner>;
}[FeatureSettingsOwner];

export class WorkbenchDisposedError extends Error {
	constructor() {
		super("The workbench has been disposed");
		this.name = "WorkbenchDisposedError";
	}
}

interface ModuleChrome {
	ribbonEl: HTMLElement | null;
	commandIds: string[];
}

export function createWorkbench(options: WorkbenchOptions): Workbench {
	validateSettingsOwnership();
	const registeredViewTypes = new Set<string>();
	const viewOwnerByType = new Map<string, FeatureSettingsOwner>();
	const chromeByModule = new Map<string, ModuleChrome>();
	const hostsByModule = new Map<FeatureSettingsOwner, unknown>();
	const sectionsById = new Map<string, WorkbenchSettingsSection>();
	const catalogById = new Map<string, WorkbenchCatalogEntry>();
	/** Command ids the host generated for the previous catalog, so it can clean up. */
	let catalogCommandIds: string[] = [];
	/** Chrome id reserved for the workbench's own ribbon and commands. */
	const HOST_CHROME_ID = "\u0000workbench-host";
	let ringBuilder: ((chrome: WorkbenchChromeScope) => void) | null = null;
	const modules = options.createModules();
	let settingsTab: WorkbenchSettingsTab | null = null;
	let disposed = false;

	const settingsTabCapability: WorkbenchSettingsTab = {
		refresh: () => settingsTab?.refresh(),
		select: (sectionId) => settingsTab?.select(sectionId),
		open: (sectionId) => settingsTab?.open(sectionId),
	};

	const removeChrome = (moduleId: string): void => {
		const chrome = chromeByModule.get(moduleId);
		if (!chrome) return;
		chrome.ribbonEl?.remove();
		for (const id of chrome.commandIds) options.plugin.removeCommand(id);
		chromeByModule.set(moduleId, { ribbonEl: null, commandIds: [] });
	};

	const hostFor = <TOwner extends FeatureSettingsOwner>(
		moduleId: TOwner,
	): WorkbenchHost<TOwner> => {
		const existing = hostsByModule.get(moduleId);
		if (existing) return existing as WorkbenchHost<TOwner>;

		const settings: BaseWorkbenchSettings<TOwner> & {
			setLanguage?: (language: Language) => Promise<void>;
		} = {
			read: () => projectSettings(moduleId, options.readSettings()),
			update: async (patch) => {
				if (disposed) throw new WorkbenchDisposedError();
				const detached = authorizeSettingsPatch(moduleId, patch);
				await options.commitSettings(detached as Partial<FlashcardSettings>);
			},
		};
		if (moduleId === "flashcards") {
			settings.setLanguage = async (language) => {
				if (disposed) throw new WorkbenchDisposedError();
				if (language !== "zh" && language !== "en") {
					throw new SettingsScopeViolation(moduleId, ["language"]);
				}
				await options.commitSettings({ language });
			};
		}

		const host = {
			app: options.app,

			settings: settings as WorkbenchSettings<TOwner>,

			settingsTab: settingsTabCapability,

			registerView: (type, factory) => {
				const existingOwner = viewOwnerByType.get(type);
				if (existingOwner && existingOwner !== moduleId) {
					throw new Error(
						`Workbench view ${type} is already registered by ${existingOwner}`,
					);
				}
				if (registeredViewTypes.has(type)) return;
				registeredViewTypes.add(type);
				viewOwnerByType.set(type, moduleId);
				options.plugin.registerView(type, (leaf) => factory(leaf));
			},

			chrome: (build) => {
				removeChrome(moduleId);
				const chrome: ModuleChrome = { ribbonEl: null, commandIds: [] };
				chromeByModule.set(moduleId, chrome);
				build({
					ribbon: (icon, title, onClick) => {
						chrome.ribbonEl?.remove();
						chrome.ribbonEl = options.plugin.addRibbonIcon(icon, title, onClick);
					},
					command: (spec) => {
						chrome.commandIds.push(spec.id);
						options.plugin.addCommand(toObsidianCommand(spec));
					},
				});
			},

			activateView: (type, activateOptions) =>
				activateView(options.app, type, activateOptions),

			settingsSection: (section) => {
				sectionsById.set(section.id, section);
			},

			catalog: (entry) => {
				catalogById.set(entry.id, entry);
			},

			openFeature: (targetFeatureId) => {
				const entry = catalogById.get(targetFeatureId);
				if (!entry) return;
				if (entry.available()) {
					entry.open();
				} else {
					settingsTabCapability.open(entry.settingsSectionId);
				}
			},
		} satisfies WorkbenchHost<TOwner>;

		hostsByModule.set(moduleId, host);
		return host;
	};

	/**
	 * Rebuilds the host-generated chrome from the catalog: one "open" command per
	 * feature that currently offers an entry point.
	 */
	const rebuildCatalogCommands = (): void => {
		const entries = [...catalogById.values()];
		for (const id of catalogCommandIds) options.plugin.removeCommand(id);
		catalogCommandIds = [];
		const language = options.readSettings().language;
		for (const entry of entries) {
			if (!entry.available()) continue;
			catalogCommandIds.push(entry.openCommandId);
			options.plugin.addCommand({
				id: entry.openCommandId,
				name: entry.title(language),
				hotkeys: entry.openHotkeys,
				callback: () => entry.open(),
			});
		}
	};

	const pushSettingsToOpenViews = (owners?: ReadonlySet<FeatureSettingsOwner>): void => {
		for (const type of registeredViewTypes) {
			const owner = viewOwnerByType.get(type);
			if (owners && (!owner || !owners.has(owner))) continue;
			for (const leaf of options.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view as Partial<WorkbenchItemView>;
				if (typeof view.updateSettings !== "function") continue;
				try {
					view.updateSettings();
				} catch (error) {
					console.error(
						`Failed to refresh the ${type} view after settings changed:`,
						error,
					);
				}
			}
		}
	};

	const renderModules = (owners?: ReadonlySet<FeatureSettingsOwner>): void => {
		for (const module of modules) {
			if (owners && !owners.has(module.id)) continue;
			try {
				module.render(hostFor(module.id) as never);
			} catch (error) {
				console.error(`Failed to render the ${module.id} workbench module:`, error);
			}
		}
		rebuildCatalogCommands();
	};

	const rebuildRing = (): void => {
		if (!ringBuilder) return;
		removeChrome(HOST_CHROME_ID);
		const chrome = createChromeScope(HOST_CHROME_ID);
		ringBuilder(chrome);
	};

	const createChromeScope = (moduleId: string): WorkbenchChromeScope => {
		removeChrome(moduleId);
		const chrome: ModuleChrome = { ribbonEl: null, commandIds: [] };
		chromeByModule.set(moduleId, chrome);
		return {
			ribbon: (icon, title, onClick) => {
				chrome.ribbonEl?.remove();
				chrome.ribbonEl = options.plugin.addRibbonIcon(icon, title, onClick);
			},
			command: (spec) => {
				chrome.commandIds.push(spec.id);
				options.plugin.addCommand(toObsidianCommand(spec));
			},
		};
	};

	return {
		refresh: () => {
			if (disposed) return;
			renderModules();
			rebuildRing();
			pushSettingsToOpenViews();
		},

		settingsChanged: (previous, next) => {
			if (disposed) return;
			const languageChanged = previous.language !== next.language;
			const changedOwners = changedSettingsOwners(previous, next);
			const affected = new Set<FeatureSettingsOwner>();
			for (const module of modules) {
				if (languageChanged || changedOwners.has(module.id)) affected.add(module.id);
			}
			if (affected.size > 0) {
				renderModules(affected);
				pushSettingsToOpenViews(affected);
			}
			if (languageChanged) rebuildRing();
		},

		addSettingsSection: (section) => {
			sectionsById.set(section.id, section);
		},

		settingsSections: () => [...sectionsById.values()].sort((a, b) => a.order - b.order),

		// Catalog order follows the order feature modules register their entries.
		catalog: () => [...catalogById.values()],

		ring: (build) => {
			ringBuilder = build;
		},

		setSettingsTab: (tab) => {
			settingsTab = tab;
		},

		settingsTab: settingsTabCapability,

		dispose: () => {
			if (disposed) return;
			disposed = true;
			// Dependants are composed after their providers, so release in reverse order.
			for (const module of [...modules].reverse()) {
				try {
					module.stop();
				} catch (error) {
					console.error(`Failed to stop the ${module.id} workbench module:`, error);
				}
			}
			for (const module of modules) removeChrome(module.id);
			removeChrome(HOST_CHROME_ID);
			for (const id of catalogCommandIds) options.plugin.removeCommand(id);
			catalogCommandIds = [];
		},
	};
}

async function activateView(
	app: App,
	type: string,
	options?: { rightSidebar?: boolean; mainTab?: boolean },
): Promise<void> {
	const workspace = app.workspace;
	let leaf: WorkspaceLeaf | undefined;
	if (options?.mainTab) {
		const rootSplit = workspace.rootSplit;
		const mainLeaves = rootSplit
			? workspace
					.getLeavesOfType(type)
					.filter((l) => typeof l.getRoot === "function" && l.getRoot() === rootSplit)
			: [];
		leaf = mainLeaves[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type, active: true });
		}
	} else {
		leaf = workspace.getLeavesOfType(type)[0];
		if (!leaf) {
			leaf = options?.rightSidebar
				? (workspace.getRightLeaf(false) ?? workspace.getLeaf("tab"))
				: workspace.getLeaf("tab");
			await leaf.setViewState({ type, active: true });
		}
	}
	await workspace.revealLeaf(leaf);
}

function toObsidianCommand(spec: WorkbenchCommand): Command {
	const base: Command = { id: spec.id, name: spec.name };
	if (spec.hotkeys) base.hotkeys = spec.hotkeys;
	if (spec.selection) {
		const selection = spec.selection;
		return {
			...base,
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				const text = editor.getSelection();
				if (!text.trim()) return false;
				if (!checking) selection.run(text);
				return true;
			},
		};
	}
	return { ...base, callback: () => spec.run?.() };
}
