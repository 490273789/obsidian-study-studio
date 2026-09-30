import {
	DICTIONARY_HISTORY_LIMIT,
	DICTIONARY_QUERY_MAX_LENGTH,
	normalizeDictionaryQuery,
} from "./configuration";
import { dictionaryText } from "./messages";
import {
	DictionaryError,
	type DictionaryResult,
	type DictionarySettingsStore,
	type DictionarySource,
	type DictionarySourceSettings,
	type DictionarySourceState,
	type DictionaryViewState,
} from "./types";

export type DictionarySourceResolver = (
	settings: Readonly<DictionarySourceSettings>,
) => DictionarySource;

export type DictionaryQueryIntent =
	| { readonly type: "change-input"; readonly value: string }
	| { readonly type: "lookup"; readonly query?: string }
	| { readonly type: "retry-source"; readonly sourceId: string }
	| { readonly type: "generate-ai" }
	| { readonly type: "select-source"; readonly sourceId: string }
	| {
			readonly type: "select-section";
			readonly sourceId: string;
			readonly sectionIndex: number;
	  }
	| { readonly type: "clear" }
	| { readonly type: "settings-changed" };

/** The stable seam for one independent 词典查询会话. */
export interface DictionaryQuerySession {
	getSnapshot(): DictionaryViewState;
	subscribe(listener: () => void): () => void;
	send(intent: DictionaryQueryIntent): Promise<void>;
	dispose(): void;
}

export interface DictionaryQuerySessionOptions {
	readonly settings: DictionarySettingsStore;
	readonly resolveSource: DictionarySourceResolver;
	readonly notify: (message: string) => void;
	readonly aiEngineInfo: () => {
		readonly configId: string | null;
		readonly name: string | null;
	};
}

/** Prepends `query` to the recent-search history, deduplicating case-insensitively. */
export function recordDictionarySearchHistory(history: readonly string[], query: string): string[] {
	const normalized = normalizeDictionaryQuery(query);
	if (!normalized) return [...history];
	const key = normalized.toLocaleLowerCase();
	return [
		normalized,
		...history.filter((candidate) => candidate.toLocaleLowerCase() !== key),
	].slice(0, DICTIONARY_HISTORY_LIMIT);
}

function createSourceState(settings: Readonly<DictionarySourceSettings>): DictionarySourceState {
	return {
		activeSectionIndex: null,
		error: "",
		id: settings.id,
		kind: settings.kind,
		label: settings.label,
		result: null,
		status: "idle",
	};
}

function freezeDictionaryResult(result: DictionaryResult): DictionaryResult {
	for (const pronunciation of result.pronunciations) Object.freeze(pronunciation);
	Object.freeze(result.pronunciations);
	for (const section of result.sections) {
		if (section.content.kind === "ai-definitions") {
			for (const definition of section.content.definitions) {
				Object.freeze(definition.synonyms);
				Object.freeze(definition.antonyms);
				for (const example of definition.examples) Object.freeze(example);
				Object.freeze(definition.examples);
				Object.freeze(definition);
			}
			Object.freeze(section.content.definitions);
		} else if (section.content.kind === "list") {
			Object.freeze(section.content.items);
		}
		Object.freeze(section.content);
		Object.freeze(section);
	}
	Object.freeze(result.sections);
	Object.freeze(result.suggestions);
	return Object.freeze(result);
}

/**
 * Creates a query-session module whose interface is also its test surface.
 */
export function createDictionaryQuerySession(
	options: DictionaryQuerySessionOptions,
): DictionaryQuerySession {
	return new DictionaryQuerySessionModule(options);
}

class DictionaryQuerySessionModule implements DictionaryQuerySession {
	private requestGeneration = 0;
	private state: DictionaryViewState;
	private snapshot: DictionaryViewState;
	private readonly listeners = new Set<() => void>();
	private disposed = false;

	constructor(private readonly options: DictionaryQuerySessionOptions) {
		const dictionary = options.settings.getDictionarySettings();
		this.state = {
			activeSourceId: null,
			aiEngineName: "",
			aiReady: false,
			history: [...dictionary.history],
			input: "",
			query: "",
			sources: [],
			status: "idle",
		};
		this.applyAiEngineInfo();
		this.snapshot = this.buildSnapshot();
	}

	async send(intent: DictionaryQueryIntent): Promise<void> {
		switch (intent.type) {
			case "change-input":
				this.setInput(intent.value);
				return;
			case "lookup":
				if (intent.query !== undefined) this.setInput(intent.query);
				return this.lookup();
			case "retry-source":
				return this.retry(intent.sourceId);
			case "generate-ai":
				return this.loadAi();
			case "select-source":
				this.selectSource(intent.sourceId);
				return;
			case "select-section":
				this.selectSection(intent.sourceId, intent.sectionIndex);
				return;
			case "clear":
				this.reset();
				return;
			case "settings-changed":
				this.refreshSettings();
		}
	}

