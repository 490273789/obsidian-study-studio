import { normalizeDictionaryFavoritePath, normalizeDictionaryQuery } from "./configuration";
import type { CardSourceOperation, SourceCard } from "../../../core/shared/cardSourceMutation";

export const DICTIONARY_FAVORITE_MEANING_MAX_LENGTH = 8_000;
export const DICTIONARY_FAVORITE_NOTE_MAX_LENGTH = 16_000;
export const DICTIONARY_FAVORITE_PATH_MAX_LENGTH = 500;
export const DICTIONARY_FAVORITE_SUGGESTION_LIMIT = 300;

type FavoriteSaveFailure =
	| "migration-required"
	| "source-needs-repair"
	| "source-changing"
	| "invalid-card-content";

export class FavoriteSaveError extends Error {
	constructor(readonly reason: FavoriteSaveFailure) {
		super(reason);
		this.name = "FavoriteSaveError";
	}
}

export interface DictionaryFavoriteEntry {
	meaning: string;
	note: string;
	path: string;
	word: string;
}

export interface StoredDictionaryFavorite {
	meaning: string;
	note: string;
	path: string;
	word: string;
}

export interface DictionaryFavoriteStore {
	/** Suggestions relative to `currentPath`; `query` is the draft path being typed. */
	suggestions(currentPath: string, query?: string): string[];
	save(entry: DictionaryFavoriteEntry): Promise<string>;
	find(path: string, word: string): Promise<StoredDictionaryFavorite | null>;
	open(path: string): Promise<boolean>;
}

/** Matches one `## word / ?? / meaning / :: / note / ;;` favorite block. */
const DICTIONARY_FAVORITE_BLOCK_PATTERN =
	/^##[ \t]+(.+?)[ \t]*(?:\r\n|\r|\n)[ \t]*\?\?[ \t]*(?:\r\n|\r|\n)((?:(?!^[ \t]*(?:\?\?|;;)[ \t]*(?=\r|\n|$))[\s\S])*?)(?:\r\n|\r|\n)[ \t]*::[ \t]*(?:\r\n|\r|\n)((?:(?!^[ \t]*(?:\?\?|;;)[ \t]*(?=\r|\n|$))[\s\S])*?)(?:\r\n|\r|\n)[ \t]*;;[ \t]*(?=\r|\n|$)/gmu;

function normalizeBody(value: string, limit: number): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim().slice(0, limit);
}

/** Serializes one favorite block; throws when the word normalizes to nothing. */
export function formatDictionaryFavorite(entry: DictionaryFavoriteEntry): string {
	const word = normalizeDictionaryQuery(entry.word);
	if (!word) throw new Error("Favorite word is empty");
	const meaning = normalizeBody(entry.meaning, DICTIONARY_FAVORITE_MEANING_MAX_LENGTH);
	const note = normalizeBody(entry.note, DICTIONARY_FAVORITE_NOTE_MAX_LENGTH);
	return `## ${word}\n??\n${meaning}\n::\n${note}\n;;\n`;
}

/**
 * Appends a serialized favorite to existing markdown content, preserving one
 * blank line between blocks.
 */
export function appendDictionaryFavorite(current: string, favorite: string): string {
	if (!current) return favorite;
	const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
	return `${current}${separator}${favorite}`;
}

function favoriteWordKey(word: string): string {
	return normalizeDictionaryQuery(word).toLocaleLowerCase("en-US");
}

/** Updates the last matching block and removes earlier duplicates, without rewriting other text. */
export function upsertDictionaryFavorite(current: string, entry: DictionaryFavoriteEntry): string {
	const favorite = formatDictionaryFavorite(entry);
	const key = favoriteWordKey(entry.word);
	const pattern = new RegExp(
		DICTIONARY_FAVORITE_BLOCK_PATTERN.source,
		DICTIONARY_FAVORITE_BLOCK_PATTERN.flags,
	);
	const matches = [...current.matchAll(pattern)].filter(
		(match) => favoriteWordKey(match[1] ?? "") === key,
	);
	const last = matches[matches.length - 1];
	if (!last) return appendDictionaryFavorite(current, favorite);

	let cursor = 0;
	const parts: string[] = [];
	for (const match of matches) {
		parts.push(current.slice(cursor, match.index));
		cursor = match.index + match[0].length;
		if (match === last) {
			const newline = match[0].match(/\r\n|\r|\n/)?.[0] ?? "\n";
			parts.push(favorite.slice(0, -1).replaceAll("\n", newline));
		} else {
			// The removed block owns its trailing newline, but surrounding text does not.
			const newline = current.slice(cursor).match(/^(?:\r\n|\r|\n)/)?.[0];
			cursor += newline?.length ?? 0;
		}
	}
	parts.push(current.slice(cursor));
	return parts.join("");
}

