import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import { getDisplayCardContent } from "../cardDisplay";
import type { FlashCard } from "../../../../../core/shared/types";

function makeCard(overrides: Partial<FlashCard> = {}): FlashCard {
	return {
		id: "deck.md::0",
		front: "正面",
		back: "back",
		explanation: "  explanation  ",
		fsrsCard: createEmptyCard(),
		sourceFile: "deck.md",
		indexInFile: 0,
		...overrides,
	};
}

describe("getDisplayCardContent", () => {
	it("uses front as prompt in normal mode", () => {
		expect(getDisplayCardContent(makeCard(), "normal")).toEqual({
			prompt: "正面",
			answer: "back",
			explanation: "explanation",
		});
	});

	it("uses back as prompt in reversed mode and keeps explanation with answer", () => {
		expect(getDisplayCardContent(makeCard(), "reversed")).toEqual({
			prompt: "back",
			answer: "正面",
			explanation: "explanation",
		});
	});

	it("normalizes missing explanation to an empty string", () => {
		expect(
			getDisplayCardContent(makeCard({ explanation: undefined }), "normal").explanation,
		).toBe("");
	});
});