	getSnapshot(): DictionaryViewState {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private setInput(value: string): void {
		if (this.disposed) return;
		this.state.input = value.slice(0, DICTIONARY_QUERY_MAX_LENGTH);
		this.publish();
	}

	private async lookup(): Promise<void> {
		if (this.disposed) return;
		const query = normalizeDictionaryQuery(this.state.input);
		if (!query) return;
		const generation = ++this.requestGeneration;
		this.state.input = query;
		this.state.query = query;
		this.state.status = "loading";
		// Retire old documents before history persistence yields to another query or render.
		for (const source of this.state.sources) {
			source.result = null;
			source.activeSectionIndex = null;
			source.error = "";
			source.status = "idle";
		}
		this.publish();

		let saved = false;
		try {
			saved = await this.options.settings.updateDictionarySettings((draft) => {
				draft.history = recordDictionarySearchHistory(draft.history, query);
			});
		} catch {
			saved = false;
		}
		if (generation !== this.requestGeneration || this.disposed) return;
		if (saved) this.refreshSettings();
		else this.options.notify(dictionaryText().saveFailed);

		const configuredSources = this.options.settings
			.getDictionarySettings()
			.sources.filter((source) => source.enabled);
		this.state.sources = configuredSources.map(createSourceState);
		this.state.activeSourceId = configuredSources.some(
			(source) => source.id === this.state.activeSourceId,
		)
			? this.state.activeSourceId
			: (configuredSources[0]?.id ?? null);

		const automatic = configuredSources.filter((source) => source.kind !== "ai");
		if (automatic.length === 0) {
			this.state.status = "ready";
			this.publish();
			return;
		}
		await Promise.all(automatic.map(async (source) => this.runSource(source.id, generation)));
		if (generation !== this.requestGeneration || this.disposed) return;
		const successful = this.state.sources.some((source) => source.status === "success");
		this.state.status = successful ? "ready" : "error";
		this.publish();
	}

	private async retry(sourceId: string): Promise<void> {
		if (this.disposed || !this.state.query) return;
		await this.runSource(sourceId, this.requestGeneration);
		if (this.disposed) return;
		const successful = this.state.sources.some((source) => source.status === "success");
		this.state.status = successful ? "ready" : "error";
		this.publish();
	}

	private async loadAi(): Promise<void> {
		if (this.disposed || !this.state.query) return;
		await this.runSource("ai", this.requestGeneration);
	}

	private selectSource(sourceId: string): void {
		if (this.disposed) return;
		if (!this.state.sources.some((source) => source.id === sourceId)) return;
		this.state.activeSourceId = sourceId;
		this.publish();
	}

	private selectSection(sourceId: string, sectionIndex: number): void {
		if (this.disposed) return;
		const source = this.state.sources.find((candidate) => candidate.id === sourceId);
		if (source?.result?.sections[sectionIndex]?.presentation !== "tab") return;
		source.activeSectionIndex = sectionIndex;
		this.publish();
	}

	private refreshSettings(): void {
		if (this.disposed) return;
		const dictionary = this.options.settings.getDictionarySettings();
		this.state.history = [...dictionary.history];
		this.applyAiEngineInfo();
		if (this.state.sources.length > 0) {
			const existing = new Map(this.state.sources.map((source) => [source.id, source]));
			this.state.sources = dictionary.sources
				.filter((source) => source.enabled)
				.map((source) => existing.get(source.id) ?? createSourceState(source));
			if (!this.state.sources.some((source) => source.id === this.state.activeSourceId)) {
				this.state.activeSourceId = this.state.sources[0]?.id ?? null;
			}
		}
		this.publish();
	}

	private reset(): void {
		this.requestGeneration += 1;
		this.state.activeSourceId = null;
		this.state.input = "";
		this.state.query = "";
		this.state.sources = [];
		this.state.status = "idle";
		this.publish();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.requestGeneration += 1;
		this.listeners.clear();
	}

	private async runSource(sourceId: string, generation: number): Promise<void> {
		const sourceSettings = this.options.settings
			.getDictionarySettings()
			.sources.find((candidate) => candidate.id === sourceId && candidate.enabled);
		const sourceState = this.state.sources.find((candidate) => candidate.id === sourceId);
		if (!sourceSettings || !sourceState || sourceState.status === "loading") return;
		sourceState.activeSectionIndex = null;
		sourceState.error = "";
		sourceState.result = null;
		sourceState.status = "loading";
		this.publish();
		try {
			const result = await this.options.resolveSource(sourceSettings).lookup({
				text: this.state.query,
			});
			if (generation !== this.requestGeneration || this.disposed) return;
			sourceState.result = result;
			const activeSection = result.sections.findIndex(
				(section) => section.presentation === "tab",
			);
			sourceState.activeSectionIndex = activeSection < 0 ? null : activeSection;
			sourceState.status = "success";
		} catch (error) {
			if (generation !== this.requestGeneration || this.disposed) return;
			sourceState.error =
				error instanceof DictionaryError ? error.message : dictionaryText().errors.request;
			sourceState.status =
				error instanceof DictionaryError && error.code === "not-found" ? "empty" : "error";
		}
		this.publish();
	}

	private applyAiEngineInfo(): void {
		const info = this.options.aiEngineInfo();
		this.state.aiEngineName = info.name ?? "";
		this.state.aiReady = info.configId !== null && info.name !== null;
	}

	private buildSnapshot(): DictionaryViewState {
		const history = [...this.state.history];
		const sources = this.state.sources.map((source): DictionarySourceState => {
			const result = source.result;
			return {
				activeSectionIndex: source.activeSectionIndex,
				error: source.error,
				id: source.id,
				kind: source.kind,
				label: source.label,
				result: result ? freezeDictionaryResult(result) : null,
				status: source.status,
			};
		});
		const snapshot: DictionaryViewState = {
			activeSourceId: this.state.activeSourceId,
			aiEngineName: this.state.aiEngineName,
			aiReady: this.state.aiReady,
			history,
			input: this.state.input,
			query: this.state.query,
			sources,
			status: this.state.status,
		};
		Object.freeze(history);
		Object.freeze(sources);
		for (const source of sources) Object.freeze(source);
		return Object.freeze(snapshot);
	}

	private publish(): void {
		this.snapshot = this.buildSnapshot();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Presentation listeners must never invalidate query-session state.
			}
		}
	}
}
