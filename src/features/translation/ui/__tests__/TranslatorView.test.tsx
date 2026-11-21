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
			profiles: [
				{
					id: "deepseek",
					name: "DeepSeek",
					enabled: true,
					engineId: "ds-1",
				},
				{
					id: "youdao",
					name: "有道智云",
					enabled: true,
					engineId: "yd-1",
				},
			],
		},
		input: "你好世界",
		translatedInput: "你好世界",
		translatedDirection: "zh-en",
		stale: false,
		clearUndoId: null,
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
		...overrides,
	};
}

function createMockRuntime(snapshot: TranslationSnapshot): TranslationRuntime {
	return {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		setInput: vi.fn(),
		clear: vi.fn(() => true),
		undoClear: vi.fn(() => true),
		swapDirection: vi.fn(),
		translate: vi.fn(),
		retryResult: vi.fn(),
		restoreHistory: vi.fn(() => true),
		clearHistory: vi.fn(),
	} as unknown as TranslationRuntime;
}

interface ElementProps {
	children?: React.ReactNode;
	right?: React.ReactNode;
	id?: string;
	role?: string;
	disabled?: boolean;
	hidden?: boolean;
	tabIndex?: number;
	"aria-labelledby"?: string;
	"aria-describedby"?: string;
	"aria-pressed"?: boolean;
	onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
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
		const deepseekCard = all.find((el) => el.props["aria-label"] === "DeepSeek 的译文");
		expect(deepseekCard).toBeDefined();
		expect(textOf(deepseekCard)).toContain("deepseek-v3");

