import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { FlashcardMenu } from "../../../../../../core/ui/primitives/Menu";
import type { DeckHomeDeckSnapshot } from "../../../../domain/decks/deckHome";
import type { DeckCardPresentation } from "../../../deckCardPresentation";
import { DeckCard } from "../DeckCard/DeckCard";

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
}));
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

type MenuProps = React.ComponentProps<typeof FlashcardMenu>;
type TreeElement = React.ReactElement<{ children?: React.ReactNode }>;

function findMenu(node: React.ReactNode): React.ReactElement<MenuProps> {
	let found: React.ReactElement<MenuProps> | undefined;
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === FlashcardMenu) {
				found = child as React.ReactElement<MenuProps>;
				return;
			}
			visit((child as TreeElement).props.children);
		});
	}
	visit(node);
	if (!found) throw new Error("Expected a FlashcardMenu");
	return found;
}

function renderCard(
	row: DeckCardPresentation,
	handlers: {
		onNavigate: ReturnType<typeof vi.fn>;
		onExport: ReturnType<typeof vi.fn>;
		onOpenSourceFile: ReturnType<typeof vi.fn>;
		onOpenSettings: ReturnType<typeof vi.fn>;
		onMenuOpenChange: ReturnType<typeof vi.fn>;
	},
): MenuProps {
	const element = (
		DeckCard as unknown as {
			type: (props: React.ComponentProps<typeof DeckCard>) => React.ReactElement;
		}
	).type({
		presentation: row,
		language: "en",
		isRecentlyDropped: false,
		onNavigate: handlers.onNavigate as never,
		onExport: handlers.onExport as never,
		onOpenSourceFile: handlers.onOpenSourceFile as never,
		onOpenSettings: handlers.onOpenSettings as never,
		onMenuOpenChange: handlers.onMenuOpenChange as never,
	}) as React.ReactElement;
	return findMenu(element).props;
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

describe("DeckCard action menu", () => {
	it("wires the shared menu trigger and secondary actions to the row semantics", () => {
		const calls = handlers();
		const menu = renderCard(presentation(), calls);

		expect(menu.triggerTitle).toBe("home.showMoreActions");
		expect(menu.ariaLabel).toBe("home.moreActions");
		expect(menu.items.map((item) => item.key)).toEqual([
			"export",
			"list",
			"source",
			"settings",
		]);

		menu.items.find((item) => item.key === "export")?.onSelect();
		expect(calls.onExport).toHaveBeenCalledWith("deck");
		menu.items.find((item) => item.key === "list")?.onSelect();
		expect(calls.onNavigate).toHaveBeenCalledWith("word-list", "deck");
		menu.items.find((item) => item.key === "source")?.onSelect();
		expect(calls.onOpenSourceFile).toHaveBeenCalledWith("deck.md");
		menu.items.find((item) => item.key === "settings")?.onSelect();
		expect(calls.onOpenSettings).toHaveBeenCalledWith("deck");

		menu.onOpenChange?.(true);
		expect(calls.onMenuOpenChange).toHaveBeenCalledWith("deck", true);
	});

	it("disables export while an export is running and settings while another view owns the draft", () => {
		const calls = handlers();
		const menu = renderCard(
			presentation({ isExporting: true, isExportBusy: true, isSettingsLocked: true }),
			calls,
		);

		expect(menu.items.find((item) => item.key === "export")?.disabled).toBe(true);
		expect(menu.items.find((item) => item.key === "settings")?.disabled).toBe(true);
	});
});
