import { DICTIONARY_QUERY_MAX_LENGTH, normalizeDictionaryQuery } from "./configuration";
import {
	DICTIONARY_FAVORITE_MEANING_MAX_LENGTH,
	DICTIONARY_FAVORITE_NOTE_MAX_LENGTH,
	FavoriteSaveError,
	type DictionaryFavoriteStore,
} from "./favorite-file";
import { isFavoriteAiWord, type FavoriteDraftGenerator } from "./favorite-ai";
import { aiFailureCode } from "../../../core/ai";
import { aiErrorText } from "../../../core/i18n/ai";
import type { Language } from "../../../core/shared/types";
import { dictionaryText } from "./messages";
import type { DictionaryFavoriteViewState, FavoriteCategory } from "./types";
import { FavoriteCategoryError, type FavoriteCategoryManager } from "./favorite-categories";

export interface FavoriteAiOptions {
	readonly generator: FavoriteDraftGenerator;
	/** Null when selection is missing; changes when the selected connection changes. */
	readonly engineKey: () => string | null;
	readonly configId?: () => string | null;
	readonly language: () => Language;
}

/**
 * Deep domain interaction session for dictionary favorites.
 * Owns single-word draft editing, AI draft generation, existing entry lookup,
 * and saving favorite entries to the active category (ADR-0003).
 * Delegates persistent category administration and file mutex to FavoriteCategoryManager (ADR-0010, ADR-0011).
 */
export class DictionaryFavoriteSession {
	private lookupRevision = 0;
	private sessionRevision = 0;
	private contentDirty = false;
	private generation: { controller: AbortController; engineKey: string } | null = null;
	private state: DictionaryFavoriteViewState;
	private snapshot: DictionaryFavoriteViewState;
	private readonly listeners = new Set<() => void>();
	private disposed = false;
	private readonly unsubscribeCategories: () => void;

	constructor(
		private readonly categoriesManager: FavoriteCategoryManager,
		private readonly store: DictionaryFavoriteStore,
		private readonly ai: FavoriteAiOptions,
	) {
		this.state = {
			categories: [...categoriesManager.categories],
			selectedCategoryId: categoriesManager.selectedCategoryId,
			meaning: "",
			message: "",
			note: "",
			path: categoriesManager.path,
			status: "idle",
			word: "",
		};
		this.snapshot = this.buildSnapshot();
		this.unsubscribeCategories = categoriesManager.subscribe(() => {
			this.onCategoriesChanged();
		});
	}

	getSnapshot(): DictionaryFavoriteViewState {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	get categories(): readonly FavoriteCategory[] {
		return this.categoriesManager.categories;
	}

	pathSuggestions(query: string): string[] {
		return this.categoriesManager.pathSuggestions(query);
	}

	/** Executes an action serialized against concurrent writes and file moves. */
	async runExclusive<T>(action: () => Promise<T>): Promise<T> {
		return this.categoriesManager.runExclusive(action);
	}

	/** Backwards-compatible alias for runExclusive. */
	async saveFavorite<T>(action: () => Promise<T>): Promise<T> {
		return this.runExclusive(action);
	}

	async selectCategory(id: string): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		this.lookupRevision += 1;
		try {
			await this.categoriesManager.select(id);
		} catch {
			this.state.message = dictionaryText(this.ai.language()).favoriteCategorySaveFailed;
			this.state.status = "error";
			this.publish();
		}
	}

	async prefill(word: string): Promise<void> {
		if (this.disposed) return;
		const normalized = normalizeDictionaryQuery(word);
		const clearOnMissing = normalized !== this.state.word;
		if (!clearOnMissing && this.state.status === "saving") return;
		if (clearOnMissing) this.sessionRevision += 1;
		this.cancelGeneration();
		if (!clearOnMissing && this.contentDirty) {
			this.publish();
			return;
		}
		if (clearOnMissing) {
			this.contentDirty = false;
			this.state.meaning = "";
			this.state.note = "";
		}
		this.state.word = normalized;
		this.state.message = "";
		this.state.status = "idle";
		this.state.categories = [...this.categoriesManager.categories];
		this.state.selectedCategoryId = this.categoriesManager.selectedCategoryId;
		this.state.path = this.categoriesManager.path;
		this.publish();
		await this.loadExisting(clearOnMissing);
	}

	setWord(value: string): void {
		if (this.disposed || this.state.status === "saving") return;
		this.sessionRevision += 1;
		this.cancelGeneration();
		this.contentDirty = false;
		this.state.word = value.slice(0, DICTIONARY_QUERY_MAX_LENGTH);
		this.state.meaning = "";
		this.state.note = "";
		this.resetMessage();
		this.publish();
		void this.loadExisting(true);
	}

