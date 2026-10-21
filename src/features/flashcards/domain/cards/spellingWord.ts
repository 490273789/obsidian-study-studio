import type { Deck } from "../../../../core/shared/types";

const LATIN_PHRASE_PATTERN =
	/^\p{Script=Latin}+(?:['’‘ʼ\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\p{Script=Latin}+)*(?:[ \t]+\p{Script=Latin}+(?:['’‘ʼ\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\p{Script=Latin}+)*)*$/u;
const DASH_PATTERN = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const APOSTROPHE_PATTERN = /[’‘ʼ]/g;

const EMPHASIS_WRAPPERS: ReadonlyArray<readonly [string, string]> = [
	["**", "**"],
	["__", "__"],
	["*", "*"],
	["_", "_"],
];

interface InvalidSpellingCard {
	cardId: string;
	indexInFile: number;
	front: string;
}

interface SpellingDeckValidation {
	/** Every card is eligible for spelling. */
	valid: boolean;
	/** At least one card is eligible, so spelling mode can start. */
	canStart: boolean;
	eligibleCardIds: string[];
	invalidCards: InvalidSpellingCard[];
}

type SpellingDiffKind = "correct" | "incorrect" | "missing" | "extra";

export interface SpellingDiffSegment {
	kind: SpellingDiffKind;
	value: string;
	expected?: string;
}

/**
 * Extract one spellable Latin word or phrase from the supported front-side Markdown.
 * The current card-format examples commonly use an ATX heading such as
 * "## science", so headings and one emphasis wrapper are accepted.
 */
export function extractSpellingWord(front: string): string | null {
	let value = front.trim();
	if (!value || /\r|\n/.test(value)) return null;

	value = value.replace(/^#{1,6}\s+/, "").trim();
	for (const [open, close] of EMPHASIS_WRAPPERS) {
		if (value.startsWith(open) && value.endsWith(close)) {
			const inner = value.slice(open.length, -close.length).trim();
			if (!inner) return null;
			value = inner;
			break;
		}
	}

	return LATIN_PHRASE_PATTERN.test(value) ? value.normalize("NFC").replace(/[ \t]+/g, " ") : null;
}

function normalizeSpellingAnswer(value: string): string {
	return value
		.normalize("NFC")
		.trim()
		.toLocaleLowerCase("en-US")
		.replace(APOSTROPHE_PATTERN, "'")
		.replace(DASH_PATTERN, "-")
		.replace(/\s+/gu, " ");
}

export function isSpellingAnswerCorrect(input: string, answer: string): boolean {
	return normalizeSpellingAnswer(input) === normalizeSpellingAnswer(answer);
}

export function validateSpellingDeck(deck: Pick<Deck, "cards">): SpellingDeckValidation {
	const eligibleCardIds: string[] = [];
	const invalidCards: InvalidSpellingCard[] = [];
	for (const card of deck.cards) {
		if (extractSpellingWord(card.front)) {
			eligibleCardIds.push(card.id);
			continue;
		}
		invalidCards.push({
			cardId: card.id,
			indexInFile: card.indexInFile,
			front: card.front,
		});
	}
	return {
		valid: invalidCards.length === 0 && deck.cards.length > 0,
		canStart: eligibleCardIds.length > 0,
		eligibleCardIds,
		invalidCards,
	};
}

/**
 * Align normalized input and answer with Levenshtein backtracking so the UI
 * can highlight correct, substituted, missing, and extra characters.
 */
export function buildSpellingDiff(input: string, answer: string): SpellingDiffSegment[] {
	const inputChars = Array.from(normalizeSpellingAnswer(input));
	const answerChars = Array.from(normalizeSpellingAnswer(answer));
	const rows = inputChars.length + 1;
	const columns = answerChars.length + 1;
	const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

	for (let row = 0; row < rows; row++) matrix[row]![0] = row;
	for (let column = 0; column < columns; column++) matrix[0]![column] = column;

	for (let row = 1; row < rows; row++) {
		for (let column = 1; column < columns; column++) {
			const substitutionCost = inputChars[row - 1] === answerChars[column - 1] ? 0 : 1;
			matrix[row]![column] = Math.min(
				matrix[row - 1]![column]! + 1,
				matrix[row]![column - 1]! + 1,
				matrix[row - 1]![column - 1]! + substitutionCost,
			);
		}
	}

	const result: SpellingDiffSegment[] = [];
	let row = inputChars.length;
	let column = answerChars.length;
	while (row > 0 || column > 0) {
		const inputChar = inputChars[row - 1];
		const answerChar = answerChars[column - 1];
		if (
			row > 0 &&
			column > 0 &&
			inputChar === answerChar &&
			matrix[row]![column] === matrix[row - 1]![column - 1]
		) {
			result.push({ kind: "correct", value: inputChar ?? "" });
			row--;
			column--;
			continue;
		}
		if (row > 0 && column > 0 && matrix[row]![column] === matrix[row - 1]![column - 1]! + 1) {
			result.push({
				kind: "incorrect",
				value: inputChar ?? "",
				expected: answerChar ?? "",
			});
			row--;
			column--;
			continue;
		}
		if (row > 0 && matrix[row]![column] === matrix[row - 1]![column]! + 1) {
			result.push({ kind: "extra", value: inputChar ?? "" });
			row--;
			continue;
		}
		result.push({ kind: "missing", value: answerChar ?? "" });
		column--;
	}

	return result.reverse();
}
