import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";

export interface VideoPlayerSettings {
	enabled: boolean;
}

export function normalizeVideoPlayerSettings(value: unknown): VideoPlayerSettings {
	const data = settingsRecord(value);
	return { enabled: data.enabled !== false };
}

/** Synced feature availability only; machine-specific playback data stays local. */
export const videoPlayerSettingsSlice: SettingsSlice<{
	videoPlayer: VideoPlayerSettings;
}> = {
	id: "videoPlayer",
	keys: ["videoPlayer"],
	defaults: () => ({ videoPlayer: { enabled: true } }),
	normalize: (raw) => ({
		videoPlayer: normalizeVideoPlayerSettings(settingsRecord(raw).videoPlayer),
	}),
	clone: (document) => ({ videoPlayer: { ...document.videoPlayer } }),
};
