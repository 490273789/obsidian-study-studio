import { describe, expect, it, vi } from "vitest";
import { FlashcardSettingTab } from "../settingsTab";
import { DEFAULT_SETTINGS } from "../settingsSlices";
import { defineSettings } from "../../settings/presentation";

class MockElement {
	children: MockElement[] = [];
	classList = new Set<string>();
	listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	attributes: Record<string, string> = {};
	text = "";
	inputEl = this;
	scrollTop = 0;
	scrollHeight = 1000;
	clientHeight = 500;
	style: Record<string, string> = {};

	setPlaceholder() {
		return this;
	}
	setValue() {
		return this;
	}
	setDisabled() {
		return this;
	}
	getValue() {
		return "";
	}

	addClass(cls: string) {
		this.classList.add(cls);
		return this;
	}

	empty() {
		this.children = [];
		return this;
	}

	createDiv(options?: { cls?: string; text?: string }) {
		const div = new MockElement();
		if (options?.cls) div.classList.add(options.cls);
		if (options?.text) div.text = options.text;
		this.children.push(div);
		return div;
	}

	createEl(tag: string, options?: { type?: string; text?: string; cls?: string }) {
		const el = new MockElement();
		if (options?.cls) {
			for (const c of options.cls.split(" ")) {
				if (c) el.classList.add(c);
			}
		}
		if (options?.text) el.text = options.text;
		if (options?.type) el.attributes.type = options.type;
		this.children.push(el);
		return el;
	}

	createSpan(options?: { text?: string; cls?: string }) {
		return this.createEl("span", options);
	}

	addEventListener(event: string, fn: (...args: unknown[]) => void) {
		this.listeners[event] = this.listeners[event] || [];
		this.listeners[event]!.push(fn);
	}

	click() {
		for (const fn of this.listeners.click ?? []) {
			fn();
		}
	}

	isShown() {
		return true;
	}
}

vi.mock("obsidian", () => ({
	Platform: { isDesktopApp: false },
	PluginSettingTab: class {
		containerEl = new MockElement();
		app: unknown;
		plugin: unknown;
		constructor(app: unknown, plugin: unknown) {
			this.app = app;
			this.plugin = plugin;
		}
		hide() {}
	},
	Setting: class {
		descEl = new MockElement();
		controlEl = new MockElement();
		constructor(public parent: MockElement) {
			parent.children.push(this as unknown as MockElement);
		}
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			return this;
		}
		addButton() {
			return this;
		}
		addDropdown() {
			return this;
		}
		addSlider() {
			return this;
		}
		addText() {
			return this;
		}

		addTextArea(cb?: (text: MockElement) => void) {
			cb?.(new MockElement());
			return this;
		}
		addToggle() {
			return this;
		}
	},
	SecretComponent: class {
		constructor() {}
		setValue() {
			return this;
		}
		setDisabled() {
			return this;
		}
		onChange() {
			return this;
		}
	},
	Modal: class {
		contentEl = new MockElement();
		titleEl = new MockElement();
		constructor(public app: unknown) {}
		open() {}
		close() {}
	},
	Notice: vi.fn(),
}));

(globalThis as unknown as { activeDocument: unknown }).activeDocument = {
	createDocumentFragment: () => new MockElement(),
};

