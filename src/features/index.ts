import type { Plugin } from "obsidian";
import type { AiService } from "../core/ai";
import { createTranscriptionProvider } from "../core/media/transcription/providers";
import { transcriptionConfigFingerprint } from "../core/media/transcription/transcriptionConfig";
import type { TranscriptionConfig } from "../core/media/transcriptionTypes";
import type { WorkbenchStore } from "../core/storage/workbenchStore";
import type { AnyWorkbenchModule } from "../core/host/workbench";
import type { OutboundPort } from "../core/net";
import { createDictionaryFeature } from "./dictionary/feature";
import { SelectionDictionaryResultContent } from "./dictionary/ui/SelectionDictionaryResultContent";
import { createFlashcardFeature } from "./flashcards/feature";
import { createTranslationFeature } from "./translation/feature";
import { createSelectionHelperModule } from "../core/selectionHelper/module";
import { createVideoPlayerFeature, type VideoShadowingServices } from "./video-player/feature";
import { createAudioPracticeFeature } from "./audio-practice/feature";
import { translateYoudao } from "./translation/domain/youdao";
import {
	TranslationConfigurationChangedError,
	TranslationExecution,
} from "./translation/domain/translationExecution";

interface WorkbenchModuleDeps {
	ai: AiService;
	store: WorkbenchStore;
	plugin: Plugin;
	net: OutboundPort;
}

/** The composition seam borrows other features' configuration without sharing their runtimes. */
function createVideoShadowingServices(deps: WorkbenchModuleDeps): VideoShadowingServices {
	const transcribe = createTranscriptionProvider(deps.net);
	const translation = new TranslationExecution({
		ai: deps.ai,
		readSettings: () => deps.store.getSettings().translation,
		youdao: (connection, text, direction, signal) =>
			translateYoudao(connection, text, direction, deps.net, signal),
	});
	const readConfig = (provider: "bailian" | "openai-compatible"): TranscriptionConfig => {
		const settings = deps.store.getSettings().audioPractice;
		if (provider === "openai-compatible") {
			return {
				provider,
				baseUrl: settings.openaiBaseUrl,
				secretId: settings.openaiSecretId,
				model: settings.openaiModel,
			};
		}
		let workspaceId = settings.bailianWorkspaceId;
		if (settings.bailianWorkspaceSecretId) {
			try {
				workspaceId = deps.net.readSecret(settings.bailianWorkspaceSecretId) ?? "";
			} catch {
				workspaceId = "";
			}
		}
		return {
			provider,
			workspaceId: workspaceId.trim(),
			secretId: settings.bailianSecretId,
			model: settings.bailianModel,
		};
	};
	return {
		async transcribe(audio, provider, signal) {
			const transcript = await transcribe(
				{ index: 0, start: 0, end: 0, wav: audio },
				readConfig(provider),
				signal,
			);
			return transcript.cues.flatMap((cue) =>
				cue.start !== null &&
				cue.end !== null &&
				Number.isFinite(cue.start) &&
				Number.isFinite(cue.end) &&
				cue.start >= 0 &&
				cue.end > cue.start &&
				cue.text.trim()
					? [{ start: cue.start, end: cue.end, text: cue.text.trim() }]
					: [],
			);
		},
		getTranscriptionSignature(provider) {
			return transcriptionConfigFingerprint(readConfig(provider));
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
				if (error instanceof TranslationConfigurationChangedError)
					throw new Error("翻译配置已变化，请重新生成字幕。");
				throw error;
			}
		},
	};
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
	const videoPlayer = createVideoPlayerFeature({ shadowing: createVideoShadowingServices(deps) });
	const audioPractice = createAudioPracticeFeature({ store: deps.store, net: deps.net });

	const selectionHelper = createSelectionHelperModule({
		dictionary: dictionary.selectionAdapter,
		renderResultContent: SelectionDictionaryResultContent,
		translation: translation.selectionAdapter,
	});

	return [flashcards, translation, dictionary, videoPlayer, audioPractice, selectionHelper];
}
