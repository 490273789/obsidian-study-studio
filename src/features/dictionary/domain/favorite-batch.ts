import { aiFailureCode } from "../../../core/ai";
import { DICTIONARY_QUERY_MAX_LENGTH, normalizeDictionaryQuery } from "./configuration";
import { isFavoriteAiWord, type FavoriteDraftGenerator } from "./favorite-ai";
import { FavoriteCategoryError, type FavoriteCategoryManager } from "./favorite-categories";
import {
	FavoriteBatchError,
	FavoriteSaveError,
	favoriteWordKey,
	type DictionaryFavoriteStore,
	type FavoriteBatchErrorReason,
} from "./favorite-file";
import type { DictionarySettingsStore, FavoriteCategory } from "./types";

export { FavoriteBatchError, type FavoriteBatchErrorReason };

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

export type FavoriteBatchStatus =
	| "idle"
	| "running"
	| "stopping"
	| "success"
	| "partial"
	| "failed"
	| "stopped";

export type FavoriteBatchReason =
	| FavoriteBatchErrorReason
	| FavoriteSaveError["reason"]
	| "busy"
	| "target-failed"
	| "target-stopped"
	| "ai-config-required"
	| "invalid-word"
	| { readonly kind: "ai"; readonly code: ReturnType<typeof aiFailureCode> };

function batchFailureReason(error: unknown): FavoriteBatchReason {
	if (error instanceof FavoriteBatchError || error instanceof FavoriteSaveError)
		return error.reason;
	if (error instanceof FavoriteCategoryError && error.reason === "busy") return "busy";
	return "target-failed";
}

export interface FavoriteBatchFailure {
	readonly line: number;
	readonly word: string;
	readonly reason: FavoriteBatchReason;
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
	readonly reason: FavoriteBatchReason | null;
	readonly failures: readonly FavoriteBatchFailure[];
}

export interface FavoriteBatchOptions {
	readonly categories: FavoriteCategoryManager;
	readonly settings: DictionarySettingsStore;
	readonly store: Pick<
		DictionaryFavoriteStore,
		"inspect" | "saveNew" | "open" | "wordListSuggestions" | "readWordList"
	>;
	readonly generator: FavoriteDraftGenerator;
	readonly hasAiConfig: (id: string) => boolean;
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
		reason: null,
		failures: [],
	};
	private readonly listeners = new Set<() => void>();
	private job: AbortController | null = null;
	private disposed = false;

	constructor(private readonly options: FavoriteBatchOptions) {}

	getSnapshot(): FavoriteBatchSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	get categories(): readonly FavoriteCategory[] {
		return this.options.categories.categories;
	}

	get selectedCategoryId(): string {
		return this.options.settings.getDictionarySettings().selectedFavoriteCategoryId;
	}

	pathSuggestions(query: string): string[] {
		return this.options.store.wordListSuggestions(query);
	}

	async start(sourcePath: string, categoryId: string): Promise<void> {
		if (this.disposed || this.job) return;
		const category = this.categories.find((item) => item.id === categoryId);
		const path = sourcePath.trim().replaceAll("\\", "/");
		const targetPath = category?.path ?? "";
		const configId = this.options.settings.getDictionarySettings().favoriteAiConfigId;
		const job = new AbortController();
		let hasFulfilledWord = false;
		let reason: FavoriteBatchReason | null = null;
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
			reason: null,
			failures: [],
		});
		try {
			if (job.signal.aborted) return;
			if (!category) throw new FavoriteBatchError("target-missing");
			if (!path) throw new FavoriteBatchError("source-missing");
			if (path.toLocaleLowerCase() === targetPath.toLocaleLowerCase())
				throw new FavoriteBatchError("same-file");
			if (!configId || !this.options.hasAiConfig(configId)) {
				reason = "ai-config-required";
				return;
			}
			await this.options.categories.runExclusive(async () => {
				const content = await this.options.store.readWordList(path);
				if (job.signal.aborted) return;
				const lines = parseFavoriteBatchLines(content);
				if (lines.length === 0) throw new FavoriteBatchError("no-words");
				this.patch({ total: lines.length });
				if (job.signal.aborted) return;
				const existing = new Set(
					(await this.options.store.inspect(targetPath)).map(favoriteWordKey),
				);
				for (const line of lines) {
					if (job.signal.aborted) break;
					this.patch({ currentWord: line.word });
					if (job.signal.aborted) break;
					if (line.kind === "invalid") {
						this.recordFailure(line, "invalid-word");
						continue;
					}
					if (line.kind === "duplicate" || existing.has(line.key)) {
						if (line.kind !== "duplicate") hasFulfilledWord = true;
						this.patch({
							processed: this.snapshot.processed + 1,
							skipped: this.snapshot.skipped + 1,
						});
						continue;
					}
					if (!this.options.hasAiConfig(configId)) {
						reason = "ai-config-required";
						break;
					}
					let draft: Awaited<ReturnType<FavoriteDraftGenerator["generate"]>>;
					try {
						draft = await this.options.generator.generate(
							line.word,
							configId,
							job.signal,
						);
					} catch (error) {
						if (job.signal.aborted) break;
						this.recordFailure(line, { kind: "ai", code: aiFailureCode(error) });
						continue;
					}
					if (job.signal.aborted) break;
					try {
						const outcome = await this.options.store.saveNew({
							path: targetPath,
							word: line.word,
							meaning: draft.meaning,
							note: draft.note,
						});
						hasFulfilledWord = true;
						this.patch({
							processed: this.snapshot.processed + 1,
							[outcome]: this.snapshot[outcome] + 1,
						});
					} catch (error) {
						this.recordFailure(line, batchFailureReason(error));
						if (
							error instanceof FavoriteSaveError &&
							error.reason === "invalid-card-content"
						)
							continue;
						reason = "target-stopped";
						break;
					}
				}
			});
		} catch (error) {
			reason = batchFailureReason(error);
		} finally {
			if (this.job === job) this.job = null;
			if (!this.disposed) {
				let status: FavoriteBatchStatus = "success";
				if (job.signal.aborted) status = "stopped";
				else if (reason || this.snapshot.failed > 0)
					status = hasFulfilledWord ? "partial" : "failed";
				this.patch({ status, reason: job.signal.aborted ? null : reason, currentWord: "" });
			}
		}
	}

	stop(): void {
		if (!this.job || this.job.signal.aborted) return;
		this.job.abort();
		this.patch({ status: "stopping" });
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

	private recordFailure(line: FavoriteBatchLine, reason: FavoriteBatchReason): void {
		this.patch({
			processed: this.snapshot.processed + 1,
			failed: this.snapshot.failed + 1,
			failures: [...this.snapshot.failures, { line: line.line, word: line.word, reason }],
		});
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
