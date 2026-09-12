import { vi } from "vitest";
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
	openFeature: ReturnType<typeof vi.fn>;
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
	const openFeature = vi.fn((featureId: string) => {
		const entry = catalog.get(featureId);
		if (entry?.available()) {
			entry.open();
		} else if (entry) {
			settingsTab.open(entry.settingsSectionId);
		}
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
		openFeature,
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
		openFeature,
	};
}
