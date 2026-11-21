import type { Plugin } from "obsidian";
import type { AiEngineTesters, AiService, TranslationEngineConfig } from "../core/ai";
import type { WorkbenchStore } from "../core/storage/workbenchStore";
import type { AnyWorkbenchModule } from "../core/host/workbench";
import type { OutboundPort } from "../core/net";
import { createDictionaryFeature } from "./dictionary/feature";
import { createFlashcardFeature } from "./flashcards/feature";
import { createTranslationFeature } from "./translation/feature";
import { createSelectionHelperModule } from "../core/selectionHelper/module";
import { createVideoPlayerFeature, type VideoShadowingServices } from "./video-player/feature";
import { createAudioPracticeFeature } from "./audio-practice/feature";
import { MediaTranscriptionEngine } from "../core/media/transcription/mediaTranscriptionEngine";
import {
	TranslationConfigurationChangedError,
	TranslationExecution,
} from "./translation/domain/translationExecution";
import { translateYoudao } from "./translation/domain/youdao";
import { assembleVideoShadowingServices } from "./video-player/domain/shadowingServices";

interface VideoShadowingServicesDeps {
	ai: AiService;
	store: WorkbenchStore;
	net: OutboundPort;
}

/**
 * Creates the video shadowing adapter combining `MediaTranscriptionEngine` and
 * `TranslationExecution` without borrowing feature-internal runtimes (ADR-0012).
 * Both halves read the shared AI engine registry (ADR-0016): ASR engines for
 * transcription, LLM/translation engines for translation.
 */
function createVideoShadowingServices(deps: VideoShadowingServicesDeps): VideoShadowingServices {
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

	return assembleVideoShadowingServices({
		transcription,
		translation,
		isTranslationConfigChanged: (error) =>
			error instanceof TranslationConfigurationChangedError,
	});
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
