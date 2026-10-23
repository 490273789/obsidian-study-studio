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
import { createBrowserAudioPreparation } from "./domain/transcription/browserAudio";
import { createTranscriptionProvider } from "./domain/transcription/providers";
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
			const generation = lifetime.own(
				new SubtitleDraftEngine({
					prepare: createBrowserAudioPreparation(() => mediaWindow),
					transcribe: createTranscriptionProvider(deps.net),
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
			const readSettings = () => host.settings.read();
			const openSettings = () => host.settingsTab.open(SECTION);
			const runtime = lifetime.own(
				new AudioPracticeRuntime({
					repository: createAudioPracticeRepository(deps.store),
					files,
					source,
					settings: {
						read: () => readSettings().audioPractice,
						readSecret: (id) => deps.net.readSecret(id),
					},
					generation,
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
								runtime.cancelSubtitleGeneration();
							},
						};
					},
					render: ({ language, settings, rootEl }) =>
						settings.audioPractice.enabled ? (
							<ModalProvider host={rootEl}>
								<AudioPracticeView
									runtime={runtime}
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
				presentation: (language) =>
					audioPracticeSettingsPresentation(
						readSettings().audioPractice,
						async (patch: Partial<AudioPracticeSettings>) => {
							await host.settings.update({
								audioPractice: { ...readSettings().audioPractice, ...patch },
							});
						},
						language,
					),
			});
			return () => {
				if (!readSettings().audioPractice.enabled) {
					runtime.pause();
					runtime.cancelSubtitleGeneration();
				}
			};
		},
	});
}
