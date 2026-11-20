import type { App } from "obsidian";
import type {
	VideoShadowingCue,
	SubtitlePipelineSignatureOptions,
} from "../../../core/media/subtitles/mediaSubtitlePipeline";
import { VideoSubtitleJobs } from "../domain/shadowSubtitlesJobs";
import type { ShadowRecorderPort } from "../domain/types";
import {
	createDesktopShadowAudioExtractor,
	shadowVideoSourceSignature,
} from "./shadowSubtitleAudio";
import { ObsidianShadowVaultStore } from "./shadowVaultStore";
import { createShadowRecorder } from "./shadowRecorder";
import type { VideoPlayerSettings } from "../settings/slice";
import { ShadowingWorkspaceSession } from "../domain/shadowingWorkspaceSession";
import { createBrowserTakeAudioPlayer } from "./browserTakeAudioPlayer";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";

const SHADOW_ENABLED_KEY = "study-studio.shadowing.enabled-sources.v1";
const FFMPEG_PATH_KEY = "study-studio.shadowing.ffmpeg-path.v1";

export type { VideoShadowingCue };

export interface VideoShadowingServices {
	transcribe(
		audio: ArrayBuffer,
		signature: string,
		signal?: AbortSignal,
	): Promise<readonly VideoShadowingCue[]>;
	translate(text: string, signature: string, signal?: AbortSignal): Promise<string>;
	getSignature(options: SubtitlePipelineSignatureOptions): Promise<string>;
	listTranslationProfiles(): { id: string; name: string }[];
}

export interface VideoShadowingDesktopAdapterOptions {
	readonly app: App;
	readonly readSettings: () => VideoPlayerSettings;
	readonly runtime: VideoPlayerRuntime;
	readonly services?: VideoShadowingServices;
	readonly initialWindow?: Window | null;
	readonly reportError?: (error: unknown) => void;
}

export class VideoShadowingDesktopAdapter {
	private readonly app: App;
	private readonly readSettings: () => VideoPlayerSettings;
	private readonly runtime: VideoPlayerRuntime;
	private readonly services?: VideoShadowingServices;
	private readonly reportError?: (error: unknown) => void;

	private readonly enabledSources: Set<string>;
	private ffmpegPath: string;

	private desktopWindow: (Window & { require?: (id: string) => unknown }) | null;
	private recorderWindow: Window | null = null;
	private activeRecorder: ShadowRecorderPort | null = null;

	private readonly jobs?: VideoSubtitleJobs;
	readonly shadowingSession?: ShadowingWorkspaceSession;

	constructor(options: VideoShadowingDesktopAdapterOptions) {
		this.app = options.app;
		this.readSettings = options.readSettings;
		this.runtime = options.runtime;
		this.services = options.services;
		this.reportError = options.reportError;

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

			const vaultStore = new ObsidianShadowVaultStore(
				this.app,
				() => this.readSettings().shadowVaultFolder,
			);

			this.jobs = new VideoSubtitleJobs({
				store: vaultStore,
				reportError: options.reportError,
				extract: (source, offset, signal) =>
					createDesktopShadowAudioExtractor({
						requireModule: this.requireModule.bind(this),
						ffmpegPath: this.ffmpegPath || undefined,
					})(source, offset, signal),
				sourceSignature: (source) =>
					shadowVideoSourceSignature(source.path, this.requireModule.bind(this)),
				serviceSignature: this.serviceSignature.bind(this),
				transcribe: (audio, task, signal) =>
					shadowing.transcribe(audio, task.config.serviceSignature, signal),
				translate: (text, task, signal) =>
					shadowing.translate(text, task.config.serviceSignature, signal),
			});

			this.shadowingSession = new ShadowingWorkspaceSession({
				runtime: this.runtime,
				jobs: this.jobs,
				recorder,
				records: vaultStore,
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
				reportDetachedFailure: (error) => {
					if (this.reportError) {
						this.reportError(error);
					} else {
						console.error("Video shadowing detached failure:", error);
					}
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

	private async serviceSignature(): Promise<string> {
		if (!this.services) return "";
		const settings = this.readSettings();
		return this.services.getSignature({
			transcriptionEngineId: settings.shadowTranscriptionEngineId,
			translationProfileId: settings.shadowTranslationProfileId,
		});
	}

	dispose(): void {
		this.activeRecorder?.dispose();
		this.activeRecorder = null;
		this.shadowingSession?.dispose();
		this.jobs?.dispose();
	}
}
