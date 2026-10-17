import React from "react";
import { describe, expect, it } from "vite-plus/test";
import type { AiDictionaryDefinition, DictionarySection } from "../../../domain/types";
import { defineSandboxDocument } from "../../../domain/sandbox-document/document";
import { dictionaryStrings } from "../../../strings/dictionary";
import {
	AiSense,
	DictionarySectionContent,
	getTabSections,
	getVisibleSections,
} from "../DictionarySectionContent";

const strings = dictionaryStrings("zh");

const definition: AiDictionaryDefinition = {
	antonyms: ["sell"],
	examples: [
		{ sentence: "They commercialized the research.", translation: "他们把研究商业化了。" },
	],
	explanation: "Relating to commerce.",
	meaning: "商业的",
	partOfSpeech: "adj.",
	synonyms: ["mercantile"],
};

function textOf(node: React.ReactNode): string {
	let text = "";
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (typeof child === "string" || typeof child === "number") {
				text += String(child);
				return;
			}
			if (React.isValidElement<{ children?: React.ReactNode }>(child))
				visit(child.props.children);
		});
	}
	visit(node);
	return text;
}

function renderSection(
	props: React.ComponentProps<typeof DictionarySectionContent>,
): React.ReactElement {
	return (
		DictionarySectionContent as unknown as {
			type: (
				input: React.ComponentProps<typeof DictionarySectionContent>,
			) => React.ReactElement;
		}
	).type(props);
}

function sections(): DictionarySection[] {
	return [
		{
			title: "释义",
			presentation: "stack",
			content: { kind: "list", items: ["商业的"] },
		},
		{
			title: "AI 释义",
			presentation: "tab",
			content: { kind: "ai-definitions", definitions: [definition] },
		},
		{
			title: "详细",
			presentation: "tab",
			content: {
				kind: "document",
				document: defineSandboxDocument("oald", "private HTML"),
			},
		},
	];
}

describe("dictionary result presentation", () => {
	it("renders every AI definition field in one shared sense", () => {
		const tree = AiSense({
			definition,
			number: 1,
			word: "commercial",
			strings,
		}) as React.ReactElement<{ children: React.ReactNode }>;
		const text = textOf(tree);

		expect(text).toContain("商业的");
		expect(text).toContain("Relating to commerce.");
		expect(text).toContain("mercantile");
		expect(text).toContain("sell");
		expect(text).toContain("They ");
		expect(text).toContain("commercialized the research.");
	});

	it("renders list content and delegates documents with their assistant-only options", () => {
		const [stack, , documentSection] = sections();
		const list = renderSection({
			content: stack!.content,
			word: "commercial",
			theme: "dark",
			title: "释义",
			strings,
		}) as React.ReactElement;
		expect(list.type).toBe("ol");

		const documentContent = documentSection!.content;
		if (documentContent.kind !== "document") throw new Error("expected document");
		const frame = renderSection({
			content: documentContent,
			word: "commercial",
			theme: "dark",
			title: "详细",
			onClose: () => {},
			fitContent: true,
			strings,
		}) as React.ReactElement<{ fitContent: boolean; onClose?: () => void }>;
		expect(frame.props.fitContent).toBe(true);
		expect(frame.props.onClose).toBeDefined();
	});

	it("derives tab indices and the visible sections from presentation", () => {
		const result = sections();
		expect(getTabSections(result).map(({ index }) => index)).toEqual([1, 2]);
		expect(getVisibleSections(result, 1).map(({ index }) => index)).toEqual([0, 1]);
		expect(getVisibleSections(result, 2).map(({ index }) => index)).toEqual([0, 2]);
		expect(getVisibleSections(result, null).map(({ index }) => index)).toEqual([0]);
	});
});
