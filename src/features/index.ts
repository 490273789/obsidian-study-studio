import type { Plugin } from "obsidian";
import type { AiEngineTesters, AiService, TranslationEngineConfig } from "../core/ai";
import type { WorkbenchStore } from "../core/storage/workbenchStore";
import type { AnyWorkbenchModule } from "../core/host/workbench";
import type { OutboundPort } from "../core/net";
import { createDictionaryFeature } from "./dictionary/feature";
import { createFlashcardFeature } from "./flashcards/feature";
import { createTranslationFeature } from "./translation/feature";
import { createSelectionHelperModule } from "../core/selectionHelper/module";
import {
	createVideoPlayerFeature,
	type VideoShadowingCue,
	type VideoShadowingServices,
} from "./video-player/feature";
import { createAudioPracticeFeature } from "./audio-practice/feature";
import { MediaFailureError } from "../core/media/failures";
import { MediaTranscriptionEngine } from "../core/media/transcription/mediaTranscriptionEngine";
import {
	TranslationConfigurationChangedError,
	TranslationExecution,
} from "./translation/domain/translationExecution";
import { translateYoudao } from "./translation/domain/youdao";

export type { VideoShadowingCue, VideoShadowingServices };

export interface VideoShadowingServicesDeps {
	ai: AiService;
	store: WorkbenchStore;
	net: OutboundPort;
}

export interface VideoShadowingServiceComponents {
	readonly transcription: Pick<MediaTranscriptionEngine, "transcribe" | "getSignature">;
	readonly translation: Pick<
		TranslationExecution,
		"getProfileId" | "getSignature" | "listProfiles" | "translate"
	>;
}

interface SerializedShadowingSignature {
	v: 2;
	e: string;
	ts: string;
	tp: string;
	tls: string;
}

