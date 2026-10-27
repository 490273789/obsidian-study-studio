import { Notice, type App } from "obsidian";
import type { LocalVideoSource } from "../domain/types";
import { VideoSubtitleJobs, type ShadowVideoSource } from "../domain/shadowSubtitlesJobs";
import type { ShadowRecorderPort } from "../domain/shadowingSession";
import { pickLocalVideoSources } from "./localVideoFiles";
import {
	createDesktopShadowAudioExtractor,
	shadowVideoSourceSignature,
} from "./shadowSubtitleAudio";
import { ShadowStorageRouter } from "./shadowStorageRouter";
import { ShadowPracticeRecords } from "./shadowPracticeRecords";
import { createShadowRecorder } from "./shadowRecorder";
import { identifyShadowSources, relinkShadowSource } from "./shadowSourceIdentity";
import type { VideoPlayerSettings } from "../settings/slice";
import { ShadowingWorkspaceSession } from "../domain/shadowingWorkspaceSession";
import { createBrowserTakeAudioPlayer } from "./browserTakeAudioPlayer";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";

const SOURCE_IDS_KEY = "study-studio.shadowing.source-ids.v1";
const SHADOW_ENABLED_KEY = "study-studio.shadowing.enabled-sources.v1";
const FFMPEG_PATH_KEY = "study-studio.shadowing.ffmpeg-path.v1";

export interface VideoShadowingCue {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export interface VideoShadowingServices {
	transcribe(
		audio: ArrayBuffer,
		provider: "bailian" | "openai-compatible",
		signature: string,
		signal: AbortSignal,
	): Promise<readonly VideoShadowingCue[]>;
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

export interface VideoShadowingDesktopAdapterOptions {
	readonly app: App;
	readonly readSettings: () => VideoPlayerSettings;
	readonly runtime: VideoPlayerRuntime;
	readonly services?: VideoShadowingServices;
	readonly initialWindow?: Window | null;
	readonly reportNotice?: (message: string) => void;
}

export interface VideoPickStrings {
	readonly addVideos: string;
	readonly selectFailed: string;
}

export interface VideoReplaceStrings {
	readonly replace: string;
	readonly selectFailed: string;
}

export class VideoShadowingDesktopAdapter {
	private readonly app: App;
	private readonly readSettings: () => VideoPlayerSettings;
	private readonly runtime: VideoPlayerRuntime;
	private readonly services?: VideoShadowingServices;
	private readonly reportNotice: (message: string) => void;

	private readonly sourceIds: Record<string, string>;
	private readonly enabledSources: Set<string>;
	private ffmpegPath: string;

	private desktopWindow: (Window & { require?: (id: string) => unknown }) | null;
	private recorderWindow: Window | null = null;
	private activeRecorder: ShadowRecorderPort | null = null;

	readonly jobs?: VideoSubtitleJobs;
	readonly shadowingSession?: ShadowingWorkspaceSession;

	constructor(options: VideoShadowingDesktopAdapterOptions) {
		this.app = options.app;
		this.readSettings = options.readSettings;
		this.runtime = options.runtime;
		this.services = options.services;
		this.reportNotice = options.reportNotice ?? ((message) => new Notice(message));

		const savedSourceIds = this.app.loadLocalStorage(SOURCE_IDS_KEY);
		this.sourceIds =
			savedSourceIds && typeof savedSourceIds === "object" && !Array.isArray(savedSourceIds)
				? Object.fromEntries(
						Object.entries(savedSourceIds).filter(
							(entry): entry is [string, string] => typeof entry[1] === "string",
						),
					)
				: {};
		for (const source of this.runtime.getSnapshot().sources) {
			this.sourceIds[source.path] = source.id;
		}

		const savedEnabled = this.app.loadLocalStorage(SHADOW_ENABLED_KEY);
		this.enabledSources = new Set(
			Array.isArray(savedEnabled)
				? savedEnabled.filter((id): id is string => typeof id === "string")
				: [],
		);

		this.ffmpegPath = String(this.app.loadLocalStorage(FFMPEG_PATH_KEY) ?? "");

		this.desktopWindow =
			options.initialWindow !== undefined
				? (options.initialWindow as (Window & { require?: (id: string) => unknown }) | null)
				: typeof window === "undefined"
					? null
					: (window as Window & { require?: (id: string) => unknown });

		if (this.services) {
			const shadowing = this.services;
			const recorder: ShadowRecorderPort = {
				start: () => this.getRecorder().start(),
				stop: () => this.getRecorder().stop(),
				cancel: () => this.activeRecorder?.cancel(),
				play: (blob) => this.getRecorder().play(blob),
				dispose: () => {
					this.activeRecorder?.dispose();
					this.activeRecorder = null;
				},
			};

			const store = new ShadowStorageRouter(
				this.app,
				() => this.readSettings().shadowVaultFolder,
			);
			const records = new ShadowPracticeRecords(this.app.vault.adapter, (sourceId) =>
				store.rootFor(sourceId),
			);

			this.jobs = new VideoSubtitleJobs({
				store,
				extract: (source, offset, signal) =>
					createDesktopShadowAudioExtractor({
						requireModule: this.requireModule.bind(this),
						ffmpegPath: this.ffmpegPath || undefined,
					})(source, offset, signal),
				serviceSignature: this.serviceSignature.bind(this),
				transcribe: async (audio, task, signal) => {
					if (task.config.serviceSignature !== (await this.serviceSignature())) {
						throw new Error("转写配置已变化，请重新生成字幕。");
					}
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
					if (task.config.serviceSignature !== (await this.serviceSignature())) {
						throw new Error("翻译配置已变化，请重新生成字幕。");
					}
					const signature = JSON.parse(task.config.serviceSignature) as {
						translationProfileId: string;
						translation: string;
					};
					if (!signature.translationProfileId) {
						throw new Error("请在影子跟读设置中启用翻译配置。");
					}
					return shadowing.translate(
						text,
						signature.translationProfileId,
						signature.translation,
						signal,
					);
				},
			});

			this.shadowingSession = new ShadowingWorkspaceSession({
				runtime: this.runtime,
				jobs: this.jobs,
				recorder,
				records,
				audioPlayer: createBrowserTakeAudioPlayer(),
				readEnabled: (sourceId) => this.enabledSources.has(sourceId),
				writeEnabled: (sourceId, enabled) => {
					if (enabled) {
						this.enabledSources.add(sourceId);
					} else {
						this.enabledSources.delete(sourceId);
					}
					this.app.saveLocalStorage(SHADOW_ENABLED_KEY, [...this.enabledSources]);
				},
				startGeneration: async (sourceId) => {
					const source = this.sourceFor(sourceId);
					await this.jobs!.start(source, await this.taskConfig(source));
				},
				translateImported: async (sourceId) => {
					const source = this.sourceFor(sourceId);
					await this.jobs!.translateSubtitles(source, await this.taskConfig(source));
				},
			});
		}
	}

