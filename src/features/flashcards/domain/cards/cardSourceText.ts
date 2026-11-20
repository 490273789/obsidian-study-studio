import type {
	CardSourceContent,
	CardSourceOperation,
} from "../../../../core/shared/cardSourceMutation";
import {
	CARD_END_SEPARATOR,
	EXPLANATION_SEPARATOR,
	FRONT_BACK_SEPARATOR,
	type CardSourceNewline,
	type ParsedCardBlock,
	cardSourceBodyStart,
	extractCardIdentityMarker,
	findSourceTagLine,
	formatCardBlock,
	formatCardIdentityMarker,
	isMarkerLine,
	parseCardBlock,
} from "./cardFormat";

type ReservedMarker =
	| typeof FRONT_BACK_SEPARATOR
	| typeof EXPLANATION_SEPARATOR
	| typeof CARD_END_SEPARATOR;

export type DeckSourceEditError =
	| { type: "missing-front" }
	| { type: "missing-back" }
	| { type: "reserved-marker"; marker: ReservedMarker }
	| { type: "card-not-found" }
	| { type: "source-file-invalid" };

export class DeckSourceEditException extends Error {
	readonly editError: DeckSourceEditError;

	constructor(editError: DeckSourceEditError) {
		super(getDeckSourceEditMessage(editError));
		this.name = "DeckSourceEditException";
		this.editError = editError;
	}
}

interface CardSourceEditResult {
	/** The new Markdown source; bytes outside the edited blocks are unchanged. */
	readonly nextContent: string;
	/** Identities created for `add` operations, in operation order. */
	readonly createdIdentities: readonly string[];
}

type IdentityMaintenanceAction =
	| { readonly kind: "register-missing" }
	| { readonly kind: "replace-markers"; readonly identities: readonly string[] };

interface CardSourceIdentityResult {
	readonly nextContent: string;
	/** Registered identities for `register-missing`, or the supplied list for `replace-markers`. */
	readonly identities: readonly string[];
}

const RESERVED_MARKERS: readonly ReservedMarker[] = [
	FRONT_BACK_SEPARATOR,
	EXPLANATION_SEPARATOR,
	CARD_END_SEPARATOR,
];

/**
 * The byte-level authority for card source edits.
 *
 * Scans one Markdown source once, addresses cards by stable identity, and
 * replaces only the target block. Everything outside that block — prefix,
 * blank lines, prose after the last card, line endings, BOM — is preserved
 * byte for byte. Blocks are formatted canonically with the source's own line
 * ending, which must be supplied explicitly to `formatCardBlock`.
 */
export function editCards(
	source: string,
	operations: readonly CardSourceOperation[],
	createIdentity: () => string,
): CardSourceEditResult {
	const scan = scanSource(source);
	if (operations.length === 0) {
		return { nextContent: source, createdIdentities: [] };
	}

	const edits: TextEdit[] = [];
	const additions: FormattedAddition[] = [];
	const createdIdentities: string[] = [];
	const selected = new Set<string>();
	const blocksByIdentity = indexBlocks(scan);

	for (const operation of operations) {
		if (operation.kind === "add") {
			assertValidContent(operation.content);
			const identity = createIdentity();
			createdIdentities.push(identity);
			additions.push({ identity, content: operation.content });
			continue;
		}

		if (selected.has(operation.identity)) {
			throw new DeckSourceEditException({ type: "card-not-found" });
		}
		const targets = blocksByIdentity.get(operation.identity) ?? [];
		if (targets.length === 0) {
			throw new DeckSourceEditException({ type: "card-not-found" });
		}
		if (targets.length > 1) {
			throw new DeckSourceEditException({ type: "source-file-invalid" });
		}
		selected.add(operation.identity);
		const block = targets[0]!;

		if (operation.kind === "delete") {
			edits.push(deletionEdit(scan, block));
			continue;
		}

		assertValidContent(operation.content);
		if (sameCardContent(scan, block, operation.identity, operation.content)) continue;
		edits.push(updateEdit(scan, block, operation.identity, operation.content));
	}

	if (edits.length === 0 && additions.length === 0) {
		return { nextContent: source, createdIdentities };
	}

	const newline = scan.blocks[scan.blocks.length - 1]?.newline ?? scan.documentNewline;
	const merged = mergeRemovalEdits(edits);
	// A legacy first front may straddle the deck tag. Keep the original tag
	// line when replacing that front, including its spacing and line ending.
	const tag = scan.tag;
	if (tag) {
		const covering = merged.findIndex((edit) => edit.start <= tag.start && edit.end >= tag.end);
		if (covering >= 0) {
			const edit = merged[covering]!;
			merged[covering] = { ...edit, text: source.slice(tag.start, tag.end) + edit.text };
		}
	}
	let next = applyEdits(source, merged);
	if (additions.length > 0) {
		next = insertAdditions(next, additions, newline);
	}
	return { nextContent: next, createdIdentities };
}

