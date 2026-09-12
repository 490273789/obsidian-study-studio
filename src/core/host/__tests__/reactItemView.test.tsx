import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settingsSlices";
import type { FlashcardSettings } from "../../shared/types";
import { ReactViewErrorBoundary, createReactItemView } from "../reactItemView";

interface FakeElement {
	children: FakeElement[];
	classes: Set<string>;
	empty(): FakeElement;
	addClass(cls: string): FakeElement;
	createDiv(options?: { cls?: string }): FakeElement;
}

const env = vi.hoisted(() => {
	const createFakeElement = (): FakeElement => {
		const el: FakeElement = {
			children: [],
			classes: new Set<string>(),
			empty() {
				el.children = [];
				return el;
			},
			addClass(cls: string) {
				el.classes.add(cls);
				return el;
			},
			createDiv(options?: { cls?: string }) {
				const div = createFakeElement();
				for (const cls of options?.cls?.split(" ") ?? []) div.classes.add(cls);
				el.children.push(div);
				return div;
			},
		};
		return el;
	};

	const content = createFakeElement();
	const listeners: Record<string, (() => void)[]> = {};
	let isDark = false;
	return {
		createFakeElement,
		content,
		listeners,
		roots: [] as { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }[],
		app: {
			isDarkMode: () => isDark,
			workspace: {
				on: (name: string, callback: () => void) => {
					(listeners[name] ??= []).push(callback);
					return { name };
				},
			},
		},
		setDark: (value: boolean) => {
			isDark = value;
		},
	};
});

vi.mock("obsidian", () => ({
	ItemView: class {
		app = env.app;
		containerEl = { children: [null, env.content] };
		registerEvent(): void {}
	},
}));

vi.mock("react-dom/client", () => ({
	createRoot: () => {
		const root = { render: vi.fn(), unmount: vi.fn() };
		env.roots.push(root);
		return root;
	},
}));

function settings(overrides: Partial<FlashcardSettings> = {}): FlashcardSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

/** The protected lifecycle methods Obsidian itself calls on the view. */
interface TestView {
	onOpen(): Promise<void>;
	onClose(): Promise<void>;
	updateSettings(): void;
	getViewType(): string;
	getIcon(): string;
	getDisplayText(): string;
}

function buildView(options: {
	settings: () => FlashcardSettings;
	trackTheme?: boolean;
	onOpen?: () => void;
	onClose?: () => void;
	render?: (context: { language: string; theme: string }) => React.ReactNode;
}): TestView {
	return createReactItemView({
		type: "test-view",
		icon: "layers",
		title: (language) => (language === "en" ? "Test view" : "测试视图"),
		trackTheme: options.trackTheme,
		readSettings: options.settings,
		renderErrorMessage: () => "渲染失败",
		onOpen: options.onOpen,
		onClose: options.onClose,
		render:
			options.render ??
			((context) =>
				React.createElement("p", { id: "body" }, `${context.language}:${context.theme}`)),
	})({} as never) as unknown as TestView;
}

/** The element tree the seam last rendered: StrictMode → I18nProvider → boundary → body. */
function lastRenderedBoundary(): React.ReactElement<{
	message: string;
	children: React.ReactNode;
}> {
	const root = env.roots[env.roots.length - 1]!;
	const calls = root.render.mock.calls;
	const tree = calls[calls.length - 1]![0] as React.ReactElement<{ children: React.ReactNode }>;
	expect(tree.type).toBe(React.StrictMode);
	const provider = tree.props.children as React.ReactElement<{ children: React.ReactNode }>;
	const boundary = provider.props.children as React.ReactElement<{
		message: string;
		children: React.ReactNode;
	}>;
	return boundary;
}

function renderedBody(): React.ReactElement<{ children: string }> {
	return lastRenderedBoundary().props.children as React.ReactElement<{ children: string }>;
}

