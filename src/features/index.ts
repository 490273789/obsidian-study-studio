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
import {
	MediaSubtitlePipeline,
	type SubtitleTranslationPort,
} from "../core/media/subtitles/mediaSubtitlePipeline";
import { TranslationExecution } from "./translation/domain/translationExecution";
import { translateYoudao } from "./translation/domain/youdao";

export type { VideoShadowingCue, VideoShadowingServices };

export interface VideoShadowingServicesDeps {
	ai: AiService;
	store: WorkbenchStore;
	net: OutboundPort;
}

/**
 * Creates the video shadowing adapter combining the deep core media subtitle
 * pipeline and translation execution without borrowing feature-internal runtimes (ADR-0012).
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

	const translationPort: SubtitleTranslationPort = {
		getProfileId: (selected) => translation.prepare(selected, "en-zh").profileId,
		getSignature: (profileId) => translation.prepare(profileId, "en-zh").signature,
		listProfiles: () => translation.listProfiles(),
		translate: async (text, profileId, expectedSignature, signal) => {
			const output = await translation
				.prepare(profileId, "en-zh")
				.translate(text, signal ?? new AbortController().signal, expectedSignature);
			return output.text;
		},
	};

	return new MediaSubtitlePipeline({
		transcription,
		translation: translationPort,
	});
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