/**
 * Identity maintenance for sources that are not (yet) addressable by identity:
 * register missing markers during synchronization/migration, or restore the
 * exact marker list during an explicit repair.
 */
export function maintainIdentities(
	source: string,
	action: IdentityMaintenanceAction,
	createIdentity: () => string,
): CardSourceIdentityResult {
	const scan = scanSource(source);

	if (action.kind === "register-missing") {
		const edits: TextEdit[] = [];
		const registered: string[] = [];
		for (const block of scan.blocks) {
			if (block.identity !== null) continue;
			const anchor = findMarkerAnchorLine(scan, block);
			if (anchor === null) {
				throw new DeckSourceEditException({ type: "source-file-invalid" });
			}
			const newline = scan.lines[anchor]!.newline || block.newline;
			const identity = createIdentity();
			registered.push(identity);
			edits.push({
				start: scan.lines[anchor]!.start,
				end: scan.lines[anchor]!.start,
				text: formatCardIdentityMarker(identity) + newline,
			});
		}
		if (edits.length === 0) return { nextContent: source, identities: [] };
		return { nextContent: applyEdits(source, edits), identities: registered };
	}

	if (action.identities.length !== scan.blocks.length) {
		throw new DeckSourceEditException({ type: "source-file-invalid" });
	}

	const edits: TextEdit[] = [];
	scan.blocks.forEach((block, index) => {
		const anchor = findMarkerAnchorLine(scan, block);
		if (anchor === null) {
			throw new DeckSourceEditException({ type: "source-file-invalid" });
		}
		const original = source.slice(
			scan.lines[block.regionStartLine]!.start,
			scan.lines[block.terminatorLine]!.end,
		);
		const replaced = rebuildBlockWithIdentity(
			source,
			scan.lines,
			block,
			anchor,
			action.identities[index]!,
		);
		if (replaced !== original) {
			edits.push({
				start: scan.lines[block.regionStartLine]!.start,
				end: scan.lines[block.terminatorLine]!.end,
				text: replaced,
			});
		}
	});
	if (edits.length === 0) {
		return { nextContent: source, identities: [...action.identities] };
	}
	return { nextContent: applyEdits(source, edits), identities: [...action.identities] };
}

