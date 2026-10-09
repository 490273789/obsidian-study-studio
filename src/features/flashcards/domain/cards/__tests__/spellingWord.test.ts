import { describe, expect, it } from "vite-plus/test";
import {
	buildSpellingDiff,
	extractSpellingWord,
	isSpellingAnswerCorrect,
	validateSpellingDeck,
} from "../spellingWord";
import type { FlashCard } from "../../../../../core/shared/types";

describe("spelling word extraction", () => {
	it.each([
		["science", "science"],
		["## science", "science"],
		["**science**", "science"],
		["## **self-esteem**", "self-esteem"],
		["don't", "don't"],
		["café", "café"],
		["make an impression", "make an impression"],
		["## **at   last**", "at last"],
		["don't give up", "don't give up"],
	])("extracts %s", (front, expected) => {
		expect(extractSpellingWord(front)).toBe(expected);
	});

	it.each([
		"science\nword",
		"[science](https://example.com)",
		"![science](image.png)",
		"`science`",
		"at, last",
		"make / impression",
		"科学",
		"",
	])("rejects %s", (front) => {
		expect(extractSpellingWord(front)).toBeNull();
	});

	it("validates every card in a deck", () => {
		const cards = [
			{ id: "one", front: "## science", indexInFile: 0 },
			{ id: "phrase", front: "make an impression", indexInFile: 1 },
			{ id: "two", front: "science / fair", indexInFile: 2 },
		] as FlashCard[];

		expect(validateSpellingDeck({ cards })).toEqual({
			valid: false,
			canStart: true,
			eligibleCardIds: ["one", "phrase"],
			invalidCards: [{ cardId: "two", indexInFile: 2, front: "science / fair" }],
		});
	});

	it("cannot start only when every card is ineligible", () => {
		const cards = [
			{ id: "one", front: "科学", indexInFile: 0 },
			{ id: "two", front: "make / impression", indexInFile: 1 },
		] as FlashCard[];

		expect(validateSpellingDeck({ cards })).toMatchObject({
			valid: false,
			canStart: false,
			eligibleCardIds: [],
			invalidCards: [{ cardId: "one" }, { cardId: "two" }],
		});
	});
});

describe("spelling answer comparison", () => {
	it("ignores case, surrounding whitespace, and equivalent punctuation", () => {
		expect(isSpellingAnswerCorrect(" Science ", "science")).toBe(true);
		expect(isSpellingAnswerCorrect("DON’T", "don't")).toBe(true);
		expect(isSpellingAnswerCorrect("self–esteem", "self-esteem")).toBe(true);
		expect(isSpellingAnswerCorrect("self－esteem", "self-esteem")).toBe(true);
		expect(isSpellingAnswerCorrect(" MAKE   AN impression ", "make an impression")).toBe(true);
	});

	it("keeps other spelling differences strict", () => {
		expect(isSpellingAnswerCorrect("sciense", "science")).toBe(false);
		expect(isSpellingAnswerCorrect("selfesteem", "self-esteem")).toBe(false);
		expect(isSpellingAnswerCorrect("make impression", "make an impression")).toBe(false);
		expect(isSpellingAnswerCorrect("at-last", "at last")).toBe(false);
	});

	it("builds character-level difference segments", () => {
		expect(buildSpellingDiff("sciense", "science")).toEqual([
			{ kind: "correct", value: "s" },
			{ kind: "correct", value: "c" },
			{ kind: "correct", value: "i" },
			{ kind: "correct", value: "e" },
			{ kind: "correct", value: "n" },
			{ kind: "incorrect", value: "s", expected: "c" },
			{ kind: "correct", value: "e" },
		]);
		expect(buildSpellingDiff("scence", "science")).toContainEqual({
			kind: "missing",
			value: "i",
		});
		expect(buildSpellingDiff("sciience", "science")).toContainEqual({
			kind: "extra",
			value: "i",
		});
		expect(buildSpellingDiff("make impression", "make an impression")).toContainEqual({
			kind: "missing",
			value: "a",
		});
	});
});
