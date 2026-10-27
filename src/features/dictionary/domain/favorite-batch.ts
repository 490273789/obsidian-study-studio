import { aiFailureCode } from "../../../core/ai";
import { aiErrorText } from "../../../core/i18n/ai";
import type { Language } from "../../../core/shared/types";
import { DICTIONARY_QUERY_MAX_LENGTH, normalizeDictionaryQuery } from "./configuration";
import { isFavoriteAiWord, type FavoriteDraftGenerator } from "./favorite-ai";
import { FavoriteCategoryError, type FavoriteCategoryManager } from "./favorite-categories";
import { FavoriteSaveError, favoriteWordKey, type DictionaryFavoriteEntry } from "./favorite-file";
import { dictionaryText } from "./messages";
import type { DictionarySettingsStore } from "./types";

export type FavoriteBatchErrorReason =
	| "source-missing"
	| "source-invalid"
	| "source-read-failed"
	| "target-missing"
	| "same-file"
	| "no-words";

export class FavoriteBatchError extends Error {
	constructor(readonly reason: FavoriteBatchErrorReason) {
		super(reason);
		this.name = "FavoriteBatchError";
	}
}

export interface FavoriteBatchSource {
	read(path: string): Promise<string>;
	pathSuggestions(query: string): string[];
}

export interface FavoriteBatchStore {
	/** Checks that the existing destination is editable and returns its favorite words. */
	inspect(path: string): Promise<readonly string[]>;
	/** Fresh-content write. Never replaces an entry that appeared after inspection. */
	saveNew(entry: DictionaryFavoriteEntry): Promise<"saved" | "skipped">;
	open(path: string): Promise<boolean>;
}

export interface FavoriteBatchLine {
	readonly line: number;
	readonly word: string;
	readonly key: string;
	readonly kind: "word" | "duplicate" | "invalid";
}

/** Empty lines are ignored; every other physical line keeps its source line number. */
export function parseFavoriteBatchLines(content: string): FavoriteBatchLine[] {
	const lines: FavoriteBatchLine[] = [];
	const seen = new Set<string>();
	for (const [index, rawLine] of content
		.replace(/^\uFEFF/u, "")
		.split(/\r\n|\r|\n/u)
		.entries()) {
		const normalized = rawLine.trim().replace(/\s+/gu, " ");
		if (!normalized) continue;
		const word = normalizeDictionaryQuery(normalized);
		const key = favoriteWordKey(word);
		const valid = normalized.length <= DICTIONARY_QUERY_MAX_LENGTH && isFavoriteAiWord(word);
		const kind = !valid ? "invalid" : seen.has(key) ? "duplicate" : "word";
		if (kind === "word") seen.add(key);
		lines.push({ line: index + 1, word: valid ? word : normalized, key, kind });
	}
	return lines;
}

export type FavoriteBatchStatus = "idle" | "running" | "success" | "partial" | "failed" | "stopped";

export interface FavoriteBatchFailure {
	readonly line: number;
	readonly word: string;
	readonly reason: string;
}

export interface FavoriteBatchSnapshot {
	readonly status: FavoriteBatchStatus;
	readonly targetPath: string;
	readonly total: number;
	readonly processed: number;
	readonly saved: number;
	readonly skipped: number;
	readonly failed: number;
	readonly currentWord: string;
	readonly message: string;
	readonly failures: readonly FavoriteBatchFailure[];
}

interface FavoriteBatchOptions {
	readonly categories: FavoriteCategoryManager;
	readonly settings: DictionarySettingsStore;
	readonly source: FavoriteBatchSource;
	readonly store: FavoriteBatchStore;
	readonly generator: FavoriteDraftGenerator;
	readonly hasAiConfig: (id: string) => boolean;
	readonly language: () => Language;
}

/** One modal's sequential batch; the category lease spans generation and writes. */
export class FavoriteBatchController {
	private snapshot: FavoriteBatchSnapshot = {
		status: "idle",
		targetPath: "",
		total: 0,
		processed: 0,
		saved: 0,
		skipped: 0,
		failed: 0,
		currentWord: "",
		message: "",
		failures: [],
	};
	private readonly listeners = new Set<() => void>();
	private job: { abort: AbortController; stopRequested: boolean } | null = null;
	private disposed = false;

	constructor(private readonly options: FavoriteBatchOptions) {}

	getSnapshot(): FavoriteBatchSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	get categories() {
		return this.options.categories.categories;
	}

	get selectedCategoryId(): string {
		return this.options.settings.getDictionarySettings().selectedFavoriteCategoryId;
	}

	pathSuggestions(query: string): string[] {
		return this.options.source.pathSuggestions(query);
	}

