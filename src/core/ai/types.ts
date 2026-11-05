import type { OutboundPort, TransportErrorCode } from "../net/types";

/** Capability family of one AI engine. Features select an engine of the kind they need. */
export type AiEngineKind = "llm" | "asr" | "translation";

export type LlmProvider = "deepseek" | "bailian" | "youdao";

export type AsrProvider = "bailian" | "openai-compatible";
export type TranslationProvider = "youdao";

interface AiEngineBase {
	id: string;
	name: string;
}

/** Text-generation engine. Shared by translation profiles, dictionary lookup and capture. */
export interface LlmEngineConfig extends AiEngineBase {
	kind: "llm";
	provider: LlmProvider;
	baseUrl: string;
	/** Obsidian SecretStorage identifier; never the API key itself. */
	secretId: string;
	model: string;
}

/**
 * Speech-recognition engine used by listening practice and video shadowing.
 * Fields for the inactive provider are retained so switching providers does not
 * discard the other configuration.
 */
export interface AsrEngineConfig extends AiEngineBase {
	kind: "asr";
	provider: AsrProvider;
	/** Base URL up to the API root for an OpenAI-compatible transcription service. */
	baseUrl: string;
	/** Bailian only. Legacy plaintext workspace ID; cleared when a secret is chosen. */
	workspaceId: string;
	/** Bailian only. Obsidian SecretStorage ID containing the Beijing-region workspace ID. */
	workspaceSecretId: string;
	/** Obsidian SecretStorage ID containing the service API key; never the key itself. */
	secretId: string;
	model: string;
}

/** Text-translation API engine (currently the Youdao app-key/app-secret API). */
export interface TranslationEngineConfig extends AiEngineBase {
	kind: "translation";
	provider: TranslationProvider;
	baseUrl: string;
	appKeySecretId: string;
	appSecretSecretId: string;
}

export type AiEngineConfig = LlmEngineConfig | AsrEngineConfig | TranslationEngineConfig;

/** Default engine per kind. Translation profiles always select an engine explicitly. */
export interface AiEngineDefaults {
	llm: string | null;
	asr: string | null;
}

export interface AiSettings {
	engines: AiEngineConfig[];
	defaults: AiEngineDefaults;
}

export interface AiModel {
	id: string;
	imageInput: "supported" | "unsupported" | "unknown";
}

export interface AiMessage {
	role: "system" | "user" | "assistant";
	text: string;
	/** Base64-encoded image bytes, without a data URL prefix. */
	images?: readonly {
		mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
		base64: string;
	}[];
}

export interface AiRequestOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface AiGenerateRequest extends AiRequestOptions {
	/** Omit to use the default LLM engine. Explicit missing IDs never fall back. */
	configId?: string;
	/** Request provider-specific reasoning when the selected engine supports it. */
	thinkingEnabled?: boolean;
	/** Ask the provider for a JSON object response (`response_format`). */
	jsonMode?: boolean;
	messages: readonly AiMessage[];
}

export interface AiTextResult {
	text: string;
	configId: string;
	model: string;
	usage?: { inputTokens: number | null; outputTokens: number | null } | null;
}

export type AiErrorCode =
	| "busy"
	| "invalid-config"
	| "config-not-found"
	| "no-default"
	| "missing-key"
	| "invalid-input"
	| "unsupported-image"
	| "incomplete-response"
	| "disposed"
	| "save-failed";

/** Domain and transport failures a caller may present for an AI operation. */
export type AiFailureCode = AiErrorCode | TransportErrorCode;

/** Safe diagnostics: no raw response bodies, credentials or prompts. */
export class AiError extends Error {
	constructor(public readonly code: AiErrorCode) {
		super(code);
		this.name = "AiError";
	}
}

/**
 * Narrow per-kind connection testers injected by the composition root, so the
 * shared registry never imports a feature's translation or transcription runtime.
 * ASR has no paid connection test; a real transcription verifies it.
 */
export interface AiEngineTesters {
	translation?(this: void, engine: TranslationEngineConfig): Promise<void>;
}

export interface AiDependencies {
	net: Pick<OutboundPort, "request" | "readSecret">;
	persist: (settings: AiSettings) => Promise<void>;
	createId: () => string;
	testers?: AiEngineTesters;
}

export interface AiSnapshot {
	readonly settings: {
		readonly engines: readonly Readonly<AiEngineConfig>[];
		readonly defaults: Readonly<AiEngineDefaults>;
	};
	/** Model catalogues by LLM engine id. */
	readonly models: Readonly<Record<string, readonly Readonly<AiModel>[]>>;
	readonly loadingModels: readonly string[];
	readonly testing: readonly string[];
}
