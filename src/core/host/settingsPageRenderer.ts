import type { App } from "obsidian";
import type { Language } from "../shared/types";
import type { SettingsPresentation } from "../settings/presentation";
import type { WorkbenchSettingsSection } from "./workbench";
import { renderSettingsControls } from "./settingsControlRenderer";
import { createSharedTranslator } from "../i18n";

interface SettingsPageRendererOptions {
	readonly app: App;
	readonly containerEl: HTMLElement;
	readonly onSelectSection: (sectionId: string) => void;
}

interface SettingsPageRenderInput {
	/** Final navigation order supplied by the workbench; the renderer preserves it. */
	readonly sections: readonly WorkbenchSettingsSection[];
	readonly activeSection: WorkbenchSettingsSection | undefined;
	readonly language: Language;
	readonly preserveScroll: boolean;
}

/**
 * Owns the settings tab's DOM: navigation strip, control pane, and the
 * scroll/focus/height bookkeeping that a full rebuild would otherwise lose.
 */
export class SettingsPageRenderer {
	private activePresentation: SettingsPresentation | null = null;
	private disposeControls: (() => void) | null = null;
	private navEl: HTMLElement | null = null;
	private sectionSelectEl: HTMLSelectElement | null = null;
	private navScrollLeft = 0;
	private pendingSortFocus: string | null = null;
	private pendingControlFocus: string | null = null;
	private renderedSectionId = "";
	private readonly sectionScrollPositions = new Map<string, number>();

	constructor(private readonly options: SettingsPageRendererOptions) {}

