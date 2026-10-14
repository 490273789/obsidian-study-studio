import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor } from "@dnd-kit/core";
import type { DragEndEvent, DndContextProps } from "@dnd-kit/core";
import type { DeckHome, DeckHomeSnapshot } from "../../../../domain/decks/deckHome";
import { restoreDailyLearningActivity } from "../../../../domain/history/dailyLearningActivity";
import { DeckList } from "../DeckList";

// Exercise the component's events and emitted dnd-kit boundary in node. Sensor
// classes remain real; native DOM hit testing is outside this adapter test.
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
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
}));
vi.mock("@dnd-kit/sortable", async (original) => ({
	...(await original<typeof import("@dnd-kit/sortable")>()),
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: () => {},
		setActivatorNodeRef: () => {},
	}),
}));
vi.mock("@dnd-kit/core", async (original) => ({
	...(await original<typeof import("@dnd-kit/core")>()),
	useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
	useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("../../DeckSettings", () => ({ DeckSettingsModal: () => null }));
vi.mock("../LearningFootprint", () => ({ LearningFootprint: () => null }));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.state = [];
	vi.stubGlobal("requestAnimationFrame", () => 1);
});
afterEach(() => vi.unstubAllGlobals());

interface ElementProps {
	children?: React.ReactNode;
	className?: string;
	onClick?: (event: { stopPropagation(): void }) => void;
	deck?: { id: string };
	"data-state"?: string;
	"aria-expanded"?: boolean;
}

/** Flattens rendered text so an assertion can name a button by its label. */
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

function findElement(
	node: React.ReactNode,
	predicate: (element: React.ReactElement<ElementProps>) => boolean,
): React.ReactElement<ElementProps> {
	let found: React.ReactElement<ElementProps> | undefined;
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (found || !React.isValidElement<ElementProps>(child)) return;
			if (predicate(child)) found = child;
			else visit(child.props.children);
		});
	}
	visit(node);
	if (!found) throw new Error("Expected view element");
	return found;
}

interface DeckOverrides {
	id: string;
	totalCards: number;
	newCards: number;
	studyCount?: number;
}

/** Two untouched decks by default; callers pass overrides for other states. */
function harness(decks?: DeckOverrides[]) {
	const act = vi.fn<DeckHome["act"]>(async () => ({ kind: "applied" }));
	const deckInputs: DeckOverrides[] = decks ?? [
		{ id: "first", totalCards: 1, newCards: 1 },
		{ id: "second", totalCards: 1, newCards: 1 },
	];
	const snapshot: DeckHomeSnapshot = {
		revision: 0,
		evaluatedAt: 0,
		decks: deckInputs.map((input) => ({
			id: input.id,
			name: input.id,
			filePath: `${input.id}.md`,
			tag: "#cards",
			studyCount: input.studyCount ?? 0,
			stats: {
				totalCards: input.totalCards,
				newCards: input.newCards,
				dueCards: 0,
				learningCards: 0,
				reviewCards: 0,
				relearningCards: 0,
			},
			spelling: {
				enabled: false,
				ready: false,
				valid: true,
				canStart: false,
				hasStableIdentities: true,
				issueCount: 0,
				ignoredCardCount: 0,
			},
		})),
		totals: {
			deckCount: deckInputs.length,
			totalCards: deckInputs.reduce((sum, deck) => sum + deck.totalCards, 0),
			newCards: deckInputs.reduce((sum, deck) => sum + deck.newCards, 0),
			dueCards: 0,
			studyCount: 0,
		},
		learningFootprint: restoreDailyLearningActivity(undefined).footprint(new Date(0)),
		challenge: { savedRoundId: null, eligibleCount: 0, lastMode: "random", round: null },
		migration: null,
		mutation: { kind: "idle" },
		export: { kind: "idle" },
		settingsDraft: null,
	};
	const props: React.ComponentProps<typeof DeckList> = {
		snapshot,
		home: { act } as unknown as DeckHome,
		ownerId: "view",
		onNavigate: vi.fn(),
		onRequestMigration: vi.fn(async () => false),
		onOpenSourceFile: vi.fn(),
		onOpenStats: vi.fn(),
		onOpenSettings: vi.fn(),
		onOpenAddCard: vi.fn(),
	};
	let tree: React.ReactNode;
	const component = (
		DeckList as unknown as {
			type: (input: React.ComponentProps<typeof DeckList>) => React.ReactNode;
		}
	).type;
	function render(): void {
		hooks.cursor = 0;
		tree = component(props);
	}
	function dnd(): DndContextProps {
		return findElement(tree, (element) => element.type === DndContext).props as DndContextProps;
	}
	function findAll(
		node: React.ReactNode,
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
		visit(node);
		return found;
	}
	function clickCardButton(className: string): void {
		const card = findElement(tree, (element) => element.props.deck?.id === "first");
		const renderCard = (
			card.type as unknown as { type: (props: ElementProps) => React.ReactNode }
		).type;
		const button = findElement(
			renderCard(card.props),
			(element) => element.props.className?.includes(className) === true,
		);
		button.props.onClick!({ stopPropagation: vi.fn() });
		render();
	}
	function drop(): void {
		dnd().onDragEnd!({ active: { id: "first" }, over: { id: "second" } } as DragEndEvent);
		render();
	}
	function clickTreeButton(className: string): void {
		const button = findElement(
			tree,
			(element) =>
				element.type === "button" && element.props.className?.includes(className) === true,
		);
		button.props.onClick!({ stopPropagation: vi.fn() });
		render();
	}
	function deckIds(): string[] {
		return findAll(tree, (element) => element.props.deck !== undefined).map(
			(element) => element.props.deck!.id,
		);
	}
	render();
	return {
		act,
		props,
		render,
		dnd,
		drop,
		clickCardButton,
		clickTreeButton,
		deckIds,
		findAll,
		findElement: (
			node: React.ReactNode,
			predicate: (element: React.ReactElement<ElementProps>) => boolean,
		) => findElement(node, predicate),
		tree: () => tree,
	};
}

