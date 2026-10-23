import type { Plugin } from "obsidian";
import type { AiService } from "../core/ai";
import { AiError } from "../core/ai";
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
import { renderTranslationPrompt } from "./translation/domain/configuration";

interface WorkbenchModuleDeps {
	ai: AiService;
	store: WorkbenchStore;
	plugin: Plugin;
	net: OutboundPort;
}

/** The composition seam borrows other features' configuration without sharing their runtimes. */
function createVideoShadowingServices(deps: WorkbenchModuleDeps): VideoShadowingServices {
	const transcribe = createTranscriptionProvider(deps.net);
	const fingerprint = (value: unknown): string => {
		const serialized = JSON.stringify(value);
		let hash = 2166136261;
		for (let index = 0; index < serialized.length; index++)
			hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
		return (hash >>> 0).toString(16);
	};
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
			return (
				selected.trim() ||
				deps.store.getSettings().translation.profiles.find((profile) => profile.enabled)
					?.id ||
				""
			);
		},
		getTranslationSignature(profileId) {
			if (!profileId) return "none";
			const settings = deps.store.getSettings().translation;
			const profile = settings.profiles.find((item) => item.id === profileId);
			return fingerprint({
				profile,
				promptTemplate: settings.promptTemplate,
				youdao: profile?.kind === "youdao" ? settings.youdao : undefined,
			});
		},
		listTranslationProfiles() {
			return deps.store
				.getSettings()
				.translation.profiles.filter((profile) => profile.enabled)
				.map(({ id, name }) => ({ id, name }));
		},
		async translate(text, profileId, signal) {
			const settings = deps.store.getSettings().translation;
			const profile = settings.profiles.find(
				(candidate) => candidate.id === profileId && candidate.enabled,
			);
			if (!profile) throw new AiError("config-not-found");
			const output =
				profile.kind === "youdao"
					? await translateYoudao(settings.youdao, text, "en-zh", deps.net, signal)
					: await deps.ai.generate({
							configId: profile.configId,
							thinkingEnabled: settings.thinkingEnabled,
							signal,
							messages: [
								{
									role: "system",
									text: renderTranslationPrompt(settings.promptTemplate, "en-zh"),
								},
								{ role: "user", text },
							],
						});
			return output.text;
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
