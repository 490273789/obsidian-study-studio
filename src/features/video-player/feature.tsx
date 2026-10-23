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
import type { LocalVideoSource } from "./domain/types";
import { VideoSubtitleJobs, type ShadowVideoSource } from "./domain/shadowSubtitlesJobs";
import { validShadowVaultFolder } from "./domain/shadowVaultFolder";
import type { ShadowRecorderPort } from "./domain/shadowingSession";
import {
	localVideoMediaUrl,
	ObsidianVideoPlayerStateStore,
	pickLocalVideoSources,
} from "./obsidian";
import { buildVideoPlayerSettingsViewModel } from "./settings/viewModel";
import {
	createDesktopShadowAudioExtractor,
	shadowVideoSourceSignature,
} from "./obsidian/shadowSubtitleAudio";
import { ShadowStorageRouter } from "./obsidian/shadowStorageRouter";
import { ShadowPracticeRecords } from "./obsidian/shadowPracticeRecords";
import { createShadowRecorder } from "./obsidian/shadowRecorder";
import { identifyShadowSources, relinkShadowSource } from "./obsidian/shadowSourceIdentity";
import { hasDuplicateShortcuts } from "./settings/keyboardShortcut";
import type { VideoPlayerSettings } from "./settings/slice";
import { videoPlayerStrings } from "./strings/videoPlayer";
import { PlayerViewInteraction } from "./ui/playerViewInteraction";
import { VideoPlayerView } from "./ui/VideoPlayerView";
import { ShadowingWorkspaceSession } from "./domain/shadowingWorkspaceSession";
import { createBrowserTakeAudioPlayer } from "./obsidian/browserTakeAudioPlayer";

export const VIDEO_PLAYER_SECTION_ID = "video-player";
export const VIEW_TYPE_VIDEO_PLAYER = "study-studio-local-video-player";

const OPEN_COMMAND_ID = "open-local-video-player";

type VideoPlayerWorkbenchHost = WorkbenchHost<"videoPlayer">;

const SOURCE_IDS_KEY = "study-studio.shadowing.source-ids.v1";
const SHADOW_ENABLED_KEY = "study-studio.shadowing.enabled-sources.v1";
const FFMPEG_PATH_KEY = "study-studio.shadowing.ffmpeg-path.v1";

export interface VideoShadowingServices {
	transcribe(
		audio: ArrayBuffer,
		provider: "bailian" | "openai-compatible",
		signature: string,
		signal: AbortSignal,
	): Promise<readonly { start: number; end: number; text: string }[]>;
	translate(
		text: string,
		profileId: string,
		signature: string,
		signal: AbortSignal,
	): Promise<string>;
	getTranscriptionSignature(provider: "bailian" | "openai-compatible"): Promise<string>;
	getTranslationProfileId(selected: string): string;
	getTranslationSignature(profileId: string): string;
	listTranslationProfiles(): { id: string; name: string }[];
}

