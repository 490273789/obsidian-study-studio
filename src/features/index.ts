import type { Plugin } from "obsidian";
import type { AiService } from "../core/ai";
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
import { MediaTranscriptionEngine } from "../core/media/transcription/mediaTranscriptionEngine";
import { MediaFailureError } from "../core/media/failures";
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

/**
 * Creates the video shadowing adapter combining the deep core media transcription
 * engine and translation execution without borrowing feature-internal runtimes (ADR-0012).
 */
export function createVideoShadowingServices(
	deps: VideoShadowingServicesDeps,
): VideoShadowingServices {
	const transcription = new MediaTranscriptionEngine({
		readSettings: () => deps.store.getSettings().mediaTranscription,
		readSecret: (id) => deps.net.readSecret(id),
		outbound: deps.net,
	});
	const translation = new TranslationExecution({
		ai: deps.ai,
		readSettings: () => deps.store.getSettings().translation,
		youdao: (connection, text, direction, signal) =>
			translateYoudao(connection, text, direction, deps.net, signal),
	});

	return {
		async transcribe(audio, provider, signature, signal) {
			try {
				const result = await transcription.transcribe({
					audio,
					provider,
					expectedSignature: signature,
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
		getTranscriptionSignature(provider) {
			return transcription.getSignature(provider);
		},
		getTranslationProfileId(selected) {
			return translation.prepare(selected, "en-zh").profileId;
		},
		getTranslationSignature(profileId) {
			return translation.prepare(profileId, "en-zh").signature;
		},
		listTranslationProfiles() {
			return translation.listProfiles();
		},
		async translate(text, profileId, signature, signal) {
			try {
				const output = await translation
					.prepare(profileId, "en-zh")
					.translate(text, signal, signature);
				return output.text;
			} catch (error) {
				if (error instanceof TranslationConfigurationChangedError) {
					throw new Error("翻译配置已变化，请重新生成字幕。");
				}
				throw error;
			}
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
		shadowing: createVideoShadowingServices(deps),
	});
	const audioPractice = createAudioPracticeFeature({ store: deps.store, net: deps.net });

	const selectionHelper = createSelectionHelperModule({
		actions: [dictionary.selectionAction, translation.selectionAction],
		slots: {
			dictionary: dictionary.renderLookupSlot,
		},
		dictionary: {
			sources: dictionary.sources,
		},
		renderLookupSlot: dictionary.renderLookupSlot,
		translation: translation.selectionAdapter,
	});

	return [flashcards, translation, dictionary, videoPlayer, audioPractice, selectionHelper];
}
