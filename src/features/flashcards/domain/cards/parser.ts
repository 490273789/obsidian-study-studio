import type { TFile, Vault } from "obsidian";
import { createEmptyCard } from "ts-fsrs";
import { FlashCard, Deck } from "../../../../core/shared/types";
import {
	EXPLANATION_SEPARATOR,
	FIRST_TAG_LINE_PATTERN,
	FRONT_BACK_SEPARATOR,
	CARD_END_SEPARATOR,
	extractCardIdentityMarker,
	hasFlashcardSyntax,
	isMarkerLine,
} from "./cardFormat";

/**
 * Generate a unique ID for cards
 */
function generateCardId(filePath: string, index: number): string {
	return `${filePath}::${index}`;
}

/**
 * Extract the first tag from content
 */
export function extractFirstTag(content: string): string | null {
	// Match hashtag at the start of the file or after newlines
	const tagMatch = content.match(/(?:^|\n)\s*(#[\w\u4e00-\u9fa5]+)/);
	return tagMatch && tagMatch[1] ? tagMatch[1] : null;
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

	// Remove the tag line from content for parsing
	const contentWithoutTag = content.replace(FIRST_TAG_LINE_PATTERN, "\n");
	const lines = contentWithoutTag.split(/\r?\n/);
	let currentBlock: string[] = [];

	for (const line of lines) {
		if (!isMarkerLine(line, CARD_END_SEPARATOR)) {
			currentBlock.push(line);
			continue;
		}

		const parsed = parseCardBlock(currentBlock);
		currentBlock = [];
		if (!parsed) continue;

		const cardId = parsed.cardIdentity ?? generateCardId(filePath, cards.length);

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

function parseCardBlock(
	blockLines: string[],
): (Pick<FlashCard, "front" | "back" | "explanation"> & { cardIdentity: string | null }) | null {
	const frontBackIndex = blockLines.findIndex((line) => isMarkerLine(line, FRONT_BACK_SEPARATOR));
	if (frontBackIndex === -1) return null;

	const explanationIndex = blockLines.findIndex(
		(line, index) => index > frontBackIndex && isMarkerLine(line, EXPLANATION_SEPARATOR),
	);

	let cardIdentity: string | null = null;
	const contentFrontLines: string[] = [];
	for (let i = 0; i < frontBackIndex; i++) {
		const line = blockLines[i]!;
		const marker = extractCardIdentityMarker(line);
		if (marker !== null) {
			if (cardIdentity === null) {
				cardIdentity = marker;
			}
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
		cardIdentity,
		front,
		back,
		explanation: explanation || undefined,
	};
}

/**
 * Parse a single file into a deck.
 * Pass `preloadedContent` to avoid reading the file a second time when the
 * caller has already read it (e.g. inside a vault-wide scan loop).
 */
export async function parseFileIntoDeck(
	file: TFile,
	vault: Vault,
	existingDeck?: Deck,
	preloadedContent?: string,
): Promise<Deck | null> {
	const content = preloadedContent ?? (await vault.cachedRead(file));
	const tag = extractFirstTag(content);

	if (!tag) return null;

	// Create a map of existing cards for preserving FSRS state
	const existingCardsMap = new Map<string, FlashCard>();
	if (existingDeck) {
		existingDeck.cards.forEach((card) => {
			existingCardsMap.set(card.id, card);
		});
	}

	const cards = parseFlashcards(content, file.path, existingCardsMap);

	if (cards.length === 0) return null;

	// Extract deck name from file name
	const deckName = file.basename;

	return {
		id: file.path,
		name: deckName,
		filePath: file.path,
		tag,
		cards,
		studyCount: existingDeck?.studyCount || 0,
		lastStudied: existingDeck?.lastStudied || null,
	};
}

/**
 * Scan all files with a specific tag
 */
export async function scanFilesWithTag(
	vault: Vault,
	targetTag: string,
	existingDecks: Map<string, Deck>,
): Promise<Deck[]> {
	const decks: Deck[] = [];
	const files = vault.getMarkdownFiles();

	for (const file of files) {
		try {
			const content = await vault.cachedRead(file);
			const tag = extractFirstTag(content);

			// Check if file has the target tag (case-insensitive comparison)
			if (tag && tag.toLowerCase() === targetTag.toLowerCase()) {
				const existingDeck = existingDecks.get(file.path);
				const deck = await parseFileIntoDeck(file, vault, existingDeck, content);
				if (deck) {
					decks.push(deck);
				}
			}
		} catch (error) {
			console.error(`Error parsing file ${file.path}:`, error);
		}
	}

	return decks;
}

/**
 * Find all unique tags that contain flashcards
 */
export async function findAllFlashcardTags(vault: Vault): Promise<string[]> {
	const tags = new Set<string>();
	const files = vault.getMarkdownFiles();

	for (const file of files) {
		try {
			const content = await vault.cachedRead(file);
			const tag = extractFirstTag(content);

			// Check if file contains flashcard separators
			if (tag && hasFlashcardSyntax(content)) {
				tags.add(tag);
			}
		} catch (error) {
			console.error(`Error scanning file ${file.path}:`, error);
		}
	}

	return Array.from(tags);
}