/** Renders one deck card and returns the `<article>` it produces. */
function renderDeckCard(
	element: React.ReactElement<ElementProps>,
): React.ReactElement<ElementProps> {
	const renderCard = (
		element.type as unknown as { type: (props: ElementProps) => React.ReactNode }
	).type;
	return renderCard(element.props) as React.ReactElement<ElementProps>;
}

describe("deck reorder availability", () => {
	it.each([
		["mouse", MouseSensor],
		["touch", TouchSensor],
		["keyboard", KeyboardSensor],
	] as const)(
		"disables %s while a card menu is open and restores it on close",
		(_name, sensor) => {
			const h = harness();
			expect(h.dnd().sensors?.some((entry) => entry.sensor === sensor)).toBe(true);
			h.clickCardButton("flashcard-deck-action-more");
			expect(h.dnd().sensors).toEqual([]);
			h.clickCardButton("flashcard-deck-overlay-close");
			expect(h.dnd().sensors?.some((entry) => entry.sensor === sensor)).toBe(true);
		},
	);

	it.each(["applied", "failed"] as const)(
		"blocks all input methods until the reorder save settles (%s)",
		async (outcome) => {
			const h = harness();
			let settle!: () => void;
			h.act.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						settle = () =>
							resolve(
								outcome === "applied"
									? { kind: "applied" }
									: { kind: "failed", message: "save failed" },
							);
					}),
			);
			h.drop();
			expect(h.act).toHaveBeenCalledExactlyOnceWith({
				kind: "reorder",
				deckIds: ["second", "first"],
			});
			expect(h.dnd().sensors).toEqual([]);
			h.drop();
			expect(h.act).toHaveBeenCalledTimes(1);
			settle();
			await Promise.resolve();
			h.render();
			expect(h.dnd().sensors?.map((entry) => entry.sensor)).toEqual([
				MouseSensor,
				TouchSensor,
				KeyboardSensor,
			]);
		},
	);

	it("ignores a pending sensor's late drop after the menu disables sorting", () => {
		const h = harness();
		h.clickCardButton("flashcard-deck-action-more");
		h.drop();
		expect(h.act).not.toHaveBeenCalled();
	});
});

describe("deck row presentation state", () => {
	it("marks an untouched deck as fresh and a partly learned deck as active", () => {
		const h = harness([
			{ id: "untouched", totalCards: 10, newCards: 10 },
			{ id: "started", totalCards: 10, newCards: 7, studyCount: 2 },
		]);
		const states = h
			.findAll(h.tree(), (element) => element.props.deck !== undefined)
			.map((element) => [
				element.props.deck!.id,
				renderDeckCard(element).props["data-state"],
			]);
		expect(states).toEqual([
			["untouched", "fresh"],
			["started", "active"],
		]);
	});

	it("shows 复习 instead of 学习 for a deck with nothing left to learn", () => {
		const h = harness([{ id: "finished", totalCards: 7, newCards: 0, studyCount: 1 }]);
		// state="done" routes the deck into the collapsed group, so it is not in
		// the sortable list until that group is opened.
		h.clickTreeButton("flashcard-completed-group-toggle");
		const card = h.findElement(h.tree(), (element) => element.props.deck?.id === "finished");
		const article = renderDeckCard(card);
		expect(article.props["data-state"]).toBe("done");
		const study = findElement(
			article.props.children,
			(element) => element.props.className?.includes("flashcard-deck-action-study") === true,
		);
		expect(textOf(study.props.children)).toContain("home.review");
	});
});
