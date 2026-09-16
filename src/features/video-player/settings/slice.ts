import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";
import {
	DEFAULT_VIDEO_PLAYER_SHORTCUTS,
	normalizeKeyboardShortcut,
	type VideoPlayerShortcuts,
} from "./keyboardShortcut";

export const VIDEO_SKIP_INTERVALS = [5, 10, 15, 30, 60] as const;
export type VideoSkipInterval = (typeof VIDEO_SKIP_INTERVALS)[number];

export interface VideoPlayerSettings {
	enabled: boolean;
	skipInterval: VideoSkipInterval;
	shortcuts: VideoPlayerShortcuts;
}

export function normalizeVideoPlayerSettings(value: unknown): VideoPlayerSettings {
	const data = settingsRecord(value);
	const shortcuts = settingsRecord(data.shortcuts);
	const normalizedShortcuts: VideoPlayerShortcuts = {
		togglePlayback: normalizeKeyboardShortcut(
			shortcuts.togglePlayback,
			DEFAULT_VIDEO_PLAYER_SHORTCUTS.togglePlayback,
		),
		seekBackward: normalizeKeyboardShortcut(
			shortcuts.seekBackward,
			DEFAULT_VIDEO_PLAYER_SHORTCUTS.seekBackward,
		),
		seekForward: normalizeKeyboardShortcut(
			shortcuts.seekForward,
			DEFAULT_VIDEO_PLAYER_SHORTCUTS.seekForward,
		),
	};
	return {
		enabled: data.enabled !== false,
		skipInterval: VIDEO_SKIP_INTERVALS.includes(data.skipInterval as VideoSkipInterval)
			? (data.skipInterval as VideoSkipInterval)
			: 10,
		shortcuts: makeShortcutsUnique(normalizedShortcuts),
	};
}

/** Synced preferences only; paths, progress, queue disclosure, and geometry stay local. */
export const videoPlayerSettingsSlice: SettingsSlice<{
	videoPlayer: VideoPlayerSettings;
}> = {
	id: "videoPlayer",
	keys: ["videoPlayer"],
	defaults: () => ({
		videoPlayer: {
			enabled: true,
			skipInterval: 10,
			shortcuts: { ...DEFAULT_VIDEO_PLAYER_SHORTCUTS },
		},
	}),
	normalize: (raw) => ({
		videoPlayer: normalizeVideoPlayerSettings(settingsRecord(raw).videoPlayer),
	}),
	clone: (document) => ({
		videoPlayer: {
			...document.videoPlayer,
			shortcuts: { ...document.videoPlayer.shortcuts },
		},
	}),
};

function makeShortcutsUnique(shortcuts: VideoPlayerShortcuts): VideoPlayerShortcuts {
	const used = new Set<string>();
	const unique = { ...shortcuts };
	for (const key of Object.keys(unique) as (keyof VideoPlayerShortcuts)[]) {
		const shortcut = unique[key];
		if (!shortcut || !used.has(shortcut)) {
			if (shortcut) used.add(shortcut);
			continue;
		}
		const fallback = DEFAULT_VIDEO_PLAYER_SHORTCUTS[key];
		unique[key] = used.has(fallback) ? "" : fallback;
		if (unique[key]) used.add(unique[key]);
	}
	return unique;
}