export function validateCardDraft(
	front: string,
	back: string,
	explanation?: string,
): DeckSourceEditError | null {
	if (!front.trim()) {
		return { type: "missing-front" };
	}
	if (!back.trim()) {
		return { type: "missing-back" };
	}

	for (const value of [front, back, explanation ?? ""]) {
		const marker = findReservedMarkerLine(value);
		if (marker) {
			return { type: "reserved-marker", marker };
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Source scanning

interface SourceLine {
	readonly start: number;
	/** Offset after the line's newline, if any. */
	readonly end: number;
	/** Line body without its newline. */
	readonly text: string;
	readonly newline: CardSourceNewline | "";
}

interface ScannedBlock {
	readonly regionStartLine: number;
	readonly contentStartLine: number;
	readonly terminatorLine: number;
	readonly identity: string | null;
	readonly parsed: ParsedCardBlock;
	readonly newline: CardSourceNewline;
	readonly terminatorHasNewline: boolean;
}

interface ScanResult {
	readonly lines: readonly SourceLine[];
	readonly documentNewline: CardSourceNewline;
	readonly blocks: readonly ScannedBlock[];
	readonly tag: ReturnType<typeof findSourceTagLine>;
}

interface TextEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

interface FormattedAddition {
	readonly identity: string;
	readonly content: CardSourceContent;
}

function scanSource(source: string): ScanResult {
	const lines = splitSourceLines(source);
	const documentNewline = detectDocumentNewline(source);
	const tag = findSourceTagLine(source);
	const tagStart = tag?.start;
	const blocks: ScannedBlock[] = [];
	let regionStartLine = 0;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		if (!isMarkerLine(lines[lineIndex]!.text, CARD_END_SEPARATOR)) continue;
		const regionStart = regionStartLine;
		const blockLines = lines
			.slice(regionStart, lineIndex)
			.filter((line) => line.start !== tagStart)
			.map((line) => line.text);
		const parsed = parseCardBlock(blockLines);
		const contentStartLine = parsed
			? findContentStartLine(lines, regionStart, lineIndex, tagStart)
			: null;
		if (parsed && contentStartLine !== null) {
			blocks.push({
				regionStartLine: regionStart,
				contentStartLine,
				terminatorLine: lineIndex,
				identity: parsed.identity,
				parsed,
				newline: detectBlockNewline(lines, regionStart, lineIndex, documentNewline),
				terminatorHasNewline: lines[lineIndex]!.newline !== "",
			});
		}
		regionStartLine = lineIndex + 1;
	}

	return { lines, documentNewline, blocks, tag };
}

function splitSourceLines(source: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let offset = cardSourceBodyStart(source);
	for (const match of source.slice(offset).matchAll(/[^\n]*(?:\n|$)/g)) {
		const raw = match[0];
		if (raw.length === 0) continue;
		const start = offset;
		offset += raw.length;
		const hasNewline = raw.endsWith("\n");
		const text = hasNewline ? raw.slice(0, -1).replace(/\r$/, "") : raw;
		lines.push({
			start,
			end: offset,
			text,
			newline: hasNewline ? (raw.endsWith("\r\n") ? "\r\n" : "\n") : "",
		});
	}
	return lines;
}

function detectDocumentNewline(source: string): CardSourceNewline {
	const firstBreak = source.indexOf("\n");
	return firstBreak > 0 && source[firstBreak - 1] === "\r" ? "\r\n" : "\n";
}

function detectBlockNewline(
	lines: readonly SourceLine[],
	regionStartLine: number,
	terminatorLine: number,
	documentNewline: CardSourceNewline,
): CardSourceNewline {
	for (let index = regionStartLine; index <= terminatorLine; index++) {
		const newline = lines[index]!.newline;
		if (newline !== "") return newline;
	}
	return documentNewline;
}

/** First non-blank line of the whole block range; update edits replace from here. */
function findContentStartLine(
	lines: readonly SourceLine[],
	regionStartLine: number,
	terminatorLine: number,
	tagStart: number | undefined,
): number | null {
	for (let index = regionStartLine; index < terminatorLine; index++) {
		const line = lines[index]!;
		if (!line.text.trim() || line.start === tagStart) continue;
		return index;
	}
	return null;
}

/** First line card content can be written to: skips the identity marker and tag prefix. */
function findMarkerAnchorLine(scan: ScanResult, block: ScannedBlock): number | null {
	for (let index = block.regionStartLine; index < block.terminatorLine; index++) {
		const line = scan.lines[index]!;
		if (!line.text.trim() || line.start === scan.tag?.start) continue;
		if (extractCardIdentityMarker(line.text) !== null) continue;
		return index;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Edit planning

function indexBlocks(scan: ScanResult): Map<string, ScannedBlock[]> {
	const byIdentity = new Map<string, ScannedBlock[]>();
	for (const block of scan.blocks) {
		if (block.identity === null) continue;
		const list = byIdentity.get(block.identity) ?? [];
		list.push(block);
		byIdentity.set(block.identity, list);
	}
	return byIdentity;
}

function updateEdit(
	scan: ScanResult,
	block: ScannedBlock,
	identity: string,
	content: CardSourceContent,
): TextEdit {
	const lines = scan.lines;
	return {
		start: lines[block.contentStartLine]!.start,
		end: lines[block.terminatorLine]!.end,
		text: formatOperation(content, identity, block.newline, block.terminatorHasNewline),
	};
}

/**
 * A delete removes the block content, its terminator, and one adjacent blank
 * separator: the following run for the first block (the prefix is preserved),
 * the preceding run otherwise. Overlapping removals are merged by the caller.
 */
function deletionEdit(scan: ScanResult, block: ScannedBlock): TextEdit {
	const lines = scan.lines;
	let start = lines[block.contentStartLine]!.start;
	let end = lines[block.terminatorLine]!.end;

	if (block.regionStartLine === 0) {
		let index = block.terminatorLine + 1;
		while (index < lines.length && lines[index]!.text.trim().length === 0) {
			end = lines[index]!.end;
			index++;
		}
	} else {
		let index = block.contentStartLine - 1;
		while (index >= block.regionStartLine && lines[index]!.text.trim().length === 0) {
			start = lines[index]!.start;
			index--;
		}
	}

	return { start, end, text: "" };
}

function sameCardContent(
	scan: ScanResult,
	block: ScannedBlock,
	identity: string,
	content: CardSourceContent,
): boolean {
	if (block.identity !== identity) return false;
	const expectedFront = content.front.trim();
	const expectedBack = content.back.trim();
	const expectedExplanation = content.explanation?.trim() ?? "";
	if (
		block.parsed.front !== expectedFront ||
		block.parsed.back !== expectedBack ||
		(block.parsed.explanation ?? "") !== expectedExplanation
	) {
		return false;
	}
	// An explicitly empty explanation keeps an empty `::` section (favorite
	// blocks); omitting the field means the block has no explanation section.
	const expectsSection = content.explanation !== undefined;
	return blockHasExplanationSection(scan.lines, block) === expectsSection;
}

function blockHasExplanationSection(lines: readonly SourceLine[], block: ScannedBlock): boolean {
	let sawFrontBack = false;
	for (let index = block.regionStartLine; index < block.terminatorLine; index++) {
		const text = lines[index]!.text;
		if (!sawFrontBack) {
			if (isMarkerLine(text, FRONT_BACK_SEPARATOR)) sawFrontBack = true;
			continue;
		}
		if (isMarkerLine(text, EXPLANATION_SEPARATOR)) return true;
	}
	return false;
}

function formatOperation(
	content: CardSourceContent,
	identity: string,
	newline: CardSourceNewline,
	terminated: boolean,
): string {
	const explanation = content.explanation?.trim() ? content.explanation : undefined;
	let block = formatCardBlock(content.front, content.back, newline, explanation, identity);
	if (content.explanation !== undefined && content.explanation.trim().length === 0) {
		block += newline + EXPLANATION_SEPARATOR + newline;
	}
	return block + newline + CARD_END_SEPARATOR + (terminated ? newline : "");
}

function insertAdditions(
	current: string,
	additions: readonly FormattedAddition[],
	newline: CardSourceNewline,
): string {
	const lines = splitSourceLines(current);
	const lastTerminator = [...lines]
		.reverse()
		.find((line) => isMarkerLine(line.text, CARD_END_SEPARATOR));
	const bodyStart = cardSourceBodyStart(current);
	const insertion = lastTerminator?.end ?? findSourceTagLine(current)?.end ?? bodyStart;
	let prefix = current.slice(0, insertion);
	const suffix = current.slice(insertion);
	for (const addition of additions) {
		const separator =
			prefix === "" || prefix === "\uFEFF"
				? ""
				: prefix.endsWith(newline + newline)
					? ""
					: prefix.endsWith(newline)
						? newline
						: newline + newline;
		prefix += separator + formatOperation(addition.content, addition.identity, newline, true);
	}
	return prefix + suffix;
}

function mergeRemovalEdits(edits: readonly TextEdit[]): TextEdit[] {
	const removals = edits
		.filter((edit) => edit.text === "")
		.map((edit) => ({ ...edit }))
		.sort((left, right) => left.start - right.start);
	const merged: TextEdit[] = [];
	for (const removal of removals) {
		const last = merged[merged.length - 1];
		if (last && removal.start <= last.end) {
			merged[merged.length - 1] = {
				start: last.start,
				end: Math.max(last.end, removal.end),
				text: "",
			};
		} else {
			merged.push(removal);
		}
	}
	const replacements = edits.filter((edit) => edit.text !== "");
	for (const replacement of replacements) {
		for (const removal of merged) {
			if (replacement.start < removal.end && removal.start < replacement.end) {
				throw new DeckSourceEditException({ type: "source-file-invalid" });
			}
		}
	}
	return [...merged, ...replacements];
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
	const sorted = [...edits].sort((left, right) => right.start - left.start);
	let previousStart = Number.POSITIVE_INFINITY;
	let next = source;
	for (const edit of sorted) {
		if (edit.end > previousStart) {
			throw new DeckSourceEditException({ type: "source-file-invalid" });
		}
		next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
		previousStart = edit.start;
	}
	return next;
}

function rebuildBlockWithIdentity(
	source: string,
	lines: readonly SourceLine[],
	block: ScannedBlock,
	anchorLine: number,
	identity: string,
): string {
	const newline = lines[anchorLine]!.newline || block.newline;
	const marker = formatCardIdentityMarker(identity) + newline;
	const parts: string[] = [];
	for (let index = block.regionStartLine; index <= block.terminatorLine; index++) {
		const line = lines[index]!;
		const raw = source.slice(line.start, line.end);
		if (index < block.terminatorLine && extractCardIdentityMarker(line.text) !== null) {
			continue;
		}
		if (index === anchorLine) parts.push(marker);
		parts.push(raw);
	}
	return parts.join("");
}

// ---------------------------------------------------------------------------
// Validation

function assertValidContent(content: CardSourceContent): void {
	const error = validateCardDraft(content.front, content.back, content.explanation);
	if (error) throw new DeckSourceEditException(error);
	for (const value of [content.front, content.back, content.explanation ?? ""]) {
		if (value.split(/\r?\n/).some((line) => extractCardIdentityMarker(line) !== null)) {
			throw new DeckSourceEditException({ type: "source-file-invalid" });
		}
	}
}

function findReservedMarkerLine(content: string): ReservedMarker | null {
	const lines = content.split(/\r?\n/);
	return (
		RESERVED_MARKERS.find((marker) => lines.some((line) => isMarkerLine(line, marker))) ?? null
	);
}

function getDeckSourceEditMessage(editError: DeckSourceEditError): string {
	switch (editError.type) {
		case "missing-front":
			return "Card front is required";
		case "missing-back":
			return "Card back is required";
		case "reserved-marker":
			return `Card content cannot contain a reserved marker line: ${editError.marker}`;
		case "card-not-found":
			return "Card not found";
		case "source-file-invalid":
			return "Card block not found in source file";
	}
}
