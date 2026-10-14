export type SelectionHelperModifier = "none" | "alt" | "shift" | "ctrl";

export interface SelectionHelperSettings {
	/** Whether the selection helper is active. */
	enabled: boolean;
	/** Modifier key required to trigger the helper after selecting text. */
	modifier: SelectionHelperModifier;
	/** Persisted IDs of dictionary sources selected for inline lookup. */
	selectedDictionaries: string[];
	/** Popup-specific source order, independent of selection and the main dictionary catalog. */
	dictionaryOrder: string[];
}

export interface SelectionSource {
	/** Opaque page identity; a navigated page receives a fresh reference. */
	readonly id: string;
}

export interface SelectionRead {
	isCurrent(): boolean;
	submit(candidate: SelectionCandidate): boolean;
	dismiss(): void;
}

export interface SelectionSourceLease {
	readonly reference: SelectionSource;
	readonly active: boolean;
	/** Capture before asynchronous work, never after it completes. */
	capture(): SelectionRead;
	/** Clear this source's selection while allowing future captures. */
	dismiss(): void;
	dispose(): void;
}

export interface SelectionCandidate {
	trigger?: "mouse" | "touch" | "webview";
	text: string;
	x: number;
	y: number;
	eligibleContext: boolean;
	altKey: boolean;
	shiftKey: boolean;
	ctrlOrMetaKey: boolean;
}

export interface SelectionTarget {
	source: SelectionSource;
	trigger?: "mouse" | "touch" | "webview";
	text: string;
	isEnglishWord: boolean;
	x: number;
	y: number;
}

export interface SelectionDictionarySource {
	id: string;
	label: string;
	kind: "ai" | "dictionary";
}

export type SelectionLookupSourceStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface SelectionLookupPronunciation {
	label: string;
	phonetic: string;
}

export type SelectionLookupSection = {
	title: string;
	presentation: "stack" | "tab";
} & (
	| { kind: "list"; items: readonly string[] }
	| {
			kind: "ai-definitions";
			definitions: readonly { partOfSpeech: string; meaning: string }[];
	  }
	| { kind: "embedded"; /** Opaque content owned by the dictionary adapter. */ handle: object }
);

export interface SelectionLookupSourceSnapshot {
	id: string;
	label: string;
	kind: "ai" | "dictionary";
	status: SelectionLookupSourceStatus;
	error: string;
	pronunciations: readonly SelectionLookupPronunciation[];
	sections: readonly SelectionLookupSection[];
	activeSectionIndex: number | null;
}

export interface SelectionLookupSnapshot {
	query: string;
	activeSourceId: string | null;
	aiEngineName: string;
	status: "idle" | "loading" | "ready" | "error";
	sources: readonly SelectionLookupSourceSnapshot[];
}

export interface SelectionLookupSession {
	getSnapshot(): SelectionLookupSnapshot;
	subscribe(listener: () => void): () => void;
	selectSource(sourceId: string): void;
	selectSection(sourceId: string, sectionIndex: number): void;
	lookup(query: string): Promise<void>;
	retry(sourceId: string): Promise<void>;
	generateAi(): Promise<void>;
	dispose(): void;
}

export interface SelectionDictionaryAdapter {
	sources(): readonly SelectionDictionarySource[];
	startLookup(query: string, sourceIds: readonly string[]): SelectionLookupSession | null;
	openInMainTab(query: string): Promise<void>;
	openFavorite?(word: string): Promise<void>;
}

export interface SelectionTranslationAdapter {
	available(): boolean;
	openPrefilled(text: string): Promise<void>;
}

export interface SelectionHelperSnapshot {
	visible: boolean;
	mode: "actions" | "dictionary";
	target: SelectionTarget | null;
	canLookup: boolean;
	canTranslate: boolean;
	lookup: SelectionLookupSnapshot | null;
}
