import { describe, expect, it } from "vite-plus/test";
import { alignTimedWords } from "../wordAlignment";
import type { TimedWord } from "../types";

const words: TimedWord[] = [
	{ text: "Hello,", start: 1, end: 1.4 },
	{ text: "world!", start: 1.4, end: 2 },
];

describe("alignTimedWords", () => {
	it("preserves original text offsets while accepting capitalization and punctuation", () => {
		const text = "  HELLO — world?";
		const result = alignTimedWords(text, 1, 2, words);
		expect(result).toEqual([
			{ startOffset: 2, endOffset: 7, start: 1, end: 1.4 },
			{ startOffset: 10, endOffset: 15, start: 1.4, end: 2 },
		]);
		expect(result?.map((word) => text.slice(word.startOffset, word.endOffset))).toEqual([
			"HELLO",
			"world",
		]);
	});

	it("normalizes curved apostrophes", () => {
		expect(alignTimedWords("Don’t!", 0, 1, [{ text: "don't", start: 0, end: 1 }])).toEqual([
			{ startOffset: 0, endOffset: 5, start: 0, end: 1 },
		]);
	});

	it("matches repeated words individually in their original order", () => {
		expect(
			alignTimedWords("Go, go!", 0, 1, [
				{ text: "go", start: 0, end: 0.4 },
				{ text: "go", start: 0.5, end: 1 },
			]),
		).toEqual([
			{ startOffset: 0, endOffset: 2, start: 0, end: 0.4 },
			{ startOffset: 4, endOffset: 6, start: 0.5, end: 1 },
		]);
	});

	it("rejects missing, extra, reordered or edited words", () => {
		expect(alignTimedWords("Hello world again", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", 1, 2, words)).toBeNull();
		expect(alignTimedWords("world Hello", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello earth", 1, 2, words)).toBeNull();
		expect(
			alignTimedWords("Hello world", 1, 2, [{ text: "Hello world", start: 1, end: 2 }]),
		).toBeNull();
	});

	it("ignores other cues and clips small boundary errors", () => {
		expect(
			alignTimedWords("Hello world", 1, 2, [
				{ text: "before", start: 0, end: 0.8 },
				{ text: "Hello", start: 0.95, end: 1.4 },
				{ text: "world", start: 1.4, end: 2.05 },
				{ text: "after", start: 2.2, end: 3 },
			]),
		).toEqual([
			{ startOffset: 0, endOffset: 5, start: 1, end: 1.4 },
			{ startOffset: 6, endOffset: 11, start: 1.4, end: 2 },
		]);
	});

	it.each([
		[{ text: "Hello", start: NaN, end: 1.4 }, words[1]!],
		[{ text: "Hello", start: -1, end: 1.4 }, words[1]!],
		[{ text: "Hello", start: 1.4, end: 1 }, words[1]!],
		[{ text: "Hello", start: 1, end: 1 }, words[1]!],
		[{ text: "Hello", start: 0.8, end: 1.4 }, words[1]!],
		[words[0]!, { text: "world", start: 1.4, end: 2.2 }],
		[words[0]!, { text: "world", start: 1.3, end: 2 }],
		[
			{ text: "Hello", start: 1.6, end: 2 },
			{ text: "world", start: 1, end: 1.4 },
		],
	])(
		"rejects invalid, overlapping, nonmonotonic or out-of-bounds times: %j",
		(...invalidWords) => {
			expect(alignTimedWords("Hello world", 1, 2, invalidWords)).toBeNull();
		},
	);

	it("returns null without matching words or valid cue boundaries", () => {
		expect(alignTimedWords("Hello", 1, 2, [])).toBeNull();
		expect(alignTimedWords("?!", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", 2, 1, words)).toBeNull();
		expect(alignTimedWords("Hello", NaN, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", -1, 2, words)).toBeNull();
	});
});
