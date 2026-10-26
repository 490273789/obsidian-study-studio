import { normalizePath, TFile, TFolder, type App } from "obsidian";
import type { CardSourceMutation } from "../../../core/shared/cardSourceMutation";
import { normalizeDictionaryFavoritePath } from "../domain/configuration";
import {
	FavoriteSaveError,
	favoriteSourceChanges,
	findDictionaryFavorite,
	formatDictionaryFavorite,
	upsertDictionaryFavorite,
	type DictionaryFavoriteEntry,
	type DictionaryFavoriteStore,
	type StoredDictionaryFavorite,
} from "../domain/favorite-file";
import { favoriteCategoryPathSuggestions } from "../domain/favorite-categories";

/**
 * Obsidian Vault adapter for dictionary favorites.
 * Handles Vault reading, writing, atomic processing, folder creation, and note opening.
 */
export class ObsidianDictionaryFavoriteStore implements DictionaryFavoriteStore {
	constructor(
		private readonly app: App,
		private readonly sourceEdits?: CardSourceMutation,
	) {}

	pathSuggestions(query: string): string[] {
		const paths = this.app.vault
			.getAllLoadedFiles()
			.flatMap((file) =>
				file instanceof TFolder
					? [file.path === "/" ? "" : `${file.path}/`]
					: file instanceof TFile && file.extension.toLowerCase() === "md"
						? [file.path]
						: [],
			);
		return favoriteCategoryPathSuggestions(paths, query);
	}

	async ensureFile(path: string): Promise<() => Promise<void>> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile && existing.extension.toLowerCase() === "md")
			return async () => undefined;
		if (existing) throw new Error("Favorite path is not a Markdown file");
		const folders = await this.ensureParentFolder(path);
		let created: TFile;
		try {
			created = await this.app.vault.create(path, "");
		} catch (error) {
			await this.cleanupFolders(folders);
			throw error;
		}
		return async () => {
			const file = this.app.vault.getFileByPath(path);
			if (file !== created || (await this.app.vault.read(file)) !== "")
				throw new Error("Favorite file changed");
			await this.app.vault.delete(file, true);
			await this.cleanupFolders(folders);
		};
	}

	async moveFile(from: string, to: string): Promise<() => Promise<void>> {
		const file = this.app.vault.getFileByPath(from);
		if (!file || this.app.vault.getAbstractFileByPath(to))
			throw new Error("Cannot move favorite file");
		const folders = await this.ensureParentFolder(to);
		try {
			await this.app.fileManager.renameFile(file, to);
		} catch (error) {
			await this.cleanupFolders(folders);
			throw error;
		}
		return async () => {
			const moved = this.app.vault.getFileByPath(to);
			if (moved !== file || this.app.vault.getAbstractFileByPath(from))
				throw new Error("Cannot restore favorite file");
			await this.app.fileManager.renameFile(moved, from);
			await this.cleanupFolders(folders);
		};
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

	private async ensureParentFolder(filePath: string): Promise<string[]> {
		const parts = filePath.split("/").slice(0, -1);
		const created: string[] = [];
		let currentPath = "";
		try {
			for (const part of parts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const existing = this.app.vault.getAbstractFileByPath(currentPath);
				if (existing instanceof TFolder) continue;
				if (existing) throw new Error("Favorite parent path is not a folder");
				// oxlint-disable-next-line no-await-in-loop -- child folders depend on their parents.
				await this.app.vault.createFolder(currentPath);
				created.push(currentPath);
			}
		} catch (error) {
			await this.cleanupFolders(created);
			throw error;
		}
		return created;
	}

	private async cleanupFolders(paths: string[]): Promise<void> {
		for (const path of [...paths].reverse()) {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (folder instanceof TFolder && folder.children.length === 0) {
				// oxlint-disable-next-line no-await-in-loop -- child folders must be removed first.
				await this.app.vault.delete(folder, true);
			}
		}
	}
}

/** Backward-compatible export alias */
export { ObsidianDictionaryFavoriteStore as DictionaryFavoriteFile };