	setMeaning(value: string): void {
		if (this.disposed || this.isBusy()) return;
		this.contentDirty = true;
		this.lookupRevision += 1;
		this.state.meaning = value.slice(0, DICTIONARY_FAVORITE_MEANING_MAX_LENGTH);
		this.resetMessage();
		this.publish();
	}

	setNote(value: string): void {
		if (this.disposed || this.isBusy()) return;
		this.contentDirty = true;
		this.lookupRevision += 1;
		this.state.note = value.slice(0, DICTIONARY_FAVORITE_NOTE_MAX_LENGTH);
		this.resetMessage();
		this.publish();
	}

	async generateAi(): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		const strings = dictionaryText(this.ai.language());
		const word = normalizeDictionaryQuery(this.state.word);
		const configId = this.ai.configId ? this.ai.configId() : this.ai.engineKey();
		const engineKey = this.ai.engineKey();
		const error = !word
			? strings.favoriteWordRequired
			: !isFavoriteAiWord(word)
				? strings.favoriteAiInputUnsupported
				: !configId || !engineKey
					? strings.favoriteAiConfigRequired
					: null;
		if (error || !configId || !engineKey) {
			this.state.status = "error";
			this.state.message = error ?? strings.favoriteAiConfigRequired;
			this.publish();
			return;
		}
		this.lookupRevision += 1;
		const request = { controller: new AbortController(), engineKey };
		this.generation = request;
		this.state.status = "generating";
		this.state.message = strings.favoriteAiGenerating;
		this.publish();
		try {
			const draft = await this.ai.generator.generate(
				word,
				configId,
				request.controller.signal,
			);
			if (this.generation !== request || this.disposed) return;
			if (this.ai.engineKey() !== engineKey) {
				this.cancelGeneration();
				return;
			}
			this.contentDirty = true;
			this.state.meaning = draft.meaning;
			this.state.note = draft.note;
			this.state.status = "success";
			this.state.message = dictionaryText(this.ai.language()).favoriteAiGenerated;
		} catch (error) {
			if (this.generation !== request || this.disposed) return;
			const code = aiFailureCode(error);
			this.state.status = "error";
			this.state.message =
				code === "invalid-response" || code === "incomplete-response"
					? dictionaryText(this.ai.language()).favoriteAiInvalidResponse
					: aiErrorText(this.ai.language(), code);
		} finally {
			if (this.generation === request) this.generation = null;
			if (!this.disposed) this.publish();
		}
	}

	cancelGeneration(): void {
		this.generation?.controller.abort();
		this.generation = null;
		if (this.state.status === "generating") {
			this.state.status = "idle";
			this.state.message = "";
		}
	}

	async save(): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		this.lookupRevision += 1;
		const word = normalizeDictionaryQuery(this.state.word);
		if (!word) {
			this.state.message = dictionaryText().favoriteWordRequired;
			this.state.status = "error";
			this.publish();
			return;
		}
		const path = this.state.path;
		if (!path) {
			this.state.message = dictionaryText().favoriteSaveFailed;
			this.state.status = "error";
			this.publish();
			return;
		}

		const entry = { meaning: this.state.meaning, note: this.state.note, path, word };
		const revision = this.sessionRevision;
		this.state.message = dictionaryText().favoriteSaving;
		this.state.status = "saving";
		this.publish();
		try {
			const savedPath = await this.categoriesManager.runExclusive(() =>
				this.store.save(entry),
			);
			if (this.disposed || revision !== this.sessionRevision) return;
			this.contentDirty = false;
			this.state.word = word;
			this.state.message = dictionaryText().favoriteSaved(savedPath);
			this.state.status = "success";
		} catch (error) {
			if (this.disposed || revision !== this.sessionRevision) return;
			const strings = dictionaryText(this.ai.language());
			const messages = {
				"migration-required": strings.favoriteMigrationRequired,
				"source-needs-repair": strings.favoriteSourceNeedsRepair,
				"source-changing": strings.favoriteSourceChanging,
				"invalid-card-content": strings.favoriteInvalidCardContent,
			};
			this.state.message =
				error instanceof FavoriteSaveError
					? messages[error.reason]
					: error instanceof FavoriteCategoryError && error.reason === "busy"
						? strings.favoriteCategoryBusy
						: strings.favoriteSaveFailed;
			this.state.status = "error";
		}
		this.publish();
	}

	clear(): void {
		if (this.disposed || this.state.status === "saving") return;
		this.cancelGeneration();
		this.contentDirty = false;
		this.lookupRevision += 1;
		this.state.meaning = "";
		this.state.message = "";
		this.state.note = "";
		this.state.status = "idle";
		this.state.word = "";
		this.publish();
	}

	refreshSettings(): void {
		if (this.disposed) return;
		if (this.generation && this.generation.engineKey !== this.ai.engineKey()) {
			this.cancelGeneration();
		}
		this.onCategoriesChanged();
	}

	resetSession(): void {
		if (this.disposed) return;
		this.sessionRevision += 1;
		this.cancelGeneration();
		this.contentDirty = false;
		this.lookupRevision += 1;
		this.state.meaning = "";
		this.state.message = "";
		this.state.note = "";
		this.state.status = "idle";
		this.state.word = "";
		this.state.categories = [...this.categoriesManager.categories];
		this.state.selectedCategoryId = this.categoriesManager.selectedCategoryId;
		this.state.path = this.categoriesManager.path;
		this.publish();
	}

	async openSavedFile(targetPath?: string): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		const revision = this.lookupRevision;
		const path = targetPath?.trim() || this.state.path.trim();
		try {
			const opened = await this.store.open(path);
			if (this.disposed || this.isBusy() || revision !== this.lookupRevision || opened)
				return;
			this.state.message = dictionaryText(this.ai.language()).favoriteFileMissing;
			this.state.status = "error";
		} catch {
			if (this.disposed || this.isBusy() || revision !== this.lookupRevision) return;
			this.state.message = dictionaryText(this.ai.language()).favoriteOpenFailed;
			this.state.status = "error";
		}
		this.publish();
	}

	dispose(): void {
		if (this.disposed) return;
		this.sessionRevision += 1;
		this.cancelGeneration();
		this.disposed = true;
		this.lookupRevision += 1;
		this.unsubscribeCategories();
		this.listeners.clear();
	}

	private isBusy(): boolean {
		return (
			this.generation !== null ||
			this.state.status === "generating" ||
			this.state.status === "saving"
		);
	}

	private resetMessage(): void {
		if (this.state.status === "saving") return;
		this.state.message = "";
		this.state.status = "idle";
	}

	private onCategoriesChanged(): void {
		if (this.disposed) return;
		const previousPath = this.state.path;
		this.state.categories = [...this.categoriesManager.categories];
		this.state.selectedCategoryId = this.categoriesManager.selectedCategoryId;
		this.state.path = this.categoriesManager.path;
		if (previousPath !== this.state.path) {
			this.cancelGeneration();
			this.lookupRevision += 1;
		}
		this.publish();
		if (previousPath !== this.state.path && !this.contentDirty && !this.isBusy()) {
			void this.loadExisting(true);
		}
	}

	private async loadExisting(clearOnMissing: boolean): Promise<void> {
		if (this.contentDirty || this.isBusy()) return;
		const revision = ++this.lookupRevision;
		const word = normalizeDictionaryQuery(this.state.word);
		const path = this.state.path;
		if (!word || !path) return;
		try {
			const existing = await this.store.find(path, word);
			if (revision !== this.lookupRevision || this.disposed) return;
			if (existing) {
				this.state.meaning = existing.meaning;
				this.state.note = existing.note;
				this.state.message = dictionaryText().favoriteExistingLoaded(existing.path);
				this.state.status = "success";
			} else {
				if (clearOnMissing) {
					this.state.meaning = "";
					this.state.note = "";
				}
				this.state.message = "";
				this.state.status = "idle";
			}
		} catch {
			if (revision !== this.lookupRevision || this.disposed) return;
			if (clearOnMissing) {
				this.state.meaning = "";
				this.state.note = "";
			}
			this.state.message = "";
			this.state.status = "idle";
		}
		this.publish();
	}

	private buildSnapshot(): DictionaryFavoriteViewState {
		const categories = this.state.categories.map((category) => ({ ...category }));
		const snapshot: DictionaryFavoriteViewState = {
			categories,
			selectedCategoryId: this.state.selectedCategoryId,
			meaning: this.state.meaning,
			message: this.state.message,
			note: this.state.note,
			path: this.state.path,
			status: this.state.status,
			word: this.state.word,
		};
		Object.freeze(categories);
		return Object.freeze(snapshot);
	}

	private publish(): void {
		this.snapshot = this.buildSnapshot();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Presentation listeners must never invalidate session state.
			}
		}
	}
}
