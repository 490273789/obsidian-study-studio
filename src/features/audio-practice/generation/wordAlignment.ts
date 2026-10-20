import type { TimedWord } from "./types";

export interface TimedTextWord {
	startOffset: number;
	endOffset: number;
	start: number;
	end: number;
}

const BOUNDARY_TOLERANCE = 0.1;

function textWords(text: string): Array<{ text: string; start: number; end: number }> {
	return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu), (match) => ({
		text: match[0].replace(/[’‘ʼ]/g, "'").toLowerCase(),
		start: match.index,
		end: match.index + match[0].length,
	}));
}

/** Match a reviewed cue without guessing timestamps for changed or missing words. */
export function alignTimedWords(
	text: string,
	cueStart: number,
	cueEnd: number,
	words: readonly TimedWord[],
): TimedTextWord[] | null {
	if (
		!Number.isFinite(cueStart) ||
		!Number.isFinite(cueEnd) ||
		cueStart < 0 ||
		cueEnd <= cueStart
	) {
		return null;
	}
	const tokens = textWords(text);
	if (tokens.length === 0 || words.length === 0) return null;

	const result: TimedTextWord[] = [];
	let previousEnd = cueStart;
	for (const word of words) {
		if (
			!Number.isFinite(word.start) ||
			!Number.isFinite(word.end) ||
			word.start < 0 ||
			word.end <= word.start
		) {
			return null;
		}
		if (word.end <= cueStart || word.start >= cueEnd) continue;
		if (
			cueStart - word.start >= BOUNDARY_TOLERANCE ||
			word.end - cueEnd >= BOUNDARY_TOLERANCE
		) {
			return null;
		}
		const recognizedTokens = textWords(word.text);
		if (recognizedTokens.length === 0) continue;
		const token = tokens[result.length];
		if (recognizedTokens.length !== 1 || !token || recognizedTokens[0]!.text !== token.text) {
			return null;
		}
		const start = Math.max(cueStart, word.start);
		const end = Math.min(cueEnd, word.end);
		if (start < previousEnd) return null;
		result.push({ startOffset: token.start, endOffset: token.end, start, end });
		previousEnd = end;
	}
	return result.length === tokens.length ? result : null;
}