describe("FlashcardSettingTab", () => {
	/**
	 * The settings tab renders whatever sections are registered. The AI and
	 * dictionary sections here stand in for the ones the composition root and the
	 * dictionary feature contribute in production.
	 */
	function createMockPlugin() {
		const presentation = (id: string, heading?: string, name?: string) =>
			defineSettings(id, (page) => {
				if (!heading || !name) return;
				page.group("general", heading, (group) => group.row("row", { name }));
			});
		const flashcardsSection = {
			id: "flashcards",
			order: 0,
			label: () => "闪卡设置",
			presentation: () => presentation("flashcards", "闪卡设置", "每日新卡"),
			activate: vi.fn(),
			hide: vi.fn(),
		};
		const aiSection = {
			id: "ai",
			order: 1,
			label: () => "AI 引擎设置",
			presentation: () => presentation("ai"),
			activate: vi.fn(),
			hide: vi.fn(),
		};
		const translationSection = {
			id: "translation",
			order: 2,
			label: () => "AI 翻译",
			// One group with one row is enough to prove the pane is not blank.
			presentation: () => presentation("translation", "AI 翻译", "翻译方向"),
			activate: vi.fn(),
			hide: vi.fn(),
		};
		const dictionarySection = {
			id: "dictionary",
			order: 3,
			label: () => "英语字典",
			presentation: () => presentation("dictionary"),
			activate: vi.fn(),
			hide: vi.fn(),
		};
		return {
			manifest: { id: "obsidian-study-studio" },
			settings: { ...DEFAULT_SETTINGS },
			store: {
				hasAvailableTagsSnapshot: () => true,
				getAvailableTags: () => ["#tag1", "#tag2"],
			},
			pronunciationRuntime: {
				subscribe: vi.fn(() => () => {}),
				getSnapshot: () => ({
					revision: 0,
					settings: { ...DEFAULT_SETTINGS.pronunciation },
					management: "idle",
					hasLocalEnglishVoice: false,
					voicesLoaded: true,
					speakingText: null,
					cacheUsage: { status: "ready", bytes: 0 },
				}),
				refreshCacheUsage: vi.fn(),
			},
			aiService: {
				subscribe: vi.fn(() => () => {}),
				getSnapshot: () => ({
					settings: {
						configs: [],
						defaultConfigId: null,
					},
					loadingModels: [],
					testing: [],
				}),
			},
			translationRuntime: {
				subscribe: vi.fn(() => () => {}),
				getSnapshot: () => ({
					settings: { ...DEFAULT_SETTINGS.translation },
					input: "",
					results: [],
					status: "idle",
					saving: false,
					testing: false,
				}),
			},
			workbench: {
				settingsSections: () => [
					flashcardsSection,
					aiSection,
					translationSection,
					dictionarySection,
				],
			},
			flashcardsSection,
			aiSection,
			translationSection,
			dictionarySection,
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
	}

	it("renders navigation bar with Flashcard, AI, and Translation tabs and defaults to Flashcard settings", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-nav"),
		);
		expect(navEl).toBeDefined();

		const tabButtons =
			navEl?.children.filter((c: MockElement) => c.classList.has("fc-settings-tab-btn")) ??
			[];
		expect(tabButtons.length).toBe(4);
		expect(tabButtons[0]?.text).toBe("闪卡设置");
		expect(tabButtons[0]?.classList.has("is-active")).toBe(true);
		expect(tabButtons[1]?.text).toBe("AI 引擎设置");
		expect(tabButtons[1]?.classList.has("is-active")).toBe(false);
		expect(tabButtons[2]?.text).toContain("翻译");
		expect(tabButtons[3]?.text).toBe("英语字典");

		const contentEl = container.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-content"),
		);
		expect(contentEl).toBeDefined();
	});

	it("renders translation settings without an empty content pane", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();
		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c) => c.classList.has("fc-settings-tab-nav"));
		navEl?.children[2]?.click();
		const contentEl = (tab.containerEl as unknown as MockElement).children.find((c) =>
			c.classList.has("fc-settings-tab-content"),
		);
		expect(contentEl).toBeDefined();
		expect(contentEl?.children.length).toBeGreaterThan(0);
	});

	it("switches to AI settings tab when clicked", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-nav"),
		);
		const aiTabBtn = navEl?.children[1];
		expect(aiTabBtn?.text).toBe("AI 引擎设置");

		aiTabBtn?.click();

		const newContainer = tab.containerEl as unknown as MockElement;
		const newNavEl = newContainer.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-nav"),
		);
		const newButtons = newNavEl?.children ?? [];
		expect(newButtons[0]?.classList.has("is-active")).toBe(false);
		expect(newButtons[1]?.classList.has("is-active")).toBe(true);

		const contentEl = newContainer.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-content"),
		);
		expect(contentEl).toBeDefined();
	});

	it("activates every registered section on display and hides them again", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		// Regression: an editor that owns live-refresh subscriptions is useless
		// unless the tab activates its section; the tab must treat every registered
		// section the same instead of naming editors one by one.
		expect(plugin.flashcardsSection.activate).toHaveBeenCalledTimes(1);
		expect(plugin.aiSection.activate).toHaveBeenCalledTimes(1);
		expect(plugin.dictionarySection.activate).toHaveBeenCalledTimes(1);

		tab.hide();
		expect(plugin.flashcardsSection.hide).toHaveBeenCalledTimes(1);
		expect(plugin.aiSection.hide).toHaveBeenCalledTimes(1);
		expect(plugin.dictionarySection.hide).toHaveBeenCalledTimes(1);
	});

	it("opens the plugin settings at a requested section", () => {
		const plugin = createMockPlugin();
		const open = vi.fn();
		const openTabById = vi.fn();
		const tab = new FlashcardSettingTab(
			{ setting: { open, openTabById } } as never,
			plugin as never,
		);

		tab.open("dictionary");
		expect(open).toHaveBeenCalledTimes(1);
		expect(openTabById).toHaveBeenCalledWith("obsidian-study-studio");

		tab.display();
		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c: MockElement) =>
			c.classList.has("fc-settings-tab-nav"),
		);
		const tabButtons =
			navEl?.children.filter((c: MockElement) => c.classList.has("fc-settings-tab-btn")) ??
			[];
		expect(tabButtons[3]?.classList.has("is-active")).toBe(true);
	});

	it("preserves scroll position when settings change/refresh instead of auto-scrolling to top", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		// Simulate user scrolling down 300px
		container.scrollTop = 300;

		// Trigger settings tab refresh (as happens when any setting changes)
		tab.refresh();

		// The scroll position must be preserved rather than reset to 0
		expect(container.scrollTop).toBe(300);
	});

	it("disposes replaced generations and preserves the installed pane when rebuilding fails", () => {
		const plugin = createMockPlugin();
		const first = defineSettings("flashcards", (page) => {
			page.group("general", "Flashcards", (group) => group.row("row", { name: "First" }));
		});
		const firstDispose = vi.spyOn(first, "dispose");
		plugin.flashcardsSection.presentation = vi.fn(() => first);
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();
		const contentBeforeFailure = (tab.containerEl as unknown as MockElement).children.find(
			(child) => child.classList.has("fc-settings-tab-content"),
		);

		plugin.flashcardsSection.presentation = vi.fn(() => {
			throw new Error("invalid definition");
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		tab.refresh();
		expect(firstDispose).not.toHaveBeenCalled();
		expect((tab.containerEl as unknown as MockElement).children).toContain(
			contentBeforeFailure,
		);

		const replacement = defineSettings("flashcards", () => undefined);
		plugin.flashcardsSection.presentation = vi.fn(() => replacement);
		tab.refresh();
		expect(firstDispose).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});

	it("isolates scroll position across different sections and restores previous section scroll", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		container.scrollTop = 400;

		// Switch to AI tab
		const navEl = container.children.find((c) => c.classList.has("fc-settings-tab-nav"));
		const aiTabBtn = navEl?.children[1];
		aiTabBtn?.click();

		// New section should start at top
		expect(container.scrollTop).toBe(0);

		// Scroll in AI tab and refresh
		container.scrollTop = 150;
		tab.refresh();
		expect(container.scrollTop).toBe(150);

		// Switch back to flashcards tab
		const updatedNavEl = container.children.find((c) => c.classList.has("fc-settings-tab-nav"));
		const flashcardTabBtn = updatedNavEl?.children[0];
		flashcardTabBtn?.click();

		// Should restore the previously recorded 400px scroll for flashcards
		expect(container.scrollTop).toBe(400);
	});
});
