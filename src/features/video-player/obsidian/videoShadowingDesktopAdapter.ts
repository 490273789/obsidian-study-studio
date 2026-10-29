import type { App } from "obsidian";
import { VideoSubtitleJobs, type ShadowVideoSource } from "../domain/shadowSubtitlesJobs";
import type { ShadowRecorderPort } from "../domain/shadowingSession";
import {
	createDesktopShadowAudioExtractor,
	shadowVideoSourceSignature,
} from "./shadowSubtitleAudio";
import { ShadowStorageRouter } from "./shadowStorageRouter";
import { ShadowPracticeRecords } from "./shadowPracticeRecords";
import { createShadowRecorder } from "./shadowRecorder";
import type { VideoPlayerSettings } from "../settings/slice";
import { ShadowingWorkspaceSession } from "../domain/shadowingWorkspaceSession";
import { createBrowserTakeAudioPlayer } from "./browserTakeAudioPlayer";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";

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
}

export class VideoShadowingDesktopAdapter {
	private readonly app: App;
	private readonly readSettings: () => VideoPlayerSettings;
	private readonly runtime: VideoPlayerRuntime;
	private readonly services?: VideoShadowingServices;

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