		// Youdao card does NOT have duplicate "有道智云 有道智云" subtitle
		const youdaoCard = all.find((el) => el.props["aria-label"] === "有道智云 的译文");
		expect(youdaoCard).toBeDefined();
		const subtitles = elements(youdaoCard).filter((el) =>
			(el.props.className ?? "").includes("subtitle"),
		);
		expect(subtitles).toHaveLength(0);
	});

	it("keeps available model and usage information inside named disclosures without inventing missing usage", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			results: [
				{ ...base.results[0]!, usage: { inputTokens: 94, outputTokens: 19 } },
				base.results[1]!,
			],
		});
		const all = elements(
			renderView({
				runtime: createMockRuntime(snapshot),
				language: "zh",
				onOpenSettings: vi.fn(),
			}),
		);
		const deepseek = all.find((element) => element.props["aria-label"] === "DeepSeek 的译文");
		const details = elements(deepseek).find((element) => element.type === "details");
		expect(textOf(details)).toContain("deepseek-v3");
		expect(textOf(details)).toContain("输入 94 · 输出 19 tokens");
		expect(
			elements(details).find((element) => element.type === "summary")?.props["aria-label"],
		).toBe("DeepSeek 的方案详情");
		expect(
			textOf(elements(deepseek).find((element) => element.type === "header")),
		).not.toContain("deepseek-v3");
		const youdao = all.find((element) => element.props["aria-label"] === "有道智云 的译文");
		expect(textOf(youdao)).not.toContain("tokens");
		expect(elements(youdao).some((element) => element.type === "details")).toBe(false);
	});

	it("shows current completion in the result header and keeps partial failures explicit", () => {
		const base = mockSnapshot();
		const runtime = createMockRuntime(base);
		const outputHeader = () => {
			const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
			const output = elements(tree).find((element) => element.props["aria-label"] === "译文");
			return textOf(elements(output).find((element) => element.type === "header"));
		};
		expect(outputHeader()).toContain("2/2 已完成");
		vi.spyOn(runtime, "getSnapshot").mockReturnValue(
			mockSnapshot({
				results: [
					base.results[0]!,
					{ ...base.results[1]!, status: "error", text: "", error: "network" },
				],
			}),
		);
		expect(outputHeader()).toContain("已完成 1/2 个方案，1 个失败");
	});

	it("keeps each result directly actionable while highlighting and after selecting one profile", async () => {
		vi.useFakeTimers();
		try {
			const snapshot = mockSnapshot();
			const runtime = createMockRuntime(snapshot);
			const onCreateCard = vi.fn(() => true);
			const onInsertNote = vi.fn(() => true);
			const render = () =>
				elements(
					renderView({
						runtime,
						language: "zh",
						onOpenSettings: vi.fn(),
						onCreateCard,
						onInsertNote,
					}),
				);
			render()
				.find((element) => element.props.children === "高亮差异")
				?.props.onClick?.();
			const highlighted = render();
			expect(highlighted.some((element) => element.type === "mark")).toBe(true);
			const deepseek = highlighted.find(
				(element) => element.props["aria-label"] === "DeepSeek 的译文",
			);
			elements(deepseek)
				.find((element) => element.props.children === "制为闪卡")
				?.props.onClick?.();
			await Promise.resolve();
			expect(onCreateCard).toHaveBeenCalledWith("你好世界", "Hello world");
			render()
				.find(
					(element) =>
						element.props.role === "tab" && element.props.children === "有道智云",
				)
				?.props.onClick?.();
			const single = render();
			expect(single.some((element) => element.props.children === "高亮差异")).toBe(false);
			const youdao = single.find(
				(element) => element.props["aria-label"] === "有道智云 的译文",
			);
			elements(youdao)
				.find((element) => element.props.children === "插入笔记")
				?.props.onClick?.();
			await Promise.resolve();
			expect(onInsertNote).toHaveBeenCalledWith("Hi world", "你好世界");
			expect(
				textOf(
					render().find((element) => element.props["aria-label"] === "有道智云 的译文"),
				),
			).toContain("已插入至当前笔记");
			vi.advanceTimersByTime(2000);
			expect(
				textOf(
					render().find((element) => element.props["aria-label"] === "有道智云 的译文"),
				),
			).toContain("已插入笔记");
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it("shows one waiting message and reveals the model tabs when results arrive", () => {
		const completed = mockSnapshot();
		const empty = mockSnapshot({
			input: "",
			status: "idle",
			results: completed.results.map((result) => ({ ...result, status: "idle", text: "" })),
		});
		const render = (snapshot: TranslationSnapshot) =>
			renderView({
				runtime: createMockRuntime(snapshot),
				language: "zh",
				onOpenSettings: vi.fn(),
			});
		const waiting = elements(render(empty));
		expect(
			waiting.filter(
				(element) => element.props.children === "翻译后，在这里对照不同方案的译文。",
			),
		).toHaveLength(1);
		expect(waiting.some((element) => element.props.role === "tablist")).toBe(false);
		const profiles = waiting.find((element) => element.type === "details");
		expect(textOf(profiles)).toContain("翻译方案（2）");
		expect(
			elements(profiles)
				.filter((element) => element.type === "li")
				.map(textOf),
		).toEqual(["DeepSeek", "有道智云"]);
		const output = waiting.find((element) => element.props["aria-label"] === "译文");
		expect(textOf(elements(output).find((element) => element.type === "footer"))).toContain(
			"结果只保留在当前视图，关闭后清除。",
		);
		const withResults = elements(render(completed));
		const selected = withResults.find(
			(element) => element.props.role === "tab" && element.props["aria-selected"],
		);
		expect(textOf(selected)).toBe("全部译文");
	});

	it("supports arrow-key switching with one tab stop and one uniquely labelled visible panel", () => {
		const runtime = createMockRuntime(mockSnapshot());
		const render = () =>
			elements(renderView({ runtime, language: "zh", onOpenSettings: vi.fn() }));
		const all = render();
		const tabs = all.filter((el) => el.props.role === "tab");
		expect(textOf(tabs[0])).toBe("全部译文");
		expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1]);

		const focus = vi.fn();
		const preventDefault = vi.fn();
		tabs[0]?.props.onKeyDown?.({
			key: "ArrowRight",
			currentTarget: { parentElement: { querySelectorAll: () => [null, { focus }] } },
			preventDefault,
		} as unknown as React.KeyboardEvent<HTMLButtonElement>);
		expect(focus).toHaveBeenCalledOnce();
		expect(preventDefault).toHaveBeenCalledOnce();

		const next = render();
		const selected = next.find((el) => el.props.role === "tab" && el.props["aria-selected"]);
		expect(textOf(selected)).toBe("DeepSeek");
		const panels = next.filter((el) => el.props.role === "tabpanel");
		expect(panels.filter((panel) => !panel.props.hidden)).toHaveLength(1);
		for (const tab of next.filter((el) => el.props.role === "tab")) {
			const matches = panels.filter((panel) => panel.props.id === tab.props["aria-controls"]);
			expect(matches).toHaveLength(1);
			expect(matches[0]?.props["aria-labelledby"]).toBe(tab.props.id);
		}
		expect(next.filter((el) => el.props.id === selected?.props["aria-controls"])).toHaveLength(
			1,
		);
	});

	it("offers setup in place of translation, with the source still editable", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			status: "idle",
			results: base.results.map((result) => ({
				...result,
				status: "idle",
				text: "",
				setupIssue: "engineSetup",
			})),
		});
		const runtime = createMockRuntime(snapshot);
		const onOpenSettings = vi.fn();
		const tree = renderView({ runtime, language: "zh", onOpenSettings });
		const all = elements(tree);
		const setup = all.find((el) => el.props.children === "配置翻译方案");
		expect(setup).toBeDefined();
		setup?.props.onClick?.();
		expect(onOpenSettings).toHaveBeenCalledOnce();
		expect(all.find((el) => el.props.value === snapshot.input)?.props.disabled).toBe(false);
		expect(textOf(all.find((el) => el.props.right)?.props.right)).toContain(
			"已就绪 0/2 个方案",
		);
		expect(textOf(tree)).not.toContain("翻译（");
		expect(textOf(tree)).not.toContain("复制译文");
		expect(textOf(tree)).not.toContain("词汇差异高亮");
	});

	it("keeps submit in the footer and describes the input with the shortcut in the source header", () => {
		const snapshot = mockSnapshot();
		const runtime = createMockRuntime(snapshot);
		const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
		const all = elements(tree);
		const header = all.find(
			(element) => element.type === "header" && textOf(element).includes("原文"),
		);
		const shortcut = elements(header).find(
			(element) => element.props.children === "Ctrl/Cmd + Enter 翻译",
		);
		const input = all.find((element) => element.props.value === snapshot.input);
		expect(shortcut?.props.id).toBeTruthy();
		expect(input?.props["aria-describedby"]).toBe(shortcut?.props.id);
		const footer = all.find(
			(element) => element.type === "footer" && textOf(element).includes("重新翻译"),
		);
		expect(footer).toBeDefined();
		expect(textOf(footer)).not.toContain("Ctrl/Cmd + Enter");
	});

	it("only offers undo for the clear published by the shared session", () => {
		const runtime = createMockRuntime(
			mockSnapshot({ clearUndoId: 12, input: "", results: [] }),
		);
		const undoClear = vi.spyOn(runtime, "undoClear");
		const render = () =>
			elements(renderView({ runtime, language: "zh", onOpenSettings: vi.fn() }));
		const undo = render().find((element) => element.props.children === "撤销");
		undo?.props.onClick?.();
		expect(undoClear).toHaveBeenCalledWith(12);
		vi.spyOn(runtime, "getSnapshot").mockReturnValue(mockSnapshot({ input: "新原文" }));
		expect(render().some((element) => element.props.children === "撤销")).toBe(false);
	});

	it("only lists ready profiles and submits without promising a comparison for a single profile", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			status: "idle",
			results: [
				{ ...base.results[0]!, status: "idle", text: "" },
				{
					...base.results[1]!,
					status: "idle",
					text: "",
					setupIssue: "engineSetup",
				},
			],
		});
		const runtime = createMockRuntime(snapshot);
		const translate = vi.spyOn(runtime, "translate");
		const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
		const submit = elements(tree).find((el) => el.props.children === "翻译");
		expect(submit).toBeDefined();
		const profiles = elements(tree).find((element) => element.type === "details");
		expect(textOf(profiles)).toContain("翻译方案（1）");
		expect(textOf(profiles)).toContain("DeepSeek");
		expect(textOf(profiles)).not.toContain("有道智云");
		submit?.props.onClick?.();
		expect(translate).toHaveBeenCalledOnce();
		expect(textOf(tree)).toContain("该方案还未配置完整，请先补全设置");
		expect(textOf(tree)).not.toContain("词汇差异高亮");
	});

	it("guides a single-profile session without showing a comparison or idle result tabs", () => {
		const base = mockSnapshot();
		const tree = renderView({
			runtime: createMockRuntime(
				mockSnapshot({
					input: "",
					status: "idle",
					results: [{ ...base.results[0]!, status: "idle", text: "" }],
				}),
			),
			language: "en",
			onOpenSettings: vi.fn(),
		});
		expect(textOf(tree)).toContain("Your translation will appear here.");
		expect(textOf(tree)).not.toContain("Compare translations");
		expect(elements(tree).some((element) => element.props.role === "tablist")).toBe(false);
		expect(
			elements(tree).find((element) => element.props.children === "Translate")?.props
				.disabled,
		).toBe(true);
	});

	it("preserves shortcut submission and blocks composition and duplicate loading requests", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			status: "idle",
			results: base.results.map((result) => ({ ...result, status: "idle", text: "" })),
		});
		const runtime = createMockRuntime(snapshot);
		const translate = vi.spyOn(runtime, "translate");
		const render = () =>
			elements(renderView({ runtime, language: "zh", onOpenSettings: vi.fn() }));
		const input = render().find((element) => element.props.value === snapshot.input);
		const event = (isComposing = false) =>
			({
				key: "Enter",
				ctrlKey: true,
				nativeEvent: { isComposing },
				preventDefault: vi.fn(),
			}) as unknown as React.KeyboardEvent<HTMLButtonElement>;
		input?.props.onKeyDown?.(event(true));
		expect(translate).not.toHaveBeenCalled();
		input?.props.onKeyDown?.(event());
		expect(translate).toHaveBeenCalledOnce();
		vi.spyOn(runtime, "getSnapshot").mockReturnValue({ ...snapshot, status: "loading" });
		const loading = render();
		loading
			.find((element) => element.props.value === snapshot.input)
			?.props.onKeyDown?.(event());
		expect(translate).toHaveBeenCalledOnce();
		expect(
			loading.find((element) => element.props.children === "正在翻译…")?.props.disabled,
		).toBe(true);
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
		const makeCardBtns = all.filter((el) => el.props.children === "制为闪卡");
		expect(makeCardBtns.length).toBeGreaterThanOrEqual(2);

		const insertBtns = all.filter((el) => el.props.children === "插入笔记");
		expect(insertBtns.length).toBeGreaterThanOrEqual(2);

		const speakBtns = all.filter(
			(el) => el.props.title === "朗读发音" || el.props["aria-label"] === "朗读发音",
		);
		expect(speakBtns.length).toBeGreaterThanOrEqual(2);
		expect(all.filter((el) => el.props["aria-label"] === "复制译文")).toHaveLength(2);
		const highlight = all.find((el) => el.props.children === "高亮差异");
		expect(highlight?.props["aria-pressed"]).toBe(false);
		highlight?.props.onClick?.();
		const updated = elements(renderView({ runtime, language: "zh", onOpenSettings: vi.fn() }));
		expect(updated.find((el) => el.props.children === "高亮差异")?.props["aria-pressed"]).toBe(
			true,
		);
		expect(textOf(updated)).toContain("标出的字词并非所有版本共有");
	});

	it("preserves results as stale and offers a full retranslation", () => {
		const snapshot = mockSnapshot({
			stale: true,
			settings: {
				...mockSnapshot().settings,
				direction: "en-zh",
			},
			translatedDirection: "zh-en",
		});
		const runtime = createMockRuntime(snapshot);
		const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
		const all = elements(tree);
		expect(textOf(tree)).toContain("原文或方向已修改；以下译文对应上一次翻译。");
		const pills = all.filter((el) => (el.props.className ?? "").includes("langPill"));
		expect(textOf(pills[0])).toBe("英文");
		expect(textOf(pills[1])).toBe("中文");
		const submit = all.find((el) => el.props.children === "翻译");
		expect(submit).toBeDefined();
		expect(textOf(tree)).not.toContain("重新翻译");
	});

	it("offers a per-result retry on failed cards", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			status: "success",
			results: [
				base.results[0]!,
				{ ...base.results[1]!, status: "error", text: "", error: "network" },
			],
		});
		const runtime = createMockRuntime(snapshot);
		const retryResult = vi.spyOn(runtime, "retryResult");
		const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
		const retry = elements(tree).find((el) => el.props.children === "重试");
		expect(retry).toBeDefined();
		retry?.props.onClick?.();
		expect(retryResult).toHaveBeenCalledWith("youdao");
	});

	it("renders in-memory recent translation history chips and supports restoring or clearing them", () => {
		const base = mockSnapshot();
		const snapshot = mockSnapshot({
			history: [
				{
					id: 2,
					input: "你好世界",
					direction: "zh-en",
					results: base.results,
				},
				{
					id: 1,
					input: "早安",
					direction: "zh-en",
					results: base.results,
				},
			],
		});
		const runtime = createMockRuntime(snapshot);
		const restoreHistory = vi.spyOn(runtime, "restoreHistory");
		const clearHistory = vi.spyOn(runtime, "clearHistory");
		const tree = renderView({ runtime, language: "zh", onOpenSettings: vi.fn() });
		const all = elements(tree);

		const secondChip = all.find((el) => el.props["aria-label"] === "恢复记录：早安");
		expect(secondChip).toBeDefined();
		secondChip?.props.onClick?.();
		expect(restoreHistory).toHaveBeenCalledWith(1);

		const clearBtn = all.find((el) => el.props["aria-label"] === "清空记录");
		expect(clearBtn).toBeDefined();
		clearBtn?.props.onClick?.();
		expect(clearHistory).toHaveBeenCalledOnce();
	});
});
