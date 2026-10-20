import { App, PluginSettingTab } from "obsidian";
import type FlashcardPlugin from "./main";
import type { WorkbenchSettingsSection, WorkbenchSettingsTab } from "./workbench";
import type { SettingsPresentation } from "../settings/presentation";
import { renderSettingsControls } from "./settingsControlRenderer";
import type { Language } from "../shared/types";

interface ObsidianSettingsManager {
	open(): void;
	openTabById(id: string): void;
}

export class FlashcardSettingTab extends PluginSettingTab implements WorkbenchSettingsTab {
	plugin: FlashcardPlugin;
	private activeSectionId = "";
	private sectionScrollPositions = new Map<string, number>();
	private activePresentation: SettingsPresentation | null = null;
	private disposeControls: (() => void) | null = null;
	private navEl: HTMLElement | null = null;
	private navScrollLeft = 0;
	private pendingSortFocus: string | null = null;
	private renderedSectionId = "";
	private renderedLanguage: Language | null = null;
	private renderedNavigationKey = "";

	constructor(app: App, plugin: FlashcardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.containerEl.addClass("flashcard-settings-tab");
	}

	select(sectionId: string): void {
		this.activeSectionId = sectionId;
	}

	open(sectionId?: string): void {
		if (sectionId) {
			this.select(sectionId);
			this.sectionScrollPositions.set(sectionId, 0);
		}
		const settingsManager = (this.app as typeof this.app & { setting: ObsidianSettingsManager })
			.setting;
		settingsManager.open();
		settingsManager.openTabById(this.plugin.manifest.id);
	}

