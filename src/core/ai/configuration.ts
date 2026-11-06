import { EndpointValidationError, validateHttpEndpoint } from "../net/endpoint";
import { isRecord } from "../shared/isRecord";
import type { SettingsSlice } from "../settings/slice";
import {
	DEFAULT_BAILIAN_ASR_MODEL,
	DEFAULT_OPENAI_BASE_URL,
	DEFAULT_OPENAI_MODEL,
	DEFAULT_YOUDAO_TRANSLATION_BASE_URL,
	LEGACY_ASR_BAILIAN_ENGINE_ID,
	LEGACY_ASR_OPENAI_ENGINE_ID,
	LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
	legacyActiveAsrEngineId,
	legacyBailianAsrConfigured,
	legacyOpenAiAsrConfigured,
	legacyTranslationEngineConfigured,
	readLegacyLlmDefaultId,
	readLegacyLlmEngines,
	readLegacyTranscriptionSettings,
	readLegacyYoudaoTranslation,
} from "./legacy";
import {
	AiError,
	type AiEngineConfig,
	type AiEngineDefaults,
	type AiEngineKind,
	type AiSettings,
	type AsrEngineConfig,
	type AsrProvider,
	type LlmEngineConfig,
	type LlmProvider,
	type TranslationEngineConfig,
	type TranslationProvider,
} from "./types";

export { isRecord };

export const LLM_PROVIDERS: readonly LlmProvider[] = ["deepseek", "bailian", "youdao"];
export const ASR_PROVIDERS: readonly AsrProvider[] = ["bailian", "openai-compatible"];
const TRANSLATION_PROVIDERS: readonly TranslationProvider[] = ["youdao"];

/** Models the synchronous Bailian speech API is known to accept (ADR-0006). */
export const BAILIAN_ASR_MODELS: readonly string[] = [
	DEFAULT_BAILIAN_ASR_MODEL,
	"qwen-audio-3.1-asr-flash",
	"qwen-audio-3.0-asr-flash",
];

export const LLM_PRESETS: Record<LlmProvider, { baseUrl: string; model: string }> = {
	deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
	// Workspace and region must be supplied by the user; no guessed endpoint.
	bailian: { baseUrl: "", model: "" },
	youdao: { baseUrl: "https://openapi.youdao.com/llmgateway/api/v1", model: "deepseek-v4-pro" },
};

export const ASR_PRESETS: Record<AsrProvider, { baseUrl: string; model: string }> = {
	bailian: { baseUrl: "", model: DEFAULT_BAILIAN_ASR_MODEL },
	"openai-compatible": { baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL },
};

const TRANSLATION_PRESETS: Record<TranslationProvider, { baseUrl: string }> = {
	youdao: { baseUrl: DEFAULT_YOUDAO_TRANSLATION_BASE_URL },
};

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeDefaults(value: unknown): AiEngineDefaults {
	const record = isRecord(value) ? value : {};
	return {
		llm: text(record.llm) || null,
		asr: text(record.asr) || null,
	};
}

export function isLlmProvider(value: unknown): value is LlmProvider {
	return LLM_PROVIDERS.some((provider) => provider === value);
}
export function isAsrProvider(value: unknown): value is AsrProvider {
	return ASR_PROVIDERS.some((provider) => provider === value);
}
function isTranslationProvider(value: unknown): value is TranslationProvider {
	return TRANSLATION_PROVIDERS.some((provider) => provider === value);
}

function normalizeLlmEngine(record: Record<string, unknown>, id: string): LlmEngineConfig | null {
	if (!isLlmProvider(record.provider)) return null;
	return {
		id,
		kind: "llm",
		name: text(record.name),
		provider: record.provider,
		baseUrl: text(record.baseUrl),
		secretId: text(record.secretId),
		model: text(record.model),
	};
}

function normalizeAsrEngine(record: Record<string, unknown>, id: string): AsrEngineConfig | null {
	if (!isAsrProvider(record.provider)) return null;
	return {
		id,
		kind: "asr",
		name: text(record.name),
		provider: record.provider,
		baseUrl: text(record.baseUrl),
		workspaceId: text(record.workspaceId),
		workspaceSecretId: text(record.workspaceSecretId),
		secretId: text(record.secretId),
		model: text(record.model),
	};
}

function normalizeTranslationEngine(
	record: Record<string, unknown>,
	id: string,
): TranslationEngineConfig | null {
	if (!isTranslationProvider(record.provider)) return null;
	return {
		id,
		kind: "translation",
		name: text(record.name),
		provider: record.provider,
		baseUrl: text(record.baseUrl),
		appKeySecretId: text(record.appKeySecretId),
		appSecretSecretId: text(record.appSecretSecretId),
	};
}

