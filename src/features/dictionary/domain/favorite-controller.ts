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
import type { DictionaryFavoriteViewState, DictionarySettingsStore } from "./types";
import { FavoriteCategoryError, FavoriteCategoryManager } from "./favorite-categories";

interface FavoriteAiOptions {
	readonly generator: FavoriteDraftGenerator;
	/** Null when selection is missing; changes when the selected connection changes. */
	readonly engineKey: () => string | null;
	readonly language: () => Language;
}

/**
 * Shared favorite-form session consumed by the favorite sidebar. The favorite
 * store is injected; settings persistence happens before any file write.
 */
export class DictionaryFavoriteController {
	private lookupRevision = 0;
	private sessionRevision = 0;
	private contentDirty = false;
	readonly categories: FavoriteCategoryManager;
	private generation: { controller: AbortController; engineKey: string } | null = null;
	private state: DictionaryFavoriteViewState;
	private snapshot: DictionaryFavoriteViewState;
	private readonly listeners = new Set<() => void>();
	private disposed = false;

	constructor(
		private readonly settings: DictionarySettingsStore,
		private readonly store: DictionaryFavoriteStore,
		private readonly ai: FavoriteAiOptions,
		categories?: FavoriteCategoryManager,
	) {
		this.categories =
			categories ??
			new FavoriteCategoryManager(settings, store, () => this.refreshSettings());
		const dictionary = settings.getDictionarySettings();
		const path =
			dictionary.favoriteCategories.find(
				(item) => item.id === dictionary.selectedFavoriteCategoryId,
			)?.path ?? dictionary.favoriteCategories[0]!.path;
		this.state = {
			categories: [...dictionary.favoriteCategories],
			selectedCategoryId: dictionary.selectedFavoriteCategoryId,
			meaning: "",
			message: "",
			note: "",
			path,
			status: "idle",
			word: "",
		};
		this.snapshot = this.buildSnapshot();
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
		this.applySettings();
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

	async selectCategory(id: string): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		this.lookupRevision += 1;
		try {
			await this.categories.select(id);
		} catch {
			this.state.message = dictionaryText(this.ai.language()).favoriteCategorySaveFailed;
			this.state.status = "error";
			this.publish();
		}
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
		const configId = this.settings.getDictionarySettings().favoriteAiConfigId;
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

	private isBusy(): boolean {
		return (
			this.generation !== null ||
			this.state.status === "generating" ||
			this.state.status === "saving"
		);
	}

	private cancelGeneration(): void {
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
			const savedPath = await this.categories.saveFavorite(() => this.store.save(entry));
			if (this.disposed || revision !== this.sessionRevision) return;
			this.contentDirty = false;
			this.applySettings();
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
			this.applySettings();
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
		const previousPath = this.state.path;
		if (this.generation && this.generation.engineKey !== this.ai.engineKey()) {
			this.cancelGeneration();
		}
		this.applySettings();
		if (previousPath !== this.state.path) {
			this.cancelGeneration();
			this.lookupRevision += 1;
		}
		this.publish();
		if (previousPath !== this.state.path && !this.contentDirty && !this.isBusy())
			void this.loadExisting(true);
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
		this.applySettings();
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
		this.listeners.clear();
	}

	private resetMessage(): void {
		if (this.state.status === "saving") return;
		this.state.message = "";
		this.state.status = "idle";
	}

	private applySettings(): void {
		const dictionary = this.settings.getDictionarySettings();
		const category =
			dictionary.favoriteCategories.find(
				(item) => item.id === dictionary.selectedFavoriteCategoryId,
			) ?? dictionary.favoriteCategories[0]!;
		const path = category.path;
		this.state.categories = [...dictionary.favoriteCategories];
		this.state.selectedCategoryId = category.id;
		this.state.path = path;
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
				// Presentation listeners must never invalidate controller state.
			}
		}
	}
}