export function createVideoPlayerFeature(
	deps: { shadowing?: VideoShadowingServices } = {},
): WorkbenchModule<"videoPlayer"> {
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
					readSettings: () => host.settings.read().videoPlayer,
				}),
			);
			const savedSourceIds = host.app.loadLocalStorage(SOURCE_IDS_KEY);
			const savedEnabled = host.app.loadLocalStorage(SHADOW_ENABLED_KEY);
			const enabledSources = new Set(
				Array.isArray(savedEnabled)
					? savedEnabled.filter((id): id is string => typeof id === "string")
					: [],
			);
			const sourceIds: Record<string, string> =
				savedSourceIds &&
				typeof savedSourceIds === "object" &&
				!Array.isArray(savedSourceIds)
					? Object.fromEntries(
							Object.entries(savedSourceIds).filter(
								(entry): entry is [string, string] => typeof entry[1] === "string",
							),
						)
					: {};
			for (const source of runtime.getSnapshot().sources) sourceIds[source.path] = source.id;
			const rememberSources = (sources: readonly LocalVideoSource[]): LocalVideoSource[] => {
				const identified = identifyShadowSources(
					sourceIds,
					sources,
					runtime.getSnapshot().sources,
				);
				host.app.saveLocalStorage(SOURCE_IDS_KEY, sourceIds);
				return identified;
			};
			let ffmpegPath = String(host.app.loadLocalStorage(FFMPEG_PATH_KEY) ?? "");
			let desktopWindow: (Window & { require?: (id: string) => unknown }) | null =
				typeof window === "undefined"
					? null
					: (window as Window & { require?: (id: string) => unknown });
			const requireModule = (id: string): unknown => {
				const require = desktopWindow?.require;
				if (!require) throw new Error("影子跟读的音轨提取需要 Obsidian 桌面版。");
				return require(id);
			};
			const sourceFor = (sourceId: string): ShadowVideoSource => {
				const source = runtime.getSnapshot().sources.find((item) => item.id === sourceId);
				if (!source) throw new Error("请先选择视频。");
				return source;
			};
			const serviceSignature = async (): Promise<string> => {
				if (!deps.shadowing) return "";
				const settings = host.settings.read().videoPlayer;
				const translationProfileId = deps.shadowing.getTranslationProfileId(
					settings.shadowTranslationProfileId,
				);
				return JSON.stringify({
					provider: settings.shadowTranscriptionProvider,
					transcription: await deps.shadowing.getTranscriptionSignature(
						settings.shadowTranscriptionProvider,
					),
					translationProfileId,
					translation: deps.shadowing.getTranslationSignature(translationProfileId),
				});
			};
			const taskConfig = async (source: ShadowVideoSource) => ({
				sourceSignature: await shadowVideoSourceSignature(source.path, requireModule),
				serviceSignature: await serviceSignature(),
			});
			let shadowingSession: ShadowingWorkspaceSession | undefined;
			if (deps.shadowing) {
				const shadowing = deps.shadowing;
				let recorderWindow: Window | null = null;
				let activeRecorder: ShadowRecorderPort | null = null;
				const getRecorder = (): ShadowRecorderPort => {
					if (!desktopWindow) throw new Error("影子跟读录音需要 Obsidian 桌面窗口。");
					if (activeRecorder && recorderWindow !== desktopWindow) {
						activeRecorder.dispose();
						activeRecorder = null;
					}
					if (!activeRecorder) {
						recorderWindow = desktopWindow;
						activeRecorder = createShadowRecorder(desktopWindow);
					}
					return activeRecorder;
				};
				const recorder: ShadowRecorderPort = {
					start: () => getRecorder().start(),
					stop: () => getRecorder().stop(),
					cancel: () => activeRecorder?.cancel(),
					play: (blob) => getRecorder().play(blob),
					dispose: () => {
						activeRecorder?.dispose();
						activeRecorder = null;
					},
				};
				const store = new ShadowStorageRouter(
					host.app,
					() => host.settings.read().videoPlayer.shadowVaultFolder,
				);
				const records = new ShadowPracticeRecords(host.app.vault.adapter, (sourceId) =>
					store.rootFor(sourceId),
				);
				const jobs = lifetime.own(
					new VideoSubtitleJobs({
						store,
						extract: (source, offset, signal) =>
							createDesktopShadowAudioExtractor({
								requireModule,
								ffmpegPath: ffmpegPath || undefined,
							})(source, offset, signal),
						serviceSignature,
						transcribe: async (audio, task, signal) => {
							if (task.config.serviceSignature !== (await serviceSignature()))
								throw new Error("转写配置已变化，请重新生成字幕。");
							const signature = JSON.parse(task.config.serviceSignature) as {
								provider: "bailian" | "openai-compatible";
								transcription: string;
							};
							return shadowing.transcribe(
								audio,
								signature.provider,
								signature.transcription,
								signal,
							);
						},
						translate: async (text, task, signal) => {
							if (task.config.serviceSignature !== (await serviceSignature()))
								throw new Error("翻译配置已变化，请重新生成字幕。");
							const signature = JSON.parse(task.config.serviceSignature) as {
								translationProfileId: string;
								translation: string;
							};
							if (!signature.translationProfileId)
								throw new Error("请在影子跟读设置中启用翻译配置。");
							return shadowing.translate(
								text,
								signature.translationProfileId,
								signature.translation,
								signal,
							);
						},
					}),
				);
				shadowingSession = lifetime.own(
					new ShadowingWorkspaceSession({
						runtime,
						jobs,
						recorder,
						records,
						audioPlayer: createBrowserTakeAudioPlayer(),
						readEnabled: (sourceId) => enabledSources.has(sourceId),
						writeEnabled: (sourceId, enabled) => {
							if (enabled) enabledSources.add(sourceId);
							else enabledSources.delete(sourceId);
							host.app.saveLocalStorage(SHADOW_ENABLED_KEY, [...enabledSources]);
						},
						startGeneration: async (sourceId) => {
							const source = sourceFor(sourceId);
							await jobs.start(source, await taskConfig(source));
						},
						translateImported: async (sourceId) => {
							const source = sourceFor(sourceId);
							await jobs.translateSubtitles(source, await taskConfig(source));
						},
					}),
				);
			}
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
						if (wasPresenter)
							desktopWindow = rootEl.ownerDocument
								.defaultView as typeof desktopWindow;
						const unsubscribe = view.subscribe(() => {
							const presenter = view.getSnapshot().role === "presenter";
							if (wasPresenter && !presenter)
								shadowingSession?.stopForPresenterLoss();
							if (!wasPresenter && presenter)
								desktopWindow = rootEl.ownerDocument
									.defaultView as typeof desktopWindow;
							wasPresenter = presenter;
						});
						return {
							resource: view,
							dispose: () => {
								if (wasPresenter) shadowingSession?.stopForPresenterLoss();
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
								shadowing={shadowingSession}
								onFocusExisting={() => void open()}
								onOpenSettings={() =>
									host.settingsTab.open(VIDEO_PLAYER_SECTION_ID)
								}
								onPickVideos={() =>
									pickLocalVideoSources(strings.addVideos, {
										document: rootEl.ownerDocument,
									})
										.then(rememberSources)
										.catch((error) => {
											console.error("Failed to select local videos:", error);
											new Notice(strings.selectFailed);
											return [];
										})
								}
								onPickReplacement={async (sourceId) => {
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
									if (replacement) {
										if (
											runtime
												.getSnapshot()
												.sources.some(
													(source) =>
														source.id !== sourceId &&
														source.path === replacement.path,
												)
										)
											return null;
										const relinked = relinkShadowSource(
											sourceIds,
											sourceId,
											replacement,
										);
										host.app.saveLocalStorage(SOURCE_IDS_KEY, sourceIds);
										return relinked;
									}
									return null;
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
								ffmpegPath = path;
								host.app.saveLocalStorage(FFMPEG_PATH_KEY, path);
							},
						},
						language,
						deps.shadowing
							? {
									translationProfiles: deps.shadowing.listTranslationProfiles(),
									ffmpegPath,
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
