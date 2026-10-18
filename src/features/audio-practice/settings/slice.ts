import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";

export interface AudioPracticeSettings {
	enabled: boolean;
	workspaceId: string;
	secretId: string;
}

export const audioPracticeSettingsSlice: SettingsSlice<{ audioPractice: AudioPracticeSettings }> = {
	id: "audioPractice",
	keys: ["audioPractice"],
	defaults: () => ({ audioPractice: { enabled: true, workspaceId: "", secretId: "" } }),
	normalize: (raw) => {
		const value = settingsRecord(settingsRecord(raw).audioPractice);
		return {
			audioPractice: {
				enabled: value.enabled !== false,
				workspaceId: typeof value.workspaceId === "string" ? value.workspaceId.trim() : "",
				secretId: typeof value.secretId === "string" ? value.secretId.trim() : "",
			},
		};
	},
	clone: (document) => ({ audioPractice: { ...document.audioPractice } }),
};
