import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MarkdownContent, PronounceableMarkdown } from "../../primitives/Markdown";
import type { CardPresentationBlock } from "../cardPresentation";
import {
	CardAnswerPanel,
	CardAnswerSection,
	CardExplanationPanel,
	CardQuestionPanel,
} from "../CardPanels";
import { CardPresentationStack } from "../CardPresentationStack";

const deps = vi.hoisted(() => ({
	markdownRenderer: vi.fn(),
	pronunciationRuntime: { stop: vi.fn() },
}));

vi.mock("obsidian", () => ({ Component: class Component {} }));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("../context", () => ({
	useCardPresentationDependencies: () => deps,
}));
vi.mock("../../hooks/useCardContextMenu", () => ({
	useCardContextMenu: () => "context-menu-handler",
}));

type BlockElement = React.ReactElement<{ block: CardPresentationBlock }>;
type TextElement = React.ReactElement<{ children: React.ReactNode }>;
type PanelChrome = React.ReactElement<{ className: string; children: React.ReactNode }>;

function childrenOf(node: React.ReactNode): React.ReactElement[] {
	const children: React.ReactElement[] = [];
	React.Children.forEach(node, (child) => {
		if (React.isValidElement(child)) children.push(child);
	});
	return children;
}

describe("card presentation panels", () => {
	it("renders the shared question panel shape", () => {
		const block: CardPresentationBlock = {
			label: "common.question",
			content: "front",
			pronunciationWord: null,
		};
		const tree = CardQuestionPanel({ block }) as PanelChrome;
		expect(tree.props.className).toBe("flashcard-question fc-panel");
		const [label, body] = childrenOf(tree.props.children);
		expect((label as TextElement).props.children).toBe("common.question");
		expect(body?.type).toBe(MarkdownContent);
		expect((body as React.ReactElement<{ content: string }>).props.content).toBe("front");
	});

	it("uses the pronounceable body when the block exposes a word", () => {
		const block: CardPresentationBlock = {
			label: "common.question",
			content: "front",
			pronunciationWord: "front",
		};
		const tree = CardQuestionPanel({ block }) as PanelChrome;
		const body = childrenOf(tree.props.children)[1] as React.ReactElement<{
			word: string;
			runtime: unknown;
		}>;
		expect(body?.type).toBe(PronounceableMarkdown);
		expect(body?.props.word).toBe("front");
		expect(body?.props.runtime).toBe(deps.pronunciationRuntime);
	});

	it("renders the answer section as divider, answer and optional explanation", () => {
		const answer: CardPresentationBlock = {
			label: "common.answer",
			content: "back",
			pronunciationWord: null,
		};
		const explanation: CardPresentationBlock = {
			label: "common.explanation",
			content: "why",
			pronunciationWord: null,
		};
		const tree = CardAnswerSection({ answer, explanation }) as PanelChrome;
		expect(tree.props.className).toBe("flashcard-answer-section");
		const [divider, answerPanel, explanationPanel] = childrenOf(tree.props.children);
		expect((divider as PanelChrome).props.className).toBe("flashcard-divider");
		expect(answerPanel?.type).toBe(CardAnswerPanel);
		expect((answerPanel as BlockElement).props.block).toBe(answer);
		expect(explanationPanel?.type).toBe(CardExplanationPanel);
		expect((explanationPanel as BlockElement).props.block).toBe(explanation);
	});

	it("renders the explanation panel standalone", () => {
		const block: CardPresentationBlock = {
			label: "common.explanation",
			content: "why",
			pronunciationWord: null,
		};
		const tree = CardExplanationPanel({ block }) as PanelChrome;
		expect(tree.props.className).toBe("flashcard-explanation fc-panel");
		const [label, body] = childrenOf(tree.props.children);
		expect((label as TextElement).props.children).toBe("common.explanation");
		expect((body as React.ReactElement<{ content: string }>).props.content).toBe("why");
	});

	it("keeps the card stack wrapper and context menu in the stack primitive", () => {
		const tree = CardPresentationStack({ children: "card" }) as React.ReactElement<{
			className: string;
			onContextMenu: unknown;
			children: React.ReactNode;
		}>;
		expect(tree.props.className).toBe("flashcard-card-stack");
		expect(tree.props.onContextMenu).toBe("context-menu-handler");
		expect(tree.props.children).toBe("card");
	});
});
