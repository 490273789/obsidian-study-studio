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

function harness() {
	const act = vi.fn<DeckHome["act"]>(async () => ({ kind: "applied" }));
	const snapshot: DeckHomeSnapshot = {
		revision: 0,
		evaluatedAt: 0,
		decks: ["first", "second"].map((id) => ({
			id,
			name: id,
			filePath: `${id}.md`,
			tag: "#cards",
			studyCount: 0,
			stats: {
				totalCards: 1,
				newCards: 1,
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
		totals: { deckCount: 2, totalCards: 2, newCards: 2, dueCards: 0, studyCount: 0 },
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
	render();
	return { act, render, dnd, drop, clickCardButton };
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
