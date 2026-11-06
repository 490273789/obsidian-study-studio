import { describe, expect, it, vi } from "vite-plus/test";
import { defineSettings } from "../../settings/presentation";
import type { WorkbenchSettingsSection } from "../workbench";
import { SettingsPageRenderer } from "../settingsPageRenderer";

class MockElement {
	children: MockElement[] = [];
	classList = new Set<string>();
	listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	attributes: Record<string, string> = {};
	text = "";
	value = "";
	scrollTop = 0;
	scrollLeft = 0;
	scrollIntoView = vi.fn();
	scrollHeight = 1000;
	style: Record<string, string> = {};
	focus = vi.fn();
	ownerDocument?: { activeElement: MockElement | null; body: MockElement };

	getAttribute(name: string) {
		return this.attributes[name] ?? null;
	}
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	contains(element: MockElement): boolean {
		return this === element || this.children.some((child) => child.contains(element));
	}
	querySelectorAll(selector?: string): MockElement[] {
		if (selector === ".fc-settings-tab-btn") {
			return this.children.filter((child) => child.classList.has("fc-settings-tab-btn"));
		}
		return this.children.flatMap((child) => [
			...(child.attributes["data-sortable-id"] ? [child] : []),
			...child.querySelectorAll(selector),
		]);
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
			for (const cls of options.cls.split(" ")) if (cls) el.classList.add(cls);
		}
		if (options?.text) el.text = options.text;
		this.children.push(el);
		return el;
	}
	addEventListener(event: string, fn: (...args: unknown[]) => void) {
		(this.listeners[event] ??= []).push(fn);
	}
	emit(event: string, ...args: unknown[]) {
		for (const fn of this.listeners[event] ?? []) fn(...args);
	}
	click() {
		for (const fn of this.listeners.click ?? []) fn();
	}
}

const controls = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../settingsControlRenderer", () => ({ renderSettingsControls: controls.render }));

function presentation() {
	return defineSettings("flashcards", (page) => {
		page.group("general", "General", (group) =>
			group.button("action", { name: "Action" }, { label: "Run", onPress: vi.fn() }),
		);
	});
}

function section(
	id: string,
	order: number,
	build: () => ReturnType<typeof presentation> = presentation,
): WorkbenchSettingsSection {
	return {
		id,
		order,
		label: () => id,
		presentation: vi.fn(build),
		activate: vi.fn(),
		hide: vi.fn(),
	};
}

function setup() {
	const container = new MockElement();
	const body = new MockElement();
	const handles: MockElement[] = [];
	container.ownerDocument = { activeElement: null, body };
	const disposeControls = vi.fn();
	controls.render.mockImplementation((_app: unknown, target: MockElement) => {
		const handle = target.createEl("button");
		handle.attributes["data-sortable-id"] = "deck-a";
		handles.push(handle);
		return disposeControls;
	});
	let activeSection = section("flashcards", 0);
	const sections = [activeSection, section("ai", 1)];
	const onSelectSection = vi.fn((id: string) => {
		activeSection = sections.find((candidate) => candidate.id === id)!;
		render({
			preserveScroll: false,
			activeSection,
		});
	});
	const renderer = new SettingsPageRenderer({
		app: {} as never,
		containerEl: container as unknown as HTMLElement,
		onSelectSection,
	});
	const render = ({
		preserveScroll = true,
		activeSection: active = activeSection,
	}: { preserveScroll?: boolean; activeSection?: WorkbenchSettingsSection } = {}) =>
		renderer.render({
			sections,
			activeSection: active,
			language: "zh",
			preserveScroll,
		});
	return { container, sections, renderer, render, onSelectSection, handles, disposeControls };
}

function navigation(container: MockElement): MockElement {
	const nav = container.children[0]!.children.find((child) =>
		child.classList.has("fc-settings-tab-nav"),
	);
	if (!nav) throw new Error("Expected navigation strip");
	return nav;
}

function content(container: MockElement): MockElement {
	const pane = container.children[0]!.children.find((child) =>
		child.classList.has("fc-settings-tab-content"),
	);
	if (!pane) throw new Error("Expected content pane");
	return pane;
}

