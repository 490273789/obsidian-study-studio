import { vi } from "vite-plus/test";
import type { FlashcardSettings } from "../../shared/types";
import {
	DEFAULT_SETTINGS,
	authorizeSettingsPatch,
	projectSettings,
	type FeatureSettingsOwner,
	type ScopedWorkbenchSettings,
} from "../settingsSlices";
import type {
	WorkbenchCatalogEntry,
	WorkbenchChromeScope,
	WorkbenchCommand,
	WorkbenchHost,
	WorkbenchSettingsSection,
} from "../workbench";

export interface FakeWorkbenchHost<TOwner extends FeatureSettingsOwner> {
	host: WorkbenchHost<TOwner>;
	views: Map<string, unknown>;
	sections: Map<string, WorkbenchSettingsSection>;
	catalog: Map<string, WorkbenchCatalogEntry>;
	ribbons: { icon: string; title: string; onClick: () => void }[];
	commands: WorkbenchCommand[];
	activateView: ReturnType<typeof vi.fn>;
	updateSettings: ReturnType<typeof vi.fn>;
	settingsTab: {
		refresh: ReturnType<typeof vi.fn>;
		select: ReturnType<typeof vi.fn>;
		open: ReturnType<typeof vi.fn>;
	};
	featureShortcuts: ReturnType<typeof vi.fn>;
}

/**
 * Records everything a feature contributes through the workbench seam, so a
 * feature's interface can be asserted without Obsidian or a real workbench.
 */
export function createFakeWorkbenchHost<TOwner extends FeatureSettingsOwner>(
	owner: TOwner,
	overrides: Partial<ScopedWorkbenchSettings<TOwner>> = {},
	app: unknown = { workspace: { getLeavesOfType: () => [] } },
): FakeWorkbenchHost<TOwner> {
	let document = { ...DEFAULT_SETTINGS, ...overrides } as FlashcardSettings;
	const views = new Map<string, unknown>();
	const sections = new Map<string, WorkbenchSettingsSection>();
	const catalog = new Map<string, WorkbenchCatalogEntry>();
	const ribbons: FakeWorkbenchHost<TOwner>["ribbons"] = [];
	const commands: WorkbenchCommand[] = [];
	const activateView = vi.fn().mockResolvedValue(undefined);
	const updateSettings = vi.fn().mockResolvedValue(undefined);
	const setLanguage = vi.fn(async (language: string) => {
		document = { ...document, language } as FlashcardSettings;
	});
	const settingsTab = { refresh: vi.fn(), select: vi.fn(), open: vi.fn() };
	// The fake owns every registered entry, so it cannot model sibling exclusion;
	// feature tests only assert that their own registration reaches the host.
	const featureShortcuts = vi.fn(() => {
		const language = document.language;
		return [...catalog.values()]
			.filter((entry) => entry.available())
			.sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity))
			.map((entry) => ({
				id: entry.id,
				title: entry.title(language),
				icon: entry.icon,
				open: () => entry.open(),
			}));
	});

	const scopedSettings = {
		read: () => projectSettings(owner, document),
		update: updateSettings.mockImplementation(async (patch) => {
			document = { ...document, ...authorizeSettingsPatch(owner, patch) };
		}),
		...(owner === "flashcards"
			? {
					setLanguage,
				}
			: {}),
	};

	const host = {
		app,
		settings: scopedSettings,
		settingsTab,
		registerView: (type: string, factory: unknown) => views.set(type, factory),
		chrome: (build: (scope: WorkbenchChromeScope) => void) => {
			const scoped: WorkbenchChromeScope = {
				ribbon: (icon, title, onClick) => ribbons.push({ icon, title, onClick }),
				command: (spec) => commands.push(spec),
			};
			// Chrome is rebuilt on every render; model that by clearing first.
			ribbons.length = 0;
			commands.length = 0;
			build(scoped);
		},
		activateView,
		settingsSection: (section: WorkbenchSettingsSection) => sections.set(section.id, section),
		catalog: (entry: WorkbenchCatalogEntry) => catalog.set(entry.id, entry),
		featureShortcuts,
	} as unknown as WorkbenchHost<TOwner>;

	return {
		host,
		views,
		sections,
		catalog,
		ribbons,
		commands,
		activateView,
		updateSettings,
		settingsTab,
		featureShortcuts,
	};
}
