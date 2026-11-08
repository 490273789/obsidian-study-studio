import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FlashcardMenu } from "../../../../../../core/ui/primitives/Menu";
import type { DeckHomeDeckSnapshot } from "../../../../domain/decks/deckHome";
import { DeckCard } from "../DeckCard/DeckCard";

const sort = vi.hoisted(() => ({
	activate: vi.fn(),
	setNodeRef: vi.fn(),
	setActivatorNodeRef: vi.fn(),
	useSortable: vi.fn(),
}));
const platform = vi.hoisted(() => ({ isMobile: false }));

beforeEach(() => {
	vi.clearAllMocks();
	platform.isMobile = false;
});

vi.mock("obsidian", () => ({ Platform: platform }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({
		language: "en",
		t: (key: string, params?: { deckName?: string }) =>
			params?.deckName ? `${key}: ${params.deckName}` : key,
	}),
}));
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: (options: unknown) => {
		sort.useSortable(options);
		return {
			attributes: { tabIndex: 0, role: "button" },
			listeners: { onKeyDown: sort.activate },
			setNodeRef: sort.setNodeRef,
			setActivatorNodeRef: sort.setActivatorNodeRef,
			isDragging: false,
			transform: null,
			transition: undefined,
		};
	},
}));

function makeDeck(newCards = 4): DeckHomeDeckSnapshot {
	return {
		id: "deck",
		name: "Deck",
		filePath: "deck.md",
		tag: "#deck",
		studyCount: 1,
		stats: {
			totalCards: 10,
			newCards,
			dueCards: 0,
			learningCards: 0,
			reviewCards: 6,
			relearningCards: 0,
		},
		effectiveStudySettings: {
			dailyNewCards: 20,
			dailyReviewCards: 200,
			studyOrder: "sequential",
			fsrsParameters: { requestRetention: 0.9, maximumInterval: 36500 },
		},
		spelling: {
			enabled: true,
			ready: true,
			valid: true,
			canStart: true,
			hasStableIdentities: true,
			issueCount: 0,
			ignoredCardCount: 0,
		},
	};
}

type Element = React.ReactElement<{
	children?: React.ReactNode;
	className?: string;
	"aria-label"?: string;
	"aria-expanded"?: boolean;
	onKeyDown?: (event: { key: string }) => void;
	tabIndex?: number;
	ref?: unknown;
	inert?: boolean;
	onClick?: (event: { target: unknown; currentTarget: unknown; stopPropagation(): void }) => void;
}>;

function findAll(node: React.ReactNode, predicate: (element: Element) => boolean): Element[] {
	const found: Element[] = [];
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (!React.isValidElement(child)) return;
			const element = child as Element;
			if (predicate(element)) found.push(element);
			visit(element.props.children);
		});
	}
	visit(node);
	return found;
}

function renderCard(
	deck: DeckHomeDeckSnapshot,
	flags: { isSettingsLocked?: boolean; isExporting?: boolean; isExportBusy?: boolean },
	isMenuOpen: boolean,
	handlers: {
		onNavigate: ReturnType<typeof vi.fn>;
		onExport: ReturnType<typeof vi.fn>;
		onOpenSourceFile: ReturnType<typeof vi.fn>;
		onOpenSettings: ReturnType<typeof vi.fn>;
		onMenuOpenChange: ReturnType<typeof vi.fn>;
	},
): Element {
	const element = (
		DeckCard as unknown as {
			type: (props: React.ComponentProps<typeof DeckCard>) => React.ReactElement;
		}
	).type({
		deck,
		isSettingsLocked: flags.isSettingsLocked ?? false,
		isExporting: flags.isExporting ?? false,
		isExportBusy: flags.isExportBusy ?? false,
		language: "en",
		isRecentlyDropped: false,
		isMenuOpen,
		onNavigate: handlers.onNavigate as never,
		onExport: handlers.onExport as never,
		onOpenSourceFile: handlers.onOpenSourceFile as never,
		onOpenSettings: handlers.onOpenSettings as never,
		onMenuOpenChange: handlers.onMenuOpenChange as never,
	}) as React.ReactElement;
	return element as Element;
}

function menuOf(tree: Element): React.ComponentProps<typeof FlashcardMenu> {
	return findAll(tree, (element) => element.type === FlashcardMenu)[0]!
		.props as React.ComponentProps<typeof FlashcardMenu>;
}

function handlers() {
	return {
		onNavigate: vi.fn(),
		onExport: vi.fn().mockResolvedValue(undefined),
		onOpenSourceFile: vi.fn(),
		onOpenSettings: vi.fn(),
		onMenuOpenChange: vi.fn(),
	};
}

