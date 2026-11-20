import "../styles/index.scss";
import { Plugin } from "obsidian";
import { createWorkbench, type Workbench } from "./workbench";
import { createAiEngineTesters, createWorkbenchModules } from "../../features";
import { AI_ENGINE_SECTION_ID, createAiEngineSection } from "./aiEngineSection";
import {
	FEATURE_OPEN_SHORTCUT_SECTION_ID,
	createFeatureOpenShortcutSection,
} from "./featureOpenShortcutSection";
import { createObsidianAiService } from "./aiAdapter";
import { normalizeAiSettings } from "../ai/configuration";
import type { AiService } from "../ai";
import { FlashcardSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "./settingsSlices";
import { WorkbenchStore } from "../storage/workbenchStore";
import { FlashcardSettingTab } from "./settingsTab";
import {
	GENERAL_SETTINGS_SECTION_ID,
	createGeneralSettingsSection,
} from "./generalSettingsSection";
import { createOutboundPort, type OutboundPort } from "../net";

/**
 * The composition root: it owns the settings document, its write queue, and the
 * shared services every feature may use. Feature behavior lives in
 * `src/features/`, reached through the workbench seam.
 */
export default class StudyStudioPlugin extends Plugin {
	settings: FlashcardSettings = DEFAULT_SETTINGS;
	store!: WorkbenchStore;
	aiService!: AiService;
	net!: OutboundPort;
	workbench!: Workbench;
	private settingsWriteQueue: Promise<void> = Promise.resolve();

	async onload() {
		this.store = new WorkbenchStore(this);
		this.settings = await this.store.loadSettings();
		this.net = createOutboundPort({ app: this.app, defaultTimeoutMs: 0 });
		this.aiService = createObsidianAiService(this.settings.ai, {
			// AI schedules its entire mutation, including persistence, in this queue.
			queueWrite: this.enqueueSettingsOperation,
			persist: (ai) => this.applySettingsPatch({ ai: normalizeAiSettings(ai) }),
			net: this.net,
			testers: createAiEngineTesters({ net: this.net }),
		});
		this.workbench = createWorkbench({
			app: this.app,
			plugin: this,
			readSettings: () => this.settings,
			commitSettings: this.commitSettings,
			createModules: () =>
				createWorkbenchModules({
					ai: this.aiService,
					store: this.store,
					net: this.net,
					plugin: this,
				}),
		});
		this.workbench.addSettingsSection(
			createGeneralSettingsSection({
				readLanguage: () => this.settings.language,
				updateLanguage: (language) => this.commitSettings({ language }),
				refresh: () => this.workbench.settingsTab.refresh(GENERAL_SETTINGS_SECTION_ID),
			}),
		);
		this.workbench.addSettingsSection(
			createAiEngineSection({
				app: this.app,
				ai: this.aiService,
				refresh: () => this.workbench.settingsTab.refresh(AI_ENGINE_SECTION_ID),
			}),
		);
		this.workbench.addSettingsSection(
			createFeatureOpenShortcutSection({
				read: () => this.settings.featureOpenShortcuts,
				update: (featureOpenShortcuts) => this.commitSettings({ featureOpenShortcuts }),
				refresh: () => this.workbench.settingsTab.refresh(FEATURE_OPEN_SHORTCUT_SECTION_ID),
			}),
		);

		const pluginSettingsTab = new FlashcardSettingTab(this.app, this);
		this.workbench.setSettingsTab(pluginSettingsTab);
		this.addSettingTab(pluginSettingsTab);

		this.workbench.refresh();
	}

	onunload() {
		this.workbench?.dispose();
		this.aiService?.dispose();
	}

	/** Obsidian Sync changed data.json; reload the authoritative document as one transition. */
	async onExternalSettingsChange(): Promise<void> {
		if (!this.store) return;
		await this.enqueueSettingsOperation(async () => {
			try {
				await this.store.reloadExternalSettings();
				const settings = this.store.getSettings();
				this.aiService?.replaceSettings(settings.ai);
				this.publishSettings(settings);
			} catch (error) {
				console.error(
					"Failed to reload externally synchronized StudyStudio settings:",
					error,
				);
			}
		});
	}

	/**
	 * Commits a feature-owned settings patch. The patch is applied to the settings
	 * committed at write time, so a queued write never resurrects a stale slice.
	 */
	private commitSettings = (
		patch: Partial<FlashcardSettings> | (() => Partial<FlashcardSettings>),
	): Promise<void> =>
		this.enqueueSettingsOperation(() =>
			this.applySettingsPatch(typeof patch === "function" ? patch() : patch),
		);

	private async applySettingsPatch(patch: Partial<FlashcardSettings>): Promise<void> {
		const nextSettings = { ...this.settings, ...patch };
		if (JSON.stringify(nextSettings) === JSON.stringify(this.settings)) return;
		await this.store.saveSettings(nextSettings);
		this.publishSettings(nextSettings);
	}

	private enqueueSettingsOperation = (operation: () => Promise<void>): Promise<void> => {
		const pending = this.settingsWriteQueue.then(operation);
		this.settingsWriteQueue = pending.catch(() => undefined);
		return pending;
	};

	private publishSettings(settings: FlashcardSettings): void {
		const previous = this.settings;
		this.settings = settings;
		try {
			this.workbench?.settingsChanged(previous, settings);
		} catch (error) {
			console.error("Failed to route committed settings through the workbench:", error);
		}
	}
}
