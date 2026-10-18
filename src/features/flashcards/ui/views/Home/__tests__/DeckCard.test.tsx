import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FlashcardButton } from "../../../../../../core/ui/primitives/Button";
import type { DeckHomeDeckSnapshot } from "../../../../domain/decks/deckHome";
import type { DeckCardPresentation } from "../../../deckCardPresentation";
import { DeckCard } from "../DeckCard/DeckCard";

const hooks = vi.hoisted(() => ({
	cursor: 0,
	refs: [] as Array<{ current: unknown }>,
	effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useId: () => "more-actions",
	useRef: () => {
		const index = hooks.cursor++;
		return (hooks.refs[index] ??= { current: null });
	},
	useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.refs = [];
	hooks.effects = [];
});
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: () => {},
		setActivatorNodeRef: () => {},
		isDragging: false,
		transform: null,
		transition: undefined,
	}),
}));

function presentation(overrides: Partial<DeckCardPresentation> = {}): DeckCardPresentation {
	const deck: DeckHomeDeckSnapshot = {
		id: "deck",
		name: "Deck",
		filePath: "deck.md",
		tag: "#deck",
		studyCount: 1,
		stats: {
			totalCards: 10,
			newCards: 4,
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
	return {
		deck,
		state: "active",
		learnedCards: 6,
		progressPercent: 60,
		isDone: false,
		isExporting: false,
		isExportBusy: false,
		isSettingsLocked: false,
		...overrides,
	};
}

type Element = React.ReactElement<{
	children?: React.ReactNode;
	className?: string;
	"aria-label"?: string;
	"aria-expanded"?: boolean;
	disabled?: boolean;
	size?: string;
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
	row: DeckCardPresentation,
	isMenuOpen: boolean,
	handlers: {
		onNavigate: ReturnType<typeof vi.fn>;
		onExport: ReturnType<typeof vi.fn>;
		onOpenSourceFile: ReturnType<typeof vi.fn>;
		onOpenSettings: ReturnType<typeof vi.fn>;
		onMenuOpenChange: ReturnType<typeof vi.fn>;
	},
): Element {
	hooks.cursor = 0;
	const element = (
		DeckCard as unknown as {
			type: (props: React.ComponentProps<typeof DeckCard>) => React.ReactElement;
		}
	).type({
		presentation: row,
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

function actionButtons(tree: Element): Element[] {
	return findAll(
		tree,
		(element) =>
			element.type === FlashcardButton &&
			element.props.className?.includes("overlayAction") === true,
	);
}

function click(button: Element): void {
	const target = {};
	button.props.onClick?.({ target, currentTarget: target, stopPropagation: vi.fn() });
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

describe("DeckCard row action overlay", () => {
	it("opens on the current row and wires its four actions", () => {
		const calls = handlers();
		const closed = renderCard(presentation(), false, calls);
		expect(actionButtons(closed)).toHaveLength(0);
		const trigger = findAll(
			closed,
			(element) => element.props["aria-label"] === "home.showMoreActions",
		)[0]!;
		click(trigger);
		expect(calls.onMenuOpenChange).toHaveBeenCalledWith("deck", true);

		const open = renderCard(presentation(), true, calls);
		const actions = actionButtons(open);
		expect(actions.map((action) => action.props.children)).toEqual([
			"home.exportPdfTitle",
			"home.list",
			"home.source",
			"home.setting",
		]);
		expect(actions.map((action) => action.props.size)).toEqual(["sm", "sm", "sm", "sm"]);
		expect(findAll(open, (element) => element.props.inert === true)).toHaveLength(3);
		click(actions[0]!);
		expect(calls.onExport).toHaveBeenCalledWith("deck");
		click(actions[1]!);
		expect(calls.onNavigate).toHaveBeenCalledWith("word-list", "deck");
		click(actions[2]!);
		expect(calls.onOpenSourceFile).toHaveBeenCalledWith("deck.md");
		click(actions[3]!);
		expect(calls.onOpenSettings).toHaveBeenCalledWith("deck");
		expect(calls.onMenuOpenChange).toHaveBeenLastCalledWith("deck", false);
	});

	it("disables export while an export is running and settings while another view owns the draft", () => {
		const calls = handlers();
		const open = renderCard(
			presentation({ isExporting: true, isExportBusy: true, isSettingsLocked: true }),
			true,
			calls,
		);
		const actions = actionButtons(open);
		expect(actions[0]?.props.disabled).toBe(true);
		expect(actions[3]?.props.disabled).toBe(true);
	});

	it("closes from the overlay toggle, empty backdrop, Escape, and outside pointer", () => {
		const calls = handlers();
		const open = renderCard(presentation(), true, calls);
		const closeButtons = findAll(
			open,
			(element) => element.props["aria-label"] === "home.hideMoreActions",
		);
		click(closeButtons[1]!);
		expect(calls.onMenuOpenChange).toHaveBeenCalledWith("deck", false);
		click(closeButtons[0]!);
		expect(calls.onMenuOpenChange).toHaveBeenCalledTimes(2);

		const listeners = new Map<string, (event: never) => void>();
		const document = {
			addEventListener: (type: string, listener: (event: never) => void) =>
				listeners.set(type, listener),
			removeEventListener: (type: string) => listeners.delete(type),
		};
		hooks.refs[0]!.current = { ownerDocument: document, contains: () => false };
		const focus = vi.fn();
		hooks.refs[1]!.current = { focus };
		hooks.refs[2]!.current = { focus: vi.fn() };
		const cleanup = hooks.effects[hooks.effects.length - 1]!();
		listeners.get("pointerdown")?.({ target: {} } as never);
		listeners.get("keydown")?.({ key: "Escape", preventDefault: vi.fn() } as never);
		expect(calls.onMenuOpenChange).toHaveBeenCalledTimes(4);
		renderCard(presentation(), false, calls);
		hooks.effects[hooks.effects.length - 1]!();
		expect(focus).toHaveBeenCalledOnce();
		cleanup?.();
		expect(listeners.size).toBe(0);
	});
});
