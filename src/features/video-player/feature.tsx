import React from "react";
import { Notice } from "obsidian";
import { CirclePlay } from "lucide-react";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { createReactItemView } from "../../core/host/reactItemView";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import type {
	WorkbenchHost,
	WorkbenchModule,
	WorkbenchSettingsSection,
} from "../../core/host/workbench";
import { VideoPlayerRuntime } from "./domain";
import {
	localVideoMediaUrl,
	ObsidianVideoPlayerStateStore,
	pickLocalVideoSources,
} from "./obsidian";
import { buildVideoPlayerSettingsViewModel } from "./settings/viewModel";
import { hasDuplicateShortcuts, type VideoPlayerShortcuts } from "./settings/keyboardShortcut";
import type { VideoPlayerSettings, VideoSkipInterval } from "./settings/slice";
import { videoPlayerStrings } from "./strings/videoPlayer";
import { PlayerViewInteraction } from "./ui/playerViewInteraction";
import { VideoPlayerView } from "./ui/VideoPlayerView";

export const VIDEO_PLAYER_SECTION_ID = "video-player";
export const VIEW_TYPE_VIDEO_PLAYER = "study-studio-local-video-player";

const OPEN_COMMAND_ID = "open-local-video-player";

type VideoPlayerWorkbenchHost = WorkbenchHost<"videoPlayer">;

export function createVideoPlayerFeature(): WorkbenchModule<"videoPlayer"> {
	return defineFeatureLifetime({
		id: "videoPlayer",
		start(host, lifetime) {
			const runtime = lifetime.own(
				new VideoPlayerRuntime({
					store: new ObsidianVideoPlayerStateStore(host.app),
					toMediaUrl: localVideoMediaUrl,
					reportError: (error) =>
						console.error("Failed to save local video player state:", error),
				}),
			);
			const interaction = lifetime.own(
				new PlayerViewInteraction({
					runtime,
				}),
			);
			const open = async (): Promise<void> => {
				try {
					await interaction.open(() =>
						host.activateView(VIEW_TYPE_VIDEO_PLAYER, { mainTab: true }),
					);
				} catch (error) {
					console.error("Failed to open the local video player:", error);
					new Notice(videoPlayerStrings(host.settings.read().language).openFailed);
				}
			};
			host.registerView(
				VIEW_TYPE_VIDEO_PLAYER,
				createReactItemView({
					type: VIEW_TYPE_VIDEO_PLAYER,
					icon: "circle-play",
					title: (language) => videoPlayerStrings(language).title,
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) => videoPlayerStrings(language).openFailed,
					acquire: ({ rootEl }) => {
						const view = interaction.mount({ ownerDocument: rootEl.ownerDocument });
						return { resource: view, dispose: () => view.dispose() };
					},
					render: ({ language, rootEl, resource: view }) => {
						const strings = videoPlayerStrings(language);
						if (!host.settings.read().videoPlayer.enabled) {
							return (
								<div className="fc-page">
									<p className="fc-kicker">{strings.disabled}</p>
									<FlashcardButton
										variant="primary"
										onClick={() =>
											host.settingsTab.open(VIDEO_PLAYER_SECTION_ID)
										}
									>
										{strings.openSettings}
									</FlashcardButton>
								</div>
							);
						}
						return (
							<VideoPlayerView
								runtime={runtime}
								view={view}
								language={language}
								rootEl={rootEl}
								settings={host.settings.read().videoPlayer}
								onFocusExisting={() => void open()}
								onOpenSettings={() =>
									host.settingsTab.open(VIDEO_PLAYER_SECTION_ID)
								}
								onPickVideos={() =>
									pickLocalVideoSources(strings.addVideos, {
										document: rootEl.ownerDocument,
									}).catch((error) => {
										console.error("Failed to select local videos:", error);
										new Notice(strings.selectFailed);
										return [];
									})
								}
								onPickReplacement={async () => {
									const [replacement] = await pickLocalVideoSources(
										strings.replace,
										{
											document: rootEl.ownerDocument,
										},
									).catch((error) => {
										console.error("Failed to replace a local video:", error);
										new Notice(strings.selectFailed);
										return [];
									});
									return replacement ?? null;
								}}
							/>
						);
					},
				}),
			);

			host.catalog({
				id: "video-player",
				icon: CirclePlay,
				order: 40,
				title: (language) => videoPlayerStrings(language).title,
				openCommandId: OPEN_COMMAND_ID,
				shortcutKey: "videoPlayer",
				settingsSectionId: VIDEO_PLAYER_SECTION_ID,
				available: () => host.settings.read().videoPlayer.enabled,
				open: () => void open(),
			});

			const section: WorkbenchSettingsSection = {
				id: VIDEO_PLAYER_SECTION_ID,
				order: 4,
				label: (language) => videoPlayerStrings(language).settingsHeading,
				presentation: (language) =>
					buildVideoPlayerSettingsViewModel(
						host.settings.read().videoPlayer,
						{
							setEnabled: async (enabled) => {
								await updateSettings(host, { enabled });
							},
							setSkipInterval: async (skipInterval) => {
								await updateSettings(host, { skipInterval });
							},
							setShortcut: async (key, shortcut) => {
								const current = host.settings.read().videoPlayer.shortcuts;
								const shortcuts = { ...current, [key]: shortcut };
								if (hasDuplicateShortcuts(shortcuts)) {
									new Notice(videoPlayerStrings(language).shortcutConflict);
									return;
								}
								await updateSettings(host, { shortcuts });
							},
							clearLocalData: () => {
								runtime.clearLocalData();
								new Notice(videoPlayerStrings(language).cleared);
							},
						},
						language,
					),
			};
			host.settingsSection(section);
		},
	});
}

async function updateSettings(
	host: VideoPlayerWorkbenchHost,
	patch: Partial<{
		enabled: boolean;
		skipInterval: VideoSkipInterval;
		shortcuts: VideoPlayerShortcuts;
	}>,
): Promise<void> {
	const current = host.settings.read().videoPlayer;
	await host.settings.update({
		videoPlayer: { ...current, ...patch } satisfies VideoPlayerSettings,
	});
}
