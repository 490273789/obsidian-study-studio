export const FRONT_BACK_SEPARATOR = "??";
export const EXPLANATION_SEPARATOR = "::";
export const CARD_END_SEPARATOR = ";;";
const TAG_NAME = "#[\\w\\u4e00-\\u9fa5]+";

export const FIRST_TAG_LINE_PATTERN = new RegExp(`(?:^|\\n)\\s*${TAG_NAME}\\s*\\n?`);
const TAG_LINE_PATTERN = new RegExp(`^\\s*${TAG_NAME}\\s*$`);
const FIRST_TAG_CAPTURE_PATTERN = new RegExp(`(?:^|\\n)\\s*(${TAG_NAME})`);

/** The physical line ending a card source uses; source edits never normalize it. */
export type CardSourceNewline = "\n" | "\r\n";

const CARD_IDENTITY_PATTERN =
	"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const CARD_IDENTITY_MARKER_PATTERN = new RegExp(
	`^\\s*<!--\\s*wsr-card-id:\\s*(${CARD_IDENTITY_PATTERN})\\s*-->\\s*$`,
);

const FLASHCARD_FRONT_BACK_PATTERN = /(?:^|\n)\s*\?\?\s*(?:\n|$)/;
const FLASHCARD_END_PATTERN = /(?:^|\n)\s*;;\s*(?:\n|$)/;

const CARD_IDENTITY_EXACT_PATTERN = new RegExp(`^${CARD_IDENTITY_PATTERN}$`);

export function isMarkerLine(line: string, marker: string): boolean {
	const len = line.length;
	const mLen = marker.length;
	let start = 0;
	while (start < len && (line.charCodeAt(start) === 32 || line.charCodeAt(start) === 9)) {
		start++;
	}
	let end = len - 1;
	while (
		end >= start &&
		(line.charCodeAt(end) === 32 || line.charCodeAt(end) === 9 || line.charCodeAt(end) === 13)
	) {
		end--;
	}
	if (end - start + 1 !== mLen) return false;
	for (let i = 0; i < mLen; i++) {
		if (line.charCodeAt(start + i) !== marker.charCodeAt(i)) return false;
	}
	return true;
}

export function hasFlashcardSyntax(content: string): boolean {
	return FLASHCARD_FRONT_BACK_PATTERN.test(content) && FLASHCARD_END_PATTERN.test(content);
}

export function extractCardIdentityMarker(line: string): string | null {
	return line.match(CARD_IDENTITY_MARKER_PATTERN)?.[1]?.toLowerCase() ?? null;
}

export function formatCardIdentityMarker(cardIdentity: string): string {
	if (!CARD_IDENTITY_EXACT_PATTERN.test(cardIdentity)) {
		throw new Error("Invalid card identity");
	}
	return `<!-- wsr-card-id: ${cardIdentity.toLowerCase()} -->`;
}

/** A source tag line (`#单词`) is the document prefix of a card file, not card content. */
export function isTagLine(line: string): boolean {
	return TAG_LINE_PATTERN.test(line);
}

/** The first tag line of a Markdown source, or null when the note is not tagged. */
export function extractFirstTag(content: string): string | null {
	return content.match(FIRST_TAG_CAPTURE_PATTERN)?.[1] ?? null;
}

/** One parsed card block: the content and identity a source scanner and a reader both need. */
export interface ParsedCardBlock {
	readonly front: string;
	readonly back: string;
	readonly explanation: string | undefined;
	readonly identity: string | null;
}

/**
 * Parse one terminated card block (the lines before its `;;` terminator).
 * The single semantic authority shared by file reads and source edits.
 */
export function parseCardBlock(blockLines: readonly string[]): ParsedCardBlock | null {
	const frontBackIndex = blockLines.findIndex((line) => isMarkerLine(line, FRONT_BACK_SEPARATOR));
	if (frontBackIndex === -1) return null;

	const explanationIndex = blockLines.findIndex(
		(line, index) => index > frontBackIndex && isMarkerLine(line, EXPLANATION_SEPARATOR),
	);

	let identity: string | null = null;
	const contentFrontLines: string[] = [];
	for (let i = 0; i < frontBackIndex; i++) {
		const line = blockLines[i]!;
		const marker = extractCardIdentityMarker(line);
		if (marker !== null) {
			if (identity === null) identity = marker;
		} else {
			contentFrontLines.push(line);
		}
	}
	const front = contentFrontLines.join("\n").trim();
	const backLines =
		explanationIndex === -1
			? blockLines.slice(frontBackIndex + 1)
			: blockLines.slice(frontBackIndex + 1, explanationIndex);
	const back = backLines.join("\n").trim();
	const explanation =
		explanationIndex === -1
			? ""
			: blockLines
					.slice(explanationIndex + 1)
					.join("\n")
					.trim();

	if (!front || !back) return null;

	return {
		identity,
		front,
		back,
		explanation: explanation || undefined,
	};
}

/**
 * Format one card block without its terminator. `newline` is required so no
 * caller can silently normalize a source that uses a different line ending.
 */
export function formatCardBlock(
	front: string,
	back: string,
	newline: CardSourceNewline,
	explanation?: string,
	cardIdentity?: string,
): string {
	const trimmedExplanation = explanation?.trim() ?? "";
	const parts = [front.trim(), FRONT_BACK_SEPARATOR, back.trim()];
	if (cardIdentity) {
		parts.unshift(formatCardIdentityMarker(cardIdentity));
	}

	if (trimmedExplanation.length > 0) {
		parts.push(EXPLANATION_SEPARATOR, trimmedExplanation);
	}

	return parts.join("\n").replaceAll("\r\n", "\n").replaceAll("\n", newline);
}
