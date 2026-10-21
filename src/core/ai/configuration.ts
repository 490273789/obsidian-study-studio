import { EndpointValidationError, validateHttpEndpoint } from "../net/endpoint";
import { isRecord } from "../shared/isRecord";
import { settingsRecord, type SettingsSlice } from "../settings/slice";
import { AiError, type AiEngineConfig, type AiProvider, type AiSettings } from "./types";

const AI_PROVIDERS: readonly AiProvider[] = ["deepseek", "bailian", "youdao"];
export const AI_PRESETS: Record<AiProvider, { baseUrl: string; model: string }> = {
	deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
	// Workspace and region must be supplied by the user; no guessed endpoint.
	bailian: { baseUrl: "", model: "" },
	youdao: { baseUrl: "https://openapi.youdao.com/llmgateway/api/v1", model: "deepseek-v4-pro" },
};

export { isRecord };

/** Whitelist fields so accidental API keys never survive normalization. */
export function normalizeAiSettings(value: unknown): AiSettings {
	if (!isRecord(value)) return { configs: [], defaultConfigId: null };
	const configs: AiEngineConfig[] = [];
	const ids = new Set<string>();
	for (const item of Array.isArray(value.configs) ? value.configs : []) {
		if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id))
			continue;
		if (!AI_PROVIDERS.some((provider) => provider === item.provider)) continue;
		ids.add(item.id);
		configs.push({
			id: item.id,
			name: typeof item.name === "string" ? item.name : "",
			provider: item.provider as AiProvider,
			baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : "",
			secretId: typeof item.secretId === "string" ? item.secretId : "",
			model: typeof item.model === "string" ? item.model : "",
		});
	}
	return {
		configs,
		defaultConfigId:
			typeof value.defaultConfigId === "string" && ids.has(value.defaultConfigId)
				? value.defaultConfigId
				: null,
	};
}

export function validateAiConnection(config: AiEngineConfig): void {
	if (!AI_PROVIDERS.includes(config.provider) || !config.secretId.trim())
		throw new AiError("invalid-config");
	try {
		validateHttpEndpoint(config.baseUrl);
	} catch (error) {
		if (error instanceof EndpointValidationError) throw new AiError("invalid-config");
		throw error;
	}
}

export function cleanAiConfig(config: AiEngineConfig): AiEngineConfig {
	const clean = normalizeAiSettings({ configs: [config] }).configs[0];
	if (!clean) throw new AiError("invalid-config");
	clean.name = clean.name.trim();
	clean.baseUrl = clean.baseUrl.trim().replace(/\/+$/, "");
	clean.secretId = clean.secretId.trim();
	clean.model = clean.model.trim();
	validateAiConnection(clean);
	if (!clean.name || !clean.model) throw new AiError("invalid-config");
	return clean;
}

/**
 * The AI engine configuration is shared by every feature that calls AI, so the
 * workbench host owns its slice; features only read the engine ids they store.
 */
export const aiSettingsSlice: SettingsSlice<{ ai: AiSettings }> = {
	id: "ai",
	keys: ["ai"],

	defaults: () => ({ ai: normalizeAiSettings(undefined) }),

	normalize: (raw) => ({ ai: normalizeAiSettings(settingsRecord(raw).ai) }),

	// Committed AI settings are already normalized: normalizing again is the
	// clone path this slice has always used, and it returns fresh objects.
	clone: (document) => ({ ai: normalizeAiSettings(document.ai) }),
};
