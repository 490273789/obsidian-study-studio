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
import { validShadowVaultFolder } from "./domain/shadowVaultFolder";
import {
	createDesktopVideoFilePicker,
	localVideoMediaUrl,
	ObsidianVideoPlayerStateStore,
	ObsidianVideoSourceIdentityStore,
} from "./obsidian";
import { buildVideoPlayerSettingsViewModel } from "./settings/viewModel";
import { hasDuplicateShortcuts } from "./settings/keyboardShortcut";
import type { VideoPlayerSettings } from "./settings/slice";
import { videoPlayerStrings } from "./strings/videoPlayer";
import { PlayerViewInteraction } from "./ui/playerViewInteraction";
import { VideoPlayerView } from "./ui/VideoPlayerView";
import {
	VideoShadowingDesktopAdapter,
	type VideoShadowingCue,
	type VideoShadowingServices,
} from "./obsidian/videoShadowingDesktopAdapter";

export const VIDEO_PLAYER_SECTION_ID = "video-player";
export const VIEW_TYPE_VIDEO_PLAYER = "study-studio-local-video-player";

const OPEN_COMMAND_ID = "open-local-video-player";

type VideoPlayerWorkbenchHost = WorkbenchHost<"videoPlayer">;

export type { VideoShadowingCue, VideoShadowingServices };

export function createVideoPlayerFeature(
	deps: { shadowing?: VideoShadowingServices } = {},
): WorkbenchModule<"videoPlayer"> {
	return defineFeatureLifetime({
		id: "videoPlayer",
		start(host, lifetime) {
			const runtime = lifetime.own(
				new VideoPlayerRuntime({
					store: new ObsidianVideoPlayerStateStore(host.app),
					identityStore: new ObsidianVideoSourceIdentityStore(host.app),
					picker: createDesktopVideoFilePicker(),
					reportNotice: (message) => new Notice(message),
					toMediaUrl: localVideoMediaUrl,
					reportError: (error) =>
						console.error("Failed to save local video player state:", error),
				}),
			);
			const interaction = lifetime.own(
				new PlayerViewInteraction({
					runtime,
					readSettings: () => host.settings.read().videoPlayer,
				}),
			);
			const desktopAdapter = lifetime.own(
				new VideoShadowingDesktopAdapter({
					app: host.app,
					readSettings: () => host.settings.read().videoPlayer,
					runtime,
					services: deps.shadowing,
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
						let wasPresenter = view.getSnapshot().role === "presenter";
						if (wasPresenter) {
							desktopAdapter.bindPresenterWindow(rootEl.ownerDocument.defaultView);
						}
						const unsubscribe = view.subscribe(() => {
							const presenter = view.getSnapshot().role === "presenter";
							if (wasPresenter && !presenter) {
								void desktopAdapter.shadowingSession?.stopForPresenterLoss();
							}
							if (!wasPresenter && presenter) {
								desktopAdapter.bindPresenterWindow(
									rootEl.ownerDocument.defaultView,
								);
							}
							wasPresenter = presenter;
						});
						return {
							resource: view,
							dispose: () => {
								if (wasPresenter) {
									void desktopAdapter.shadowingSession?.stopForPresenterLoss();
								}
								unsubscribe();
								view.dispose();
							},
						};
					},
					render: ({ language, rootEl, resource: view }) => {
						const strings = videoPlayerStrings(language);
						if (!host.settings.read().videoPlayer.enabled) {
							return (
								<div className="fc-page fc-page__content">
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
								shadowing={desktopAdapter.shadowingSession}
								onFocusExisting={() => void open()}
								onOpenSettings={() =>
									host.settingsTab.open(VIDEO_PLAYER_SECTION_ID)
								}
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
							setShadowTranscriptionProvider: (shadowTranscriptionProvider) =>
								updateSettings(host, { shadowTranscriptionProvider }),
							setShadowTranslationProfileId: (shadowTranslationProfileId) =>
								updateSettings(host, { shadowTranslationProfileId }),
							setShadowVaultFolder: (shadowVaultFolder) => {
								if (!validShadowVaultFolder(shadowVaultFolder)) {
									new Notice("练习资料目录必须是资料库内的有效相对路径。");
									return;
								}
								return updateSettings(host, { shadowVaultFolder });
							},
							setShadowFfmpegPath: (path) => {
								desktopAdapter.setFfmpegPath(path);
							},
						},
						language,
						deps.shadowing
							? {
									translationProfiles: deps.shadowing.listTranslationProfiles(),
									ffmpegPath: desktopAdapter.getFfmpegPath(),
								}
							: undefined,
					),
			};
			host.settingsSection(section);
		},
	});
}

async function updateSettings(
	host: VideoPlayerWorkbenchHost,
	patch: Partial<
		Pick<
			VideoPlayerSettings,
			| "enabled"
			| "skipInterval"
			| "shortcuts"
			| "shadowTranscriptionProvider"
			| "shadowTranslationProfileId"
			| "shadowVaultFolder"
		>
	>,
): Promise<void> {
	const current = host.settings.read().videoPlayer;
	await host.settings.update({
		videoPlayer: { ...current, ...patch } satisfies VideoPlayerSettings,
	});
}
