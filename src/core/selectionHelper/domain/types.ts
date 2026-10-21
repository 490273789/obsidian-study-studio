export type SelectionHelperModifier = "none" | "alt" | "shift" | "ctrl";

export interface SelectionHelperSettings {
	/** Whether the selection helper is active. */
	enabled: boolean;
	/** Modifier key required to trigger the helper after selecting text. */
	modifier: SelectionHelperModifier;
	/** Shortcut to open the current lookup in the main dictionary tab. */
	openMainShortcut: string;
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
	trigger?: "mouse" | "touch" | "webview" | "manual";
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
	trigger?: "mouse" | "touch" | "webview" | "manual";
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

type SelectionLookupSourceStatus = "idle" | "loading" | "success" | "empty" | "error";

interface SelectionLookupPronunciation {
	label: string;
	phonetic: string;
}

interface SelectionLookupSourceSnapshot {
	id: string;
	label: string;
	kind: "ai" | "dictionary";
	status: SelectionLookupSourceStatus;
	error: string;
	pronunciations: readonly SelectionLookupPronunciation[];
	/** Opaque success body owned by the supplying feature; the helper never interprets it. */
	result: object | null;
}

export interface SelectionLookupSnapshot {
	query: string;
	activeSourceId: string | null;
	aiEngineName: string;
	status: "idle" | "loading" | "ready" | "error";
	sources: readonly SelectionLookupSourceSnapshot[];
}

/** Actions the helper may send to one lookup session; the adapter translates them. */
export type SelectionLookupIntent =
	| { readonly type: "lookup"; readonly query: string }
	| { readonly type: "select-source"; readonly sourceId: string }
	| { readonly type: "select-section"; readonly sourceId: string; readonly sectionIndex: number }
	| { readonly type: "retry-source"; readonly sourceId: string }
	| { readonly type: "generate-ai" };

export interface SelectionLookupHandle {
	getSnapshot(): SelectionLookupSnapshot;
	subscribe(listener: () => void): () => void;
	send(intent: SelectionLookupIntent): Promise<void>;
	dispose(): void;
}

export interface SelectionDictionaryAdapter {
	sources(): readonly SelectionDictionarySource[];
	startLookup(query: string, sourceIds: readonly string[]): SelectionLookupHandle | null;
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
