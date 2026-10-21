import type {
	SelectionDictionaryAdapter,
	SelectionLookupHandle,
	SelectionLookupIntent,
	SelectionLookupSnapshot,
} from "../../core/selectionHelper/domain/types";
import type { DictionaryResult, DictionarySettings, DictionaryViewState } from "./domain/types";
import type { DictionaryQuerySession } from "./domain/querySession";

/** The opaque success body handed to the 选区助手; only the 词典 feature renders it. */
export interface DictionarySelectionResultHandle {
	readonly result: DictionaryResult;
	readonly activeSectionIndex: number | null;
	readonly word: string;
}

export interface DictionarySelectionRuntime {
	readonly settings: { getDictionarySettings(): Readonly<DictionarySettings> };
	createSelectionLookupSession(
		query: string,
		sourceIds: readonly string[],
	): DictionaryQuerySession | null;
}

export interface DictionarySelectionAdapterOptions {
	runtime(): DictionarySelectionRuntime | null;
	openInMainTab(query: string): Promise<void>;
	openFavorite?(word: string): Promise<void>;
}

/** Adapts the 词典 feature to the narrow 选区助手 seam. */
export function createDictionarySelectionAdapter(
	options: DictionarySelectionAdapterOptions,
): SelectionDictionaryAdapter {
	return {
		sources: () => {
			const settings = options.runtime()?.settings.getDictionarySettings();
			return (settings?.sources ?? [])
				.filter((source) => source.enabled)
				.map((source) => ({
					id: source.id,
					label: source.label,
					kind: source.kind === "ai" ? ("ai" as const) : ("dictionary" as const),
				}));
		},

		startLookup: (query, sourceIds) => {
			const session = options.runtime()?.createSelectionLookupSession(query, sourceIds);
			return session ? new DictionarySelectionLookupHandle(session) : null;
		},

		openInMainTab: (query) => options.openInMainTab(query),
		openFavorite: options.openFavorite ? (word) => options.openFavorite!(word) : undefined,
	};
}

class DictionarySelectionLookupHandle implements SelectionLookupHandle {
	constructor(private readonly session: DictionaryQuerySession) {}

	getSnapshot(): SelectionLookupSnapshot {
		return toSelectionSnapshot(this.session.getSnapshot());
	}

	subscribe(listener: () => void): () => void {
		return this.session.subscribe(listener);
	}

	send(intent: SelectionLookupIntent): Promise<void> {
		switch (intent.type) {
			case "lookup":
				return this.session.send({ type: "lookup", query: intent.query });
			case "select-source":
				return this.session.send({ type: "select-source", sourceId: intent.sourceId });
			case "select-section":
				return this.session.send({
					type: "select-section",
					sourceId: intent.sourceId,
					sectionIndex: intent.sectionIndex,
				});
			case "retry-source":
				return this.session.send({ type: "retry-source", sourceId: intent.sourceId });
			case "generate-ai":
				return this.session.send({ type: "generate-ai" });
		}
	}

	dispose(): void {
		this.session.dispose();
	}
}

function toSelectionSnapshot(state: DictionaryViewState): SelectionLookupSnapshot {
	return {
		query: state.query,
		activeSourceId: state.activeSourceId,
		aiEngineName: state.aiEngineName,
		status: state.status,
		sources: state.sources.map((source) => ({
			id: source.id,
			label: source.label,
			kind: source.kind === "ai" ? ("ai" as const) : ("dictionary" as const),
			status: source.status,
			error: source.error,
			pronunciations: (source.result?.pronunciations ?? []).map(({ label, phonetic }) => ({
				label,
				phonetic,
			})),
			result: source.result
				? ({
						result: source.result,
						activeSectionIndex: source.activeSectionIndex,
						word: source.result.word || state.query,
					} satisfies DictionarySelectionResultHandle)
				: null,
		})),
	};
}