/** Whitelists fields so accidental API keys never survive normalization. */
function normalizeEngine(value: unknown): AiEngineConfig | null {
	if (!isRecord(value)) return null;
	const id = text(value.id);
	if (!id) return null;
	switch (value.kind) {
		case "llm":
			return normalizeLlmEngine(value, id);
		case "asr":
			return normalizeAsrEngine(value, id);
		case "translation":
			return normalizeTranslationEngine(value, id);
		default:
			// Pre-registry LLM configurations carried no `kind`.
			return normalizeLlmEngine({ ...value, kind: "llm" }, id);
	}
}

function collectEngines(candidates: readonly unknown[]): AiEngineConfig[] {
	const engines: AiEngineConfig[] = [];
	const ids = new Set<string>();
	for (const candidate of candidates) {
		const engine = normalizeEngine(candidate);
		if (!engine || ids.has(engine.id)) continue;
		ids.add(engine.id);
		engines.push(engine);
	}
	return engines;
}

/** Normalizes a committed engine registry; never re-adds legacy entries. */
export function normalizeAiSettings(value: unknown): AiSettings {
	const record = isRecord(value) ? value : {};
	const candidates = Array.isArray(record.engines)
		? record.engines
		: Array.isArray(record.configs)
			? record.configs
			: [];
	const engines = collectEngines(candidates);
	return { engines, defaults: validDefaults(normalizeDefaults(record.defaults), engines) };
}

function validDefaults(
	defaults: AiEngineDefaults,
	engines: readonly AiEngineConfig[],
): AiEngineDefaults {
	const has = (id: string | null, kind: AiEngineKind) =>
		id !== null && engines.some((engine) => engine.id === id && engine.kind === kind);
	return {
		llm: has(defaults.llm, "llm") ? defaults.llm : null,
		asr: has(defaults.asr, "asr") ? defaults.asr : null,
	};
}

function migratedAsrEngines(rawDocument: unknown): AiEngineConfig[] {
	const legacy = readLegacyTranscriptionSettings(rawDocument);
	if (!legacy) return [];
	const engines: AiEngineConfig[] = [];
	if (legacyBailianAsrConfigured(legacy)) {
		engines.push({
			id: LEGACY_ASR_BAILIAN_ENGINE_ID,
			kind: "asr",
			name: "百炼语音识别",
			provider: "bailian",
			baseUrl: "",
			workspaceId: legacy.bailianWorkspaceId,
			workspaceSecretId: legacy.bailianWorkspaceSecretId,
			secretId: legacy.bailianSecretId,
			model: legacy.bailianModel || DEFAULT_BAILIAN_ASR_MODEL,
		});
	}
	if (legacyOpenAiAsrConfigured(legacy)) {
		engines.push({
			id: LEGACY_ASR_OPENAI_ENGINE_ID,
			kind: "asr",
			name: "OpenAI 兼容语音识别",
			provider: "openai-compatible",
			baseUrl: legacy.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
			workspaceId: "",
			workspaceSecretId: "",
			secretId: legacy.openaiSecretId,
			model: legacy.openaiModel || DEFAULT_OPENAI_MODEL,
		});
	}
	return engines;
}

function migratedTranslationEngine(rawDocument: unknown): AiEngineConfig[] {
	const youdao = readLegacyYoudaoTranslation(rawDocument);
	if (!legacyTranslationEngineConfigured(youdao) || !youdao) return [];
	return [
		{
			id: LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
			kind: "translation",
			name: "有道文本翻译",
			provider: "youdao",
			baseUrl: youdao.baseUrl || DEFAULT_YOUDAO_TRANSLATION_BASE_URL,
			appKeySecretId: youdao.appKeySecretId,
			appSecretSecretId: youdao.appSecretSecretId,
		},
	];
}

/**
 * Reads the registry from a full raw settings document (ADR-0016). Legacy
 * `ai.configs`, `mediaTranscription`, `audioPractice` transcription fields and
 * `translation.youdao` become typed engines with stable ids; only secret
 * references move, never values. The function is idempotent because the new
 * document no longer carries the legacy fields.
 */
export function migrateAiSettings(rawDocument: unknown): AiSettings {
	const document = isRecord(rawDocument) ? rawDocument : {};
	const ai = isRecord(document.ai) ? document.ai : {};
	const candidates: unknown[] = Array.isArray(ai.engines)
		? [...ai.engines]
		: [...readLegacyLlmEngines(rawDocument)];
	candidates.push(...migratedAsrEngines(rawDocument), ...migratedTranslationEngine(rawDocument));
	const engines = collectEngines(candidates);
	const legacyAsr = readLegacyTranscriptionSettings(rawDocument);
	const defaults = normalizeDefaults(ai.defaults);
	return {
		engines,
		defaults: validDefaults(
			{
				llm: defaults.llm ?? legacyDefaultLlmId(rawDocument),
				asr:
					defaults.asr ?? (legacyAsr ? legacyActiveAsrEngineId(legacyAsr) || null : null),
			},
			engines,
		),
	};
}

