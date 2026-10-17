import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FlashcardButtonProps } from "../../../../../core/ui/primitives/Button";
import type {
	PracticeResultSnapshot,
	SessionCardSnapshot,
} from "../../../domain/sessions/sessionLifecycle";
import { PracticeSummary } from "../Practice/PracticeSummary";

// Exercise the result-screen adapter in node: hooks are stateful doubles and the
// heavy Markdown/Obsidian primitives stay mocked.
const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[] }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state)) hooks.state[index] = initial;
		return [
			hooks.state[index],
			(next: unknown) => {
				hooks.state[index] =
					typeof next === "function"
						? (next as (current: unknown) => unknown)(hooks.state[index])
						: next;
			},
		];
	},
}));
vi.mock("../../../../../core/ui/primitives/Button", () => ({
	FlashcardButton: (props: FlashcardButtonProps) => <button>{props.children}</button>,
}));
vi.mock("../../../../../core/ui/primitives/Header", () => ({ FlashcardHeader: () => <header /> }));
vi.mock("../../../../../core/ui/primitives/Confetti", () => ({ Confetti: () => null }));
vi.mock("../../primitives/Markdown", () => ({ MarkdownContent: () => null }));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "zh", t: (key: string) => key }),
}));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.state = [];
});

function makeCard(index: number): SessionCardSnapshot {
	return {
		identity: `card-${index}`,
		currentDeckId: "deck",
		front: `front-${index}`,
		back: `back-${index}`,
		sourceFile: "deck.md",
		indexInFile: index,
	};
}

function makeResult(incorrectCount: number): PracticeResultSnapshot {
	const totalQuestions = Math.max(incorrectCount, 3);
	return {
		kind: "result",
		mode: "practice",
		originDeck: { id: "deck", name: "Deck" },
		direction: "forward",
		totalQuestions,
		correctCount: totalQuestions - incorrectCount,
		incorrectCount,
		accuracy: 50,
		timeSpent: 5,
		incorrectCards: Array.from({ length: incorrectCount }, (_, index) => makeCard(index)),
	} as unknown as PracticeResultSnapshot;
}

interface ElementProps {
	children?: React.ReactNode;
	onClick?: () => void;
	card?: SessionCardSnapshot;
	index?: number;
}

type SummaryProps = React.ComponentProps<typeof PracticeSummary>;

/** Mounts the summary function directly so a clicked expand button can re-render it. */
function harness(result: PracticeResultSnapshot) {
	const props: SummaryProps = {
		result,
		onRestart: vi.fn(),
		onPracticeIncorrect: vi.fn(),
		onHome: vi.fn(),
		markdownRenderer: async () => {},
	};
	const component = (
		PracticeSummary as unknown as { type: (input: SummaryProps) => React.ReactNode }
	).type;
	let tree: React.ReactNode;

	function findAll(
		predicate: (element: React.ReactElement<ElementProps>) => boolean,
	): React.ReactElement<ElementProps>[] {
		const found: React.ReactElement<ElementProps>[] = [];
		function visit(children: React.ReactNode): void {
			React.Children.forEach(children, (child) => {
				if (!React.isValidElement<ElementProps>(child)) return;
				if (predicate(child)) found.push(child);
				visit(child.props.children);
			});
		}
		visit(tree);
		return found;
	}

	function incorrectRows(): { identity: string; position: number }[] {
		return findAll(
			(element) =>
				element.props.card !== undefined && typeof element.props.index === "number",
		).map((element) => ({
			identity: element.props.card!.identity,
			position: element.props.index!,
		}));
	}

	function expandButton(): React.ReactElement<ElementProps> | undefined {
		return findAll((element) => element.props.children === "practice.showMoreIncorrect")[0];
	}

	function render(): void {
		hooks.cursor = 0;
		tree = component(props);
	}

	function expand(): void {
		const button = expandButton();
		if (!button) throw new Error("Expected an expand button");
		button.props.onClick!();
		render();
	}

	render();
	return { props, render, incorrectRows, expandButton, expand };
}

describe("practice summary incorrect list batching", () => {
	it("mounts only the first screenful of missed cards", () => {
		const h = harness(makeResult(25));

		expect(h.incorrectRows()).toHaveLength(10);
		expect(h.incorrectRows().map((row) => row.identity)).toEqual(
			Array.from({ length: 10 }, (_, index) => `card-${index}`),
		);
		expect(h.expandButton()).toBeDefined();
	});

	it("reveals every missed card in the original order when expanded", () => {
		const h = harness(makeResult(25));

		h.expand();

		expect(h.incorrectRows().map((row) => row.identity)).toEqual(
			Array.from({ length: 25 }, (_, index) => `card-${index}`),
		);
		expect(h.incorrectRows().map((row) => row.position)).toEqual(
			Array.from({ length: 25 }, (_, index) => index + 1),
		);
		expect(h.expandButton()).toBeUndefined();
	});

	it("renders a short list completely without an expand button", () => {
		const h = harness(makeResult(3));

		expect(h.incorrectRows()).toHaveLength(3);
		expect(h.expandButton()).toBeUndefined();
	});

	it("starts a replaced result collapsed again", () => {
		const h = harness(makeResult(25));
		h.expand();
		expect(h.incorrectRows()).toHaveLength(25);

		h.props.result = makeResult(20);
		h.render();

		expect(h.incorrectRows()).toHaveLength(10);
		expect(h.expandButton()).toBeDefined();
	});
});
