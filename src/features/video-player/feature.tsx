import React from "react";
import { Notice } from "obsidian";
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
import { videoPlayerStrings } from "./strings/videoPlayer";
import { VideoPlayerView } from "./ui/VideoPlayerView";
import { VideoPlayerPresenterLease } from "./ui/presenterLease";

export const VIDEO_PLAYER_SECTION_ID = "video-player";
export const VIEW_TYPE_VIDEO_PLAYER = "study-studio-local-video-player";

const OPEN_COMMAND_ID = "open-local-video-player";

type VideoPlayerWorkbenchHost = WorkbenchHost<"videoPlayer">;

export function createVideoPlayerFeature(): WorkbenchModule<"videoPlayer"> {
	const open = async (host: VideoPlayerWorkbenchHost): Promise<void> => {
		try {
			await host.activateView(VIEW_TYPE_VIDEO_PLAYER, { mainTab: true });
		} catch (error) {
			console.error("Failed to open the local video player:", error);
			new Notice(videoPlayerStrings(host.settings.read().language).openFailed);
		}
	};

	return defineFeatureLifetime({
		id: "videoPlayer",
		start(host, lifetime) {
			const presenterLease = new VideoPlayerPresenterLease();
			const runtime = lifetime.own(
				new VideoPlayerRuntime({
					state: new ObsidianVideoPlayerStateStore(host.app),
					toMediaUrl: localVideoMediaUrl,
				}),
			);

			host.registerView(
				VIEW_TYPE_VIDEO_PLAYER,
				createReactItemView({
					type: VIEW_TYPE_VIDEO_PLAYER,
					icon: "circle-play",
					title: (language) => videoPlayerStrings(language).title,
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) => videoPlayerStrings(language).openFailed,
					render: ({ language, rootEl }) => {
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
								language={language}
								rootEl={rootEl}
								presenterLease={presenterLease}
								onFocusExisting={() => void open(host)}
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
				icon: "circle-play",
				title: (language) => videoPlayerStrings(language).title,
				openCommandId: OPEN_COMMAND_ID,
				settingsSectionId: VIDEO_PLAYER_SECTION_ID,
				available: () => host.settings.read().videoPlayer.enabled,
				open: () => void open(host),
			});

			const section: WorkbenchSettingsSection = {
				id: VIDEO_PLAYER_SECTION_ID,
				order: 4,
				label: (language) => videoPlayerStrings(language).settingsHeading,
				presentation: (language) =>
					buildVideoPlayerSettingsViewModel(
						host.settings.read().videoPlayer.enabled,
						{
							setEnabled: async (enabled) => {
								await host.settings.update({ videoPlayer: { enabled } });
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