describe("SettingsPageRenderer", () => {
	it("offers every section in a compact selector and keeps keyboard focus after selection", () => {
		const { container, render, onSelectSection } = setup();
		render();
		const selector = container.children[0]!.children[0]!.children[1]!;
		expect(selector.getAttribute("aria-label")).toBe("设置分类");
		expect(selector.children.map((option) => option.text)).toEqual(["flashcards", "ai"]);
		container.ownerDocument!.activeElement = selector;
		selector.value = "ai";
		selector.emit("change");
		expect(onSelectSection).toHaveBeenCalledWith("ai");
		const nextSelector = container.children[0]!.children[0]!.children[1]!;
		expect(nextSelector.value).toBe("ai");
		expect(nextSelector.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("renders groups in the supplied host order without reapplying category priorities", () => {
		const { container, sections, render } = setup();
		sections[0]!.category = "learning";
		sections[1]!.category = "general";
		render();
		const nav = navigation(container);
		expect(nav.getAttribute("aria-orientation")).toBe("vertical");
		expect(nav.children.map((child) => child.text)).toEqual([
			"学习",
			"flashcards",
			"通用",
			"ai",
		]);
		expect(nav.children[1]!.getAttribute("aria-selected")).toBe("true");
	});
	it("restores focus on the same sorting handle across a rebuild", () => {
		const { container, render, handles } = setup();
		expect(render()).toBe(true);
		const first = handles[0]!;
		container.ownerDocument!.activeElement = first;

		expect(render()).toBe(true);
		const restored = handles[handles.length - 1]!;
		expect(restored).not.toBe(first);
		expect(restored.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("keeps a separate scroll offset per section and restores it on tab switch", () => {
		const { container, render, onSelectSection } = setup();
		render();
		container.scrollTop = 400;
		navigation(container).children[1]!.click();
		expect(onSelectSection).toHaveBeenCalledWith("ai");
		expect(container.scrollTop).toBe(0);

		container.scrollTop = 150;
		render();
		expect(container.scrollTop).toBe(150);

		navigation(container).children[0]!.click();
		expect(container.scrollTop).toBe(400);
	});

	it("remembers the navigation strip's horizontal offset across rebuilds", () => {
		const { container, render } = setup();
		render();
		navigation(container).scrollLeft = 96;
		render();
		expect(navigation(container).scrollLeft).toBe(96);
	});

	it("leaves the installed pane in place when presentation construction fails", () => {
		const { container, sections, render, disposeControls } = setup();
		render();
		const installedNav = navigation(container);

		sections[0]!.presentation = vi.fn(() => {
			throw new Error("invalid definition");
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(render()).toBe(false);
		expect(navigation(container)).toBe(installedNav);
		expect(disposeControls).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("disposes presentation and controls and can render again", () => {
		const { container, render, renderer, sections, disposeControls } = setup();
		const first = presentation();
		const dispose = vi.spyOn(first, "dispose");
		sections[0]!.presentation = vi.fn(() => first);
		render();

		renderer.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(disposeControls).toHaveBeenCalledOnce();
		expect(render()).toBe(true);
		expect(content(container)).toBeDefined();
	});

	it("renders an empty content pane for a section without a presentation", () => {
		const container = new MockElement();
		const active = section("soon", 0, () => null as never);
		const renderer = new SettingsPageRenderer({
			app: {} as never,
			containerEl: container as unknown as HTMLElement,
			onSelectSection: vi.fn(),
		});
		expect(
			renderer.render({
				sections: [active],
				activeSection: active,
				language: "zh",
				preserveScroll: false,
			}),
		).toBe(true);
		expect(content(container).children).toHaveLength(1);
		expect(content(container).children[0]!.text).toBe("soon");
	});

	it("applies WAI-ARIA tablist and tab semantics to navigation and content pane", () => {
		const { container, render } = setup();
		render();

		const nav = navigation(container);
		expect(nav.getAttribute("role")).toBe("tablist");

		const tabs = nav.children;
		expect(tabs[0]!.getAttribute("role")).toBe("tab");
		expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
		expect(tabs[0]!.getAttribute("aria-controls")).toBe("fc-settings-panel-flashcards");

		expect(tabs[1]!.getAttribute("role")).toBe("tab");
		expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
		expect(tabs[1]!.getAttribute("aria-controls")).toBe("fc-settings-panel-ai");

		const pane = content(container);
		expect(pane.getAttribute("role")).toBe("tabpanel");
		expect(pane.getAttribute("id")).toBe("fc-settings-panel-flashcards");
		expect(pane.getAttribute("aria-labelledby")).toBe("fc-settings-tab-flashcards");
	});

	it("supports keyboard arrow navigation between tabs", () => {
		const { container, render, onSelectSection } = setup();
		render();

		const nav = navigation(container);
		const firstTab = nav.children[0]!;
		firstTab.emit("keydown", { key: "ArrowRight", preventDefault: vi.fn() });

		expect(onSelectSection).toHaveBeenCalledWith("ai");
	});

	it("retains focus on the active tab button across rebuilds when navigating by keyboard", () => {
		const { container, render } = setup();
		render();

		const nav = navigation(container);
		const firstTab = nav.children[0]!;
		container.ownerDocument!.activeElement = firstTab;

		firstTab.emit("keydown", { key: "ArrowRight", preventDefault: vi.fn() });

		const updatedNav = navigation(container);
		const activeTab = updatedNav.children[1]!;
		expect(activeTab.focus).toHaveBeenCalledWith({ preventScroll: true });
	});
});