describe("react item view seam", () => {
	beforeEach(() => {
		env.content.children = [];
		env.content.classes.clear();
		env.roots.length = 0;
		for (const key of Object.keys(env.listeners)) delete env.listeners[key];
		env.setDark(false);
	});

	it("exposes the declared view type, icon, and a language-dependent title", () => {
		let current = settings({ language: "zh" });
		const view = buildView({ settings: () => current });

		expect(view.getViewType()).toBe("test-view");
		expect(view.getIcon()).toBe("layers");
		expect(view.getDisplayText()).toBe("测试视图");

		current = settings({ language: "en" });
		expect(view.getDisplayText()).toBe("Test view");
	});

	it("builds the container and the React root on open", async () => {
		const onOpen = vi.fn();
		env.content.children.push(env.createFakeElement());
		const view = buildView({ settings: () => settings(), onOpen });

		await view.onOpen();

		// The seam owns one container class for every workbench view.
		expect(env.content.classes.has("flashcard-container")).toBe(true);
		// The stale child is gone and exactly one root element was created.
		expect(env.content.children).toHaveLength(1);
		expect([...env.content.children[0]!.classes]).toEqual(["flashcard-root"]);
		expect(env.roots).toHaveLength(1);
		expect(env.roots[0]!.render).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("renders the view inside the shared i18n provider and error boundary", async () => {
		const view = buildView({ settings: () => settings({ language: "en" }) });

		await view.onOpen();

		expect(lastRenderedBoundary().props.message).toBe("渲染失败");
		expect(renderedBody().props.children).toBe("en:light");
	});

	it("re-renders from the committed settings when the host pushes a change", async () => {
		let current = settings({ language: "zh" });
		const view = buildView({ settings: () => current });
		await view.onOpen();
		expect(renderedBody().props.children).toBe("zh:light");

		current = settings({ language: "en" });
		view.updateSettings();

		const root = env.roots[0]!;
		expect(root.render).toHaveBeenCalledTimes(2);
		expect(renderedBody().props.children).toBe("en:light");
	});

	it("unmounts and runs the close hook", async () => {
		const onClose = vi.fn();
		const view = buildView({ settings: () => settings(), onClose });
		await view.onOpen();

		await view.onClose();

		expect(env.roots[0]!.unmount).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);

		// A late settings push after close must not render again.
		view.updateSettings();
		expect(env.roots[0]!.render).toHaveBeenCalledTimes(1);
	});

	it("ignores theme changes unless the view opts in", async () => {
		const view = buildView({ settings: () => settings() });
		await view.onOpen();

		expect(env.listeners["css-change"]).toBeUndefined();
		view.updateSettings();
		expect(env.roots[0]!.render).toHaveBeenCalledTimes(2);
	});

	it("re-renders on a real theme change only when tracking is enabled", async () => {
		const view = buildView({ settings: () => settings(), trackTheme: true });
		await view.onOpen();
		expect(env.listeners["css-change"]).toHaveLength(1);
		expect(renderedBody().props.children).toBe("zh:light");

		// Same theme: no re-render.
		env.listeners["css-change"]![0]!();
		expect(env.roots[0]!.render).toHaveBeenCalledTimes(1);

		env.setDark(true);
		env.listeners["css-change"]![0]!();
		expect(env.roots[0]!.render).toHaveBeenCalledTimes(2);
		expect(renderedBody().props.children).toBe("zh:dark");

		await view.onClose();
	});

	it("shows the localized message instead of a blank leaf when its tree fails", () => {
		expect(ReactViewErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });

		const node = ReactViewErrorBoundary.prototype.render.call({
			props: { message: "渲染失败", viewType: "test-view", children: null },
			state: { failed: true },
		} as never) as React.ReactElement<{ className: string; children: string }>;

		expect(node.type).toBe("p");
		expect(node.props.className).toBe("fc-kicker");
		expect(node.props.children).toBe("渲染失败");
	});
});
