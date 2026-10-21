import type { App, Command, Editor, Hotkey, ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import type { LucideIcon } from "lucide-react";
import type { SettingsPresentation } from "../settings/presentation";
import type { FlashcardSettings, Language } from "../shared/types";
import { featureOpenHotkeys, type FeatureOpenShortcutKey } from "../settings/featureOpenShortcuts";
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
	/** Host-owned configurable default hotkey, resolved when registering the command. */
	shortcutKey?: FeatureOpenShortcutKey;
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
	/** Lucide icon displayed by the landing-page shortcut; Obsidian commands carry no icon. */
	icon: LucideIcon;
	/** Landing-page shortcut order; lower comes first, ties keep registration order. */
	order?: number;
	/**
	 * Command id for the host-generated "open" command. Features keep the id they
	 * have always used so user-assigned hotkeys survive.
	 */
	openCommandId: string;
	/** Default hotkeys for the generated open command. */
	openHotkeys?: Hotkey[];
	/** Host-owned configurable default hotkey for this feature's open command. */
	shortcutKey?: FeatureOpenShortcutKey;
	/** Settings section used when an unavailable feature is opened. */
	settingsSectionId: string;
	/** Whether the feature currently offers an entry point. */
	available(): boolean;
	/** Opens or focuses the feature's primary view. */
	open(): void;
}

/**
 * The host's read projection of the catalog: one sibling feature as the landing
 * page needs it. Titles are resolved, availability is already filtered, and
 * ordering is applied, so callers never enumerate features themselves.
 */
export interface WorkbenchFeatureShortcut {
	readonly id: string;
	readonly title: string;
	readonly icon: LucideIcon;
	/** Opens the feature, or its settings when it became unavailable after projection. */
	readonly open: () => void;
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
	/** Refreshes one section, or the entire tab when shared context changes. */
	refresh(sectionId?: string): void;
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

type WorkbenchSettings<TOwner extends FeatureSettingsOwner> = BaseWorkbenchSettings<TOwner> &
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
	/** Read projection of the other features, ordered and filtered for a landing page. */
	featureShortcuts(): readonly WorkbenchFeatureShortcut[];
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
	/** The settings tab registers itself here so features can reach it. */
	setSettingsTab(tab: WorkbenchSettingsTab): void;
	/** The settings-tab capability, for host-owned sections created outside features. */
	readonly settingsTab: WorkbenchSettingsTab;
	/** Releases every module. */
	dispose(): void;
}

interface WorkbenchOptions {
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
	usesConfigurableShortcut: boolean;
}