function decodeShadowingSignature(signature: string): SerializedShadowingSignature | null {
	try {
		const parsed = JSON.parse(signature) as Partial<SerializedShadowingSignature> | null;
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.v === 2 &&
			typeof parsed.e === "string" &&
			typeof parsed.ts === "string"
		) {
			return {
				v: 2,
				e: parsed.e,
				ts: parsed.ts,
				tp: typeof parsed.tp === "string" ? parsed.tp : "",
				tls: typeof parsed.tls === "string" ? parsed.tls : "",
			};
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Composes video shadowing transcription and translation from `MediaTranscriptionEngine`
 * and `TranslationExecution` directly inside the cross-feature composition module.
 */
export function assembleVideoShadowingServices(
	components: VideoShadowingServiceComponents,
): VideoShadowingServices {
	return {
		async getSignature(options): Promise<string> {
			const engineId = options.transcriptionEngineId;
			const transcriptionSig = await components.transcription.getSignature(engineId);
			const profileId = components.translation.getProfileId(
				options.translationProfileId ?? "",
			);
			const translationSig = profileId ? components.translation.getSignature(profileId) : "";
			const signature: SerializedShadowingSignature = {
				v: 2,
				e: engineId,
				ts: transcriptionSig,
				tp: profileId,
				tls: translationSig,
			};
			return JSON.stringify(signature);
		},

		async transcribe(
			audio: ArrayBuffer,
			signature: string,
			signal?: AbortSignal,
		): Promise<readonly VideoShadowingCue[]> {
			const parsed = decodeShadowingSignature(signature);
			if (!parsed) {
				throw new Error("转写配置已变化，请重新生成字幕。");
			}
			const currentTransSig = await components.transcription.getSignature(parsed.e);
			if (currentTransSig !== parsed.ts) {
				throw new Error("转写配置已变化，请重新生成字幕。");
			}
			try {
				const result = await components.transcription.transcribe({
					audio,
					engineId: parsed.e,
					expectedSignature: parsed.ts,
					signal,
				});
				return result.cues.flatMap((cue) =>
					cue.start !== null && cue.end !== null
						? [{ start: cue.start, end: cue.end, text: cue.text }]
						: [],
				);
			} catch (error) {
				if (error instanceof MediaFailureError && error.failure.kind === "config-drift") {
					throw new Error("转写配置已变化，请重新生成字幕。");
				}
				throw error;
			}
		},

		async translate(text: string, signature: string, signal?: AbortSignal): Promise<string> {
			const parsed = decodeShadowingSignature(signature);
			if (!parsed) {
				throw new Error("翻译配置已变化，请重新生成字幕。");
			}
			if (!parsed.tp) {
				throw new Error("请在影子跟读设置中启用翻译配置。");
			}
			const currentTransSig = components.translation.getSignature(parsed.tp);
			if (currentTransSig !== parsed.tls) {
				throw new Error("翻译配置已变化，请重新生成字幕。");
			}
			try {
				const output = await components.translation.translate(text, {
					profileId: parsed.tp,
					expectedSignature: parsed.tls,
					signal,
				});
				return output.text;
			} catch (error) {
				if (
					error instanceof TranslationConfigurationChangedError ||
					(error instanceof MediaFailureError && error.failure.kind === "config-drift")
				) {
					throw new Error("翻译配置已变化，请重新生成字幕。");
				}
				throw error;
			}
		},

		listTranslationProfiles(): { id: string; name: string }[] {
			return components.translation.listProfiles();
		},
	};
}

/**
 * Creates the video shadowing adapter combining `MediaTranscriptionEngine` and
 * `TranslationExecution` without borrowing feature-internal runtimes (ADR-0012).
 * Both halves read the shared AI engine registry (ADR-0016): ASR engines for
 * transcription, LLM/translation engines for translation.
 */
export function createVideoShadowingServices(
	deps: VideoShadowingServicesDeps,
): VideoShadowingServices {
	const transcription = new MediaTranscriptionEngine({
		readRegistry: () => deps.store.getSettings().ai,
		resolveEngineId: () => deps.store.getSettings().videoPlayer.shadowTranscriptionEngineId,
		readSecret: (id) => deps.net.readSecret(id),
		outbound: deps.net,
	});
	const translation = new TranslationExecution({
		ai: deps.ai,
		readSettings: () => deps.store.getSettings().translation,
		defaultDirection: "en-zh",
		youdao: (engine, text, direction, signal) =>
			translateYoudao(
				{
					baseUrl: engine.baseUrl,
					appKeySecretId: engine.appKeySecretId,
					appSecretSecretId: engine.appSecretSecretId,
				},
				text,
				direction,
				deps.net,
				signal,
			),
	});

	return assembleVideoShadowingServices({ transcription, translation });
}

/**
 * Narrow connection testers for non-LLM engines injected into the shared AI
 * service by the composition root (ADR-0016). The engine settings page never
 * imports a feature runtime to test a translation connection.
 */
export function createAiEngineTesters(deps: { net: OutboundPort }): AiEngineTesters {
	return {
		async translation(engine: TranslationEngineConfig): Promise<void> {
			await translateYoudao(
				{
					baseUrl: engine.baseUrl,
					appKeySecretId: engine.appKeySecretId,
					appSecretSecretId: engine.appSecretSecretId,
				},
				"你好",
				"zh-en",
				deps.net,
			);
		},
	};
}

interface WorkbenchModuleDeps {
	ai: AiService;
	store: WorkbenchStore;
	plugin: Plugin;
	net: OutboundPort;
}

/**
 * The single composition module for the workbench: it lists every feature and
 * explicitly hands each one the shared services it needs. The composition root
 * imports only this module, so it never has to know a feature's name.
 */
export function createWorkbenchModules(deps: WorkbenchModuleDeps): AnyWorkbenchModule[] {
	const flashcards = createFlashcardFeature({
		store: deps.store,
		net: deps.net,
		plugin: deps.plugin,
	});
	const translation = createTranslationFeature({ ai: deps.ai, net: deps.net });
	const dictionary = createDictionaryFeature({
		ai: deps.ai,
		net: deps.net,
		plugin: deps.plugin,
		sourceEdits: flashcards.sourceEditAdapter,
	});
	const videoPlayer = createVideoPlayerFeature({
		ai: deps.ai,
		shadowing: createVideoShadowingServices(deps),
	});
	const audioPractice = createAudioPracticeFeature({
		ai: deps.ai,
		store: deps.store,
		net: deps.net,
	});

	const selectionHelper = createSelectionHelperModule({
		actions: [dictionary.selectionAction, translation.selectionAction],
		slots: {
			dictionary: dictionary.renderLookupSlot,
		},
		dictionarySources: dictionary.sources,
	});

	return [flashcards, translation, dictionary, videoPlayer, audioPractice, selectionHelper];
}