	/** Returns false when the section presentation fails, leaving the installed pane intact. */
	render(input: SettingsPageRenderInput): boolean {
		const { containerEl } = this.options;
		const activeSectionId = input.activeSection?.id ?? "";
		let nextPresentation: SettingsPresentation | null;
		try {
			nextPresentation = input.activeSection?.presentation(input.language) ?? null;
		} catch (error) {
			console.error("Failed to build settings presentation:", error);
			return false;
		}

		const scrollContainer = this.getScrollContainer();
		const targetScrollTop = this.captureScrollTop(
			input.preserveScroll,
			activeSectionId,
			scrollContainer,
		);
		if (activeSectionId) {
			this.sectionScrollPositions.set(activeSectionId, targetScrollTop);
		}

		const prevScrollHeight = containerEl.scrollHeight;
		if (
			input.preserveScroll &&
			containerEl.style &&
			typeof prevScrollHeight === "number" &&
			prevScrollHeight > 0
		) {
			containerEl.style.minHeight = `${prevScrollHeight}px`;
		}

		const focused = containerEl.ownerDocument?.activeElement;
		const selectFocused = Boolean(focused && focused === this.sectionSelectEl);
		const navFocused = Boolean(
			focused && this.navEl && containerEl.contains(focused) && this.navEl.contains(focused),
		);
		if (activeSectionId !== this.renderedSectionId) {
			this.pendingSortFocus = null;
			this.pendingControlFocus = null;
		} else if (focused && containerEl.contains(focused)) {
			this.pendingSortFocus = focused.getAttribute("data-sortable-id");
			this.pendingControlFocus = focused.getAttribute("data-settings-focus");
		} else if (focused && focused !== containerEl.ownerDocument.body) {
			this.pendingSortFocus = null;
			this.pendingControlFocus = null;
		}
		const sectionChanged = activeSectionId !== this.renderedSectionId;
		this.rememberNavScroll();
		this.activePresentation?.dispose();
		this.disposeControls?.();
		this.disposeControls = null;
		containerEl.empty();
		containerEl.addClass("flashcard-settings-tab");
		this.activePresentation = nextPresentation;

		this.renderedSectionId = activeSectionId;
		const layoutEl = containerEl.createDiv({ cls: "fc-settings-layout" });
		const t = createSharedTranslator(input.language);
		const compactNav = layoutEl.createDiv({ cls: "fc-settings-compact-nav" });
		compactNav.createEl("label", {
			text: t("settings.navigation"),
			attr: { for: "fc-settings-section-select" },
		});
		const sectionSelect = compactNav.createEl("select", {
			cls: "dropdown fc-settings-section-select",
		});
		sectionSelect.setAttribute("id", "fc-settings-section-select");
		sectionSelect.setAttribute("aria-label", t("settings.navigation"));
		const selectSection = (id: string) => {
			if (input.activeSection?.id === id) return;
			const currentScroll = this.getScrollContainer().scrollTop;
			if (activeSectionId)
				this.sectionScrollPositions.set(activeSectionId, currentScroll || 0);
			this.options.onSelectSection(id);
		};
		sectionSelect.addEventListener("change", () => selectSection(sectionSelect.value));
		this.sectionSelectEl = sectionSelect;
		const navEl = layoutEl.createDiv({ cls: "fc-settings-tab-nav" });
		navEl.setAttribute?.("role", "tablist");
		navEl.setAttribute?.("aria-orientation", "vertical");
		navEl.setAttribute?.(
			"aria-label",
			input.language === "zh" ? "设置模块导航" : "Settings sections navigation",
		);
		let activeTabEl: HTMLButtonElement | null = null;
		const tabButtons: HTMLButtonElement[] = [];

		let previousCategory: WorkbenchSettingsSection["category"];
		let optionParent: HTMLElement = sectionSelect;
		for (const section of input.sections) {
			if (section.category && section.category !== previousCategory) {
				const categoryLabel = t(`settings.category.${section.category}`);
				navEl
					.createDiv({ cls: "fc-settings-nav-category", text: categoryLabel })
					.setAttribute("role", "presentation");
				optionParent = sectionSelect.createEl("optgroup", {
					attr: { label: categoryLabel },
				});
			} else if (!section.category) optionParent = sectionSelect;
			previousCategory = section.category;
			optionParent.createEl("option", {
				value: section.id,
				text: section.label(input.language),
			});
			const isActive = input.activeSection?.id === section.id;
			const tabBtn = navEl.createEl("button", {
				type: "button",
				text: section.label(input.language),
				cls: `fc-settings-tab-btn ${isActive ? "is-active" : ""}`,
			});
			tabBtn.setAttribute?.("role", "tab");
			tabBtn.setAttribute?.("id", `fc-settings-tab-${section.id}`);
			tabBtn.setAttribute?.("aria-selected", isActive ? "true" : "false");
			tabBtn.setAttribute?.("aria-controls", `fc-settings-panel-${section.id}`);
			tabBtn.tabIndex = isActive ? 0 : -1;
			tabButtons.push(tabBtn);

			if (isActive) activeTabEl = tabBtn;
			tabBtn.addEventListener("click", () => {
				selectSection(section.id);
			});

			tabBtn.addEventListener("keydown", (event: KeyboardEvent) => {
				let targetIndex = -1;
				const currentIndex = tabButtons.indexOf(tabBtn);
				if (event.key === "ArrowRight" || event.key === "ArrowDown") {
					event.preventDefault();
					targetIndex = (currentIndex + 1) % tabButtons.length;
				} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
					event.preventDefault();
					targetIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
				} else if (event.key === "Home") {
					event.preventDefault();
					targetIndex = 0;
				} else if (event.key === "End") {
					event.preventDefault();
					targetIndex = tabButtons.length - 1;
				}
				if (targetIndex >= 0 && targetIndex !== currentIndex) {
					const targetBtn = tabButtons[targetIndex];
					targetBtn?.focus();
					targetBtn?.click();
				}
			});
		}

		sectionSelect.value = activeSectionId;
		this.navEl = navEl;
		navEl.scrollLeft = this.navScrollLeft;

		const contentEl = layoutEl.createDiv({ cls: "fc-settings-tab-content" });
		contentEl.setAttribute?.("role", "tabpanel");
		if (activeSectionId) {
			contentEl.setAttribute?.("id", `fc-settings-panel-${activeSectionId}`);
			contentEl.setAttribute?.("aria-labelledby", `fc-settings-tab-${activeSectionId}`);
		}

