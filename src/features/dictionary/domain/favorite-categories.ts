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
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly settings: DictionarySettingsStore,
		private readonly files: FavoriteCategoryFiles,
		private readonly changed: () => void = () => undefined,
	) {}

	get categories(): readonly FavoriteCategory[] {
		return this.settings.getDictionarySettings().favoriteCategories;
	}

	get selectedCategoryId(): string {
		return this.settings.getDictionarySettings().selectedFavoriteCategoryId;
	}

	get selectedCategory(): FavoriteCategory {
		const dictionary = this.settings.getDictionarySettings();
		return (
			dictionary.favoriteCategories.find(
				(item) => item.id === dictionary.selectedFavoriteCategoryId,
			) ?? dictionary.favoriteCategories[0]!
		);
	}

	get path(): string {
		return this.selectedCategory.path;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	pathSuggestions(query: string): string[] {
		return this.files.pathSuggestions(query);
	}

	/** Executes an action serialized against concurrent writes and file moves. */
	async runExclusive<T>(action: () => Promise<T>): Promise<T> {
		if (this.busy) throw new FavoriteCategoryError("busy");
		this.busy = true;
		try {
			return await action();
		} finally {
			this.busy = false;
		}
	}

	/** Backwards-compatible alias for runExclusive. */
	async saveFavorite<T>(action: () => Promise<T>): Promise<T> {
		return this.runExclusive(action);
	}

	async create(rawName: string, rawPath: string, select = false): Promise<FavoriteCategory> {
		return this.runExclusive(async () => {
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
		await this.runExclusive(async () => {
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
		await this.runExclusive(async () => {
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
		await this.runExclusive(async () => {
			if (!this.categories.some((item) => item.id === id))
				throw new FavoriteCategoryError("missing");
			if (this.settings.getDictionarySettings().selectedFavoriteCategoryId === id) return;
			await this.persist((draft) => {
				draft.selectedFavoriteCategoryId = id;
			});
		});
	}

	delete = (id: string) => this.remove(id);

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
		this.publish();
	}

	private publish(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Listeners must never fail category persistence.
			}
		}
	}

	private async rollback(undo: () => Promise<void>): Promise<void> {
		try {
			await undo();
		} catch {
			throw new FavoriteCategoryError("recovery-incomplete");
		}
	}
}
