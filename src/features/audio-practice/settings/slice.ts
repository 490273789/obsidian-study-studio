import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";
import type { TranscriptionProviderId } from "../domain/transcriptionTypes";

export const DEFAULT_BAILIAN_MODEL = "fun-asr-flash-2026-06-15";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "whisper-1";

export interface AudioPracticeSettings {
	enabled: boolean;
	/** Which speech service receives generated audio. */
	provider: TranscriptionProviderId;
	/** Legacy plaintext workspace; cleared when a SecretStorage entry is selected. */
	bailianWorkspaceId: string;
	/** Obsidian SecretStorage ID for the Beijing-region workspace ID. */
	bailianWorkspaceSecretId: string;
	/** Obsidian SecretStorage ID for the workspace API key; never the key itself. */
	bailianSecretId: string;
	bailianModel: string;
	/** Base URL up to the API root for an OpenAI-compatible transcription service. */
	openaiBaseUrl: string;
	/** Obsidian SecretStorage ID for the compatible service; never the key itself. */
	openaiSecretId: string;
	openaiModel: string;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Older documents stored the single Bailian workspace as top-level fields. */
function migrated(value: string, legacy: string): string {
	return value || legacy;
}

export const audioPracticeSettingsSlice: SettingsSlice<{ audioPractice: AudioPracticeSettings }> = {
	id: "audioPractice",
	keys: ["audioPractice"],
	defaults: () => ({
		audioPractice: {
			enabled: true,
			provider: "bailian",
			bailianWorkspaceId: "",
			bailianWorkspaceSecretId: "",
			bailianSecretId: "",
			bailianModel: DEFAULT_BAILIAN_MODEL,
			openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
			openaiSecretId: "",
			openaiModel: DEFAULT_OPENAI_MODEL,
		},
	}),
	normalize: (raw) => {
		const value = settingsRecord(settingsRecord(raw).audioPractice);
		const legacyWorkspaceId = text(value.workspaceId);
		const legacySecretId = text(value.secretId);
		const bailianWorkspaceSecretId = text(value.bailianWorkspaceSecretId);
		return {
			audioPractice: {
				enabled: value.enabled !== false,
				provider: value.provider === "openai-compatible" ? "openai-compatible" : "bailian",
				bailianWorkspaceId: bailianWorkspaceSecretId
					? ""
					: migrated(text(value.bailianWorkspaceId), legacyWorkspaceId),
				bailianWorkspaceSecretId,
				bailianSecretId: migrated(text(value.bailianSecretId), legacySecretId),
				bailianModel: text(value.bailianModel) || DEFAULT_BAILIAN_MODEL,
				openaiBaseUrl: text(value.openaiBaseUrl) || DEFAULT_OPENAI_BASE_URL,
				openaiSecretId: text(value.openaiSecretId),
				openaiModel: text(value.openaiModel) || DEFAULT_OPENAI_MODEL,
			},
		};
	},
	clone: (document) => ({ audioPractice: { ...document.audioPractice } }),
};
