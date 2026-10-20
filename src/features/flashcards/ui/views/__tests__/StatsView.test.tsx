import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { StudyHistoryEntry } from "../../../../../core/shared/types";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { StatCards } from "../../../../../core/ui/primitives/StatCards";
import { StatsView } from "../Stats/StatsView";

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useMemo: (build: () => unknown) => build(),
}));

vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({
		language: "zh",
		t: (key: string, vars?: Record<string, string | number>) => {
			if (vars?.count !== undefined) return `${key}:${vars.count}`;
			if (vars?.month !== undefined && vars?.day !== undefined) {
				return `${vars.month}月${vars.day}日`;
			}
			if (vars?.date !== undefined && vars?.label !== undefined) {
				return `${vars.date}（${vars.label}）`;
			}
			return key;
		},
	}),
}));

vi.mock("../../../../../core/ui/primitives/Header", () => ({
	FlashcardHeader: () => null,
}));

vi.mock("../../../../../core/ui/primitives/StatCards", () => ({
	StatCards: () => null,
}));

type NodeProps = {
	children?: React.ReactNode;
	title?: string;
	items?: Array<{ key: string; value: React.ReactNode; label: React.ReactNode }>;
	onBack?: () => void;
};

function elements(node: React.ReactNode): React.ReactElement<NodeProps>[] {
	const result: React.ReactElement<NodeProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<NodeProps>(child)) return;
		result.push(child);
		if (child.props.children) {
			result.push(...elements(child.props.children));
		}
	});
	return result;
}

function render(
	component: unknown,
	props: { history: ReadonlyArray<StudyHistoryEntry>; onBack: () => void },
): React.ReactNode {
	return (component as { type: (p: typeof props) => React.ReactNode }).type(props);
}

describe("StatsView", () => {
	it("renders empty state when there are no history records", () => {
		const tree = render(StatsView, {
			history: [],
			onBack: vi.fn(),
		});

		const allElements = elements(tree);
		const statCardsEl = allElements.find((el) => el.type === StatCards);
		expect(statCardsEl).toBeDefined();
		expect(statCardsEl?.props.items).toHaveLength(4);

		const items = statCardsEl?.props.items ?? [];
		expect(items.map((i) => i.key)).toEqual(["duration", "cards", "days", "records"]);
		expect(items.find((i) => i.key === "days")?.value).toBe("0");
		expect(items.find((i) => i.key === "records")?.value).toBe("0");

		const hasEmptyTitle = allElements.some((el) => el.props.children === "stats.noRecords");
		expect(hasEmptyTitle).toBe(true);
	});

	it("renders day cards and study session entries with mode, deck, cards and duration", () => {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

		const history: StudyHistoryEntry[] = [
			{
				date: todayStr,
				timestamp: now.getTime(),
				mode: "study",
				deckId: "deck-1",
				deckName: "Senior High School",
				cardCount: 20,
				duration: 120,
			},
			{
				date: todayStr,
				timestamp: now.getTime() + 1000,
				mode: "spelling",
				deckId: "deck-2",
				deckName: "FC-Writing",
				cardCount: 5,
				duration: 45,
			},
		];

		const onBack = vi.fn();
		const tree = render(StatsView, {
			history,
			onBack,
		});

		const allElements = elements(tree);

		// Header is rendered with stats title and onBack handler
		const headerEl = allElements.find((el) => el.type === FlashcardHeader);
		expect(headerEl).toBeDefined();
		expect(headerEl?.props.title).toBe("stats.title");
		expect(headerEl?.props.onBack).toBe(onBack);

		// Stat cards are rendered with calculated values
		const statCardsEl = allElements.find((el) => el.type === StatCards);
		expect(statCardsEl).toBeDefined();
		const items = statCardsEl?.props.items ?? [];
		expect(items.find((i) => i.key === "cards")?.value).toBe(25);
		expect(items.find((i) => i.key === "days")?.value).toBe("1");
		expect(items.find((i) => i.key === "records")?.value).toBe("2");

		// Deck titles are present
		const hasDeck1 = allElements.some((el) => el.props.children === "Senior High School");
		expect(hasDeck1).toBe(true);
		const hasDeck2 = allElements.some((el) => el.props.children === "FC-Writing");
		expect(hasDeck2).toBe(true);
	});
});
