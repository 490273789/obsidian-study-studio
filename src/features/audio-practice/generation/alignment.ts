import type { AudioChunk, DraftCue, TimedWord, Transcript } from "./types";

function tokens(text: string): string[] {
	return (
		text
			.toLowerCase()
			.replace(/[’‘]/g, "'")
			.match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? []
	);
}

/** Deduplicate only matching words actually observed in overlapping chunks. */
export function mergeTranscripts(results: Transcript[], chunks: AudioChunk[]): Transcript {
	const words: TimedWord[] = [];
	const cues: DraftCue[] = [];
	const sameObservation = (left: TimedWord, right: TimedWord): boolean => {
		const normalized = tokens(left.text).join(" ");
		if (!normalized || normalized !== tokens(right.text).join(" ")) return false;
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
				// A duplicate inside a sentence splits the remaining words into separate timed runs.
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

export function alignReference(reference: string, transcript: Transcript): DraftCue[] {
	const sentences = reference
		.split(/\r?\n/)
		.flatMap((line) => line.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) ?? [])
		.map((text) => text.trim())
		.filter(Boolean);
	const target = sentences.flatMap(tokens);
	const timed = transcript.words.flatMap((word) =>
		tokens(word.text).map((text) => ({ ...word, text })),
	);
	// Bound the quadratic planner, leaving oversized material for explicit manual timing.
	if (target.length > 5000 || timed.length > 5000)
		return sentences.map((text, index) => ({
			id: `reference-${index}`,
			text,
			start: null,
			end: null,
			needsReview: true,
		}));
	const width = timed.length + 1;
	const table = new Uint16Array((target.length + 1) * width);
	for (let i = target.length - 1; i >= 0; i--)
		for (let j = timed.length - 1; j >= 0; j--)
			table[i * width + j] =
				target[i] === timed[j]?.text
					? 1 + (table[(i + 1) * width + j + 1] ?? 0)
					: Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
	const matches = new Map<number, number>();
	for (let i = 0, j = 0; i < target.length && j < timed.length;) {
		if (target[i] === timed[j]?.text) {
			matches.set(i, j);
			i++;
			j++;
		} else if ((table[(i + 1) * width + j] ?? 0) > (table[i * width + j + 1] ?? 0)) i++;
		else j++;
	}
	let offset = 0;
	return sentences.map((text, index) => {
		const sentenceTokens = tokens(text);
		const found = sentenceTokens.flatMap((_, position) =>
			matches.has(offset + position) ? [matches.get(offset + position)!] : [],
		);
		let occurrences = 0;
		for (let position = 0; position <= timed.length - sentenceTokens.length; position++)
			if (
				sentenceTokens.length &&
				sentenceTokens.every((token, n) => token === timed[position + n]?.text)
			)
				occurrences++;
		const first = matches.get(offset);
		const last = matches.get(offset + sentenceTokens.length - 1);
		const sourceSpan =
			first !== undefined && last !== undefined ? timed.slice(first, last + 1) : [];
		const dense = sourceSpan.length > 0 && found.length / sourceSpan.length >= 0.9;
		const noLongGaps = sourceSpan.every(
			(word, position) =>
				position === 0 || word.start - (sourceSpan[position - 1]?.end ?? word.start) <= 2,
		);
		const reliable =
			sentenceTokens.length > 0 &&
			found.length / sentenceTokens.length >= 0.9 &&
			first !== undefined &&
			last !== undefined &&
			occurrences <= 1 &&
			dense &&
			noLongGaps;
		offset += sentenceTokens.length;
		return {
			id: `reference-${index}`,
			text,
			start: reliable ? (timed[first!]?.start ?? null) : null,
			end: reliable ? (timed[last!]?.end ?? null) : null,
			needsReview: !reliable,
		};
	});
}
