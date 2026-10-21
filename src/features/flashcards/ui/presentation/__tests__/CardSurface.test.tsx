import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PresentedCard, PresentedCardKind } from "../../answerPresentationTransition";
import type { ChallengeQuestionMode } from "../../../domain/sessions/challengeSessionEngine";
import { CardSurface } from "../CardSurface";
import { CardAnswerSection, CardQuestionPanel } from "../CardPanels";
import { CardPresentationStack } from "../CardPresentationStack";

vi.mock("obsidian", () => ({ Component: class Component {} }));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("../context", () => ({
	useCardPresentationDependencies: () => ({
		markdownRenderer: vi.fn(),
		pronunciationRuntime: { stop: vi.fn() },
	}),
}));

const card = {
	identity: "hello",
	currentDeckId: "deck",
	front: "front",
	back: "back",
	explanation: "explanation",
	sourceFile: "deck.md",
	indexInFile: 0,
};

function presented(kind: PresentedCardKind, overrides: Partial<PresentedCard> = {}): PresentedCard {
	return {
		kind,
		card,
		direction: "normal",
		encounterKey: "encounter",
		presentationKey: "presentation",
		...overrides,
	};
}

interface SurfaceInput {
	kind: PresentedCardKind;
	answerVisible: boolean;
	questionMode?: ChallengeQuestionMode;
	children?: React.ReactNode;
	overrides?: Partial<PresentedCard>;
}

function surface(input: SurfaceInput) {
	const rendered = CardSurface({
		presented: presented(input.kind, {
			...(input.questionMode ? { questionMode: input.questionMode } : {}),
			...input.overrides,
		}),
		answerVisible: input.answerVisible,
		pronunciationWord: null,
		children: input.children,
	}) as React.ReactElement<{ children: React.ReactNode }>;
	expect(rendered.type).toBe(CardPresentationStack);
	const children = React.Children.toArray(rendered.props.children) as React.ReactElement[];
	const question = children.find((child) => child.type === CardQuestionPanel) as
		| React.ReactElement<{ block: { label: string; content: string } }>
		| undefined;
	const answer = children.find((child) => child.type === CardAnswerSection) as
		| React.ReactElement<{
				answer: { content: string };
				explanation: { content: string } | null;
		  }>
		| undefined;
	const extraChildren = children.filter(
		(child) => child.type !== CardQuestionPanel && child.type !== CardAnswerSection,
	);
	return {
		key: rendered.key,
		questionLabel: question?.props.block.label,
		question: question?.props.block,
		answer: answer?.props.answer,
		explanation: answer?.props.explanation,
		childCount: extraChildren.length,
	};
}

describe("CardSurface", () => {
	it("keys the stack by the presented presentation key", () => {
		expect(surface({ kind: "study", answerVisible: false }).key).toBe("presentation");
	});

	it("shows only the question before the answer is revealed", () => {
		const result = surface({ kind: "study", answerVisible: false });
		expect(result.question?.content).toBe("front");
		expect(result.answer).toBeUndefined();
	});

	it("renders the answer and explanation for a revealed study card", () => {
		const result = surface({ kind: "study", answerVisible: true });
		expect(result.question?.content).toBe("front");
		expect(result.answer?.content).toBe("back");
		expect(result.explanation?.content).toBe("explanation");
	});

	it("never renders a spelling answer panel and keeps mode children", () => {
		const child = React.createElement("output", { role: "status" }, "feedback");
		const result = surface({
			kind: "spelling",
			answerVisible: true,
			overrides: { direction: "reversed" },
			children: child,
		});
		expect(result.questionLabel).toBe("spelling.meaningPrompt");
		expect(result.question?.content).toBe("back");
		expect(result.answer).toBeUndefined();
		expect(result.childCount).toBe(1);
	});

	it("labels a challenge spelling question and reveals its answer from feedback", () => {
		const hidden = surface({
			kind: "challenge",
			answerVisible: false,
			questionMode: "spelling",
			overrides: { direction: "reversed" },
		});
		expect(hidden.questionLabel).toBe("challenge.spellingPrompt");
		expect(hidden.question?.content).toBe("back");
		expect(hidden.answer).toBeUndefined();

		const revealed = surface({
			kind: "challenge",
			answerVisible: true,
			questionMode: "reversed",
			overrides: { direction: "reversed" },
		});
		expect(revealed.questionLabel).toBe("common.question");
		expect(revealed.answer?.content).toBe("front");
	});
});
