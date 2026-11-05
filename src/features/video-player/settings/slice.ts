import {
	legacyAsrEngineId,
	readLegacyTranscriptionSettings,
	readLegacyVideoTranscriptionProvider,
} from "../../../core/ai/legacy";
import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";
import { validShadowVaultFolder } from "../domain/shadowVaultFolder";
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
	/** Selected ASR engine shared with listening practice; empty means the default engine. */
	shadowTranscriptionEngineId: string;
	shadowTranslationProfileId: string;
	shadowVaultFolder: string;
}

export function normalizeVideoPlayerSettings(
	value: unknown,
	legacyDocument?: unknown,
): VideoPlayerSettings {
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
		shadowTranscriptionEngineId: shadowTranscriptionEngineId(data, legacyDocument),
		shadowTranslationProfileId:
			typeof data.shadowTranslationProfileId === "string"
				? data.shadowTranslationProfileId
				: "",
		shadowVaultFolder: validShadowVaultFolder(data.shadowVaultFolder)
			? data.shadowVaultFolder
			: "Study Studio/影子跟读",
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
			shadowTranscriptionEngineId: "",
			shadowTranslationProfileId: "",
			shadowVaultFolder: "Study Studio/影子跟读",
		},
	}),
	normalize: (raw) => ({
		videoPlayer: normalizeVideoPlayerSettings(settingsRecord(raw).videoPlayer, raw),
	}),
	clone: (document) => ({
		videoPlayer: {
			...document.videoPlayer,
			shortcuts: { ...document.videoPlayer.shortcuts },
		},
	}),
};

/**
 * ADR-0016: the video player selects an ASR engine from the shared registry
 * instead of owning a provider enum. The new id wins; the old provider is mapped
 * to the legacy engine that the AI settings migration creates. An empty result
 * means "use the default ASR engine".
 */
function shadowTranscriptionEngineId(
	data: Record<string, unknown>,
	legacyDocument: unknown,
): string {
	const selected = data.shadowTranscriptionEngineId;
	if (typeof selected === "string" && selected.trim()) return selected.trim();
	const provider = readLegacyVideoTranscriptionProvider(
		legacyDocument === undefined ? { videoPlayer: data } : legacyDocument,
	);
	if (!provider) return "";
	const legacy = readLegacyTranscriptionSettings(legacyDocument);
	return legacy ? legacyAsrEngineId(legacy, provider) : "";
}

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
