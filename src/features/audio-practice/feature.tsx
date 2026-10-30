import { Headphones } from "lucide-react";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import { createReactItemView } from "../../core/host/reactItemView";
import type { WorkbenchModule } from "../../core/host/workbench";
import type { WorkbenchStore } from "../../core/storage/workbenchStore";
import type { OutboundPort } from "../../core/net/types";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { ModalProvider } from "../../core/ui/primitives/Modal";
import { AudioPracticeRuntime } from "./domain/audioPracticeRuntime";
import { SubtitleDraftEngine, normalizeGenerationDraft } from "./domain/subtitleDraftEngine";
import type { SubtitleTranscriptionPort } from "./domain/types";
import { createBrowserAudioPreparation } from "./domain/transcription/browserAudio";
import {
	MediaTranscriptionEngine,
	type MediaTranscriptionSettings,
} from "../../core/media/transcription/mediaTranscriptionEngine";
import { createAudioSourceFiles } from "./obsidian/audioSourceFiles";
import { createAudioPracticeRepository } from "./obsidian/repositoryAdapter";
import { createAudioPracticeCatalog, createAudioPracticeFiles } from "./obsidian/vaultFiles";
import { AudioPracticeView } from "./ui/AudioPracticeView";
import { audioPracticeStrings } from "./strings/audioPractice";
import { audioPracticeSettingsPresentation } from "./settings/viewModel";
import type { AudioPracticeSettings } from "./settings/slice";

export const AUDIO_PRACTICE_VIEW = "study-studio-audio-practice";
const SECTION = "audio-practice";
const DRAFT_PREFIX = "study-studio.audio-practice.draft.";

