import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { normalizeDictionaryFavoritePath, normalizeDictionaryQuery } from "./configuration";

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

import {
	DICTIONARY_FAVORITE_MEANING_MAX_LENGTH,
	DICTIONARY_FAVORITE_NOTE_MAX_LENGTH,
	DICTIONARY_FAVORITE_SUGGESTION_LIMIT,
} from "./favorite-limits";
export * from "./favorite-limits";

/** Matches one `## word / ?? / meaning / :: / note / ;;` favorite block. */
export const DICTIONARY_FAVORITE_BLOCK_PATTERN =
	/^##[ \t]+(.+?)[ \t]*\n\?\?\n([\s\S]*?)\n::\n([\s\S]*?)\n;;[ \t]*(?=\n|$)/gmu;

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
	const normalizedWord = normalizeDictionaryQuery(requestedWord).toLocaleLowerCase("en-US");
	if (!normalizedWord) return null;
	let found: Omit<StoredDictionaryFavorite, "path"> | null = null;
	for (const favorite of parseDictionaryFavorites(content)) {
		if (favorite.word.toLocaleLowerCase("en-US") !== normalizedWord) continue;
		found = favorite;
	}
	return found;
}

/** Pins the committed path and `word.md`, then appends existing markdown paths. */
export function dictionaryFavoriteSuggestions(
	currentPath: string,
	markdownPaths: readonly string[],
): string[] {
	const pinned = [...new Set([normalizeDictionaryFavoritePath(currentPath), "word.md"])];
	const paths = new Set<string>(markdownPaths);
	for (const path of pinned) paths.delete(path);
	// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array copied from the set.
	const existing = [...paths].sort((left, right) => left.localeCompare(right));
	return [...pinned, ...existing].slice(0, DICTIONARY_FAVORITE_SUGGESTION_LIMIT);
}

export class DictionaryFavoriteFile {
	constructor(private readonly app: App) {}

	suggestions(currentPath: string): string[] {
		return dictionaryFavoriteSuggestions(
			currentPath,
			this.app.vault.getMarkdownFiles().map((file) => file.path),
		);
	}

	async save(entry: DictionaryFavoriteEntry): Promise<string> {
		const path = normalizePath(normalizeDictionaryFavoritePath(entry.path, ""));
		if (!path) throw new Error("Favorite path is empty");
		const favorite = formatDictionaryFavorite(entry);
		await this.ensureParentFolder(path);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			await this.app.vault.create(path, favorite);
			return path;
		}
		if (!(existing instanceof TFile)) throw new Error("Favorite path is not a file");
		await this.app.vault.process(existing, (current) =>
			appendDictionaryFavorite(current, favorite),
		);
		return path;
	}

	async find(path: string, word: string): Promise<StoredDictionaryFavorite | null> {
		const normalizedPath = normalizePath(normalizeDictionaryFavoritePath(path, ""));
		const file = normalizedPath ? this.app.vault.getFileByPath(normalizedPath) : null;
		if (!file) return null;
		const found = findDictionaryFavorite(await this.app.vault.cachedRead(file), word);
		return found ? { ...found, path: normalizedPath } : null;
	}

	async open(path: string): Promise<boolean> {
		const normalized = normalizePath(normalizeDictionaryFavoritePath(path, ""));
		const file = normalized ? this.app.vault.getFileByPath(normalized) : null;
		if (!file) return false;
		await this.app.workspace.openLinkText(file.path, "", true);
		return true;
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parts = filePath.split("/").slice(0, -1);
		let currentPath = "";
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(currentPath);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error("Favorite parent path is not a folder");
			// oxlint-disable-next-line no-await-in-loop -- child folders depend on their parents.
			await this.app.vault.createFolder(currentPath);
		}
	}
}