function legacyDefaultLlmId(rawDocument: unknown): string | null {
	const id = readLegacyLlmDefaultId(rawDocument);
	return id && id.trim() ? id.trim() : null;
}

/** One LLM connection without requiring a model, for draft model discovery. */
export function validateAiConnection(engine: LlmEngineConfig): void {
	if (!isLlmProvider(engine.provider) || !engine.secretId.trim())
		throw new AiError("invalid-config");
	validateEndpoint(engine.baseUrl);
}

function validateLlmConnection(engine: LlmEngineConfig): void {
	validateAiConnection(engine);
	if (!engine.model.trim()) throw new AiError("invalid-config");
}

function validateEndpoint(baseUrl: string): void {
	try {
		validateHttpEndpoint(baseUrl);
	} catch (error) {
		if (error instanceof EndpointValidationError) throw new AiError("invalid-config");
		throw error;
	}
}

/** Validates one engine for the capability it claims, before any paid request. */
export function validateEngine(engine: AiEngineConfig): void {
	if (!engine.name.trim()) throw new AiError("invalid-config");
	switch (engine.kind) {
		case "llm":
			validateLlmConnection(engine);
			return;
		case "asr":
			if (!engine.secretId.trim() || !engine.model.trim())
				throw new AiError("invalid-config");
			if (engine.provider === "bailian") {
				if (!engine.workspaceId.trim() && !engine.workspaceSecretId.trim())
					throw new AiError("invalid-config");
				return;
			}
			validateEndpoint(engine.baseUrl);
			return;
		case "translation":
			if (
				!isTranslationProvider(engine.provider) ||
				!engine.appKeySecretId.trim() ||
				!engine.appSecretSecretId.trim()
			)
				throw new AiError("invalid-config");
			validateEndpoint(engine.baseUrl);
	}
}

/** Trims and validates an engine before it is committed. */
export function cleanEngine(engine: AiEngineConfig): AiEngineConfig {
	const clean = normalizeEngine(engine);
	if (!clean) throw new AiError("invalid-config");
	clean.name = clean.name.trim();
	clean.baseUrl = clean.baseUrl.replace(/\/+$/, "");
	validateEngine(clean);
	return clean;
}

export function createEngineDraft(kind: AiEngineKind, id: string): AiEngineConfig {
	switch (kind) {
		case "llm": {
			const provider: LlmProvider = "deepseek";
			return {
				id,
				kind: "llm",
				name: "",
				provider,
				...LLM_PRESETS[provider],
				secretId: "",
			};
		}
		case "asr": {
			const provider: AsrProvider = "bailian";
			return {
				id,
				kind: "asr",
				name: "",
				provider,
				...ASR_PRESETS[provider],
				workspaceId: "",
				workspaceSecretId: "",
				secretId: "",
			};
		}
		case "translation":
			return {
				id,
				kind: "translation",
				name: "",
				provider: "youdao",
				...TRANSLATION_PRESETS.youdao,
				appKeySecretId: "",
				appSecretSecretId: "",
			};
	}
}

export function enginesOfKind(settings: AiSettings, kind: AiEngineKind): readonly AiEngineConfig[] {
	return settings.engines.filter((engine) => engine.kind === kind);
}

export function findEngine(settings: AiSettings, id: string): AiEngineConfig | undefined {
	if (!id.trim()) return undefined;
	return settings.engines.find((engine) => engine.id === id);
}

/** Default engine of a kind, falling back to the first configured engine. */
export function defaultEngineFor(
	settings: AiSettings,
	kind: AiEngineKind,
): AiEngineConfig | undefined {
	const configured =
		kind === "llm" ? settings.defaults.llm : kind === "asr" ? settings.defaults.asr : null;
	const preferred = configured ? findEngine(settings, configured) : undefined;
	if (preferred?.kind === kind) return preferred;
	return enginesOfKind(settings, kind)[0];
}

/** Resolves a use-site selection; an empty id means the default engine of that kind. */
export function selectedEngine(
	settings: AiSettings,
	kind: AiEngineKind,
	id: string,
): AiEngineConfig | undefined {
	if (!id.trim()) return defaultEngineFor(settings, kind);
	const engine = findEngine(settings, id);
	return engine?.kind === kind ? engine : undefined;
}

/**
 * The engine registry is shared by every feature that calls AI, so the workbench
 * host owns its slice; features only store the engine ids they select.
 */
export const aiSettingsSlice: SettingsSlice<{ ai: AiSettings }> = {
	id: "ai",
	keys: ["ai"],

	defaults: () => ({ ai: normalizeAiSettings(undefined) }),

	normalize: (raw) => ({ ai: migrateAiSettings(raw) }),

	// Committed AI settings are already normalized: normalizing again is the
	// clone path this slice has always used, and it returns fresh objects.
	clone: (document) => ({ ai: normalizeAiSettings(document.ai) }),
};
