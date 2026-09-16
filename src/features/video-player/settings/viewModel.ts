import type { Language } from "../../../core/shared/types";
import { defineSettings, type SettingsPresentation } from "../../../core/settings/presentation";
import { videoPlayerStrings } from "../strings/videoPlayer";

export interface VideoPlayerSettingsActions {
	setEnabled: (enabled: boolean) => void | Promise<void>;
	clearLocalData: () => void | Promise<void>;
}

export function buildVideoPlayerSettingsViewModel(
	enabled: boolean,
	actions: VideoPlayerSettingsActions,
	language: Language,
): SettingsPresentation {
	const t = videoPlayerStrings(language);
	return defineSettings("video-player", (page) => {
		page.group("general", t.settingsGeneral, (group) => {
			group.toggle(
				"enabled",
				{ name: t.enabled, description: t.enabledDescription },
				{ value: enabled, onChange: actions.setEnabled },
			);
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
