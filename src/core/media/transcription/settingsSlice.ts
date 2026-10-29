import { settingsRecord, type SettingsSlice } from "../../settings/slice";
import type { MediaTranscriptionSettings } from "./mediaTranscriptionEngine";

export const DEFAULT_BAILIAN_MODEL = "fun-asr-flash-2026-06-15";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "whisper-1";

export const mediaTranscriptionDefaults: MediaTranscriptionSettings = {
	provider: "bailian",
	bailianWorkspaceId: "",
	bailianWorkspaceSecretId: "",
	bailianSecretId: "",
	bailianModel: DEFAULT_BAILIAN_MODEL,
	openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
	openaiSecretId: "",
	openaiModel: DEFAULT_OPENAI_MODEL,
};

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Workbench-owned media transcription settings slice (ADR-0012).
 * Normalizes both direct mediaTranscription config and legacy audioPractice fields.
 */
export const mediaTranscriptionSettingsSlice: SettingsSlice<{
	mediaTranscription: MediaTranscriptionSettings;
}> = {
	id: "mediaTranscription",
	keys: ["mediaTranscription"],
	defaults: () => ({
		mediaTranscription: { ...mediaTranscriptionDefaults },
	}),
	normalize: (raw) => {
		const rawDoc = settingsRecord(raw);
		const current = settingsRecord(rawDoc.mediaTranscription);
		const legacyAudio = settingsRecord(rawDoc.audioPractice);

		const provider =
			current.provider === "openai-compatible" ||
			(!current.provider && legacyAudio.provider === "openai-compatible")
				? "openai-compatible"
				: "bailian";

		const bailianWorkspaceSecretId = text(
			current.bailianWorkspaceSecretId || legacyAudio.bailianWorkspaceSecretId,
		);
		const bailianWorkspaceId = bailianWorkspaceSecretId
			? ""
			: text(
					current.bailianWorkspaceId ||
						legacyAudio.bailianWorkspaceId ||
						legacyAudio.workspaceId,
				);

		const bailianSecretId = text(
			current.bailianSecretId || legacyAudio.bailianSecretId || legacyAudio.secretId,
		);
		const bailianModel =
			text(current.bailianModel || legacyAudio.bailianModel) || DEFAULT_BAILIAN_MODEL;

		const openaiBaseUrl =
			text(current.openaiBaseUrl || legacyAudio.openaiBaseUrl) || DEFAULT_OPENAI_BASE_URL;
		const openaiSecretId = text(current.openaiSecretId || legacyAudio.openaiSecretId);
		const openaiModel =
			text(current.openaiModel || legacyAudio.openaiModel) || DEFAULT_OPENAI_MODEL;

		return {
			mediaTranscription: {
				provider,
				bailianWorkspaceId,
				bailianWorkspaceSecretId,
				bailianSecretId,
				bailianModel,
				openaiBaseUrl,
				openaiSecretId,
				openaiModel,
			},
		};
	},
	clone: (doc) => ({
		mediaTranscription: { ...doc.mediaTranscription },
	}),
};
