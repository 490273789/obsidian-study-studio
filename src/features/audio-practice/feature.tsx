import React, { useEffect, useState, useSyncExternalStore } from "react";
import { TFile, type App } from "obsidian";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import { createReactItemView } from "../../core/host/reactItemView";
import type { WorkbenchModule } from "../../core/host/workbench";
import type { WorkbenchStore } from "../../core/storage/workbenchStore";
import type { OutboundPort } from "../../core/net/types";
import type { Language } from "../../core/shared/types";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { ModalProvider } from "../../core/ui/primitives/Modal";
import { AudioPracticeRuntime } from "./domain/audioPracticeRuntime";
import type { AudioMaterial } from "./domain/types";
import { AudioGenerationActions } from "./obsidian/generationActions";
import { createAudioPracticeRepository } from "./obsidian/repositoryAdapter";
import { createAudioPracticeFiles, listAudioPracticeFiles } from "./obsidian/vaultFiles";
import { SubtitleGeneration, normalizeGenerationDraft } from "./generation/subtitleGeneration";
import { createBrowserAudioPreparation } from "./generation/browserAudio";
import { createTranscriptionProvider } from "./generation/providers";
import { validateTranscriptionConfig } from "./generation/transcriptionConfig";
import type { TranscriptionConfig } from "./generation/types";
import { AudioPracticeView } from "./ui/AudioPracticeView";
import { audioSettingsCopy } from "./settings/copy";
import { audioPracticeSettingsPresentation } from "./settings/viewModel";
import type { AudioPracticeSettings } from "./settings/slice";

export const AUDIO_PRACTICE_VIEW = "study-studio-audio-practice";
const SECTION = "audio-practice";
const DRAFT_PREFIX = "study-studio.audio-practice.draft.";

/** Maps persisted settings onto the provider-specific transcription config. */
function transcriptionConfig(settings: AudioPracticeSettings): TranscriptionConfig {
	return settings.provider === "bailian"
		? {
				provider: "bailian",
				workspaceId: settings.bailianWorkspaceId.trim(),
				secretId: settings.bailianSecretId,
				model: settings.bailianModel.trim(),
			}
		: {
				provider: "openai-compatible",
				baseUrl: settings.openaiBaseUrl.trim(),
				secretId: settings.openaiSecretId,
				model: settings.openaiModel.trim(),
			};
}

export function createAudioPracticeFeature(deps: {
	store: WorkbenchStore;
	net: OutboundPort;
}): WorkbenchModule<"audioPractice"> {
	return defineFeatureLifetime({
		id: "audioPractice",
		start(host, lifetime) {
			const files = createAudioPracticeFiles(host.app);
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
			const generationActions = lifetime.own(
				new AudioGenerationActions({
					generation,
					readInput: async (material: AudioMaterial) => {
						const settings = readSettings();
						const config = transcriptionConfig(settings.audioPractice);
						// Fail before decoding or any paid request when the configured
						// service is incomplete.
						validateTranscriptionConfig(config);
						let secret: string | null = null;
						try {
							secret = deps.net.readSecret(config.secretId);
						} catch {
							secret = null;
						}
						if (!secret) throw new Error("请在设置中为字幕生成服务配置 API Key 密钥。");
						const current = runtime
							.getSnapshot()
							.materials.find((entry) => entry.id === material.id);
						if (!current) throw new Error(audioSettingsCopy(settings.language).missing);
						const file = host.app.vault.getAbstractFileByPath(current.audioPath);
						if (!(file instanceof TFile))
							throw new Error(audioSettingsCopy(settings.language).missing);
						if (file.stat.size > 50 * 1024 * 1024)
							throw new Error(
								settings.language === "en"
									? "Audio must be at most 50 MiB."
									: "生成字幕仅支持 50 MiB 以内的音频。",
							);
						const audio = await host.app.vault.readBinary(file);
						return {
							audio,
							name: file.name,
							taskKey: material.id,
							referenceText: current.originalText,
							config,
						};
					},
				}),
			);
			const onGenerate = (material: AudioMaterial, force = false) =>
				generationActions.run(material, force);
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
								generationActions.cancel();
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
									language={language}
									onReadText={(path) => files.readText(path)}
									onGenerate={onGenerate}
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
				icon: "headphones",
				openCommandId: "open-audio-practice",
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
					generationActions.cancel();
				}
			};
		},
	});
}

function AudioPracticeHost(props: {
	app: App;
	runtime: AudioPracticeRuntime;
	generation: SubtitleGeneration;
	language: Language;
	onReadText(path: string): Promise<string>;
	onGenerate(material: AudioMaterial, force?: boolean): Promise<void>;
	onOpenSettings(): void;
}) {
	const [paths, setPaths] = useState(() => listAudioPracticeFiles(props.app));
	const snapshot = useSyncExternalStore(props.runtime.subscribe, props.runtime.getSnapshot);
	const draft = useSyncExternalStore(props.generation.subscribe, props.generation.getSnapshot);
	const generating = ["preparing", "transcribing", "aligning"].includes(draft.status);
	useEffect(() => {
		const update = () => setPaths(listAudioPracticeFiles(props.app));
		const refs = [
			props.app.vault.on("create", update),
			props.app.vault.on("rename", update),
			props.app.vault.on("delete", update),
		];
		return () => refs.forEach((ref) => props.app.vault.offref(ref));
	}, [props.app]);
	useEffect(() => {
		if (
			!generating &&
			snapshot.currentMaterialId &&
			draft.taskKey !== snapshot.currentMaterialId
		)
			void props.generation.restore(snapshot.currentMaterialId).catch(() => {});
	}, [snapshot.currentMaterialId, props.generation, generating, draft.taskKey]);
	return (
		<AudioPracticeView
			{...props}
			{...paths}
			onSaveDraft={async (materialId) => {
				if (props.generation.getSnapshot().taskKey !== materialId)
					throw new Error(audioSettingsCopy(props.language).saving);
				const material = props.runtime
					.getSnapshot()
					.materials.find((item) => item.id === materialId);
				const file = material && props.app.vault.getAbstractFileByPath(material.audioPath);
				if (!material || !(file instanceof TFile))
					throw new Error(audioSettingsCopy(props.language).missing);
				const mtime = file.stat.mtime;
				const bytes = await props.app.vault.readBinary(file);
				const matches = await props.generation.matchesSource(bytes, material.originalText);
				const current = props.runtime
					.getSnapshot()
					.materials.find((item) => item.id === materialId);
				if (
					!matches ||
					props.generation.getSnapshot().taskKey !== materialId ||
					current?.audioPath !== material.audioPath ||
					current.originalText !== material.originalText ||
					file.stat.mtime !== mtime
				)
					throw new Error(audioSettingsCopy(props.language).sourceChanged);
				await props.runtime.saveSubtitles(materialId, props.generation.validatedCues());
			}}
		/>
	);
}
