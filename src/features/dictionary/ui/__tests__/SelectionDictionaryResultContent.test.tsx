import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { DictionaryResult } from "../../domain/types";
import type { DictionarySelectionResultHandle } from "../../selectionAdapter";
import { SelectionDictionaryResultContent } from "../SelectionDictionaryResultContent";

function result(): DictionaryResult {
	return {
		attribution: "",
		pronunciations: [],
		sourceId: "youdao",
		sourceLabel: "有道词典",
		suggestions: [],
		word: "commercial",
		sections: [
			{ title: "释义", presentation: "stack", content: { kind: "list", items: ["商业的"] } },
			{
				title: "更多",
				presentation: "tab",
				content: {
					kind: "ai-definitions",
					definitions: [
						{
							antonyms: [],
							examples: [],
							explanation: "Relating to commerce.",
							meaning: "商业的",
							partOfSpeech: "adj.",
							synonyms: [],
						},
					],
				},
			},
		],
	};
}

function find(
	node: React.ReactNode,
	predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>>[] {
	const found: React.ReactElement<Record<string, unknown>>[] = [];
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (!React.isValidElement(child)) return;
			const element = child as React.ReactElement<Record<string, unknown>>;
			if (predicate(element)) found.push(element);
			visit((element as React.ReactElement<{ children?: React.ReactNode }>).props.children);
		});
	}
	visit(node);
	return found;
}

describe("SelectionDictionaryResultContent", () => {
	it("renders detail tabs and delegates their selection back to the session action", () => {
		const onSelectSection = vi.fn();
		const handle: DictionarySelectionResultHandle = {
			result: result(),
			activeSectionIndex: 1,
			word: "commercial",
		};
		const element = (
			SelectionDictionaryResultContent as unknown as {
				type: (
					props: React.ComponentProps<typeof SelectionDictionaryResultContent>,
				) => React.ReactNode;
			}
		).type({
			handle,
			language: "zh",
			theme: "dark",
			onLookup: vi.fn(),
			onSelectSection,
			onClose: vi.fn(),
		});

		const tabs = find(
			element,
			(entry) => entry.type === "button" && entry.props.role === "tab",
		);
		expect(tabs).toHaveLength(1);
		const tab = tabs[0];
		if (!tab) throw new Error("Expected a detail tab");
		expect(tab.props["aria-selected"]).toBe(true);
		(tab.props.onClick as () => void)();
		expect(onSelectSection).toHaveBeenCalledWith(1);

		const panels = find(element, (entry) => entry.props.role === "tabpanel");
		expect(panels).toHaveLength(1);
	});
});
