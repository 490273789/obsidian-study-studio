import { validatedFavoriteCategoryPath } from "./configuration";
import type { DictionarySettingsStore, FavoriteCategory } from "./types";

export type FavoriteCategoryFailure =
	| "busy"
	| "invalid-name"
	| "duplicate-name"
	| "invalid-path"
	| "duplicate-path"
	| "missing"
	| "conflict"
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

function claimsPath(category: FavoriteCategory, path: string): boolean {
	return category.path.toLocaleLowerCase() === path.toLocaleLowerCase();
}

function assertUniqueCategory(
	categories: readonly FavoriteCategory[],
	name: string,
	path: string,
	exceptId?: string,
): void {
	const normalizedName = name.toLocaleLowerCase();
	for (const category of categories) {
		if (category.id === exceptId) continue;
		if (category.name.toLocaleLowerCase() === normalizedName)
			throw new FavoriteCategoryError("duplicate-name");
		if (claimsPath(category, path)) throw new FavoriteCategoryError("duplicate-path");
	}
}

function expectCurrentCategory(
	categories: readonly FavoriteCategory[],
	expected: FavoriteCategory,
): FavoriteCategory {
	const current = categories.find((category) => category.id === expected.id);
	if (!current || current.name !== expected.name || current.path !== expected.path)
		throw new FavoriteCategoryError("conflict");
	return current;
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
					assertUniqueCategory(draft.favoriteCategories, name, path);
					draft.favoriteCategories.push(category);
					if (select) draft.selectedFavoriteCategoryId = category.id;
				});
			} catch (error) {
				if (!this.categories.some((category) => claimsPath(category, path)))
					await this.rollback(undo);
				throw error;
			}
			return category;
		});
	}

	async edit(id: string, rawName: string, rawPath: string): Promise<void> {
		await this.runExclusive(async () => {
			const current = this.snapshotCategory(id);
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
					const category = expectCurrentCategory(draft.favoriteCategories, current);
					assertUniqueCategory(draft.favoriteCategories, name, path, id);
					category.name = name;
					category.path = path;
				});
			} catch (error) {
				if (undo) {
					// Moving the file back would orphan the synchronized destination category.
					const destinationClaimed = this.categories.some(
						(category) =>
							(category.id !== current.id || category.path !== current.path) &&
							claimsPath(category, path),
					);
					if (destinationClaimed) throw new FavoriteCategoryError("recovery-incomplete");
					await this.rollback(undo);
				}
				throw error;
			}
		});
	}

	async remove(id: string): Promise<void> {
		await this.runExclusive(async () => {
			const current = this.snapshotCategory(id);
			if (this.categories.length === 1) throw new FavoriteCategoryError("last-category");
			await this.persist((draft) => {
				expectCurrentCategory(draft.favoriteCategories, current);
				if (draft.favoriteCategories.length === 1)
					throw new FavoriteCategoryError("last-category");
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
				if (!draft.favoriteCategories.some((category) => category.id === id))
					throw new FavoriteCategoryError("conflict");
				draft.selectedFavoriteCategoryId = id;
			});
		});
	}

	delete = (id: string) => this.remove(id);

	private snapshotCategory(id: string): FavoriteCategory {
		const category = this.categories.find((item) => item.id === id);
		if (!category) throw new FavoriteCategoryError("missing");
		return { ...category };
	}

	private validate(
		rawName: string,
		rawPath: string,
		exceptId?: string,
	): { name: string; path: string } {
		const name = rawName.trim();
		if (!name || name.length > 120) throw new FavoriteCategoryError("invalid-name");
		const path = favoriteCategoryPath(rawPath);
		assertUniqueCategory(this.categories, name, path, exceptId);
		return { name, path };
	}

	private async persist(
		mutate: Parameters<DictionarySettingsStore["updateDictionarySettings"]>[0],
	): Promise<void> {
		let saved = false;
		let invalid: FavoriteCategoryError | undefined;
		try {
			saved = await this.settings.updateDictionarySettings((draft) => {
				try {
					mutate(draft);
				} catch (error) {
					// The settings adapter can return false for a rejected mutation.
					if (error instanceof FavoriteCategoryError) invalid = error;
					throw error;
				}
			});
		} catch {
			/* Report the same error as a failed save. */
		}
		if (!saved) throw invalid ?? new FavoriteCategoryError("save-failed");
		try {
			this.changed();
		} catch (error) {
			console.error("Failed to report a saved favorite category change:", error);
		}
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