describe("DeckCard actions", () => {
	it("uses a deck-named menu and keeps the card context available while open", () => {
		const calls = handlers();
		const deck = makeDeck();
		const closed = menuOf(renderCard(deck, {}, false, calls));
		expect(closed.open).toBe(false);
		expect(closed.triggerTitle).toBe("home.deckActions: Deck");
		closed.onOpenChange!(true);
		expect(calls.onMenuOpenChange).toHaveBeenCalledWith("deck", true);

		const tree = renderCard(deck, {}, true, calls);
		const menu = menuOf(tree);
		expect(menu.open).toBe(true);
		expect(menu.presentation).toBe("floating");
		expect(menu.ariaLabel).toBe("home.deckActions: Deck");
		expect(findAll(tree, (element) => element.props.inert === true)).toHaveLength(0);
		expect(menu.items.map((action) => action.key)).toEqual([
			"export",
			"list",
			"source",
			"settings",
		]);
		menu.items.forEach((action) => action.onSelect());
		expect(calls.onExport).toHaveBeenCalledWith("deck");
		expect(calls.onNavigate).toHaveBeenCalledWith("word-list", "deck");
		expect(calls.onOpenSourceFile).toHaveBeenCalledWith("deck.md");
		expect(calls.onOpenSettings).toHaveBeenCalledWith("deck");
	});

	it("renders clean action set with study and practice, navigating to practice on click", () => {
		const calls = handlers();
		const deck = makeDeck();
		const tree = renderCard(deck, {}, false, calls);

		const isStudy = (element: Element) =>
			element.props.className === "flashcard-deck-action-study";
		const isPractice = (element: Element) =>
			element.props.className === "flashcard-deck-action-practice";
		const isSpelling = (element: Element) =>
			element.props.className?.includes("flashcard-deck-action-spelling") === true;
		const isPlaceholder = (element: Element) =>
			element.props.className?.includes("flashcard-deck-action-spelling-placeholder") ===
			true;

		expect(findAll(tree, isStudy)).toHaveLength(1);
		const practiceButtons = findAll(tree, isPractice);
		expect(practiceButtons).toHaveLength(1);
		expect(findAll(tree, isSpelling)).toHaveLength(0);
		expect(findAll(tree, isPlaceholder)).toHaveLength(0);

		practiceButtons[0]?.props.onClick?.({
			target: null,
			currentTarget: null,
			stopPropagation: () => {},
		});
		expect(calls.onNavigate).toHaveBeenCalledWith("practice", "deck");
	});

	it("replaces the mobile action row in place and keeps the deck context visible", () => {
		platform.isMobile = true;
		const deck = makeDeck();
		const calls = handlers();
		const isStudy = (element: Element) =>
			element.props.className === "flashcard-deck-action-study";
		const closed = renderCard(deck, {}, false, calls);
		expect(findAll(closed, isStudy)).toHaveLength(1);

		const open = renderCard(deck, {}, true, calls);
		const menu = menuOf(open);
		expect(menu.presentation).toBe("inline");
		expect(menu.triggerTitle).toBe("home.closeDeckActions: Deck");
		expect(menu.ariaLabel).toBe("home.deckActions: Deck");
		expect(findAll(open, isStudy)).toHaveLength(0);
		expect(
			findAll(
				open,
				(element) => element.props.className?.includes("flashcard-deck-name") === true,
			)[0]?.props.children,
		).toBe(deck.name);
		menu.onOpenChange!(false);
		expect(calls.onMenuOpenChange).toHaveBeenCalledWith(deck.id, false);
	});

	it("disables export while an export is running and settings while another view owns the draft", () => {
		const tree = renderCard(
			makeDeck(),
			{ isExporting: true, isExportBusy: true, isSettingsLocked: true },
			true,
			handlers(),
		);
		const disabled = menuOf(tree).items.filter((action) => action.disabled);
		expect(disabled.map((action) => action.key)).toEqual(["export", "settings"]);
	});
});

describe("DeckCard sort handle", () => {
	it("binds keyboard sorting and the activator ref to the named handle", () => {
		const tree = renderCard(makeDeck(), {}, false, handlers());
		const [handle] = findAll(tree, (element) => element.props.onKeyDown === sort.activate);
		expect(tree.props.onKeyDown).toBeUndefined();
		expect(tree.props.tabIndex).toBeUndefined();
		expect(tree.props.ref).toBe(sort.setNodeRef);
		expect(handle?.type).toBe("button");
		expect(handle?.props.ref).toBe(sort.setActivatorNodeRef);
		expect(handle?.props["aria-label"]).toBe("home.reorderDeck: Deck");
		expect(handle?.props.tabIndex).toBe(0);
	});

	it("excludes completed decks from both drag and drop", () => {
		const deck = makeDeck(0);
		const tree = renderCard(deck, {}, false, handlers());
		expect(findAll(tree, (element) => element.props.onKeyDown === sort.activate)).toHaveLength(
			0,
		);
		expect(sort.useSortable).toHaveBeenCalledWith({
			id: deck.id,
			disabled: { draggable: true, droppable: true },
		});
	});
});
