import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SessionCardSnapshot } from "../../../../domain/sessions/sessionLifecycle";
import { StudyReviewCard } from "../StudyReviewCard";

const hooks = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useId: () => "card-details",
	useState: () => [
		hooks.state,
		(value: unknown) => {
			hooks.state = value;
		},
	],
}));
vi.mock("../../../primitives/Markdown/MarkdownContent", () => ({ MarkdownContent: () => null }));
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({ t: (key: string) => key }),
}));

interface NodeProps {
	children?: React.ReactNode;
	onClick?: () => void;
	onFocusCapture?: () => void;
	"aria-expanded"?: boolean;
	"aria-controls"?: string;
	"aria-label"?: string;
	"data-expanded"?: boolean;
	id?: string;
	hidden?: boolean;
}

const card: SessionCardSnapshot = {
	identity: "card-1",
	currentDeckId: "deck",
	front: "recommend",
	back: "推荐",
	explanation: "A detailed explanation",
	sourceFile: "notes/English.md",
	indexInFile: 0,
};

function harness() {
	const onOpenSourceFile = vi.fn();
	const component = (
		StudyReviewCard as unknown as {
			type: (props: React.ComponentProps<typeof StudyReviewCard>) => React.ReactNode;
		}
	).type;
	let tree: React.ReactNode;
	function render(nextCard = card) {
		tree = component({ card: nextCard, index: 1, onOpenSourceFile });
	}
	function nodes() {
		const found: React.ReactElement<NodeProps>[] = [];
		function visit(children: React.ReactNode) {
			React.Children.forEach(children, (child) => {
				if (!React.isValidElement<NodeProps>(child)) return;
				found.push(child);
				visit(child.props.children);
			});
		}
		visit(tree);
		return found;
	}
	function toggle() {
		return nodes().find((node) => node.props["aria-controls"] === "card-details")!;
	}
	render();
	return { render, nodes, toggle, onOpenSourceFile };
}

beforeEach(() => {
	hooks.state = null;
});

describe("study review card disclosure", () => {
	it("starts collapsed and mounts the explanation only when expanded", () => {
		const h = harness();
		expect(h.toggle().props["aria-expanded"]).toBe(false);
		expect(h.nodes().some((node) => node.props.children === card.explanation)).toBe(false);
		h.toggle().props.onClick!();
		h.render();
		expect(h.toggle().props["aria-expanded"]).toBe(true);
		expect(h.nodes().find((node) => node.props.id === "card-details")?.props.hidden).toBe(
			false,
		);
		expect(h.nodes().some((node) => node.props.children === card.explanation)).toBe(true);
		h.toggle().props.onClick!();
		h.render();
		expect(h.toggle().props["aria-expanded"]).toBe(false);
	});

	it("collapses when the same identity is replaced by a new result snapshot", () => {
		const h = harness();
		h.toggle().props.onClick!();
		h.render({ ...card, explanation: "Updated explanation" });
		expect(h.toggle().props["aria-expanded"]).toBe(false);
	});

	it("opens the exact source without expanding the card", () => {
		const h = harness();
		h.nodes().find((node) => node.props["aria-label"] === "study.openNote: notes/English.md")
			?.props.onClick!();
		expect(h.onOpenSourceFile).toHaveBeenCalledWith("notes/English.md");
		h.render();
		expect(h.toggle().props["aria-expanded"]).toBe(false);
	});

	it("reveals clipped content when a Markdown link receives keyboard focus", () => {
		const h = harness();
		h.nodes().find((node) => node.props.onFocusCapture)?.props.onFocusCapture!();
		h.render();
		expect(h.toggle().props["aria-expanded"]).toBe(true);
	});
});
