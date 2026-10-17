import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { KeyboardSensor, MouseSensor, TouchSensor } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent, DndContextProps } from "@dnd-kit/core";
import { rectSortingStrategy } from "@dnd-kit/sortable";
import type {
	DeckHome,
	DeckHomeSettingsDraft,
	DeckHomeSnapshot,
} from "../../../../domain/decks/deckHome";
import { restoreDailyLearningActivity } from "../../../../domain/history/dailyLearningActivity";
import { DEFAULT_SETTINGS } from "../../../../../../core/host/settingsSlices";
import { DeckList } from "../DeckList";
import type { DeckCardPresentation } from "../../../deckCardPresentation";
import { ReorderableList } from "../../../../../../core/ui/primitives/Sortable/Sortable";
import type { SortableInteraction } from "../../../../../../core/ui/primitives/Sortable/sortableInteraction";

// Exercise the component's events and emitted dnd-kit boundary in node. Sensor
// classes remain real; native DOM hit testing is outside this adapter test.
const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[] }));
const drag = vi.hoisted(() => ({
	activeId: null as string | null,
	transforms: {} as Record<string, { x: number; y: number; scaleX: number; scaleY: number }>,
}));
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
	useId: () => "completed-decks",
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
	useLayoutEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
const sortingAdapter = vi.hoisted(() => ({ interaction: null as SortableInteraction | null }));
vi.mock("../../../../../../core/ui/primitives/Sortable/Sortable", async (original) => {
	const actual =
		await original<typeof import("../../../../../../core/ui/primitives/Sortable/Sortable")>();
	const { SortableInteraction } =
		await import("../../../../../../core/ui/primitives/Sortable/sortableInteraction");
	return {
		...actual,
		useSortableInteraction: (input: ConstructorParameters<typeof SortableInteraction>[0]) => {
			if (!sortingAdapter.interaction) {
				sortingAdapter.interaction = new SortableInteraction(input);
				sortingAdapter.interaction.mount();
			} else sortingAdapter.interaction.update(input);
			return {
				interaction: sortingAdapter.interaction,
				snapshot: sortingAdapter.interaction.getSnapshot(),
			};
		},
	};
});
vi.mock("@dnd-kit/sortable", async (original) => ({
	...(await original<typeof import("@dnd-kit/sortable")>()),
	useSortable: ({ id }: { id: string }) => ({
		attributes: {},
		listeners: {},
		setNodeRef: () => {},
		setActivatorNodeRef: () => {},
		isDragging: drag.activeId === id,
		transform: drag.transforms[id] ?? null,
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
	sortingAdapter.interaction = null;
	drag.activeId = null;
	drag.transforms = {};
	vi.stubGlobal("requestAnimationFrame", () => 1);
});
afterEach(() => vi.unstubAllGlobals());

interface ElementProps {
	children?: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
	onClick?: (event: { stopPropagation(): void }) => void;
	presentation?: DeckCardPresentation;
	onMenuOpenChange?: (deckId: string, open: boolean) => void;
	"data-state"?: string;
	"aria-expanded"?: boolean;
	ariaExpanded?: boolean;
	onKeyDown?: (event: { key: string; preventDefault(): void }) => void;
	right?: React.ReactNode;
	badge?: React.ReactNode;
	"aria-controls"?: string;
	id?: string;
	hidden?: boolean;
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
			effectiveStudySettings: {
				dailyNewCards: DEFAULT_SETTINGS.dailyNewCards,
				dailyReviewCards: DEFAULT_SETTINGS.dailyReviewCards,
				studyOrder: DEFAULT_SETTINGS.studyOrder,
				fsrsParameters: DEFAULT_SETTINGS.fsrsParameters,
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
		studyHistory: [],
		spellingProgress: {},
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
		const list = findElement(
			tree,
			(element) => element.type === ReorderableList,
		) as React.ReactElement<React.ComponentProps<typeof ReorderableList>>;
		return ReorderableList(list.props).props as DndContextProps;
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
	function setCardMenu(deckId: string, open: boolean): void {
		const card = findElement(tree, (element) => element.props.presentation?.deck.id === deckId);
		card.props.onMenuOpenChange!(deckId, open);
		render();
	}
	function drop(): void {
		const props = dnd();
		props.onDragStart!({ active: { id: "first" } } as DragStartEvent);
		props.onDragEnd!({ active: { id: "first" }, over: { id: "second" } } as DragEndEvent);
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
		return presentations().map((presentation) => presentation.deck.id);
	}
	function presentations(): DeckCardPresentation[] {
		return findAll(tree, (element) => element.props.presentation !== undefined).map(
			(element) => element.props.presentation!,
		);
	}
	render();
	return {
		act,
		props,
		render,
		dnd,
		drop,
		setCardMenu,
		clickTreeButton,
		deckIds,
		presentations,
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

function makeSettingsDraft(ownerId: string, deckId: string): DeckHomeSettingsDraft {
	return {
		ownerId,
		deckId,
		deckName: deckId,
		filePath: `${deckId}.md`,
		totalCards: 1,
		useCustom: false,
		dailyNewCards: DEFAULT_SETTINGS.dailyNewCards,
		dailyReviewCards: DEFAULT_SETTINGS.dailyReviewCards,
		studyOrder: DEFAULT_SETTINGS.studyOrder,
		requestRetention: DEFAULT_SETTINGS.fsrsParameters.requestRetention,
		maximumInterval: "36500",
		daysToComplete: "10",
		wordLearningEnabled: false,
		global: {
			dailyNewCards: DEFAULT_SETTINGS.dailyNewCards,
			dailyReviewCards: DEFAULT_SETTINGS.dailyReviewCards,
			studyOrder: DEFAULT_SETTINGS.studyOrder,
			fsrsParameters: DEFAULT_SETTINGS.fsrsParameters,
		},
		spelling: { canStart: false, hasStableIdentities: true, invalidCards: [] },
	};
}

describe("deck reorder availability", () => {
	it("keeps scale on the dragged deck when another deck enters its original position", () => {
		const h = harness();
		expect((h.dnd().children as React.ReactElement<{ strategy: unknown }>).props.strategy).toBe(
			rectSortingStrategy,
		);
		const cards = h.findAll(h.tree(), (element) => element.props.presentation !== undefined);
		const [first, second] = cards;
		drag.activeId = first!.props.presentation!.deck.id;
		// Reproduce the geometry after pickup: the active row has visually shrunk.
		const rects = [
			{ left: 0, top: 0, width: 380, height: 95, right: 380, bottom: 95 },
			{ left: 0, top: 100, width: 400, height: 100, right: 400, bottom: 200 },
		];
		for (const overIndex of [0, 1, 0, 1]) {
			cards.forEach((card, index) => {
				drag.transforms[card.props.presentation!.deck.id] = rectSortingStrategy({
					activeIndex: 0,
					overIndex,
					index,
					rects,
					activeNodeRect: rects[0]!,
				})!;
			});
			const dragged = renderDeckCard(first!);
			const displaced = renderDeckCard(second!);
			expect(dragged.props.style?.transform).toContain("scaleX(0.95) scaleY(0.95)");
			expect(displaced.props.style?.transform).toContain("scaleX(1) scaleY(1)");
		}
		drag.activeId = null;
		drag.transforms = {};
		expect(renderDeckCard(first!).props.style?.transform).toBeUndefined();
	});

	it.each([
		["mouse", MouseSensor],
		["touch", TouchSensor],
		["keyboard", KeyboardSensor],
	] as const)(
		"disables %s while a card menu is open and restores it on close",
		(_name, sensor) => {
			const h = harness();
			expect(h.dnd().sensors?.some((entry) => entry.sensor === sensor)).toBe(true);
			h.setCardMenu("first", true);
			expect(h.dnd().sensors).toEqual([]);
			h.setCardMenu("first", false);
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
		const pending = h.dnd();
		pending.onDragStart!({ active: { id: "first" } } as DragStartEvent);
		h.setCardMenu("first", true);
		pending.onDragEnd!({ active: { id: "first" }, over: { id: "second" } } as DragEndEvent);
		expect(h.act).not.toHaveBeenCalled();
	});

	it("previews the working order and appends completed decks only in the owner's save", () => {
		const h = harness([
			{ id: "first", totalCards: 5, newCards: 5 },
			{ id: "finished", totalCards: 5, newCards: 0 },
			{ id: "second", totalCards: 5, newCards: 5 },
		]);
		h.drop();
		expect(h.deckIds()).toEqual(["second", "first"]);
		expect(h.act).toHaveBeenCalledExactlyOnceWith({
			kind: "reorder",
			deckIds: ["second", "first", "finished"],
		});
	});

	it("invalidates a pending gesture when the owner replaces the ordered deck IDs", () => {
		const h = harness();
		const pending = h.dnd();
		pending.onDragStart!({ active: { id: "first" } } as DragStartEvent);
		h.props.snapshot = { ...h.props.snapshot, decks: [...h.props.snapshot.decks].reverse() };
		h.render();
		pending.onDragEnd!({ active: { id: "first" }, over: { id: "second" } } as DragEndEvent);
		expect(h.act).not.toHaveBeenCalled();
	});

	it("shows the latest owner snapshot after a failed save, including newly added decks", async () => {
		const h = harness();
		let fail!: () => void;
		h.act.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					fail = () => resolve({ kind: "failed", message: "save failed" });
				}),
		);
		h.drop();
		h.props.snapshot = {
			...h.props.snapshot,
			decks: [{ ...h.props.snapshot.decks[0]!, id: "third" }, ...h.props.snapshot.decks],
		};
		h.render();
		expect(h.deckIds()).toEqual(["third", "first", "second"]);
		expect(h.dnd().sensors).toEqual([]);
		fail();
		await Promise.resolve();
		await Promise.resolve();
		h.render();
		expect(h.deckIds()).toEqual(["third", "first", "second"]);
		expect(h.dnd().sensors).toHaveLength(3);
	});
});

describe("deck row presentation state", () => {
	it("keeps completed decks collapsed and connects the disclosure to its group", () => {
		const h = harness([
			{ id: "new", totalCards: 10, newCards: 10 },
			{ id: "finished", totalCards: 7, newCards: 0, studyCount: 1 },
		]);
		const toggle = () =>
			h.findElement(h.tree(), (element) => element.props["aria-controls"] !== undefined);
		const body = () =>
			h.findElement(
				h.tree(),
				(element) => element.props.id === toggle().props["aria-controls"],
			);

		expect(toggle().props["aria-expanded"]).toBe(false);
		expect(body().props.hidden).toBe(true);
		expect(h.deckIds()).toEqual(["new"]);
		expect(textOf(toggle().props.children)).toContain("home.completedGroupTitle");
		h.clickTreeButton("flashcard-completed-group-toggle");
		expect(toggle().props["aria-expanded"]).toBe(true);
		expect(body().props.hidden).toBe(false);
		expect(h.deckIds()).toEqual(["new", "finished"]);
		h.clickTreeButton("flashcard-completed-group-toggle");
		expect(toggle().props["aria-expanded"]).toBe(false);
		expect(body().props.hidden).toBe(true);
		expect(h.deckIds()).toEqual(["new"]);
		expect(h.act).not.toHaveBeenCalled();
	});

	it("marks an untouched deck as fresh and a partly learned deck as active", () => {
		const h = harness([
			{ id: "untouched", totalCards: 10, newCards: 10 },
			{ id: "started", totalCards: 10, newCards: 7, studyCount: 2 },
		]);
		const states = h
			.findAll(h.tree(), (element) => element.props.presentation !== undefined)
			.map((element) => [
				element.props.presentation!.deck.id,
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
		const card = h.findElement(
			h.tree(),
			(element) => element.props.presentation?.deck.id === "finished",
		);
		const article = renderDeckCard(card);
		expect(article.props["data-state"]).toBe("done");
		const study = findElement(
			article.props.children,
			(element) => element.props.className?.includes("flashcard-deck-action-study") === true,
		);
		expect(textOf(study.props.children)).toContain("home.review");
	});

	it("keeps unchanged row models referentially stable across unrelated publishes", () => {
		const h = harness([
			{ id: "started", totalCards: 10, newCards: 7, studyCount: 2 },
			{ id: "untouched", totalCards: 10, newCards: 10 },
		]);
		const before = h.presentations();
		// A publish that only touches unrelated read model fields: same deck
		// objects, new snapshot wrapper.
		h.props.snapshot = {
			...h.props.snapshot,
			revision: 1,
			mutation: { kind: "refreshing" },
			totals: { ...h.props.snapshot.totals },
		};
		h.render();
		const after = h.presentations();

		expect(after).toHaveLength(2);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
	});

	it("rebuilds only the rows whose deck content changed", () => {
		const h = harness([
			{ id: "started", totalCards: 10, newCards: 7, studyCount: 2 },
			{ id: "untouched", totalCards: 10, newCards: 10 },
		]);
		const before = h.presentations();
		// Deck home rebuilds every deck wrapper on each publish, so unchanged
		// content must still keep its row model.
		h.props.snapshot = {
			...h.props.snapshot,
			decks: h.props.snapshot.decks.map((deck) =>
				deck.id === "untouched"
					? { ...deck, stats: { ...deck.stats, newCards: 4 } }
					: { ...deck },
			),
		};
		h.render();
		const after = h.presentations();

		expect(after[0]).toBe(before[0]);
		expect(after[1]).not.toBe(before[1]);
		expect(after[1]!.learnedCards).toBe(6);
	});

	it("refreshes row models when the settings draft or export target changes", () => {
		const h = harness();
		const before = h.presentations();

		h.props.snapshot = {
			...h.props.snapshot,
			settingsDraft: makeSettingsDraft("", "first"),
		};
		h.render();
		const locked = h.presentations();

		expect(locked[0]).not.toBe(before[0]);
		expect(locked[1]).not.toBe(before[1]);
		expect(locked[0]!.isSettingsLocked).toBe(false);
		expect(locked[1]!.isSettingsLocked).toBe(true);

		h.props.snapshot = {
			...h.props.snapshot,
			settingsDraft: makeSettingsDraft("", "second"),
		};
		h.render();
		const retargeted = h.presentations();

		expect(retargeted[0]).not.toBe(locked[0]);
		expect(retargeted[0]!.isSettingsLocked).toBe(true);
		expect(retargeted[1]!.isSettingsLocked).toBe(false);

		h.props.snapshot = {
			...h.props.snapshot,
			settingsDraft: null,
			export: { kind: "exporting", deckId: "second", phase: null, completed: 0, total: 1 },
		};
		h.render();
		const exporting = h.presentations();

		expect(exporting[0]).not.toBe(retargeted[0]);
		expect(exporting[0]!.isExporting).toBe(false);
		expect(exporting[0]!.isExportBusy).toBe(true);
		expect(exporting[1]!.isExporting).toBe(true);
	});
});

describe("mobile header collapse", () => {
	it("defaults to collapsed with aria-expanded false and toggles on header click", () => {
		const h = harness();
		const getHeader = () =>
			h.findElement(
				h.tree(),
				(element) => element.props.className?.includes("homeHeader") === true,
			);

		// Defaults to collapsed
		const initialHeader = getHeader();
		expect(initialHeader.props.ariaExpanded).toBe(false);
		expect(initialHeader.props.className).toContain("isCollapsed");

		// Clicking header toggles to expanded
		initialHeader.props.onClick!({ stopPropagation: vi.fn() });
		h.render();

		const expandedHeader = getHeader();
		expect(expandedHeader.props.ariaExpanded).toBe(true);
		expect(expandedHeader.props.className).not.toContain("isCollapsed");

		// Clicking again collapses
		expandedHeader.props.onClick!({ stopPropagation: vi.fn() });
		h.render();

		const collapsedAgain = getHeader();
		expect(collapsedAgain.props.ariaExpanded).toBe(false);
		expect(collapsedAgain.props.className).toContain("isCollapsed");
	});

	it("toggles collapse state with Enter and Space keys", () => {
		const h = harness();
		const getHeader = () =>
			h.findElement(
				h.tree(),
				(element) => element.props.className?.includes("homeHeader") === true,
			);

		const header = getHeader();
		const preventDefault = vi.fn();
		header.props.onKeyDown!({ key: "Enter", preventDefault });
		expect(preventDefault).toHaveBeenCalled();
		h.render();

		expect(getHeader().props.ariaExpanded).toBe(true);

		getHeader().props.onKeyDown!({ key: " ", preventDefault });
		h.render();

		expect(getHeader().props.ariaExpanded).toBe(false);
	});

	it("stops propagation when clicking the header action buttons container", () => {
		const h = harness();
		const header = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("homeHeader") === true,
		);
		const actions = h.findElement(
			header.props.right,
			(element) => element.props.className === "flashcard-header-actions",
		);
		const stopPropagation = vi.fn();
		actions.props.onClick!({ stopPropagation });
		expect(stopPropagation).toHaveBeenCalled();
	});
});
