import type { CardSourceOperation } from "../../../../core/shared/cardSourceMutation";
import {
	CARD_END_SEPARATOR,
	FIRST_TAG_LINE_PATTERN,
	extractCardIdentityMarker,
	formatCardBlock,
	isMarkerLine,
} from "./cardFormat";
import { DeckSourceEditException, validateCardDraft } from "./deckSourceEditor";

/** Plans a same-source edit without normalizing bytes outside selected cards. */
export function editSourceCardBatch(
	content: string,
	operations: readonly CardSourceOperation[],
	createIdentity: () => string,
): string {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const ranges = new Map<string, { start: number; end: number; terminated: boolean }>();
	let offset = 0;
	let active: { identity: string; start: number } | undefined;
	for (const line of content.matchAll(/[^\n]*(?:\n|$)/g)) {
		if (!line[0]) continue;
		const body = line[0].replace(/\r?\n$/, "");
		const identity = extractCardIdentityMarker(body);
		if (identity) {
			if (active || ranges.has(identity)) {
				throw new DeckSourceEditException({ type: "source-file-invalid" });
			}
			active = { identity, start: offset };
		}
		if (isMarkerLine(body, CARD_END_SEPARATOR) && active) {
			ranges.set(active.identity, {
				start: active.start,
				end: offset + line[0].length,
				terminated: line[0].endsWith("\n"),
			});
			active = undefined;
		}
		offset += line[0].length;
	}
	const replacements: Array<{ start: number; end: number; text: string }> = [];
	const selected = new Set<string>();
	const additions: string[] = [];
	for (const operation of operations) {
		if (operation.kind !== "delete") {
			const { front, back, explanation } = operation.content;
			const error = validateCardDraft(front, back, explanation);
			if (error) throw new DeckSourceEditException(error);
			if (
				[front, back, explanation ?? ""].some((value) =>
					value.split(/\r?\n/).some((line) => extractCardIdentityMarker(line) !== null),
				)
			) {
				throw new DeckSourceEditException({ type: "source-file-invalid" });
			}
		}
		if (operation.kind === "add") {
			additions.push(formatOperation(operation.content, createIdentity(), newline));
			continue;
		}
		const range = ranges.get(operation.identity);
		if (!range || selected.has(operation.identity)) {
			throw new DeckSourceEditException({ type: "card-not-found" });
		}
		selected.add(operation.identity);
		replacements.push({
			...range,
			text:
				operation.kind === "delete"
					? ""
					: formatOperation(operation.content, operation.identity, newline) +
						(range.terminated ? newline : ""),
		});
	}
	// oxlint-disable-next-line unicorn/no-array-sort -- edits run backwards to preserve original offsets.
	replacements.sort((left, right) => right.start - left.start);
	let next = content;
	for (const replacement of replacements) {
		next = next.slice(0, replacement.start) + replacement.text + next.slice(replacement.end);
	}
	if (additions.length > 0) {
		// Unconsumed prose after the last card must remain after all cards: the
		// parser otherwise treats it as part of an appended card's front.
		let insertion = 0;
		for (const end of next.matchAll(/^[ \t]*;;[ \t]*\r?(?:\n|$)/gm)) {
			insertion = end.index + end[0].length;
		}
		if (!insertion) {
			const tag = next.match(FIRST_TAG_LINE_PATTERN);
			if (tag?.index !== undefined) insertion = tag.index + tag[0].length;
		}
		let prefix = next.slice(0, insertion);
		const suffix = next.slice(insertion);
		for (const addition of additions) {
			const separator = !prefix
				? ""
				: prefix.endsWith(newline + newline)
					? ""
					: prefix.endsWith(newline)
						? newline
						: newline + newline;
			prefix += separator + addition + newline;
		}
		next = prefix + suffix;
	}
	return next;
}

function formatOperation(
	content: { front: string; back: string; explanation?: string },
	identity: string,
	newline: string,
): string {
	let block = formatCardBlock(content.front, content.back, content.explanation, identity);
	// Preserve explicitly empty explanations, used by dictionary favorite blocks.
	if (content.explanation !== undefined && !content.explanation.trim()) block += "\n::\n";
	return (block + "\n;;").replaceAll("\r\n", "\n").replaceAll("\n", newline);
}
