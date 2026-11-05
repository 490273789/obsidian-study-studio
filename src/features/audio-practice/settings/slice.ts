import { legacyActiveAsrEngineId, readLegacyTranscriptionSettings } from "../../../core/ai/legacy";
import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";

/**
 * Listening practice stores only the ASR engine it selects (ADR-0016). The
 * engine registry, credentials, models and Base URLs live in the shared AI
 * engine settings.
 */
export interface AudioPracticeSettings {
	enabled: boolean;
	/** Selected ASR engine id; an empty id means the default ASR engine. */
	transcriptionEngineId: string;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export const audioPracticeSettingsSlice: SettingsSlice<{ audioPractice: AudioPracticeSettings }> = {
	id: "audioPractice",
	keys: ["audioPractice"],

	defaults: () => ({
		audioPractice: {
			enabled: true,
			transcriptionEngineId: "",
		},
	}),

	normalize: (raw) => {
		const value = settingsRecord(settingsRecord(raw).audioPractice);
		const selected = text(value.transcriptionEngineId);
		// Pre-registry documents configured the service here or in the removed
		// `mediaTranscription` slice; map that choice onto its stable engine id.
		const legacy = selected ? null : readLegacyTranscriptionSettings(raw);
		return {
			audioPractice: {
				enabled: value.enabled !== false,
				transcriptionEngineId: selected || (legacy ? legacyActiveAsrEngineId(legacy) : ""),
			},
		};
	},

	clone: (document) => ({ audioPractice: { ...document.audioPractice } }),
};