	refresh(sectionId?: string): void {
		if (sectionId && this.activePresentation) {
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
		this.activePresentation?.dispose();
		this.activePresentation = null;
		this.disposeControls?.();
		this.disposeControls = null;
		this.pendingSortFocus = null;
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

	private getScrollContainer(): HTMLElement {
		let current: HTMLElement | null = this.containerEl;
		while (current) {
			if (typeof current.scrollTop === "number" && current.scrollTop > 0) {
				return current;
			}
			current = current.parentElement;
		}
		const doc =
			this.containerEl.ownerDocument ?? (typeof document !== "undefined" ? document : null);
		current = this.containerEl;
		while (current && current !== doc?.body) {
			try {
				const style =
					current.style?.overflowY ||
					(typeof window !== "undefined" && window.getComputedStyle
						? window.getComputedStyle(current)?.overflowY
						: "");
				if (style === "auto" || style === "scroll") {
					return current;
				}
			} catch {
				// Ignore environments where window or getComputedStyle is unsupported
			}
			current = current.parentElement;
		}
		return this.containerEl;
	}

	private restoreScroll(targetScrollTop: number): void {
		const container = this.getScrollContainer();
		container.scrollTop = targetScrollTop;
		if (this.containerEl !== container && typeof this.containerEl.scrollTop === "number") {
			this.containerEl.scrollTop = targetScrollTop;
		}

		const win =
			this.containerEl.ownerDocument?.defaultView ??
			(typeof window !== "undefined" ? window : null);
		if (win && typeof win.requestAnimationFrame === "function") {
			win.requestAnimationFrame(() => {
				container.scrollTop = targetScrollTop;
				if (
					this.containerEl !== container &&
					typeof this.containerEl.scrollTop === "number"
				) {
					this.containerEl.scrollTop = targetScrollTop;
				}
			});
		}
	}

	private refreshDefinitions(): void {
		this.renderSettings({ preserveScroll: true });
	}

	/** The section strip is its own horizontal scroller, so remember its offset across re-renders. */
	private rememberNavScroll(): void {
		const scrollLeft = this.navEl?.scrollLeft;
		if (typeof scrollLeft === "number") this.navScrollLeft = scrollLeft;
	}

	/** Keep the active section's tab visible when the strip overflows. */
	private revealActiveTab(activeTabEl: HTMLElement | null): void {
		activeTabEl?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}

	private renderSettings(options: { preserveScroll?: boolean } = { preserveScroll: true }): void {
		const { containerEl } = this;
		const activeSection = this.activeSection();
		const activeSectionId = activeSection?.id ?? "";
		const scrollContainer = this.getScrollContainer();
		const language = this.getSelectedLanguage();
		let nextPresentation: SettingsPresentation | null = null;
		try {
			nextPresentation = activeSection?.presentation(language) ?? null;
		} catch (error) {
			console.error("Failed to build settings presentation:", error);
			return;
		}

		const shouldPreserve = options.preserveScroll !== false;
		const targetScrollTop = shouldPreserve
			? typeof scrollContainer.scrollTop === "number" && scrollContainer.scrollTop > 0
				? scrollContainer.scrollTop
				: (this.sectionScrollPositions.get(activeSectionId) ?? 0)
			: (this.sectionScrollPositions.get(activeSectionId) ?? 0);

		if (activeSectionId) {
			this.sectionScrollPositions.set(activeSectionId, targetScrollTop);
		}

		const prevScrollHeight = containerEl.scrollHeight;
		if (
			shouldPreserve &&
			containerEl.style &&
			typeof prevScrollHeight === "number" &&
			prevScrollHeight > 0
		) {
			containerEl.style.minHeight = `${prevScrollHeight}px`;
		}

		const focused = containerEl.ownerDocument?.activeElement;
		if (activeSectionId !== this.renderedSectionId) this.pendingSortFocus = null;
		else if (focused && containerEl.contains(focused)) {
			this.pendingSortFocus = focused.getAttribute("data-sortable-id");
		} else if (focused && focused !== containerEl.ownerDocument.body) {
			this.pendingSortFocus = null;
		}
		const sectionChanged = activeSectionId !== this.renderedSectionId;
		this.rememberNavScroll();
		this.activePresentation?.dispose();
		this.disposeControls?.();
		this.disposeControls = null;
		containerEl.empty();
		containerEl.addClass("flashcard-settings-tab");
		this.activePresentation = nextPresentation;

		const sections = this.sections();
		this.renderedSectionId = activeSectionId;
		this.renderedLanguage = language;
		this.renderedNavigationKey = this.navigationKey(sections, language);
		const navEl = containerEl.createDiv({ cls: "fc-settings-tab-nav" });
		let activeTabEl: HTMLButtonElement | null = null;

		for (const section of sections) {
			const tabBtn = navEl.createEl("button", {
				type: "button",
				text: section.label(language),
				cls: `fc-settings-tab-btn ${activeSection?.id === section.id ? "is-active" : ""}`,
			});
			if (section.id === activeSection?.id) activeTabEl = tabBtn;
			tabBtn.addEventListener("click", () => {
				if (this.activeSectionId !== section.id) {
					if (activeSectionId) {
						const currentScroll = this.getScrollContainer().scrollTop;
						this.sectionScrollPositions.set(
							activeSectionId,
							typeof currentScroll === "number" ? currentScroll : 0,
						);
					}
					this.activeSectionId = section.id;
					this.renderSettings({ preserveScroll: false });
				}
			});
		}

		this.navEl = navEl;
		navEl.scrollLeft = this.navScrollLeft;

		const contentEl = containerEl.createDiv({ cls: "fc-settings-tab-content" });

		if (nextPresentation)
			this.disposeControls = renderSettingsControls(
				this.app,
				contentEl,
				nextPresentation,
				language,
			);
		if (this.pendingSortFocus) {
			const handle = Array.from(
				contentEl.querySelectorAll<HTMLButtonElement>("button[data-sortable-id]"),
			).find((button) => button.getAttribute("data-sortable-id") === this.pendingSortFocus);
			if (handle) {
				handle.focus({ preventScroll: true });
				this.pendingSortFocus = null;
			}
		}

		if (sectionChanged) this.revealActiveTab(activeTabEl);
		this.restoreScroll(targetScrollTop);

		if (shouldPreserve && containerEl.style) {
			containerEl.style.minHeight = "";
		}
	}
}