		if (input.activeSection)
			contentEl.createEl("h2", {
				cls: "fc-settings-page-title",
				text: input.activeSection.label(input.language),
			});
		if (nextPresentation) {
			this.disposeControls = renderSettingsControls(
				this.options.app,
				contentEl,
				nextPresentation,
				input.language,
				{ redundantHeading: input.activeSection?.label(input.language) },
			);
		}
		if (this.pendingSortFocus) {
			const handle = Array.from(
				contentEl.querySelectorAll<HTMLButtonElement>("button[data-sortable-id]"),
			).find((button) => button.getAttribute("data-sortable-id") === this.pendingSortFocus);
			if (handle) {
				handle.focus({ preventScroll: true });
				this.pendingSortFocus = null;
			}
		}
		if (this.pendingControlFocus) {
			const control = Array.from(
				contentEl.querySelectorAll<HTMLInputElement>("[data-settings-focus]"),
			).find(
				(element) =>
					element.getAttribute("data-settings-focus") === this.pendingControlFocus &&
					!element.disabled,
			);
			if (control) {
				control.focus({ preventScroll: true });
				this.pendingControlFocus = null;
			}
		}

		if (sectionChanged) this.revealActiveTab(activeTabEl);
		if (selectFocused) sectionSelect.focus({ preventScroll: true });
		if (navFocused) {
			activeTabEl?.focus({ preventScroll: true });
		}
		this.restoreScroll(targetScrollTop);

		if (input.preserveScroll && containerEl.style) {
			containerEl.style.minHeight = "";
		}
		return true;
	}

	/** Releases the installed presentation and controls; a later render may install a new pane. */
	dispose(): void {
		this.activePresentation?.dispose();
		this.activePresentation = null;
		this.disposeControls?.();
		this.disposeControls = null;
		this.pendingSortFocus = null;
		this.pendingControlFocus = null;
		this.navEl = null;
		this.sectionSelectEl = null;
	}

	/** Forget a section's remembered scroll offset, e.g. when it is opened programmatically. */
	resetSectionScroll(sectionId: string): void {
		this.sectionScrollPositions.set(sectionId, 0);
	}

	private captureScrollTop(
		preserveScroll: boolean,
		activeSectionId: string,
		scrollContainer: HTMLElement,
	): number {
		return preserveScroll
			? typeof scrollContainer.scrollTop === "number" && scrollContainer.scrollTop > 0
				? scrollContainer.scrollTop
				: (this.sectionScrollPositions.get(activeSectionId) ?? 0)
			: (this.sectionScrollPositions.get(activeSectionId) ?? 0);
	}

	private getScrollContainer(): HTMLElement {
		const { containerEl } = this.options;
		let current: HTMLElement | null = containerEl;
		while (current) {
			if (typeof current.scrollTop === "number" && current.scrollTop > 0) {
				return current;
			}
			current = current.parentElement;
		}
		const doc =
			containerEl.ownerDocument ?? (typeof document !== "undefined" ? document : null);
		current = containerEl;
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
		return containerEl;
	}

	private restoreScroll(targetScrollTop: number): void {
		const { containerEl } = this.options;
		const container = this.getScrollContainer();
		container.scrollTop = targetScrollTop;
		if (containerEl !== container && typeof containerEl.scrollTop === "number") {
			containerEl.scrollTop = targetScrollTop;
		}

		const win =
			containerEl.ownerDocument?.defaultView ??
			(typeof window !== "undefined" ? window : null);
		if (win && typeof win.requestAnimationFrame === "function") {
			win.requestAnimationFrame(() => {
				container.scrollTop = targetScrollTop;
				if (containerEl !== container && typeof containerEl.scrollTop === "number") {
					containerEl.scrollTop = targetScrollTop;
				}
			});
		}
	}

	/** The section strip is its own horizontal scroller, so remember its offset across re-renders. */
	private rememberNavScroll(): void {
		const scrollLeft = this.navEl?.scrollLeft;
		if (typeof scrollLeft === "number") this.navScrollLeft = scrollLeft;
	}

	private revealActiveTab(activeTabEl: HTMLElement | null): void {
		activeTabEl?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}
}
