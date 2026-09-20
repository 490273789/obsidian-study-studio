import type { SandboxDocument } from "./sandbox-document";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";

/* -------------------------------------------------------------------------- */
/* Lookup results                                                              */
/* -------------------------------------------------------------------------- */

export interface DictionaryQuery {
	text: string;
}

export interface Pronunciation {
	accent: "uk" | "us" | "generic";
	audioUrl: string | null;
	label: string;
	phonetic: string;
}

export interface AiDictionaryExample {
	sentence: string;
	translation: string;
}

export interface AiDictionaryDefinition {
	antonyms: string[];
	examples: AiDictionaryExample[];
	explanation: string;
	meaning: string;
	partOfSpeech: string;
	synonyms: string[];
}

export type DictionarySectionContent =
	| { definitions: AiDictionaryDefinition[]; kind: "ai-definitions" }
	| { items: string[]; kind: "list" }
	| { document: SandboxDocument; kind: "document" };

export interface DictionarySection {
	content: DictionarySectionContent;
	presentation: "stack" | "tab";
	title: string;
}

export interface DictionaryResult {
	attribution: string;
	pronunciations: Pronunciation[];
	sections: DictionarySection[];
	sourceId: string;
	sourceLabel: string;
	suggestions: string[];
	word: string;
}

export type DictionaryErrorCode =
	| "configuration"
	| "unauthorized"
	| "not-found"
	| "rate-limit"
	| "server"
	| "network"
	| "empty-response"
	| "invalid-response"
	| "request"
	| "unsupported";

export class DictionaryError extends Error {
	constructor(
		readonly code: DictionaryErrorCode,
		message: string,
		readonly status: number | null = null,
	) {
		super(message);
		this.name = "DictionaryError";
	}
}

export function dictionaryErrorCodeMessage(
	code: DictionaryErrorCode,
	text: DictionaryStrings = dictionaryStrings("zh"),
): string {
	switch (code) {
		case "configuration":
			return text.errors.configuration;
		case "unauthorized":
			return text.errors.unauthorized;
		case "not-found":
			return text.errors.notFound;
		case "rate-limit":
			return text.errors.rateLimit;
		case "server":
			return text.errors.server;
		case "network":
			return text.errors.network;
		case "empty-response":
			return text.errors.emptyResponse;
		case "invalid-response":
			return text.errors.invalidResponse;
		case "request":
			return text.errors.request;
		case "unsupported":
			return text.errors.unsupported;
	}
}

export interface DictionarySource {
	readonly id: string;
	readonly kind: DictionarySourceKind;
	readonly label: string;
	lookup(query: DictionaryQuery): Promise<DictionaryResult>;
}

export type DictionarySourceStatus = "idle" | "loading" | "success" | "empty" | "error";

/* -------------------------------------------------------------------------- */
/* Persisted settings                                                          */
/* -------------------------------------------------------------------------- */

export type DictionarySourceKind = "youdao" | "cambridge" | "hujiang" | "ai" | "local";
export type YoudaoAccessMode = "official" | "free";

export interface DictionarySourceSettings {
	enabled: boolean;
	id: string;
	kind: DictionarySourceKind;
	label: string;
}

export interface DictionarySourceConfiguration {
	enabled: boolean;
	id: string;
}

export interface LocalDictionaryFileSettings {
	name: string;
	size: number;
}

export interface CompiledDictionarySettings {
	engineVersion: string;
	entryCount: number;
	fileCount: number;
	formatVersion: 2;
	manifestPath: "compiled-v2/manifest.json";
	manifestSha256: string;
	sourceFingerprint: string;
	totalBytes: number;
}

/**
 * Retained only so legacy catalog entries can still be reported as requiring a
 */
export interface PortableDictionarySettings {
	fileCount: number;
	formatVersion: 1;
	manifestPath: "portable-v1/manifest.json";
	manifestSha256: string;
	sourceFingerprint: string;
	totalBytes: number;
}

export interface LocalDictionarySettings {
	compiled?: CompiledDictionarySettings;
	directory: string;
	files: LocalDictionaryFileSettings[];
	id: string;
	name: string;
	portable?: PortableDictionarySettings;
}

/**
 * Persisted Youdao configuration. Secret values live only in Obsidian
 * `SecretStorage`; only the identifiers are stored here.
 */
export interface PersistedYoudaoDictionarySettings {
	accessMode: YoudaoAccessMode;
	appKeySecretId: string;
	appSecretSecretId: string;
	dictionaries: string[];
}

/** Resolved Youdao credentials handed to the dictionary source at runtime. */
export interface YoudaoDictionarySettings {
	accessMode: YoudaoAccessMode;
	appKey: string;
	appSecret: string;
	dictionaries: string[];
}

export interface AiDictionarySettings {
	/** Id of the shared AI engine configuration used for AI definitions. */
	configId: string | null;
}

export interface DictionarySettings {
	ai: AiDictionarySettings;
	enabled: boolean;
	favoritePath: string;
	history: string[];
	localDictionaries: LocalDictionarySettings[];
	sources: DictionarySourceSettings[];
	youdao: PersistedYoudaoDictionarySettings;
}

export interface LocalDictionaryAdministrationState {
	localDictionaries: LocalDictionarySettings[];
	sources: DictionarySourceSettings[];
}

/**
 * The settings seam the dictionary domain code depends on. The Obsidian
 * boundary implements it on top of `FlashcardSettings.dictionary` so domain
 * modules never touch `DataStore` directly.
 */
export interface DictionarySettingsStore {
	/** Current committed dictionary settings. */
	getDictionarySettings(): Readonly<DictionarySettings>;
	/** Mutates a draft and persists it; returns false when persistence failed. */
	updateDictionarySettings(mutate: (draft: DictionarySettings) => void): Promise<boolean>;
	getLocalDictionaryAdministrationState(): Readonly<LocalDictionaryAdministrationState>;
	setLocalDictionaryAdministrationState(state: LocalDictionaryAdministrationState): void;
	save(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Presentation state                                                          */
/* -------------------------------------------------------------------------- */

export interface DictionarySourceState {
	activeSectionIndex: number | null;
	error: string;
	id: string;
	kind: DictionarySourceKind;
	label: string;
	result: DictionaryResult | null;
	status: DictionarySourceStatus;
}

export interface DictionaryViewState {
	activeSourceId: string | null;
	/** Display label of the selected AI engine configuration, if any. */
	aiEngineName: string;
	aiReady: boolean;
	history: string[];
	input: string;
	query: string;
	sources: DictionarySourceState[];
	status: "idle" | "loading" | "ready" | "error";
}

export interface DictionaryFavoriteViewState {
	meaning: string;
	message: string;
	note: string;
	path: string;
	pathSuggestions: string[];
	savedPath: string;
	status: "idle" | "saving" | "success" | "error";
	word: string;
}

export interface DictionaryFavoriteViewModel {
	clear(): void;
	getSnapshot(): DictionaryFavoriteViewState;
	openSavedFile(): Promise<void>;
	save(): Promise<void>;
	setMeaning(value: string): void;
	setNote(value: string): void;
	setPath(value: string): void;
	setWord(value: string): void;
	subscribe(listener: () => void): () => void;
}
