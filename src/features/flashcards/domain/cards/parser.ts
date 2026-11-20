import { createEmptyCard } from "ts-fsrs";
import type { FlashCard } from "../../../../core/shared/types";
import {
	CARD_END_SEPARATOR,
	cardSourceBodyStart,
	findSourceTagLine,
	isMarkerLine,
	parseCardBlock,
} from "./cardFormat";

/**
 * Generate a unique ID for cards
 */
function generateCardId(filePath: string, index: number): string {
	return `${filePath}::${index}`;
}

/**
 * Parse flashcards from markdown content
 * Format:
 * - Front/back separated by "??" on its own line
 * - Optional explanation separated by "::" on its own line
 * - Cards ended by ";;" on its own line
 */
export function parseFlashcards(
	content: string,
	filePath: string,
	existingCards?: Map<string, FlashCard>,
): FlashCard[] {
	const cards: FlashCard[] = [];

	const tag = findSourceTagLine(content);
	const bodyStart = cardSourceBodyStart(content);
	const body = tag
		? content.slice(bodyStart, tag.start) + content.slice(tag.end)
		: content.slice(bodyStart);
	const lines = body.split(/\r?\n/);
	let currentBlock: string[] = [];

	for (const line of lines) {
		if (!isMarkerLine(line, CARD_END_SEPARATOR)) {
			currentBlock.push(line);
			continue;
		}

		const parsed = parseCardBlock(currentBlock);
		currentBlock = [];
		if (!parsed) continue;

		const cardId = parsed.identity ?? generateCardId(filePath, cards.length);

		// Preserve existing FSRS state if card exists
		const existingCard = existingCards?.get(cardId);

		cards.push({
			id: cardId,
			front: parsed.front,
			back: parsed.back,
			explanation: parsed.explanation,
			fsrsCard: existingCard?.fsrsCard || createEmptyCard(),
			sourceFile: filePath,
			indexInFile: cards.length,
		});
	}

	return cards;
}