	bindPresenterWindow(win: Window | null): void {
		this.desktopWindow = win as (Window & { require?: (id: string) => unknown }) | null;
		if (this.activeRecorder && this.recorderWindow !== this.desktopWindow) {
			this.activeRecorder.dispose();
			this.activeRecorder = null;
		}
	}

	getFfmpegPath(): string {
		return this.ffmpegPath;
	}

	setFfmpegPath(path: string): void {
		this.ffmpegPath = path;
		this.app.saveLocalStorage(FFMPEG_PATH_KEY, path);
	}

	async pickVideos(options: {
		document: Document;
		strings: VideoPickStrings;
	}): Promise<readonly LocalVideoSource[]> {
		try {
			const picked = await pickLocalVideoSources(options.strings.addVideos, {
				document: options.document,
			});
			const identified = identifyShadowSources(
				this.sourceIds,
				picked,
				this.runtime.getSnapshot().sources,
			);
			this.app.saveLocalStorage(SOURCE_IDS_KEY, this.sourceIds);
			return identified;
		} catch (error) {
			console.error("Failed to select local videos:", error);
			this.reportNotice(options.strings.selectFailed);
			return [];
		}
	}

	async pickReplacement(options: {
		sourceId: string;
		document: Document;
		strings: VideoReplaceStrings;
	}): Promise<LocalVideoSource | null> {
		try {
			const [replacement] = await pickLocalVideoSources(options.strings.replace, {
				document: options.document,
			});
			if (replacement) {
				if (
					this.runtime
						.getSnapshot()
						.sources.some(
							(source) =>
								source.id !== options.sourceId && source.path === replacement.path,
						)
				) {
					return null;
				}
				const relinked = relinkShadowSource(this.sourceIds, options.sourceId, replacement);
				this.app.saveLocalStorage(SOURCE_IDS_KEY, this.sourceIds);
				return relinked;
			}
			return null;
		} catch (error) {
			console.error("Failed to replace a local video:", error);
			this.reportNotice(options.strings.selectFailed);
			return null;
		}
	}

	private requireModule(id: string): unknown {
		const req = this.desktopWindow?.require;
		if (!req) {
			throw new Error("影子跟读的音轨提取需要 Obsidian 桌面版。");
		}
		return req(id);
	}

	private getRecorder(): ShadowRecorderPort {
		if (!this.desktopWindow) {
			throw new Error("影子跟读录音需要 Obsidian 桌面窗口。");
		}
		if (this.activeRecorder && this.recorderWindow !== this.desktopWindow) {
			this.activeRecorder.dispose();
			this.activeRecorder = null;
		}
		if (!this.activeRecorder) {
			this.recorderWindow = this.desktopWindow;
			this.activeRecorder = createShadowRecorder(this.desktopWindow);
		}
		return this.activeRecorder;
	}

	private sourceFor(sourceId: string): ShadowVideoSource {
		const source = this.runtime.getSnapshot().sources.find((item) => item.id === sourceId);
		if (!source) {
			throw new Error("请先选择视频。");
		}
		return source;
	}

	private async serviceSignature(): Promise<string> {
		if (!this.services) return "";
		const settings = this.readSettings();
		const translationProfileId = this.services.getTranslationProfileId(
			settings.shadowTranslationProfileId,
		);
		return JSON.stringify({
			provider: settings.shadowTranscriptionProvider,
			transcription: await this.services.getTranscriptionSignature(
				settings.shadowTranscriptionProvider,
			),
			translationProfileId,
			translation: this.services.getTranslationSignature(translationProfileId),
		});
	}

	private async taskConfig(source: ShadowVideoSource) {
		return {
			sourceSignature: await shadowVideoSourceSignature(
				source.path,
				this.requireModule.bind(this),
			),
			serviceSignature: await this.serviceSignature(),
		};
	}

	dispose(): void {
		this.activeRecorder?.dispose();
		this.activeRecorder = null;
		this.shadowingSession?.dispose();
		this.jobs?.dispose();
	}
}