export function createAudioPracticeFeature(deps: {
	store: WorkbenchStore;
	net: OutboundPort;
}): WorkbenchModule<"audioPractice"> {
	return defineFeatureLifetime({
		id: "audioPractice",
		start(host, lifetime) {
			const files = createAudioPracticeFiles(host.app);
			const catalog = createAudioPracticeCatalog(host.app);
			const source = createAudioSourceFiles(host.app);
			let mediaWindow: Window = window;
			const readSettings = () => host.settings.read();
			const readMediaSettings = () => deps.store.getSettings().mediaTranscription;
			const openSettings = () => host.settingsTab.open(SECTION);

			const transcriptionEngine = new MediaTranscriptionEngine({
				readSettings: readMediaSettings,
				readSecret: (id) => deps.net.readSecret(id),
				outbound: deps.net,
			});
			const transcription: SubtitleTranscriptionPort = {
				getSignature: () => transcriptionEngine.getSignature(),
				transcribe: async (chunk, signal, expectedSignature) => {
					const result = await transcriptionEngine.transcribe({
						audio: chunk,
						signal,
						expectedSignature,
					});
					return {
						cues: [...result.cues],
						words: [...result.words],
					};
				},
			};

			let runtime!: AudioPracticeRuntime;
			const generation = lifetime.own(
				new SubtitleDraftEngine({
					prepare: createBrowserAudioPreparation(() => mediaWindow),
					transcription,
					source,
					commitSubtitles: (id, cues, timings) =>
						runtime.saveSubtitles(id, cues, timings),
					drafts: {
						load: async (key) =>
							normalizeGenerationDraft(host.app.loadLocalStorage(DRAFT_PREFIX + key)),
						save: async (draft) => {
							host.app.saveLocalStorage(DRAFT_PREFIX + draft.taskKey, draft);
						},
						remove: async (key) => {
							host.app.saveLocalStorage(DRAFT_PREFIX + key, null);
						},
					},
				}),
			);
			runtime = lifetime.own(
				new AudioPracticeRuntime({
					repository: createAudioPracticeRepository(deps.store),
					files,
					observer: {
						onMaterialSelected: (material) => generation.syncWithMaterial(material),
						onMaterialDiscarded: async (id) => generation.discard(id),
						onMaterialAudioChanged: () => generation.invalidateValidation(),
						isGenerating: (id) => {
							const snap = generation.getSnapshot();
							return (
								snap.taskKey === id &&
								["preparing", "transcribing", "aligning"].includes(snap.status)
							);
						},
					},
				}),
			);
			host.registerView(
				AUDIO_PRACTICE_VIEW,
				createReactItemView({
					type: AUDIO_PRACTICE_VIEW,
					icon: "headphones",
					title: (language) => audioPracticeStrings(language).title,
					readSettings,
					renderErrorMessage: (language) => audioPracticeStrings(language).error,
					acquire: ({ rootEl }) => {
						mediaWindow = rootEl.ownerDocument.defaultView ?? window;
						return {
							resource: undefined,
							dispose: () => {
								runtime.pause();
								generation.cancel();
							},
						};
					},
					render: ({ language, settings, rootEl }) =>
						settings.audioPractice.enabled ? (
							<ModalProvider host={rootEl}>
								<AudioPracticeView
									runtime={runtime}
									draftEngine={generation}
									files={files}
									catalog={catalog}
									language={language}
									onOpenSettings={openSettings}
								/>
							</ModalProvider>
						) : (
							<div className="fc-page fc-page__content">
								<p>{audioPracticeStrings(language).disabled}</p>
								<FlashcardButton onClick={openSettings}>
									{audioPracticeStrings(language).openSettings}
								</FlashcardButton>
							</div>
						),
				}),
			);
			host.catalog({
				id: SECTION,
				title: (language) => audioPracticeStrings(language).title,
				icon: Headphones,
				order: 30,
				openCommandId: "open-audio-practice",
				shortcutKey: "audioPractice",
				settingsSectionId: SECTION,
				available: () => readSettings().audioPractice.enabled,
				open: () => {
					void host.activateView(AUDIO_PRACTICE_VIEW, { mainTab: true });
				},
			});
			host.settingsSection({
				id: SECTION,
				order: 5,
				label: (language) => audioPracticeStrings(language).title,
				presentation: (language) => {
					const currentMedia = readMediaSettings();
					const combinedSettings: AudioPracticeSettings = {
						...readSettings().audioPractice,
						provider: currentMedia.provider,
						bailianWorkspaceId: currentMedia.bailianWorkspaceId,
						bailianWorkspaceSecretId: currentMedia.bailianWorkspaceSecretId,
						bailianSecretId: currentMedia.bailianSecretId,
						bailianModel: currentMedia.bailianModel,
						openaiBaseUrl: currentMedia.openaiBaseUrl,
						openaiSecretId: currentMedia.openaiSecretId,
						openaiModel: currentMedia.openaiModel,
					};
					return audioPracticeSettingsPresentation(
						combinedSettings,
						async (patch: Partial<AudioPracticeSettings>) => {
							const audioPatch: Partial<AudioPracticeSettings> = {};
							const mediaPatch: Partial<MediaTranscriptionSettings> = {};
							if ("enabled" in patch) audioPatch.enabled = patch.enabled;
							if ("provider" in patch) mediaPatch.provider = patch.provider;
							if ("bailianWorkspaceId" in patch)
								mediaPatch.bailianWorkspaceId = patch.bailianWorkspaceId;
							if ("bailianWorkspaceSecretId" in patch)
								mediaPatch.bailianWorkspaceSecretId =
									patch.bailianWorkspaceSecretId;
							if ("bailianSecretId" in patch)
								mediaPatch.bailianSecretId = patch.bailianSecretId;
							if ("bailianModel" in patch)
								mediaPatch.bailianModel = patch.bailianModel;
							if ("openaiBaseUrl" in patch)
								mediaPatch.openaiBaseUrl = patch.openaiBaseUrl;
							if ("openaiSecretId" in patch)
								mediaPatch.openaiSecretId = patch.openaiSecretId;
							if ("openaiModel" in patch) mediaPatch.openaiModel = patch.openaiModel;

							await host.settings.update({
								audioPractice: {
									...readSettings().audioPractice,
									...patch,
									...audioPatch,
								},
							});
							if (Object.keys(mediaPatch).length > 0) {
								const allSettings = deps.store.getSettings();
								await deps.store.saveSettings({
									...allSettings,
									mediaTranscription: {
										...allSettings.mediaTranscription,
										...mediaPatch,
									},
								});
							}
						},
						language,
					);
				},
			});
			return () => {
				if (!readSettings().audioPractice.enabled) {
					runtime.pause();
					generation.cancel();
				}
			};
		},
	});
}
