import type { Language } from "../../../core/shared/types";
import { defineSettings, type SettingsPresentation } from "../../../core/settings/presentation";
import { videoPlayerStrings } from "../strings/videoPlayer";
import { DEFAULT_VIDEO_PLAYER_SHORTCUTS, type VideoPlayerShortcuts } from "./keyboardShortcut";
import { VIDEO_SKIP_INTERVALS, type VideoPlayerSettings, type VideoSkipInterval } from "./slice";

export interface VideoPlayerSettingsActions {
	setEnabled: (enabled: boolean) => void | Promise<void>;
	setSkipInterval: (seconds: VideoSkipInterval) => void | Promise<void>;
	setShortcut: (key: keyof VideoPlayerShortcuts, shortcut: string) => void | Promise<void>;
	clearLocalData: () => void | Promise<void>;
}

export function buildVideoPlayerSettingsViewModel(
	settings: VideoPlayerSettings,
	actions: VideoPlayerSettingsActions,
	language: Language,
): SettingsPresentation {
	const t = videoPlayerStrings(language);
	return defineSettings("video-player", (page) => {
		page.group("general", t.settingsGeneral, (group) => {
			group.toggle(
				"enabled",
				{ name: t.enabled, description: t.enabledDescription },
				{ value: settings.enabled, onChange: actions.setEnabled },
			);
			group.select(
				"skip-interval",
				{ name: t.skipInterval, description: t.skipIntervalDescription },
				{
					value: String(settings.skipInterval),
					options: VIDEO_SKIP_INTERVALS.map((seconds) => ({
						value: String(seconds),
						label: t.seconds(seconds),
					})),
					onChange: (value) =>
						actions.setSkipInterval(Number(value) as VideoSkipInterval),
				},
			);
		});
		page.group("keyboard", t.keyboardSettings, (group) => {
			for (const key of ["togglePlayback", "seekBackward", "seekForward"] as const) {
				const unavailableValues = Object.entries(settings.shortcuts)
					.filter(([other]) => other !== key)
					.map(([, shortcut]) => shortcut)
					.filter(Boolean);
				const resetValue = DEFAULT_VIDEO_PLAYER_SHORTCUTS[key];
				group.row(
					key,
					{
						name: t.shortcutNames[key],
						description: t.shortcutDescription,
					},
					(row) => {
						row.keybinding("binding", {
							value: settings.shortcuts[key],
							emptyLabel: t.shortcutUnassigned,
							recordingLabel: t.shortcutRecording,
							conflictMessage: t.shortcutConflict,
							unavailableValues,
							onChange: (shortcut) => actions.setShortcut(key, shortcut),
						});
						row.button("clear", {
							label: t.shortcutClear,
							disabled: settings.shortcuts[key] === "",
							onPress: () => actions.setShortcut(key, ""),
						});
						row.button("reset", {
							label: t.shortcutReset,
							disabled:
								settings.shortcuts[key] === resetValue ||
								unavailableValues.includes(resetValue),
							onPress: () => actions.setShortcut(key, resetValue),
						});
					},
				);
			}
		});
		page.group("local-data", t.localData, (group) => {
			group.button(
				"clear",
				{ name: t.localData, description: t.localDataDescription, tone: "warning" },
				{
					label: t.clearLocalData,
					tone: "warning",
					onPress: actions.clearLocalData,
				},
			);
		});
	});
}