function favoriteCardWord(card: SourceCard): string | null {
	const match = card.front.match(/^##[ \t]+(.+?)[ \t]*$/u);
	return match ? favoriteWordKey(match[1] ?? "") : null;
}

export function favoriteSourceChanges(
	current: string,
	entry: DictionaryFavoriteEntry,
	cards: readonly SourceCard[],
): CardSourceOperation[] {
	const key = favoriteWordKey(entry.word);
	const matches = cards.filter((card) => favoriteCardWord(card) === key);
	const favorites = parseDictionaryFavorites(current).filter(
		(favorite) => favoriteWordKey(favorite.word) === key,
	);
	// A favorite with extra front matter or an invalid card body cannot safely be
	// replaced using a card identity. Keep the original source for explicit repair.
	if (favorites.length !== matches.length) throw new FavoriteSaveError("source-needs-repair");
	const content = {
		front: `## ${normalizeDictionaryQuery(entry.word)}`,
		back: normalizeBody(entry.meaning, DICTIONARY_FAVORITE_MEANING_MAX_LENGTH),
		explanation: normalizeBody(entry.note, DICTIONARY_FAVORITE_NOTE_MAX_LENGTH),
	};
	const last = matches[matches.length - 1];
	return last
		? [
				{ kind: "edit", identity: last.identity, content },
				...matches.slice(0, -1).map((card): CardSourceOperation => ({
					kind: "delete",
					identity: card.identity,
				})),
			]
		: [{ kind: "add", content }];
}

/** Parses every favorite block in `content` in document order. */
export function parseDictionaryFavorites(
	content: string,
): Omit<StoredDictionaryFavorite, "path">[] {
	const normalizedContent = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	const pattern = new RegExp(
		DICTIONARY_FAVORITE_BLOCK_PATTERN.source,
		DICTIONARY_FAVORITE_BLOCK_PATTERN.flags,
	);
	const favorites: Omit<StoredDictionaryFavorite, "path">[] = [];
	for (const match of normalizedContent.matchAll(pattern)) {
		const word = normalizeDictionaryQuery(match[1] ?? "");
		if (!word) continue;
		favorites.push({
			meaning: match[2] ?? "",
			note: match[3] ?? "",
			word,
		});
	}
	return favorites;
}

/** Returns the last block stored for `requestedWord`, or null when absent. */
export function findDictionaryFavorite(
	content: string,
	requestedWord: string,
): Omit<StoredDictionaryFavorite, "path"> | null {
	const normalizedWord = favoriteWordKey(requestedWord);
	if (!normalizedWord) return null;
	let found: Omit<StoredDictionaryFavorite, "path"> | null = null;
	for (const favorite of parseDictionaryFavorites(content)) {
		if (favoriteWordKey(favorite.word) !== normalizedWord) continue;
		found = favorite;
	}
	return found;
}

/** Normalizes typed input for matching without appending a `.md` extension. */
function normalizeSuggestionQuery(value: string): string {
	return value.trim().replaceAll("\\", "/").replace(/^\/+/, "").toLocaleLowerCase("en-US");
}

/**
 * Pins the committed path and `word.md`, then offers existing markdown paths
 * relevant to the typed text. Matching happens before the result limit so a
 * large vault cannot crowd out the paths under the typed folder; prefix matches
 * rank above paths that merely contain the typed text.
 */
export function dictionaryFavoriteSuggestions(
	currentPath: string,
	markdownPaths: readonly string[],
	query = "",
): string[] {
	const pinned = [...new Set([normalizeDictionaryFavoritePath(currentPath), "word.md"])];
	const paths = new Set<string>(markdownPaths);
	for (const path of pinned) paths.delete(path);
	// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array copied from the set.
	const existing = [...paths].sort((left, right) => left.localeCompare(right));
	const candidates = [...pinned, ...existing];
	const normalizedQuery = normalizeSuggestionQuery(query);
	if (!normalizedQuery) return candidates.slice(0, DICTIONARY_FAVORITE_SUGGESTION_LIMIT);
	const prefixMatches: string[] = [];
	const otherMatches: string[] = [];
	for (const path of candidates) {
		const normalizedPath = path.toLocaleLowerCase("en-US");
		if (normalizedPath.startsWith(normalizedQuery)) prefixMatches.push(path);
		else if (normalizedPath.includes(normalizedQuery)) otherMatches.push(path);
	}
	return [...prefixMatches, ...otherMatches].slice(0, DICTIONARY_FAVORITE_SUGGESTION_LIMIT);
}

/** Pure in-memory dictionary favorite store for tests and fallback execution. */
export function createMemoryDictionaryFavoriteStore(
	initialFiles: Record<string, string> = {},
): DictionaryFavoriteStore {
	const files = new Map<string, string>(Object.entries(initialFiles));
	return {
		suggestions(currentPath: string, query = ""): string[] {
			return dictionaryFavoriteSuggestions(currentPath, [...files.keys()], query);
		},
		async save(entry: DictionaryFavoriteEntry): Promise<string> {
			const path = normalizeDictionaryFavoritePath(entry.path, "");
			if (!path) throw new Error("Favorite path is empty");
			const current = files.get(path) ?? "";
			const next = upsertDictionaryFavorite(current, entry);
			files.set(path, next);
			return path;
		},
		async find(path: string, word: string): Promise<StoredDictionaryFavorite | null> {
			const normalizedPath = normalizeDictionaryFavoritePath(path, "");
			const content = files.get(normalizedPath);
			if (!content) return null;
			const found = findDictionaryFavorite(content, word);
			return found ? { ...found, path: normalizedPath } : null;
		},
		async open(path: string): Promise<boolean> {
			const normalizedPath = normalizeDictionaryFavoritePath(path, "");
			return files.has(normalizedPath);
		},
	};
}
