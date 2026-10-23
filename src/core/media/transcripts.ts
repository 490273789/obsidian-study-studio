import type {
	AudioChunk,
	DraftCue,
	TimedTextWord,
	TimedWord,
	Transcript,
} from "./transcriptionTypes";

interface TextToken {
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

/**
 * Unicode-aware tokenization that preserves whitespace and punctuation offsets,
 * standardizing curved apostrophes and diacritics.
 */
export function tokenizeUnicodeWords(text: string): TextToken[] {
	return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu), (match) => ({
		text: match[0].replace(/[’‘ʼ]/g, "'").toLowerCase(),
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
	}));
}

const BOUNDARY_TOLERANCE = 0.1;

/**
 * Match a reviewed cue against recognized words without guessing timestamps
 * for missing, extra, reordered, or edited words.
 */
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
	const tokens = tokenizeUnicodeWords(text);
	if (tokens.length === 0 || words.length === 0) return null;

	const recognized: { word: TimedWord; token: string }[] = [];
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
		const recognizedTokens = tokenizeUnicodeWords(word.text.replace(/\s*['’‘ʼ]\s*/g, "'"));
		if (recognizedTokens.length === 0) continue;
		if (recognizedTokens.length !== 1) return null;
		recognized.push({ word, token: recognizedTokens[0]!.text });
	}

	const result: TimedTextWord[] = [];
	let sourceIndex = 0;
	let previousEnd = cueStart;
	for (const token of tokens) {
		const source = recognized[sourceIndex];
		if (!source) return null;
		let count = 1;
		if (source.token !== token.text) {
			// ASR may timestamp a contraction as separate lexical pieces around an apostrophe.
			const parts = token.text.split("'");
			if (
				parts.length < 2 ||
				parts.some((part) => !part) ||
				parts.some((part, index) => recognized[sourceIndex + index]?.token !== part)
			)
				return null;
			count = parts.length;
		}
		let end = previousEnd;
		for (let index = sourceIndex; index < sourceIndex + count; index++) {
			const word = recognized[index]!.word;
			const start = Math.max(cueStart, word.start);
			if (start < end) return null;
			end = Math.min(cueEnd, word.end);
		}
		result.push({
			startOffset: token.start,
			endOffset: token.end,
			start: Math.max(cueStart, source.word.start),
			end,
		});
		previousEnd = end;
		sourceIndex += count;
	}
	return sourceIndex === recognized.length ? result : null;
}

/** Deduplicate only matching words actually observed in overlapping chunks. */
export function mergeTranscripts(
	results: readonly Transcript[],
	chunks: readonly Pick<AudioChunk, "start" | "end">[],
): Transcript {
	const words: TimedWord[] = [];
	const cues: DraftCue[] = [];
	const sameObservation = (left: TimedWord, right: TimedWord): boolean => {
		const normLeft = tokenizeUnicodeWords(left.text)
			.map((t) => t.text)
			.join(" ");
		const normRight = tokenizeUnicodeWords(right.text)
			.map((t) => t.text)
			.join(" ");
		if (!normLeft || normLeft !== normRight) return false;
		const overlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
		const shortest = Math.min(left.end - left.start, right.end - right.start);
		return overlap > 0 && overlap / shortest >= 0.5;
	};
	for (let index = 0; index < results.length; index++) {
		const chunk = chunks[index];
		const result = results[index];
		if (!chunk || !result) continue;
		const previousWords = [...words];
		const previousCues = [...cues];
		const mapped = result.words.map((word) => ({
			...word,
			start: word.start + chunk.start,
			end: Math.min(word.end + chunk.start, chunk.end),
		}));
		const accepted = new Set<TimedWord>();
		let matchedIndex = -1;
		for (const word of mapped) {
			if (word.start < chunk.start || word.end <= word.start) continue;
			const duplicate = previousWords.findIndex(
				(previous, previousIndex) =>
					previousIndex > matchedIndex && sameObservation(previous, word),
			);
			if (duplicate >= 0) matchedIndex = duplicate;
			else accepted.add(word);
		}
		words.push(...accepted);
		for (const cue of result.cues) {
			if (cue.start === null || cue.end === null) continue;
			const start = cue.start + chunk.start;
			const end = Math.min(cue.end + chunk.start, chunk.end);
			const sourceWords = mapped.filter((word) => word.start >= start && word.end <= end);
			const ownedWords = sourceWords.filter((word) => accepted.has(word));
			if (sourceWords.length > 0 && ownedWords.length === 0) continue;
			if (sourceWords.length === ownedWords.length) {
				if (
					previousCues.some(
						(previous) =>
							previous.start !== null &&
							previous.end !== null &&
							sameObservation(
								{ text: previous.text, start: previous.start, end: previous.end },
								{ text: cue.text, start, end },
							),
					)
				)
					continue;
				cues.push({ ...cue, id: `${index}-${cue.id}`, start, end });
			} else {
				let run: TimedWord[] = [];
				const flush = () => {
					if (!run.length) return;
					cues.push({
						...cue,
						id: `${index}-${cue.id}-${cues.length}`,
						text: run.map((word) => word.text.trim()).join(" "),
						start: run[0]!.start,
						end: run[run.length - 1]!.end,
						needsReview: true,
					});
					run = [];
				};
				for (const word of sourceWords) {
					if (accepted.has(word)) run.push(word);
					else flush();
				}
				flush();
			}
		}
	}
	return {
		cues: cues.sort((a, b) => (a.start ?? 0) - (b.start ?? 0)),
		words: words.sort((a, b) => a.start - b.start),
	};
}
