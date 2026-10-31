import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { KeyboardSensor, MouseSensor, TouchSensor } from "@dnd-kit/core";
import { Languages } from "lucide-react";
import type { DragEndEvent, DragStartEvent, DndContextProps } from "@dnd-kit/core";
import { rectSortingStrategy } from "@dnd-kit/sortable";
import type {
	DeckHome,
	DeckHomeDeckSnapshot,
	DeckHomeSnapshot,
} from "../../../../domain/decks/deckHome";
import type {
	DeckSettingsDraftSession,
	DeckSettingsDraftSnapshot,
	DeckSettingsOutcome,
} from "../../../../domain/decks/deckSettingsDraftSession";
import { restoreDailyLearningActivity } from "../../../../domain/history/dailyLearningActivity";
import { DEFAULT_SETTINGS } from "../../../../../../core/host/settingsSlices";
import { DeckList } from "../DeckList";
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
	useRef: () => ({ current: null }),
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
	deck?: DeckHomeDeckSnapshot;
	isSettingsLocked?: boolean;
	isExporting?: boolean;
	isExportBusy?: boolean;
	onMenuOpenChange?: (deckId: string, open: boolean) => void;
	isMenuOpen?: boolean;
	"data-state"?: string;
	"aria-expanded"?: boolean;
	ariaExpanded?: boolean;
	"aria-label"?: string;
	title?: string;
	right?: React.ReactNode;
	badge?: React.ReactNode;
	"aria-controls"?: string;
	id?: string;
	hidden?: boolean;
	footprint?: unknown;
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
	};
	let currentDraft: DeckSettingsDraftSnapshot | null = null;
	const openSpy = vi.fn((): DeckSettingsOutcome => ({ kind: "applied" }));
	const settingsDraftSession: DeckSettingsDraftSession = {
		getSnapshot: vi.fn(() => currentDraft),
		subscribe: vi.fn(() => () => {}),
		open: openSpy,
		change: vi.fn((): DeckSettingsOutcome => ({ kind: "applied" })),
		save: vi.fn(async (): Promise<DeckSettingsOutcome> => ({ kind: "applied" })),
		cancel: vi.fn((): DeckSettingsOutcome => ({ kind: "applied" })),
		releaseOwner: vi.fn((): DeckSettingsOutcome => ({ kind: "applied" })),
		isLocked: vi.fn((deckId: string, ownerId: string): boolean => {
			if (!currentDraft) return false;
			if (currentDraft.ownerId === ownerId) return false;
			return currentDraft.ownerId !== "" || currentDraft.deckId !== deckId;
		}),
		dispose: vi.fn(),
	};
	const props: React.ComponentProps<typeof DeckList> = {
		snapshot,
		home: { act } as unknown as DeckHome,
		ownerId: "view",
		settingsDraftSession,
		onNavigate: vi.fn(),
		onRequestMigration: vi.fn(async () => false),
		onOpenSourceFile: vi.fn(),
		onOpenStats: vi.fn(),
		onOpenSettings: vi.fn(),
		onOpenAddCard: vi.fn(),
		shortcuts: [],
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
		const card = findElement(tree, (element) => element.props.deck?.id === deckId);
		card.props.onMenuOpenChange!(deckId, open);
		render();
	}
	function openCardMenuIds(): string[] {
		return findAll(tree, (element) => element.props.isMenuOpen === true).map(
			(element) => element.props.deck!.id,
		);
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
		return deckRows().map((deck) => deck.id);
	}
	function deckRows(): DeckHomeDeckSnapshot[] {
		return findAll(tree, (element) => element.props.deck !== undefined).map(
			(element) => element.props.deck!,
		);
	}
	render();
	return {
		act,
		props,
		render,
		setDraft: (draft: DeckSettingsDraftSnapshot | null) => {
			currentDraft = draft;
		},
		settingsDraftSession,
		openSpy,
		dnd,
		drop,
		setCardMenu,
		openCardMenuIds,
		clickTreeButton,
		deckIds,
		deckRows,
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

function makeSettingsDraft(ownerId: string, deckId: string): DeckSettingsDraftSnapshot {
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
		isSaving: false,
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
		const cards = h.findAll(h.tree(), (element) => element.props.deck !== undefined);
		const [first, second] = cards;
		drag.activeId = first!.props.deck!.id;
		// Reproduce the geometry after pickup: the active row has visually shrunk.
		const rects = [
			{ left: 0, top: 0, width: 380, height: 95, right: 380, bottom: 95 },
			{ left: 0, top: 100, width: 400, height: 100, right: 400, bottom: 200 },
		];
		for (const overIndex of [0, 1, 0, 1]) {
			cards.forEach((card, index) => {
				drag.transforms[card.props.deck!.id] = rectSortingStrategy({
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

	it("keeps the action overlay on only one deck row", () => {
		const h = harness();
		h.setCardMenu("first", true);
		expect(h.openCardMenuIds()).toEqual(["first"]);
		h.setCardMenu("second", true);
		expect(h.openCardMenuIds()).toEqual(["second"]);
		h.setCardMenu("first", false);
		expect(h.openCardMenuIds()).toEqual(["second"]);
		h.setCardMenu("second", false);
		expect(h.openCardMenuIds()).toEqual([]);
	});

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
	it("keeps the current recommendation rule and opens the recommended deck", () => {
		const h = harness([
			{ id: "fresh", totalCards: 100, newCards: 100 },
			{ id: "started", totalCards: 10, newCards: 6, studyCount: 1 },
		]);
		const title = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("resumeTitle") === true,
		);
		const button = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("resumeButton") === true,
		);

		expect(textOf(title.props.children)).toBe("home.resumeHeading");
		expect(textOf(button.props.children)).toBe("home.continueStudy");
		button.props.onClick!({ stopPropagation: vi.fn() });
		expect(h.props.onNavigate).toHaveBeenCalledWith("study", "started");
	});

	it("starts a fresh recommendation and has no dead action when all decks are learned", () => {
		const h = harness([{ id: "fresh", totalCards: 10, newCards: 10 }]);
		const title = () =>
			h.findElement(
				h.tree(),
				(element) => element.props.className?.includes("resumeTitle") === true,
			);
		const buttons = () =>
			h.findAll(
				h.tree(),
				(element) => element.props.className?.includes("resumeButton") === true,
			);

		expect(textOf(title().props.children)).toBe("home.startHeading");
		expect(textOf(buttons()[0]!.props.children)).toBe("home.startStudy");
		h.props.snapshot = {
			...h.props.snapshot,
			decks: [
				{
					...h.props.snapshot.decks[0]!,
					stats: {
						...h.props.snapshot.decks[0]!.stats,
						newCards: 0,
					},
				},
			],
		};
		h.render();
		expect(textOf(title().props.children)).toBe("home.allDoneHeading");
		expect(buttons()).toHaveLength(0);
	});

	it("groups the recommendation and learning history before the complete deck list", () => {
		const h = harness();
		const body = h.findElement(
			h.tree(),
			(element) => element.props.className === "fc-page__body",
		);
		const sections = React.Children.toArray(
			body.props.children,
		) as React.ReactElement<ElementProps>[];

		expect(sections[0]!.props.className).toContain("overview");
		const overview = React.Children.toArray(
			sections[0]!.props.children,
		) as React.ReactElement<ElementProps>[];
		expect(overview[0]!.props.className).toContain("flashcard-home-hero");
		expect(overview[1]!.props.footprint).toBe(h.props.snapshot.learningFootprint);
		expect(sections[1]!.props.className).toContain("flashcard-home-workspace");
		expect(h.deckIds()).toEqual(["first", "second"]);
	});

	it("keeps the empty-state action before learning history when there is no deck", () => {
		const h = harness([]);
		const body = h.findElement(
			h.tree(),
			(element) => element.props.className === "fc-page__body",
		);
		const sections = React.Children.toArray(
			body.props.children,
		) as React.ReactElement<ElementProps>[];

		expect(sections[0]!.props.className).toContain("flashcard-empty");
		expect(sections[1]!.props.footprint).toBe(h.props.snapshot.learningFootprint);
	});

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

	it("passes the settings lock and export target to the affected rows", () => {
		const h = harness();

		h.setDraft(makeSettingsDraft("", "first"));
		h.render();
		const locked = h.findAll(h.tree(), (element) => element.props.deck !== undefined);

		expect(locked[0]!.props.deck!.id).toBe("first");
		expect(locked[0]!.props.isSettingsLocked).toBe(false);
		expect(locked[1]!.props.isSettingsLocked).toBe(true);

		h.setDraft(null);
		h.props.snapshot = {
			...h.props.snapshot,
			export: { kind: "exporting", deckId: "second", phase: null, completed: 0, total: 1 },
		};
		h.render();
		const exporting = h.findAll(h.tree(), (element) => element.props.deck !== undefined);

		expect(exporting[0]!.props.isExporting).toBe(false);
		expect(exporting[0]!.props.isExportBusy).toBe(true);
		expect(exporting[1]!.props.isExporting).toBe(true);
	});

	it("delegates opening deck settings to the settings draft session", () => {
		const h = harness();
		h.render();
		const card = h.findAll(h.tree(), (element) => element.props.deck !== undefined)[0]!;
		// Find DeckCard's settings trigger:
		// onOpenSettings is passed directly to the DeckCard component
		const onOpenSettings = (
			card.props as unknown as { onOpenSettings: (deckId: string) => void }
		).onOpenSettings;
		onOpenSettings("first");
		expect(h.openSpy).toHaveBeenCalledWith("first", "view");
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

		const getToggle = () =>
			h.findElement(getHeader().props.badge, (element) => element.type === "button");

		const initialHeader = getHeader();
		expect(getToggle().props["aria-expanded"]).toBe(false);
		expect(initialHeader.props.className).toContain("isCollapsed");

		// Clicking header toggles to expanded
		initialHeader.props.onClick!({ stopPropagation: vi.fn() });
		h.render();

		const expandedHeader = getHeader();
		expect(getToggle().props["aria-expanded"]).toBe(true);
		expect(expandedHeader.props.className).not.toContain("isCollapsed");

		// Clicking again collapses
		expandedHeader.props.onClick!({ stopPropagation: vi.fn() });
		h.render();

		const collapsedAgain = getHeader();
		expect(getToggle().props["aria-expanded"]).toBe(false);
		expect(collapsedAgain.props.className).toContain("isCollapsed");
	});

	it("offers a labelled native toggle linked to the action tray", () => {
		const h = harness();
		const header = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("homeHeader") === true,
		);
		const toggle = h.findElement(header.props.badge, (element) => element.type === "button");
		const tray = h.findElement(
			header.props.right,
			(element) => element.props.className === "flashcard-header-actions",
		);
		expect(toggle.props["aria-label"]).toBe("home.expandTools");
		expect(toggle.props["aria-controls"]).toBe(tray.props.id);
		const stopPropagation = vi.fn();
		toggle.props.onClick!({ stopPropagation });
		expect(stopPropagation).toHaveBeenCalled();
		h.render();
		const expandedHeader = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("homeHeader") === true,
		);
		const expandedToggle = h.findElement(
			expandedHeader.props.badge,
			(element) => element.type === "button",
		);
		expect(expandedToggle.props["aria-expanded"]).toBe(true);
		expect(expandedToggle.props["aria-label"]).toBe("home.collapseTools");
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

describe("landing page feature shortcuts", () => {
	it("renders the host's catalog projection and opens the selected feature", () => {
		const h = harness();
		const openTranslation = vi.fn();
		const openDictionary = vi.fn();
		h.props.shortcuts = [
			{ id: "translation", title: "AI 翻译", icon: Languages, open: openTranslation },
			{ id: "dictionary", title: "英语字典", icon: Languages, open: openDictionary },
		];
		h.render();

		const header = h.findElement(
			h.tree(),
			(element) => element.props.className?.includes("homeHeader") === true,
		);
		const buttons = h.findAll(
			header.props.right,
			(element) => element.props["aria-label"] === "AI 翻译",
		);
		expect(buttons).toHaveLength(1);
		buttons[0]!.props.onClick!({ stopPropagation: vi.fn() });
		expect(openTranslation).toHaveBeenCalledTimes(1);
		expect(openDictionary).not.toHaveBeenCalled();
	});
});
