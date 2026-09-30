import {
	DICTIONARY_QUERY_MAX_LENGTH,
	normalizeDictionaryFavoritePath,
	normalizeDictionaryQuery,
} from "./configuration";
import {
	DICTIONARY_FAVORITE_MEANING_MAX_LENGTH,
	DICTIONARY_FAVORITE_NOTE_MAX_LENGTH,
	DICTIONARY_FAVORITE_PATH_MAX_LENGTH,
} from "./favorite-limits";
import type { DictionaryFavoriteFile } from "./favorite-file";
import { isFavoriteAiWord, type FavoriteDraftGenerator } from "./favorite-ai";
import { aiFailureCode } from "../../../core/ai";
import { aiErrorText } from "../../../core/i18n/ai";
import type { Language } from "../../../core/shared/types";
import { dictionaryText } from "./messages";
import type { DictionaryFavoriteViewState, DictionarySettingsStore } from "./types";

interface FavoriteAiOptions {
	readonly generator: FavoriteDraftGenerator;
	/** Null when selection is missing; changes when the selected connection changes. */
	readonly engineKey: () => string | null;
	readonly language: () => Language;
}

/**
 * Shared favorite-form session consumed by the favorite sidebar. The vault file
 * is injected; settings persistence happens before any file write.
 */
export class DictionaryFavoriteController {
	private lookupRevision = 0;
	private sessionRevision = 0;
	private pathDirty = false;
	private contentDirty = false;
	private generation: { controller: AbortController; engineKey: string } | null = null;
	private state: DictionaryFavoriteViewState;
	private snapshot: DictionaryFavoriteViewState;
	private readonly listeners = new Set<() => void>();
	private disposed = false;

	constructor(
		private readonly settings: DictionarySettingsStore,
		private readonly file: DictionaryFavoriteFile,
		private readonly notify: (message: string) => void,
		private readonly ai: FavoriteAiOptions,
	) {
		const path = settings.getDictionarySettings().favoritePath;
		this.state = {
			meaning: "",
			message: "",
			note: "",
			path,
			pathSuggestions: file.suggestions(path),
			savedPath: path,
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

	setPath(value: string): void {
		if (this.disposed || this.state.status === "saving") return;
		this.cancelGeneration();
		this.pathDirty = true;
		this.state.path = value.slice(0, DICTIONARY_FAVORITE_PATH_MAX_LENGTH);
		this.resetMessage();
		this.publish();
		void this.loadExisting(false);
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
		const path = normalizeDictionaryFavoritePath(this.state.path, "");
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
		const previousPath = this.settings.getDictionarySettings().favoritePath;
		try {
			if (path !== previousPath && !(await this.persistFavoritePath(path))) {
				this.notify(dictionaryText().saveFailed);
				throw new Error("favorite-path-persist-failed");
			}
			const savedPath = await this.file.save(entry);
			if (this.disposed || revision !== this.sessionRevision) return;
			this.contentDirty = false;
			this.pathDirty = false;
			this.applySettings();
			this.state.word = word;
			this.state.message = dictionaryText().favoriteSaved(savedPath);
			this.state.status = "success";
		} catch {
			if (this.disposed || revision !== this.sessionRevision) return;
			this.state.message = dictionaryText().favoriteSaveFailed;
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
		this.pathDirty = false;
		this.state.meaning = "";
		this.state.message = "";
		this.state.note = "";
		this.state.path = this.state.savedPath;
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
			void this.loadExisting(false);
	}

	resetSession(): void {
		if (this.disposed) return;
		this.sessionRevision += 1;
		this.cancelGeneration();
		this.contentDirty = false;
		this.lookupRevision += 1;
		this.pathDirty = false;
		this.state.meaning = "";
		this.state.message = "";
		this.state.note = "";
		this.state.status = "idle";
		this.state.word = "";
		this.applySettings();
		this.publish();
	}

	async openSavedFile(): Promise<void> {
		if (this.disposed || this.isBusy()) return;
		const revision = this.lookupRevision;
		try {
			const opened = await this.file.open(this.state.savedPath);
			if (this.disposed || this.isBusy() || revision !== this.lookupRevision || opened)
				return;
			this.state.message = dictionaryText().favoriteFileMissing;
			this.state.status = "error";
		} catch {
			if (this.disposed || this.isBusy() || revision !== this.lookupRevision) return;
			this.state.message = dictionaryText().favoriteOpenFailed;
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

	private async persistFavoritePath(path: string): Promise<boolean> {
		try {
			return await this.settings.updateDictionarySettings((draft) => {
				draft.favoritePath = path;
			});
		} catch {
			return false;
		}
	}

	private resetMessage(): void {
		if (this.state.status === "saving") return;
		this.state.message = "";
		this.state.status = "idle";
	}

	private applySettings(): void {
		const path = this.settings.getDictionarySettings().favoritePath;
		this.state.savedPath = path;
		if (!this.pathDirty) this.state.path = path;
		this.state.pathSuggestions = this.file.suggestions(path);
	}

	private async loadExisting(clearOnMissing: boolean): Promise<void> {
		if (this.contentDirty || this.isBusy()) return;
		const revision = ++this.lookupRevision;
		const word = normalizeDictionaryQuery(this.state.word);
		const path = normalizeDictionaryFavoritePath(this.state.path, "");
		if (!word || !path) return;
		try {
			const existing = await this.file.find(path, word);
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
		const pathSuggestions = [...this.state.pathSuggestions];
		const snapshot: DictionaryFavoriteViewState = {
			meaning: this.state.meaning,
			message: this.state.message,
			note: this.state.note,
			path: this.state.path,
			pathSuggestions,
			savedPath: this.state.savedPath,
			status: this.state.status,
			word: this.state.word,
		};
		Object.freeze(pathSuggestions);
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
