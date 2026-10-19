import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionDictCard } from "../SelectionDictCard";
import type { SelectionResultContentProps } from "../types";
import { selectionHelperStrings } from "../../strings/selectionPopup";
import type { SelectionLookupSession, SelectionLookupSnapshot } from "../../domain/types";

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: () => ({ current: null }),
	useEffect: () => {},
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

		(content.props.onSelectSection as (index: number) => void)(2);
		expect(session.selectSection).toHaveBeenCalledWith("youdao", 2);
		(content.props.onLookup as (word: string) => void)("science");
		expect(session.lookup).toHaveBeenCalledWith("science");
	});

	it("keeps the title and phonetics in the drag handle with source tabs outside it", () => {
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
			onHeaderPointerDown,
		});
		const handle = findElement(
			tree,
			(element) => element.props.onPointerDown === onHeaderPointerDown,
		);
		expect(handle).toBeDefined();
		expect(findElement(handle, (element) => element.type === "h3")).toBeDefined();
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
});
