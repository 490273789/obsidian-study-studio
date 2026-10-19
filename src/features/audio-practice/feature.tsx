import React, { useEffect, useState } from "react";
import type { App } from "obsidian";
import { Headphones } from "lucide-react";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import { createReactItemView } from "../../core/host/reactItemView";
import type { WorkbenchModule } from "../../core/host/workbench";
import type { WorkbenchStore } from "../../core/storage/workbenchStore";
import type { OutboundPort } from "../../core/net/types";
import type { Language } from "../../core/shared/types";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { ModalProvider } from "../../core/ui/primitives/Modal";
import { AudioPracticeRuntime } from "./domain/audioPracticeRuntime";
import { SubtitleGeneration, normalizeGenerationDraft } from "./generation/subtitleGeneration";
import type { SubtitleWorkflowMessages } from "./generation/subtitleWorkflow";
import { SubtitleWorkflow } from "./generation/subtitleWorkflow";
import { createBrowserAudioPreparation } from "./generation/browserAudio";
import { createTranscriptionProvider } from "./generation/providers";
import { createAudioSourceFiles } from "./obsidian/audioSourceFiles";
import { createAudioPracticeRepository } from "./obsidian/repositoryAdapter";
import { createAudioPracticeFiles, listAudioPracticeFiles } from "./obsidian/vaultFiles";
import { AudioPracticeView } from "./ui/AudioPracticeView";
import { audioSettingsCopy } from "./settings/copy";
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
			const source = createAudioSourceFiles(host.app);
			const runtime = lifetime.own(
				new AudioPracticeRuntime(createAudioPracticeRepository(deps.store), files),
			);
			let mediaWindow: Window = window;
			const generation = lifetime.own(
				new SubtitleGeneration({
					prepare: createBrowserAudioPreparation(() => mediaWindow),
					transcribe: createTranscriptionProvider(deps.net),
					drafts: {
						load: async (key) =>
							normalizeGenerationDraft(host.app.loadLocalStorage(DRAFT_PREFIX + key)),
						save: async (draft) => {
							host.app.saveLocalStorage(DRAFT_PREFIX + draft.taskKey, draft);
						},
					},
				}),
			);
			const readSettings = () => host.settings.read();
			const openSettings = () => host.settingsTab.open(SECTION);
			const messages: SubtitleWorkflowMessages = {
				missing: () => audioSettingsCopy(readSettings().language).missing,
				saving: () => audioSettingsCopy(readSettings().language).saving,
				sourceChanged: () => audioSettingsCopy(readSettings().language).sourceChanged,
				tooLarge: () => audioSettingsCopy(readSettings().language).tooLarge,
				configMissing: () => audioSettingsCopy(readSettings().language).configMissing,
				failed: () => audioSettingsCopy(readSettings().language).failed,
			};
			const workflow = lifetime.own(
				new SubtitleWorkflow({
					runtime,
					generation,
					settings: {
						read: () => readSettings().audioPractice,
						readSecret: (id) => {
							try {
								return deps.net.readSecret(id);
							} catch {
								return null;
							}
						},
					},
					source,
					messages,
				}),
			);
			host.registerView(
				AUDIO_PRACTICE_VIEW,
				createReactItemView({
					type: AUDIO_PRACTICE_VIEW,
					icon: "headphones",
					title: (language) => audioSettingsCopy(language).title,
					readSettings,
					renderErrorMessage: (language) => audioSettingsCopy(language).error,
					acquire: ({ rootEl }) => {
						mediaWindow = rootEl.ownerDocument.defaultView ?? window;
						return {
							resource: undefined,
							dispose: () => {
								runtime.pause();
								workflow.cancel();
							},
						};
					},
					render: ({ language, settings, rootEl }) =>
						settings.audioPractice.enabled ? (
							<ModalProvider host={rootEl}>
								<AudioPracticeHost
									app={host.app}
									runtime={runtime}
									generation={generation}
									workflow={workflow}
									language={language}
									onReadText={(path) => files.readText(path)}
									onOpenSettings={openSettings}
								/>
							</ModalProvider>
						) : (
							<div className="fc-page">
								<p>{audioSettingsCopy(language).disabled}</p>
								<FlashcardButton onClick={openSettings}>
									{audioSettingsCopy(language).openSettings}
								</FlashcardButton>
							</div>
						),
				}),
			);
			host.catalog({
				id: SECTION,
				title: (language) => audioSettingsCopy(language).title,
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
				label: (language) => audioSettingsCopy(language).title,
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
					workflow.cancel();
				}
			};
		},
	});
}

function AudioPracticeHost(props: {
	app: App;
	runtime: AudioPracticeRuntime;
	generation: SubtitleGeneration;
	workflow: SubtitleWorkflow;
	language: Language;
	onReadText(path: string): Promise<string>;
	onOpenSettings(): void;
}) {
	const [paths, setPaths] = useState(() => listAudioPracticeFiles(props.app));
	useEffect(() => {
		const update = () => setPaths(listAudioPracticeFiles(props.app));
		const refs = [
			props.app.vault.on("create", update),
			props.app.vault.on("rename", update),
			props.app.vault.on("delete", update),
		];
		return () => refs.forEach((ref) => props.app.vault.offref(ref));
	}, [props.app]);
	return <AudioPracticeView {...props} {...paths} />;
}
