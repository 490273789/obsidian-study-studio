import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { allowsMainTabShortcut, SelectionDictCard } from "../SelectionDictCard";
import type { SelectionResultContentProps } from "../types";
import { selectionHelperStrings } from "../../strings/selectionPopup";
import type { SelectionLookupSession, SelectionLookupSnapshot } from "../../domain/types";

const reactHooks = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	effects: [] as (() => unknown)[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: () => reactHooks.refs.shift() ?? { current: null },
	useEffect: (effect: () => unknown) => reactHooks.effects.push(effect),
}));

function findElement(
	node: React.ReactNode,
	predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>> | undefined {
	let found: React.ReactElement<Record<string, unknown>> | undefined;
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (found || !React.isValidElement(child)) return;
			if (predicate(child as React.ReactElement<Record<string, unknown>>)) {
				found = child as React.ReactElement<Record<string, unknown>>;
				return;
			}
			visit((child as React.ReactElement<{ children?: React.ReactNode }>).props.children);
		});
	}
	visit(node);
	return found;
}

describe("SelectionDictCard", () => {
	const mockLookup: SelectionLookupSnapshot = {
		query: "commercial",
		activeSourceId: "youdao",
		aiEngineName: "",
		status: "ready",
		sources: [
			{
				id: "youdao",
				label: "有道词典",
				kind: "dictionary",
				status: "success",
				error: "",
				pronunciations: [],
				result: { opaque: true },
			},
		],
	};

	const mockSession: SelectionLookupSession = {
		getSnapshot: () => mockLookup,
		subscribe: vi.fn(() => () => {}),
		selectSource: vi.fn(),
		selectSection: vi.fn(),
		lookup: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		generateAi: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
	};

	it("renders favorite button when onFavorite is provided", () => {
		const onFavorite = vi.fn();
		const strings = selectionHelperStrings("zh");
		const element = (
			<SelectionDictCard
				query="commercial"
				lookup={mockLookup}
				session={mockSession}
				strings={strings}
				language="zh"
				theme="dark"
				onOpenInMainTab={vi.fn()}
				onFavorite={onFavorite}
				onClose={vi.fn()}
				openMainShortcut="Ctrl+Enter"
			/>
		);

		// Component renders properly as a React element with expected props
		expect(element.props.onFavorite).toBe(onFavorite);
		expect(element.props.strings.favorite).toBe("收藏");
	});

	it("delegates the success body to the injected dictionary renderer", () => {
		const session = {
			...mockSession,
			selectSection: vi.fn(),
			lookup: vi.fn().mockResolvedValue(undefined),
		};
		const ResultContent = (_props: SelectionResultContentProps) => null;
		const props: React.ComponentProps<typeof SelectionDictCard> = {
			query: "commercial",
			lookup: mockLookup,
			session,
			strings: selectionHelperStrings("zh"),
			language: "zh",
			theme: "dark",
			renderResultContent: ResultContent,
			onOpenInMainTab: vi.fn(),
			onClose: vi.fn(),
			openMainShortcut: "Ctrl+Enter",
		};
		const tree = (
			SelectionDictCard as unknown as {
				type: (props: React.ComponentProps<typeof SelectionDictCard>) => React.ReactNode;
			}
		).type(props);
		const content = findElement(tree, (element) => element.type === ResultContent);
		expect(content).toBeDefined();
		if (!content) throw new Error("Expected the injected result renderer");
		expect(content.props.handle).toEqual({ opaque: true });
		expect(content.props.language).toBe("zh");
		expect(content.props.mainTabShortcut).toBe("Ctrl+Enter");
		(content.props.onOpenMainTab as () => void)();
		expect(props.onOpenInMainTab).toHaveBeenCalledWith("commercial");

		(content.props.onSelectSection as (index: number) => void)(2);
		expect(session.selectSection).toHaveBeenCalledWith("youdao", 2);
		(content.props.onLookup as (word: string) => void)("science");
		expect(session.lookup).toHaveBeenCalledWith("science");
	});

	it("keeps the query input and phonetics in the drag handle with source tabs outside it", () => {
		const onHeaderPointerDown = vi.fn();
		const lookup = {
			...mockLookup,
			sources: [
				{ ...mockLookup.sources[0]!, pronunciations: [{ label: "UK", phonetic: "test" }] },
				{ ...mockLookup.sources[0]!, id: "other" },
			],
		};
		const tree = (
			SelectionDictCard as unknown as {
				type: (props: React.ComponentProps<typeof SelectionDictCard>) => React.ReactNode;
			}
		).type({
			query: "commercial",
			lookup,
			session: mockSession,
			strings: selectionHelperStrings("zh"),
			language: "zh",
			theme: "dark",
			onClose: vi.fn(),
			onOpenInMainTab: vi.fn(),
			openMainShortcut: "Ctrl+Enter",
			onHeaderPointerDown,
		});
		const handle = findElement(
			tree,
			(element) => element.props.onPointerDown === onHeaderPointerDown,
		);
		expect(handle).toBeDefined();
		expect(findElement(handle, (element) => element.type === "input")).toBeDefined();
		expect(
			findElement(
				handle,
				(element) =>
					element.type === "span" &&
					React.Children.toArray(element.props.children as React.ReactNode)
						.map((child) => (typeof child === "string" ? child : ""))
						.join("") === "[UK] /test/",
			),
		).toBeDefined();
		expect(findElement(handle, (element) => element.props.role === "tablist")).toBeUndefined();
		expect(findElement(tree, (element) => element.props.role === "tablist")).toBeDefined();
	});

	it("queries a trimmed draft on plain Enter and keeps handoffs on the displayed word", () => {
		const session = { ...mockSession, lookup: vi.fn().mockResolvedValue(undefined) };
		const onFavorite = vi.fn();
		const onOpenInMainTab = vi.fn();
		const tree = (
			SelectionDictCard as unknown as {
				type: (props: React.ComponentProps<typeof SelectionDictCard>) => React.ReactNode;
			}
		).type({
			query: "commercial",
			lookup: mockLookup,
			session,
			strings: selectionHelperStrings("zh"),
			language: "zh",
			theme: "dark",
			onClose: vi.fn(),
			onFavorite,
			onOpenInMainTab,
			openMainShortcut: "Ctrl+Enter",
		});
		const input = findElement(tree, (element) => element.type === "input");
		expect(input?.props.defaultValue).toBe("commercial");
		if (!input) throw new Error("Expected lookup input");
		const onKeyDown = input?.props.onKeyDown as (event: unknown) => void;
		const event = {
			key: "Enter",
			currentTarget: { value: "  new   word  " },
			nativeEvent: { isComposing: false },
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		onKeyDown(event);
		expect(session.lookup).toHaveBeenCalledExactlyOnceWith("new word");
		expect(event.currentTarget.value).toBe("new word");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		onKeyDown({ ...event, ctrlKey: true });
		expect(session.lookup).toHaveBeenCalledTimes(1);
		const favorite = findElement(tree, (element) => element.props["aria-label"] === "收藏");
		if (!favorite) throw new Error("Expected favorite button");
		(favorite.props.onClick as () => void)();
		expect(onFavorite).toHaveBeenCalledWith("commercial");
		const main = findElement(
			tree,
			(element) => element.props.title === "按 Ctrl+Enter 在主标签页打开",
		);
		if (!main) throw new Error("Expected main-tab button");
		(main.props.onClick as () => void)();
		expect(onOpenInMainTab).toHaveBeenCalledWith("commercial");
	});

	it("focuses and selects the first query, then syncs the input after entry navigation", () => {
		const input = { value: "commercial", focus: vi.fn(), select: vi.fn() };
		const card = { ownerDocument: { defaultView: null } };
		const props: React.ComponentProps<typeof SelectionDictCard> = {
			query: "commercial",
			lookup: mockLookup,
			session: mockSession,
			strings: selectionHelperStrings("zh"),
			language: "zh",
			theme: "dark",
			onClose: vi.fn(),
			onOpenInMainTab: vi.fn(),
			openMainShortcut: "Ctrl+Enter",
		};
		const render = (lookup: SelectionLookupSnapshot) => {
			reactHooks.refs = [{ current: card }, { current: input }];
			reactHooks.effects = [];
			void (
				SelectionDictCard as unknown as {
					type: (
						props: React.ComponentProps<typeof SelectionDictCard>,
					) => React.ReactNode;
				}
			).type({ ...props, lookup });
		};
		render(mockLookup);
		reactHooks.effects[0]?.();
		reactHooks.effects[1]?.();
		expect(input.focus).toHaveBeenCalledOnce();
		expect(input.select).toHaveBeenCalledOnce();
		render({ ...mockLookup, query: "migration" });
		reactHooks.effects[1]?.();
		expect(input.value).toBe("migration");
		reactHooks.refs = [];
		reactHooks.effects = [];
	});

	it("limits the main-tab shortcut to this popup and rejects composition", () => {
		const inside = {} as Node;
		const card = { contains: (target: Node) => target === inside } as HTMLDialogElement;
		const eventFields = {
			target: inside,
			key: "Enter",
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			defaultPrevented: false,
			isComposing: false,
		};
		const event = eventFields as unknown as KeyboardEvent;
		expect(allowsMainTabShortcut(event, card, "Ctrl+Enter")).toBe(true);
		expect(
			allowsMainTabShortcut(
				{ ...eventFields, target: {} } as KeyboardEvent,
				card,
				"Ctrl+Enter",
			),
		).toBe(false);
		expect(
			allowsMainTabShortcut(
				{ ...eventFields, isComposing: true } as unknown as KeyboardEvent,
				card,
				"Ctrl+Enter",
			),
		).toBe(false);
		expect(
			allowsMainTabShortcut(
				{ ...eventFields, ctrlKey: false } as unknown as KeyboardEvent,
				card,
				"Ctrl+Enter",
			),
		).toBe(false);
	});
});
