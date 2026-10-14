import { normalizePath, TFile, TFolder, type App } from "obsidian";
import type { CardSourceMutation } from "../../../core/shared/cardSourceMutation";
import { normalizeDictionaryFavoritePath } from "../domain/configuration";
import { FavoriteSaveError } from "../domain/favorite-save-error";
import {
	dictionaryFavoriteSuggestions,
	favoriteSourceChanges,
	findDictionaryFavorite,
	formatDictionaryFavorite,
	upsertDictionaryFavorite,
	type DictionaryFavoriteEntry,
	type DictionaryFavoriteStore,
	type StoredDictionaryFavorite,
} from "../domain/favorite-file";

/**
 * Obsidian Vault adapter for dictionary favorites.
 * Handles Vault reading, writing, atomic processing, folder creation, and note opening.
 */
export class ObsidianDictionaryFavoriteStore implements DictionaryFavoriteStore {
	constructor(
		private readonly app: App,
		private readonly sourceEdits?: CardSourceMutation,
	) {}

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
		const expectedContent = await this.app.vault.read(existing);
		const preparation = this.sourceEdits
			? await this.sourceEdits.prepare(path, expectedContent)
			: { kind: "unmanaged" as const };
		if (preparation.kind === "ready") {
			const outcome = await this.sourceEdits!.change({
				path,
				expectedContent,
				changes: favoriteSourceChanges(expectedContent, entry, preparation.cards),
			});
			if (outcome.kind === "applied") return path;
			if (outcome.kind === "blocked") throw new FavoriteSaveError(outcome.reason);
			if (outcome.kind === "source-changing") throw new FavoriteSaveError("source-changing");
			if (outcome.kind === "validation-failed") {
				throw new FavoriteSaveError("invalid-card-content");
			}
			throw new Error("Favorite source update failed");
		}
		if (preparation.kind === "blocked") throw new FavoriteSaveError(preparation.reason);
		if (preparation.kind === "source-changing") throw new FavoriteSaveError("source-changing");
		if (preparation.kind === "failed") throw new Error("Favorite source preparation failed");
		let written = false;
		await this.app.vault.process(existing, (current) => {
			if (current !== expectedContent) return current;
			const next = upsertDictionaryFavorite(current, entry);
			written = true;
			return next;
		});
		if (!written) throw new FavoriteSaveError("source-changing");
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

/** Backward-compatible export alias */
export { ObsidianDictionaryFavoriteStore as DictionaryFavoriteFile };
