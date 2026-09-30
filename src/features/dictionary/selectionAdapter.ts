import type {
	SelectionDictionaryAdapter,
	SelectionLookupSection,
	SelectionLookupSession,
	SelectionLookupSnapshot,
} from "../../core/selectionHelper/domain/types";
import type { DictionarySettings, DictionaryViewState } from "./domain/types";
import type { DictionaryQuerySession } from "./domain/querySession";

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
			return session ? new DictionarySelectionLookupSession(session) : null;
		},

		openInMainTab: (query) => options.openInMainTab(query),
	};
}

class DictionarySelectionLookupSession implements SelectionLookupSession {
	constructor(private readonly session: DictionaryQuerySession) {}

	getSnapshot(): SelectionLookupSnapshot {
		return toSelectionSnapshot(this.session.getSnapshot());
	}

	subscribe(listener: () => void): () => void {
		return this.session.subscribe(listener);
	}

	selectSource(sourceId: string): void {
		void this.session.send({ type: "select-source", sourceId });
	}

	selectSection(sourceId: string, sectionIndex: number): void {
		void this.session.send({ type: "select-section", sourceId, sectionIndex });
	}

	lookup(query: string): Promise<void> {
		return this.session.send({ type: "lookup", query });
	}

	retry(sourceId: string): Promise<void> {
		return this.session.send({ type: "retry-source", sourceId });
	}

	generateAi(): Promise<void> {
		return this.session.send({ type: "generate-ai" });
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
		sources: state.sources.map((source) => {
			const sections: SelectionLookupSection[] = [];
			for (const section of source.result?.sections ?? []) {
				const metadata = { title: section.title, presentation: section.presentation };
				if (section.content.kind === "list") {
					sections.push({ ...metadata, kind: "list", items: [...section.content.items] });
				} else if (section.content.kind === "ai-definitions") {
					sections.push({
						...metadata,
						kind: "ai-definitions",
						definitions: section.content.definitions.map((definition) => ({
							partOfSpeech: definition.partOfSpeech,
							meaning: definition.meaning,
						})),
					});
				} else {
					sections.push({
						...metadata,
						kind: "embedded",
						handle: section.content.document,
					});
				}
			}
			return {
				id: source.id,
				label: source.label,
				kind: source.kind === "ai" ? ("ai" as const) : ("dictionary" as const),
				status: source.status,
				error: source.error,
				pronunciations: (source.result?.pronunciations ?? []).map(
					({ label, phonetic }) => ({
						label,
						phonetic,
					}),
				),
				sections,
				activeSectionIndex: source.activeSectionIndex,
			};
		}),
	};
}
