import { isRecord } from "../shared/isRecord";
import type { AsrProvider } from "./types";

/**
 * Stable identities for engines recovered from pre-registry settings. They are
 * constants so every slice can derive the same selection id without reading
 * another slice's normalized output.
 */
export const LEGACY_ASR_BAILIAN_ENGINE_ID = "legacy-asr-bailian";
export const LEGACY_ASR_OPENAI_ENGINE_ID = "legacy-asr-openai-compatible";
export const LEGACY_YOUDAO_TRANSLATION_ENGINE_ID = "legacy-translation-youdao";

export const DEFAULT_BAILIAN_ASR_MODEL = "fun-asr-flash-2026-06-15";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "whisper-1";
export const DEFAULT_YOUDAO_TRANSLATION_BASE_URL = "https://openapi.youdao.com/api";

/** One pre-registry transcription configuration, read from either legacy owner. */
export interface LegacyTranscriptionSettings {
	provider: AsrProvider;
	bailianWorkspaceId: string;
	bailianWorkspaceSecretId: string;
	bailianSecretId: string;
	bailianModel: string;
	openaiBaseUrl: string;
	openaiSecretId: string;
	openaiModel: string;
}

export interface LegacyYoudaoTranslation {
	baseUrl: string;
	appKeySecretId: string;
	appSecretSecretId: string;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

/**
 * Before ADR-0016 the transcription configuration lived in `mediaTranscription`
 * (workbench-owned) and, before ADR-0012, in `audioPractice`. Both shapes are
 * accepted; the newer field wins, exactly like the removed slice normalized them.
 */
export function readLegacyTranscriptionSettings(
	rawDocument: unknown,
): LegacyTranscriptionSettings | null {
	const document = record(rawDocument);
	const current = isRecord(document.mediaTranscription) ? document.mediaTranscription : null;
	const legacyAudio = record(document.audioPractice);
	if (!current && !Object.keys(legacyAudio).length) return null;

	const provider: AsrProvider =
		current?.provider === "openai-compatible" ||
		(!current?.provider && legacyAudio.provider === "openai-compatible")
			? "openai-compatible"
			: "bailian";
	const bailianWorkspaceSecretId = text(
		current?.bailianWorkspaceSecretId ?? legacyAudio.bailianWorkspaceSecretId,
	);
	return {
		provider,
		bailianWorkspaceSecretId,
		bailianWorkspaceId: bailianWorkspaceSecretId
			? ""
			: text(
					current?.bailianWorkspaceId ??
						legacyAudio.bailianWorkspaceId ??
						legacyAudio.workspaceId,
				),
		bailianSecretId: text(
			current?.bailianSecretId ?? legacyAudio.bailianSecretId ?? legacyAudio.secretId,
		),
		bailianModel: text(current?.bailianModel ?? legacyAudio.bailianModel),
		openaiBaseUrl: text(current?.openaiBaseUrl ?? legacyAudio.openaiBaseUrl),
		openaiSecretId: text(current?.openaiSecretId ?? legacyAudio.openaiSecretId),
		openaiModel: text(current?.openaiModel ?? legacyAudio.openaiModel),
	};
}

/** Reads the pre-registry Youdao text-translation connection. */
export function readLegacyYoudaoTranslation(rawDocument: unknown): LegacyYoudaoTranslation | null {
	const translation = record(record(rawDocument).translation);
	if (!isRecord(translation.youdao)) return null;
	const youdao = translation.youdao;
	return {
		baseUrl: text(youdao.baseUrl),
		appKeySecretId: text(youdao.appKeySecretId),
		appSecretSecretId: text(youdao.appSecretSecretId),
	};
}

/** The pre-registry provider enum stored by the video player's shadowing settings. */
export function readLegacyVideoTranscriptionProvider(rawDocument: unknown): AsrProvider | null {
	const video = record(record(rawDocument).videoPlayer);
	if (video.shadowTranscriptionProvider === "openai-compatible") return "openai-compatible";
	if (video.shadowTranscriptionProvider === "bailian") return "bailian";
	return null;
}

/** Pre-registry LLM engine configurations (`ai.configs`). */
export function readLegacyLlmEngines(rawDocument: unknown): unknown[] {
	const ai = record(record(rawDocument).ai);
	if (Array.isArray(ai.engines)) return [];
	return Array.isArray(ai.configs) ? ai.configs : [];
}

export function readLegacyLlmDefaultId(rawDocument: unknown): string | null {
	const ai = record(record(rawDocument).ai);
	if (Array.isArray(ai.engines)) return null;
	return typeof ai.defaultConfigId === "string" ? ai.defaultConfigId : null;
}

export function legacyBailianAsrConfigured(settings: LegacyTranscriptionSettings): boolean {
	return Boolean(
		settings.bailianSecretId ||
		settings.bailianWorkspaceId ||
		settings.bailianWorkspaceSecretId,
	);
}

export function legacyOpenAiAsrConfigured(settings: LegacyTranscriptionSettings): boolean {
	return Boolean(settings.openaiSecretId);
}

/** Legacy engine id for one provider, or "" when that provider had no configuration. */
export function legacyAsrEngineId(
	settings: LegacyTranscriptionSettings,
	provider: AsrProvider,
): string {
	if (provider === "bailian")
		return legacyBailianAsrConfigured(settings) ? LEGACY_ASR_BAILIAN_ENGINE_ID : "";
	return legacyOpenAiAsrConfigured(settings) ? LEGACY_ASR_OPENAI_ENGINE_ID : "";
}

/** The provider selected by the old audio-practice settings. */
export function legacyActiveAsrEngineId(settings: LegacyTranscriptionSettings): string {
	return settings.provider === "openai-compatible"
		? legacyAsrEngineId(settings, "openai-compatible") || legacyAsrEngineId(settings, "bailian")
		: legacyAsrEngineId(settings, "bailian") ||
				legacyAsrEngineId(settings, "openai-compatible");
}

export function legacyTranslationEngineConfigured(
	settings: LegacyYoudaoTranslation | null,
): boolean {
	return Boolean(settings?.appKeySecretId || settings?.appSecretSecretId);
}
