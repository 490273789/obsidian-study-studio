import { App, PluginSettingTab } from "obsidian";
import type FlashcardPlugin from "./main";
import type { WorkbenchSettingsSection, WorkbenchSettingsTab } from "./workbench";
import type { Language } from "../shared/types";
import { SettingsPageRenderer } from "./settingsPageRenderer";

interface ObsidianSettingsManager {
	open(): void;
	openTabById(id: string): void;
}

export class FlashcardSettingTab extends PluginSettingTab implements WorkbenchSettingsTab {
	plugin: FlashcardPlugin;
	private activeSectionId = "";
	private renderedSectionId = "";
	private renderedLanguage: Language | null = null;
	private renderedNavigationKey = "";
	private readonly renderer: SettingsPageRenderer;

	constructor(app: App, plugin: FlashcardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.containerEl.addClass("flashcard-settings-tab");
		this.renderer = new SettingsPageRenderer({
			app,
			containerEl: this.containerEl,
			onSelectSection: (sectionId) => {
				this.activeSectionId = sectionId;
				this.renderSettings({ preserveScroll: false });
			},
		});
	}

	select(sectionId: string): void {
		this.activeSectionId = sectionId;
	}

	open(sectionId?: string): void {
		if (sectionId) {
			this.select(sectionId);
			this.renderer.resetSectionScroll(sectionId);
		}
		const settingsManager = (this.app as typeof this.app & { setting: ObsidianSettingsManager })
			.setting;
		settingsManager.open();
		settingsManager.openTabById(this.plugin.manifest.id);
	}

	refresh(sectionId?: string): void {
		if (sectionId && this.renderedSectionId) {
			const sections = this.sections();
			const language = this.getSelectedLanguage();
			const activeSection = this.activeSection();
			if (
				sectionId !== activeSection?.id &&
				this.renderedSectionId === activeSection?.id &&
				this.renderedLanguage === language &&
				this.renderedNavigationKey === this.navigationKey(sections, language)
			) {
				return;
			}
		}
		this.refreshDefinitions();
	}

	display(): void {
		for (const section of this.sections()) section.activate?.();
		this.renderSettings({ preserveScroll: false });
	}

	hide(): void {
		this.renderer.dispose();
		for (const section of this.sections()) section.hide?.();
		super.hide();
	}

	/** The settings tab is a host-owned shell: it renders whatever sections are registered. */
	private sections(): WorkbenchSettingsSection[] {
		return (this.plugin.workbench?.settingsSections() ?? []).sort((a, b) => a.order - b.order);
	}

	private navigationKey(sections: WorkbenchSettingsSection[], language: Language): string {
		return JSON.stringify(
			sections.map((section) => [section.id, section.order, section.label(language)]),
		);
	}

	private activeSection(): WorkbenchSettingsSection | undefined {
		const sections = this.sections();
		return sections.find((section) => section.id === this.activeSectionId) ?? sections[0];
	}

	private getSelectedLanguage(): Language {
		return this.plugin.settings.language === "en" ? "en" : "zh";
	}

	private refreshDefinitions(): void {
		this.renderSettings({ preserveScroll: true });
	}

	private renderSettings(options: { preserveScroll?: boolean } = { preserveScroll: true }): void {
		const sections = this.sections();
		const activeSection = this.activeSection();
		const language = this.getSelectedLanguage();
		const rendered = this.renderer.render({
			sections,
			activeSection,
			language,
			preserveScroll: options.preserveScroll !== false,
		});
		if (!rendered) return;
		this.renderedSectionId = activeSection?.id ?? "";
		this.renderedLanguage = language;
		this.renderedNavigationKey = this.navigationKey(sections, language);
	}
}
