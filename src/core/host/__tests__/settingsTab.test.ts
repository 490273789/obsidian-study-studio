import { describe, expect, it, vi } from "vite-plus/test";
import { FlashcardSettingTab } from "../settingsTab";
import { DEFAULT_SETTINGS } from "../settingsSlices";
import { defineSettings } from "../../settings/presentation";
import * as controlRenderer from "../settingsControlRenderer";

class MockElement {
	children: MockElement[] = [];
	classList = new Set<string>();
	listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	attributes: Record<string, string> = {};
	text = "";
	inputEl = this;
	scrollTop = 0;
	scrollLeft = 0;
	scrollIntoView = vi.fn();
	scrollHeight = 1000;
	clientHeight = 500;
	style: Record<string, string> = {};
	ownerDocument?: { activeElement: MockElement | null; body: MockElement };

	getAttribute(name: string) {
		return this.attributes[name] ?? null;
	}
	contains(element: MockElement): boolean {
		return this === element || this.children.some((child) => child.contains(element));
	}
	querySelectorAll(): MockElement[] {
		return this.children.flatMap((child) => [
			...(child.attributes["data-sortable-id"] ? [child] : []),
			...child.querySelectorAll(),
		]);
	}

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

	createEl(_tag: string, options?: { type?: string; text?: string; cls?: string }) {
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
	it("restores the same dictionary handle across busy and saved generations for repeated keyboard sorting", () => {
		const tab = new FlashcardSettingTab({} as never, createMockPlugin() as never);
		const container = tab.containerEl as unknown as MockElement;
		const body = new MockElement();
		const document = { activeElement: body, body };
		container.ownerDocument = document;
		let busy = false;
		const handles: MockElement[] = [];
		const render = vi
			.spyOn(controlRenderer, "renderSettingsControls")
			.mockImplementation((_app, target) => {
				if (!busy) {
					const handle = (target as unknown as MockElement).createEl("button");
					handle.attributes["data-sortable-id"] = "dictionary-a";
					Object.assign(handle, {
						focus: () => {
							document.activeElement = handle;
						},
					});
					handles.push(handle);
				}
				return () => {
					document.activeElement = body;
				};
			});
		try {
			tab.display();
			document.activeElement = handles[0]!;
			for (let attempt = 0; attempt < 2; attempt++) {
				busy = true;
				tab.refresh();
				expect(document.activeElement).toBe(body);
				busy = false;
				tab.refresh();
				expect(document.activeElement).toBe(handles[handles.length - 1]);
			}
		} finally {
			tab.hide();
			render.mockRestore();
		}
	});

	it("releases sorting roots before replacing settings and again when hidden", () => {
		const first = vi.fn();
		const second = vi.fn();
		const render = vi
			.spyOn(controlRenderer, "renderSettingsControls")
			.mockReturnValueOnce(first)
			.mockReturnValueOnce(second);
		try {
			const plugin = createMockPlugin();
			const tab = new FlashcardSettingTab({} as never, plugin as never);
			tab.display();
			expect(first).not.toHaveBeenCalled();
			tab.refresh();
			expect(first).toHaveBeenCalledOnce();
			expect(second).not.toHaveBeenCalled();
			tab.hide();
			tab.hide();
			expect(second).toHaveBeenCalledOnce();
		} finally {
			render.mockRestore();
		}
	});

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

	it("preserves DOM and live actions for unrelated section refreshes, then expires them on a local refresh", async () => {
		const plugin = createMockPlugin();
		const onPress = vi.fn();
		const presentation = vi.fn(() =>
			defineSettings("flashcards", (page) => {
				page.group("general", "Flashcards", (group) => {
					group.button("action", { name: "Action" }, { label: "Run", onPress });
				});
			}),
		);
		plugin.flashcardsSection.presentation = presentation;
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();
		const first = presentation.mock.results[0]!.value;
		const control = first.snapshot.groups[0]!.rows[0]!.controls[0]!;
		if (control.kind !== "button") throw new Error("Expected button");
		const container = tab.containerEl as unknown as MockElement;
		const children = container.children;
		container.scrollTop = 300;

		// A completion from another editor must not detach the current control.
		await Promise.resolve();
		tab.refresh("ai");
		tab.refresh("dictionary");
		expect(presentation).toHaveBeenCalledOnce();
		expect(container.children).toBe(children);
		expect(container.scrollTop).toBe(300);
		expect(await first.invoke({ action: control.action, value: undefined })).toEqual({
			status: "applied",
		});

		tab.refresh("flashcards");
		expect(presentation).toHaveBeenCalledTimes(2);
		expect(container.children).not.toBe(children);
		expect(await first.invoke({ action: control.action, value: undefined })).toEqual({
			status: "ignored",
			reason: "stale",
		});
		expect(onPress).toHaveBeenCalledOnce();
	});

	it("refreshes shared language and navigation changes even for an unrelated source", () => {
		const plugin = createMockPlugin();
		const presentation = vi.spyOn(plugin.flashcardsSection, "presentation");
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.select("flashcards");
		tab.display();
		plugin.settings.language = "en";
		tab.refresh("dictionary");
		expect(presentation).toHaveBeenCalledTimes(2);
		plugin.dictionarySection.label = () => "Dictionary";
		tab.refresh("dictionary");
		expect(presentation).toHaveBeenCalledTimes(3);
		plugin.dictionarySection.order = -1;
		tab.refresh("ai");
		expect(presentation).toHaveBeenCalledTimes(4);
	});

	it("renders a pending section selection even when another section requested refresh", () => {
		const plugin = createMockPlugin();
		const presentation = vi.spyOn(plugin.dictionarySection, "presentation");
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();
		tab.select("dictionary");
		tab.refresh("ai");
		expect(presentation).toHaveBeenCalledOnce();
	});

	it("rebuilds on display after hide even when unrelated refreshes were skipped", () => {
		const plugin = createMockPlugin();
		const presentation = vi.spyOn(plugin.flashcardsSection, "presentation");
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();
		const firstDispose = vi.spyOn(presentation.mock.results[0]!.value, "dispose");
		tab.refresh("ai");
		tab.hide();
		expect(firstDispose).toHaveBeenCalledOnce();
		tab.display();
		expect(presentation).toHaveBeenCalledTimes(2);
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

	it("keeps the section strip's horizontal scroll offset across re-renders", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab({} as never, plugin as never);
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c) => c.classList.has("fc-settings-tab-nav"));
		navEl!.scrollLeft = 96;

		// Rendering replaces the strip; without remembering its offset the active
		// tab would jump back to the left edge on every refresh.
		tab.refresh();

		const nextNavEl = (tab.containerEl as unknown as MockElement).children.find((c) =>
			c.classList.has("fc-settings-tab-nav"),
		);
		expect(nextNavEl?.scrollLeft).toBe(96);
	});

	it("reveals the active tab when a section is opened programmatically", () => {
		const plugin = createMockPlugin();
		const tab = new FlashcardSettingTab(
			{ setting: { open: vi.fn(), openTabById: vi.fn() } } as never,
			plugin as never,
		);

		tab.open("dictionary");
		tab.display();

		const container = tab.containerEl as unknown as MockElement;
		const navEl = container.children.find((c) => c.classList.has("fc-settings-tab-nav"));
		const tabButtons = navEl?.children ?? [];
		expect(tabButtons[3]?.scrollIntoView).toHaveBeenCalledWith({
			block: "nearest",
			inline: "nearest",
		});
		expect(tabButtons[0]?.scrollIntoView).not.toHaveBeenCalled();
	});
});
