import { validatedFavoriteCategoryPath } from "./configuration";
import type { DictionarySettingsStore, FavoriteCategory } from "./types";

export type FavoriteCategoryFailure =
	| "busy"
	| "invalid-name"
	| "duplicate-name"
	| "invalid-path"
	| "duplicate-path"
	| "missing"
	| "last-category"
	| "file-failed"
	| "save-failed"
	| "recovery-incomplete";

export class FavoriteCategoryError extends Error {
	constructor(readonly reason: FavoriteCategoryFailure) {
		super(reason);
		this.name = "FavoriteCategoryError";
	}
}

export interface FavoriteCategoryFiles {
	/** The undo callback only removes a file created by this operation. */
	ensureFile(path: string): Promise<() => Promise<void>>;
	/** The undo callback moves the file back to its original path. */
	moveFile(from: string, to: string): Promise<() => Promise<void>>;
	pathSuggestions(query: string): string[];
}

export function favoriteCategoryPath(raw: string): string {
	const path = validatedFavoriteCategoryPath(raw);
	if (!path) throw new FavoriteCategoryError("invalid-path");
	return path;
}

/** Suggests existing vault paths without reading file contents. */
export function favoriteCategoryPathSuggestions(paths: readonly string[], query: string): string[] {
	const normalized = query.trim().replaceAll("\\", "/").toLocaleLowerCase();
	return [...new Set(paths)]
		.filter((path) => path && (!normalized || path.toLocaleLowerCase().includes(normalized)))
		.sort(
			(a, b) =>
				Number(b.toLocaleLowerCase().startsWith(normalized)) -
					Number(a.toLocaleLowerCase().startsWith(normalized)) || a.localeCompare(b),
		)
		.slice(0, 300);
}

/** Serializes category and selection writes against their vault file operations. */
export class FavoriteCategoryManager {
	private busy = false;

	constructor(
		private readonly settings: DictionarySettingsStore,
		private readonly files: FavoriteCategoryFiles,
		private readonly changed: () => void,
	) {}

	get categories(): readonly FavoriteCategory[] {
		return this.settings.getDictionarySettings().favoriteCategories;
	}

	pathSuggestions(query: string): string[] {
		return this.files.pathSuggestions(query);
	}

	/** A favorite write and a category file move must never target the same file concurrently. */
	async saveFavorite<T>(action: () => Promise<T>): Promise<T> {
		return this.run(action);
	}

	async create(rawName: string, rawPath: string, select: boolean): Promise<FavoriteCategory> {
		return this.run(async () => {
			const { name, path } = this.validate(rawName, rawPath);
			const category = { id: crypto.randomUUID(), name, path };
			let undo: () => Promise<void>;
			try {
				undo = await this.files.ensureFile(path);
			} catch {
				throw new FavoriteCategoryError("file-failed");
			}
			try {
				await this.persist((draft) => {
					draft.favoriteCategories.push(category);
					if (select) draft.selectedFavoriteCategoryId = category.id;
				});
			} catch (error) {
				await this.rollback(undo);
				throw error;
			}
			return category;
		});
	}

	async edit(id: string, rawName: string, rawPath: string): Promise<void> {
		await this.run(async () => {
			const current = this.categories.find((item) => item.id === id);
			if (!current) throw new FavoriteCategoryError("missing");
			const { name, path } = this.validate(rawName, rawPath, id);
			if (name === current.name && path === current.path) return;
			let undo: (() => Promise<void>) | null = null;
			if (path !== current.path) {
				try {
					undo = await this.files.moveFile(current.path, path);
				} catch {
					throw new FavoriteCategoryError("file-failed");
				}
			}
			try {
				await this.persist((draft) => {
					const category = draft.favoriteCategories.find((item) => item.id === id);
					if (category) {
						category.name = name;
						category.path = path;
					}
				});
			} catch (error) {
				if (undo) await this.rollback(undo);
				throw error;
			}
		});
	}

	async remove(id: string): Promise<void> {
		await this.run(async () => {
			if (!this.categories.some((item) => item.id === id))
				throw new FavoriteCategoryError("missing");
			if (this.categories.length === 1) throw new FavoriteCategoryError("last-category");
			await this.persist((draft) => {
				draft.favoriteCategories = draft.favoriteCategories.filter(
					(item) => item.id !== id,
				);
				if (draft.selectedFavoriteCategoryId === id)
					draft.selectedFavoriteCategoryId = draft.favoriteCategories[0]!.id;
			});
		});
	}

	async select(id: string): Promise<void> {
		await this.run(async () => {
			if (!this.categories.some((item) => item.id === id))
				throw new FavoriteCategoryError("missing");
			if (this.settings.getDictionarySettings().selectedFavoriteCategoryId === id) return;
			await this.persist((draft) => {
				draft.selectedFavoriteCategoryId = id;
			});
		});
	}

	private validate(
		rawName: string,
		rawPath: string,
		exceptId?: string,
	): { name: string; path: string } {
		const name = rawName.trim();
		if (!name || name.length > 120) throw new FavoriteCategoryError("invalid-name");
		const path = favoriteCategoryPath(rawPath);
		for (const category of this.categories) {
			if (category.id === exceptId) continue;
			if (category.name.toLocaleLowerCase() === name.toLocaleLowerCase())
				throw new FavoriteCategoryError("duplicate-name");
			if (category.path.toLocaleLowerCase() === path.toLocaleLowerCase())
				throw new FavoriteCategoryError("duplicate-path");
		}
		return { name, path };
	}

	private async persist(
		mutate: Parameters<DictionarySettingsStore["updateDictionarySettings"]>[0],
	): Promise<void> {
		let saved = false;
		try {
			saved = await this.settings.updateDictionarySettings(mutate);
		} catch {
			/* Report the same error as a failed save. */
		}
		if (!saved) throw new FavoriteCategoryError("save-failed");
		this.changed();
	}

	private async rollback(undo: () => Promise<void>): Promise<void> {
		try {
			await undo();
		} catch {
			throw new FavoriteCategoryError("recovery-incomplete");
		}
	}

	private async run<T>(action: () => Promise<T>): Promise<T> {
		if (this.busy) throw new FavoriteCategoryError("busy");
		this.busy = true;
		try {
			return await action();
		} finally {
			this.busy = false;
		}
	}
}
