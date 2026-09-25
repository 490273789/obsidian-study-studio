import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import type { FlashCard } from "../../../../../core/shared/types";
import { buildWordListItems } from "../wordListPresentationModel";

function makeCard(id: string, indexInFile: number, overrides: Partial<FlashCard> = {}): FlashCard {
	return {
		id,
		front: `#${id}`,
		back: ` ${id} back `,
		explanation: ` ${id} explanation `,
		fsrsCard: createEmptyCard(),
		sourceFile: "deck.md",
		indexInFile,
		...overrides,
	};
}

describe("word list presentation model", () => {
	it("builds sorted word-list items from cards and trims display fields", () => {
		expect(
			buildWordListItems([
				makeCard("second", 1),
				makeCard("first", 0, { front: " #first #tag ", explanation: undefined }),
			]),
		).toEqual([
			{
				id: "first",
				front: "first tag",
				back: "first back",
				explanation: "",
				index: 0,
			},
			{
				id: "second",
				front: "second",
				back: "second back",
				explanation: "second explanation",
				index: 1,
			},
		]);
	});
});