	async start(sourcePath: string, categoryId: string): Promise<void> {
		if (this.disposed || this.job) return;
		const t = dictionaryText(this.options.language());
		const category = this.categories.find((item) => item.id === categoryId);
		const path = sourcePath.trim().replaceAll("\\", "/");
		const targetPath = category?.path ?? "";
		const configId = this.options.settings.getDictionarySettings().favoriteAiConfigId;
		const job = { abort: new AbortController(), stopRequested: false };
		this.job = job;
		this.setSnapshot({
			status: "running",
			targetPath,
			total: 0,
			processed: 0,
			saved: 0,
			skipped: 0,
			failed: 0,
			currentWord: "",
			message: "",
			failures: [],
		});
		try {
			if (!category) throw new FavoriteBatchError("target-missing");
			if (!path) throw new FavoriteBatchError("source-missing");
			if (path.toLocaleLowerCase() === targetPath.toLocaleLowerCase())
				throw new FavoriteBatchError("same-file");
			if (!configId || !this.options.hasAiConfig(configId)) {
				this.patch({ message: t.favoriteAiConfigRequired });
				return;
			}
			await this.options.categories.saveFavorite(async () => {
				const content = await this.options.source.read(path);
				if (job.stopRequested) return;
				const lines = parseFavoriteBatchLines(content);
				if (lines.length === 0) throw new FavoriteBatchError("no-words");
				this.patch({ total: lines.length });
				const existing = new Set(
					(await this.options.store.inspect(targetPath)).map(favoriteWordKey),
				);
				for (const line of lines) {
					if (job.stopRequested) break;
					this.patch({ currentWord: line.word });
					if (line.kind === "invalid") {
						this.recordFailure(line, t.favoriteBatchInvalidWord);
						continue;
					}
					if (line.kind === "duplicate" || existing.has(line.key)) {
						this.patch({
							processed: this.snapshot.processed + 1,
							skipped: this.snapshot.skipped + 1,
						});
						continue;
					}
					if (!this.options.hasAiConfig(configId)) {
						this.patch({ message: t.favoriteAiConfigRequired });
						break;
					}
					let draft: Awaited<ReturnType<FavoriteDraftGenerator["generate"]>>;
					try {
						draft = await this.options.generator.generate(
							line.word,
							configId,
							job.abort.signal,
						);
					} catch (error) {
						if (job.stopRequested) break;
						const code = aiFailureCode(error);
						this.recordFailure(
							line,
							code === "invalid-response" || code === "incomplete-response"
								? t.favoriteAiInvalidResponse
								: aiErrorText(this.options.language(), code),
						);
						continue;
					}
					if (job.stopRequested) break;
					try {
						const outcome = await this.options.store.saveNew({
							path: targetPath,
							word: line.word,
							meaning: draft.meaning,
							note: draft.note,
						});
						existing.add(line.key);
						this.patch({
							processed: this.snapshot.processed + 1,
							[outcome === "saved" ? "saved" : "skipped"]:
								this.snapshot[outcome === "saved" ? "saved" : "skipped"] + 1,
						});
					} catch (error) {
						this.recordFailure(line, this.errorText(error));
						if (
							error instanceof FavoriteSaveError &&
							error.reason === "invalid-card-content"
						)
							continue;
						this.patch({ message: t.favoriteBatchTargetStopped });
						break;
					}
				}
			});
		} catch (error) {
			if (!job.stopRequested) this.patch({ message: this.errorText(error) });
		} finally {
			if (this.job === job) this.job = null;
			if (!this.disposed) {
				const status: FavoriteBatchStatus = job.stopRequested
					? "stopped"
					: this.snapshot.message || this.snapshot.failed
						? this.snapshot.saved + this.snapshot.skipped > 0
							? "partial"
							: "failed"
						: "success";
				this.patch({ status, currentWord: "" });
			}
		}
	}

	stop(): void {
		if (!this.job) return;
		this.job.stopRequested = true;
		this.job.abort.abort();
		this.patch({ message: dictionaryText(this.options.language()).favoriteBatchStopping });
	}

	async openTarget(): Promise<boolean> {
		if (this.job || !this.snapshot.targetPath) return false;
		return this.options.store.open(this.snapshot.targetPath);
	}

	dispose(): void {
		if (this.disposed) return;
		this.stop();
		this.disposed = true;
		this.listeners.clear();
	}

	private recordFailure(line: FavoriteBatchLine, reason: string): void {
		this.patch({
			processed: this.snapshot.processed + 1,
			failed: this.snapshot.failed + 1,
			failures: [...this.snapshot.failures, { line: line.line, word: line.word, reason }],
		});
	}

	private errorText(error: unknown): string {
		const t = dictionaryText(this.options.language());
		if (error instanceof FavoriteBatchError) {
			switch (error.reason) {
				case "source-missing":
				case "source-invalid":
					return t.favoriteBatchSourceInvalid;
				case "source-read-failed":
					return t.favoriteBatchSourceReadFailed;
				case "target-missing":
					return t.favoriteBatchTargetMissing;
				case "same-file":
					return t.favoriteBatchSameFile;
				case "no-words":
					return t.favoriteBatchNoWords;
			}
		}
		if (error instanceof FavoriteSaveError) {
			switch (error.reason) {
				case "migration-required":
					return t.favoriteMigrationRequired;
				case "source-needs-repair":
					return t.favoriteSourceNeedsRepair;
				case "source-changing":
					return t.favoriteSourceChanging;
				case "invalid-card-content":
					return t.favoriteInvalidCardContent;
			}
		}
		if (error instanceof FavoriteCategoryError && error.reason === "busy")
			return t.favoriteCategoryBusy;
		return t.favoriteBatchTargetFailed;
	}

	private patch(changes: Partial<FavoriteBatchSnapshot>): void {
		if (this.disposed) return;
		this.setSnapshot({ ...this.snapshot, ...changes });
	}

	private setSnapshot(snapshot: FavoriteBatchSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}
}
