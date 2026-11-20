import type { FlashCard } from "../../../../core/shared/types";

export type VisibleWordColumnKey = "front" | "back";

export interface WordListItem {
	id: string;
	front: string;
	back: string;
	explanation: string;
	index: number;
}

interface WordColumnPresentation {
	key: VisibleWordColumnKey;
	variant: "secondary";
	labelKey: "wordList.firstColumn" | "wordList.secondColumn";
	maskKey: "wordList.maskFirstColumn" | "wordList.maskSecondColumn";
	unmaskKey: "wordList.unmaskFirstColumn" | "wordList.unmaskSecondColumn";
	toggleKey: "wordList.toggleFirstColumn" | "wordList.toggleSecondColumn";
}

export const VISIBLE_WORD_COLUMNS: readonly WordColumnPresentation[] = [
	{
		key: "front",
		variant: "secondary",
		labelKey: "wordList.firstColumn",
		maskKey: "wordList.maskFirstColumn",
		unmaskKey: "wordList.unmaskFirstColumn",
		toggleKey: "wordList.toggleFirstColumn",
	},
	{
		key: "back",
		variant: "secondary",
		labelKey: "wordList.secondColumn",
		maskKey: "wordList.maskSecondColumn",
		unmaskKey: "wordList.unmaskSecondColumn",
		toggleKey: "wordList.toggleSecondColumn",
	},
];

export function buildWordListItems(cards: FlashCard[]): WordListItem[] {
	return [...cards].sort((a, b) => a.indexInFile - b.indexInFile).map(toWordListItem);
}

function toWordListItem(card: FlashCard): WordListItem {
	return {
		id: card.id,
		front: card.front.trim().replace(/^#{1,6}[ \t]+/, ""),
		back: card.back.trim(),
		explanation: card.explanation?.trim() ?? "",
		index: card.indexInFile,
	};
}
