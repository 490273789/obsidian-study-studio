import type { App } from "obsidian";
import type { Language } from "../shared/types";
import type { SettingsPresentation } from "../settings/presentation";
import type { WorkbenchSettingsSection } from "./workbench";
import { renderSettingsControls } from "./settingsControlRenderer";

export interface SettingsPageRendererOptions {
	readonly app: App;
	readonly containerEl: HTMLElement;
	readonly onSelectSection: (sectionId: string) => void;
}

export interface SettingsPageRenderInput {
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
	private navScrollLeft = 0;
	private pendingSortFocus: string | null = null;
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

		this.renderedSectionId = activeSectionId;
		const navEl = containerEl.createDiv({ cls: "fc-settings-tab-nav" });
		let activeTabEl: HTMLButtonElement | null = null;

		for (const section of input.sections) {
			const tabBtn = navEl.createEl("button", {
				type: "button",
				text: section.label(input.language),
				cls: `fc-settings-tab-btn ${input.activeSection?.id === section.id ? "is-active" : ""}`,
			});
			if (section.id === input.activeSection?.id) activeTabEl = tabBtn;
			tabBtn.addEventListener("click", () => {
				if (input.activeSection?.id === section.id) return;
				const currentScroll = this.getScrollContainer().scrollTop;
				if (activeSectionId) {
					this.sectionScrollPositions.set(
						activeSectionId,
						typeof currentScroll === "number" ? currentScroll : 0,
					);
				}
				this.options.onSelectSection(section.id);
			});
		}

		this.navEl = navEl;
		navEl.scrollLeft = this.navScrollLeft;

		const contentEl = containerEl.createDiv({ cls: "fc-settings-tab-content" });

		if (nextPresentation) {
			this.disposeControls = renderSettingsControls(
				this.options.app,
				contentEl,
				nextPresentation,
				input.language,
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

		if (sectionChanged) this.revealActiveTab(activeTabEl);
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
		this.navEl = null;
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