export function createWorkbench(options: WorkbenchOptions): Workbench {
	validateSettingsOwnership();
	const registeredViewTypes = new Set<string>();
	const viewOwnerByType = new Map<string, FeatureSettingsOwner>();
	const chromeByModule = new Map<string, ModuleChrome>();
	const hostsByModule = new Map<FeatureSettingsOwner, unknown>();
	const sectionsById = new Map<string, WorkbenchSettingsSection>();
	const catalogById = new Map<string, WorkbenchCatalogEntry>();
	const sectionOwnerById = new Map<string, FeatureSettingsOwner>();
	const catalogOwnerById = new Map<string, FeatureSettingsOwner>();
	/** Command ids the host generated for the previous catalog, so it can clean up. */
	let catalogCommandIds: string[] = [];
	/** Availability/order signature, so a catalog change repaints open landing pages. */
	let catalogAvailabilitySignature = "";
	/** Last projection, keyed by language + resolved entries, for stable React props. */
	let shortcutCache: {
		signature: string;
		shortcuts: readonly WorkbenchFeatureShortcut[];
	} | null = null;
	const modules = options.createModules();
	let settingsTab: WorkbenchSettingsTab | null = null;
	let disposed = false;

	const settingsTabCapability: WorkbenchSettingsTab = {
		refresh: (sectionId) => settingsTab?.refresh(sectionId),
		select: (sectionId) => settingsTab?.select(sectionId),
		open: (sectionId) => settingsTab?.open(sectionId),
	};
	const configuredHotkeys = (key: FeatureOpenShortcutKey): Hotkey[] =>
		featureOpenHotkeys(options.readSettings().featureOpenShortcuts[key]);

	const openCatalogFeature = (featureId: string): void => {
		const entry = catalogById.get(featureId);
		if (!entry) return;
		if (entry.available()) {
			entry.open();
		} else {
			settingsTabCapability.open(entry.settingsSectionId);
		}
	};

	const featureShortcutsFor = (
		moduleId: FeatureSettingsOwner,
	): readonly WorkbenchFeatureShortcut[] => {
		const language = options.readSettings().language;
		const signature = [
			moduleId,
			language,
			...[...catalogById.values()]
				.map(
					(entry) =>
						`${entry.id}|${entry.available() ? 1 : 0}|${entry.order ?? ""}|${entry.title(language)}`,
				)
				.sort(),
		].join("\n");
		if (shortcutCache?.signature === signature) return shortcutCache.shortcuts;
		const shortcuts = Object.freeze(
			[...catalogById.values()]
				.filter((entry) => catalogOwnerById.get(entry.id) !== moduleId && entry.available())
				.sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity))
				.map((entry) =>
					Object.freeze({
						id: entry.id,
						title: entry.title(language),
						icon: entry.icon,
						open: () => openCatalogFeature(entry.id),
					}),
				),
		);
		shortcutCache = { signature, shortcuts };
		return shortcuts;
	};

	const catalogSignature = (): string =>
		[...catalogById.values()]
			.map((entry) => `${entry.id}|${entry.available() ? 1 : 0}|${entry.order ?? ""}`)
			.sort()
			.join("\n");

	const removeChrome = (moduleId: string): void => {
		const chrome = chromeByModule.get(moduleId);
		if (!chrome) return;
		chrome.ribbonEl?.remove();
		for (const id of chrome.commandIds) options.plugin.removeCommand(id);
		chromeByModule.set(moduleId, {
			ribbonEl: null,
			commandIds: [],
			usesConfigurableShortcut: false,
		});
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
				const chrome: ModuleChrome = {
					ribbonEl: null,
					commandIds: [],
					usesConfigurableShortcut: false,
				};
				chromeByModule.set(moduleId, chrome);
				build({
					ribbon: (icon, title, onClick) => {
						chrome.ribbonEl?.remove();
						chrome.ribbonEl = options.plugin.addRibbonIcon(icon, title, onClick);
					},
					command: (spec) => {
						chrome.commandIds.push(spec.id);
						if (spec.shortcutKey) chrome.usesConfigurableShortcut = true;
						options.plugin.addCommand(
							toObsidianCommand(
								spec.shortcutKey
									? { ...spec, hotkeys: configuredHotkeys(spec.shortcutKey) }
									: spec,
							),
						);
					},
				});
			},

			activateView: (type, activateOptions) =>
				activateView(options.app, type, activateOptions),

			settingsSection: (section) => {
				sectionsById.set(section.id, section);
				sectionOwnerById.set(section.id, moduleId);
			},

			catalog: (entry) => {
				catalogById.set(entry.id, entry);
				catalogOwnerById.set(entry.id, moduleId);
			},

			featureShortcuts: () => featureShortcutsFor(moduleId),
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
				hotkeys: entry.shortcutKey
					? configuredHotkeys(entry.shortcutKey)
					: entry.openHotkeys,
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

	const renderModules = (targets?: ReadonlySet<FeatureSettingsOwner>): boolean => {
		for (const module of modules) {
			if (targets && !targets.has(module.id)) continue;
			try {
				module.render(hostFor(module.id) as never);
			} catch (error) {
				console.error(`Failed to render the ${module.id} workbench module:`, error);
				removeChrome(module.id);
				for (const [sectionId, owner] of sectionOwnerById) {
					if (owner === module.id) {
						sectionsById.delete(sectionId);
						sectionOwnerById.delete(sectionId);
					}
				}
				for (const [entryId, owner] of catalogOwnerById) {
					if (owner === module.id) {
						catalogById.delete(entryId);
						catalogOwnerById.delete(entryId);
					}
				}
			}
		}
		rebuildCatalogCommands();
		const nextSignature = catalogSignature();
		const catalogChanged = nextSignature !== catalogAvailabilitySignature;
		catalogAvailabilitySignature = nextSignature;
		return catalogChanged;
	};

	return {
		refresh: () => {
			if (disposed) return;
			renderModules();
			pushSettingsToOpenViews();
		},

		settingsChanged: (previous, next) => {
			if (disposed) return;
			const languageChanged = previous.language !== next.language;
			const shortcutsChanged =
				JSON.stringify(previous.featureOpenShortcuts) !==
				JSON.stringify(next.featureOpenShortcuts);
			const changedOwners = changedSettingsOwners(previous, next);
			const affected = new Set<FeatureSettingsOwner>();
			for (const module of modules) {
				if (
					languageChanged ||
					changedOwners.has(module.id) ||
					(shortcutsChanged && chromeByModule.get(module.id)?.usesConfigurableShortcut)
				)
					affected.add(module.id);
			}
			if (affected.size > 0) {
				const catalogChanged = renderModules(affected);
				// A changed sibling availability set must reach every open landing page;
				// otherwise only the affected owner's views would repaint.
				if (catalogChanged) pushSettingsToOpenViews();
				else pushSettingsToOpenViews(affected);
			} else if (shortcutsChanged) {
				rebuildCatalogCommands();
			}
		},

		addSettingsSection: (section) => {
			sectionsById.set(section.id, section);
		},

		settingsSections: () => [...sectionsById.values()].sort((a, b) => a.order - b.order),

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
			for (const id of catalogCommandIds) options.plugin.removeCommand(id);
			catalogCommandIds = [];
			hostsByModule.clear();
			sectionsById.clear();
			catalogById.clear();
			sectionOwnerById.clear();
			catalogOwnerById.clear();
			catalogAvailabilitySignature = "";
			shortcutCache = null;
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
	} else if (options?.rightSidebar) {
		leaf = workspace
			.getLeavesOfType(type)
			.find((candidate) => candidate.getRoot() === workspace.rightSplit);
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
			await leaf.setViewState({ type, active: true });
		}
	} else {
		leaf = workspace.getLeavesOfType(type)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
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
