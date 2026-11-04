import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { TranslatorView } from "../TranslatorView";
import type { TranslationRuntime } from "../../domain/translationRuntime";
import type { TranslationSnapshot } from "../../domain/types";

const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[] }));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state)) hooks.state[index] = initial;
		return [
			hooks.state[index],
			(next: unknown) => {
				hooks.state[index] = typeof next === "function" ? next(hooks.state[index]) : next;
			},
		];
	},
	useMemo: (build: () => unknown) => build(),
	useId: () => "translator-view-test",
	useRef: (init: unknown) => ({ current: init }),
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
	useLayoutEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));

function mockSnapshot(overrides: Partial<TranslationSnapshot> = {}): TranslationSnapshot {
	return {
		settings: {
			enabled: true,
			direction: "zh-en",
			promptTemplate: "",
			thinkingEnabled: false,
			youdao: { baseUrl: "", appKeySecretId: "", appSecretSecretId: "" },
			profiles: [
				{
					id: "deepseek",
					name: "DeepSeek",
					enabled: true,
					kind: "engine",
					configId: "ds-1",
				},
				{
					id: "youdao",
					name: "有道智云",
					enabled: true,
					kind: "youdao",
					configId: "yd-1",
				},
			],
		},
		input: "你好世界",
		results: [
			{
				id: "deepseek",
				name: "DeepSeek",
				model: "deepseek-v3",
				provider: "deepseek",
				status: "success",
				text: "Hello world",
			},
			{
				id: "youdao",
				name: "有道智云",
				model: "",
				provider: "youdao",
				status: "success",
				text: "Hi world",
			},
		],
		status: "success",
		saving: false,
		testing: false,
		...overrides,
	};
}

function createMockRuntime(snapshot: TranslationSnapshot): TranslationRuntime {
	return {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		setInput: vi.fn(),
		clear: vi.fn(),
		restore: vi.fn(),
		swapDirection: vi.fn(),
		translate: vi.fn(),
	} as unknown as TranslationRuntime;
}

interface ElementProps {
	children?: React.ReactNode;
	id?: string;
	role?: string;
	"aria-label"?: string;
	"aria-selected"?: boolean;
	"aria-controls"?: string;
	title?: string;
	className?: string;
	onClick?: () => void;
	value?: unknown;
}

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
	const result: React.ReactElement<ElementProps>[] = [];
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (!React.isValidElement<ElementProps>(child)) return;
			result.push(child);
			visit(child.props.children);
		});
	}
	visit(node);
	return result;
}

function textOf(node: React.ReactNode): string {
	let text = "";
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (typeof child === "string" || typeof child === "number") {
				text += String(child);
				return;
			}
			if (React.isValidElement<ElementProps>(child)) visit(child.props.children);
		});
	}
	visit(node);
	return text;
}

function renderView(props: React.ComponentProps<typeof TranslatorView>): React.ReactNode {
	hooks.cursor = 0;
	const Component = (
		TranslatorView as unknown as {
			type: (input: React.ComponentProps<typeof TranslatorView>) => React.ReactNode;
		}
	).type;
	return Component(props);
}

describe("TranslatorView UI", () => {
	beforeEach(() => {
		hooks.cursor = 0;
		hooks.state.length = 0;
	});

	it("renders input panel, direction indicator, and controls", () => {
		const snapshot = mockSnapshot();
		const runtime = createMockRuntime(snapshot);
		const tree = renderView({
			runtime,
			language: "zh",
			onOpenSettings: vi.fn(),
		});

		const all = elements(tree);
		// Check that language pills exist
		const pills = all.filter((el) => (el.props.className ?? "").includes("langPill"));
		expect(pills.length).toBeGreaterThanOrEqual(2);
		expect(textOf(pills[0])).toBe("中文");
		expect(textOf(pills[1])).toBe("英文");
	});

	it("deduplicates subtitle when provider matches profile name (e.g. 有道智云)", () => {
		const snapshot = mockSnapshot();
		const runtime = createMockRuntime(snapshot);
		const tree = renderView({
			runtime,
			language: "zh",
			onOpenSettings: vi.fn(),
		});

		const all = elements(tree);
		// DeepSeek card has subtitle "deepseek-v3"
		const deepseekCard = all.find((el) => el.props.id?.endsWith("-panel-deepseek"));
		expect(deepseekCard).toBeDefined();
		expect(textOf(deepseekCard)).toContain("deepseek-v3");

		// Youdao card does NOT have duplicate "有道智云 有道智云" subtitle
		const youdaoCard = all.find((el) => el.props.id?.endsWith("-panel-youdao"));
		expect(youdaoCard).toBeDefined();
		const subtitles = elements(youdaoCard).filter((el) =>
			(el.props.className ?? "").includes("subtitle"),
		);
		expect(subtitles).toHaveLength(0);
	});

	it("renders accessible tablist and tabpanel cross-references in comparison view", () => {
		const snapshot = mockSnapshot();
		const runtime = createMockRuntime(snapshot);
		const tree = renderView({
			runtime,
			language: "zh",
			onOpenSettings: vi.fn(),
		});

		const all = elements(tree);
		const tablist = all.find((el) => el.props.role === "tablist");
		expect(tablist).toBeDefined();

		const tabs = all.filter((el) => el.props.role === "tab");
		expect(tabs.length).toBeGreaterThanOrEqual(3); // deepseek, youdao, compareTable

		// Tab all should control panel all
		const allTab = tabs.find((t) => t.props.id?.endsWith("-tab-all"));
		expect(allTab).toBeDefined();
		expect(allTab?.props["aria-controls"]).toMatch(/-panel-all$/);

		const allPanel = all.find((el) => el.props.id?.endsWith("-panel-all"));
		expect(allPanel).toBeDefined();
		expect(allPanel?.props.role).toBe("tabpanel");
	});

	it("provides speak, card creation, and note insertion actions", () => {
		const snapshot = mockSnapshot();
		const runtime = createMockRuntime(snapshot);
		const onInsertNote = vi.fn().mockResolvedValue(true);
		const onCreateCard = vi.fn().mockResolvedValue(true);

		const tree = renderView({
			runtime,
			language: "zh",
			onOpenSettings: vi.fn(),
			onInsertNote,
			onCreateCard,
		});

		const all = elements(tree);
		// Check that action buttons exist (朗读, 制卡, 插入笔记, 复制)
		const makeCardBtns = all.filter(
			(el) => el.props.title === "制为闪卡" || el.props["aria-label"] === "制为闪卡",
		);
		expect(makeCardBtns.length).toBeGreaterThanOrEqual(2);

		const insertBtns = all.filter(
			(el) => el.props.title === "插入笔记" || el.props["aria-label"] === "插入笔记",
		);
		expect(insertBtns.length).toBeGreaterThanOrEqual(2);

		const speakBtns = all.filter(
			(el) => el.props.title === "朗读发音" || el.props["aria-label"] === "朗读发音",
		);
		expect(speakBtns.length).toBeGreaterThanOrEqual(2);
	});
});
