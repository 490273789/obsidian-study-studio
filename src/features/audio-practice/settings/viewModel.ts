import { defineSettings } from "../../../core/settings/presentation";
import type { Language } from "../../../core/shared/types";
import type { TranscriptionProviderId } from "../domain/transcriptionTypes";
import type { AudioPracticeSettings } from "./slice";
import { audioSettingsCopy } from "./copy";

export function audioPracticeSettingsPresentation(
	settings: AudioPracticeSettings,
	update: (patch: Partial<AudioPracticeSettings>) => Promise<void>,
	language: Language,
) {
	const t = audioSettingsCopy(language);
	return defineSettings("audio-practice", (page) => {
		page.group("general", t.title, (group) => {
			group.toggle(
				"enabled",
				{ name: t.enabled },
				{
					value: settings.enabled,
					onChange: (enabled) => update({ enabled }),
				},
			);
		});
		page.group("service", t.service, (group) => {
			group.select<TranscriptionProviderId>(
				"provider",
				{ name: t.provider, description: t.providerHint },
				{
					value: settings.provider,
					options: [
						{ value: "bailian", label: t.providerBailian },
						{ value: "openai-compatible", label: t.providerOpenAi },
					],
					onChange: (provider) => update({ provider }),
				},
			);
			if (settings.provider === "bailian") {
				group.text(
					"workspace",
					{ name: t.workspace, description: t.workspaceHint },
					{
						value: settings.bailianWorkspaceId,
						onChange: (bailianWorkspaceId) =>
							update({ bailianWorkspaceId: bailianWorkspaceId.trim() }),
					},
				);
				group.select(
					"model",
					{ name: t.bailianModel, description: t.bailianModelHint },
					{
						value: settings.bailianModel,
						options: [
							{
								value: "fun-asr-flash-2026-06-15",
								label: "fun-asr-flash-2026-06-15",
							},
							{
								value: "qwen-audio-3.1-asr-flash",
								label: "qwen-audio-3.1-asr-flash",
							},
							{
								value: "qwen-audio-3.0-asr-flash",
								label: "qwen-audio-3.0-asr-flash",
							},
						],
						missingValueLabel: `${t.bailianLegacyModel}: ${settings.bailianModel}`,
						onChange: (bailianModel) => update({ bailianModel }),
					},
				);
				group.secret(
					"secret",
					{ name: t.bailianSecret, description: t.bailianSecretHint },
					{
						value: settings.bailianSecretId,
						onChange: (bailianSecretId) => update({ bailianSecretId }),
					},
				);
				group.row(
					"explanation",
					{ name: t.service, description: t.bailianServiceHint },
					() => {},
				);
				return;
			}
			group.text(
				"base-url",
				{ name: t.baseUrl, description: t.baseUrlHint },
				{
					value: settings.openaiBaseUrl,
					placeholder: "https://api.openai.com/v1",
					onChange: (openaiBaseUrl) => update({ openaiBaseUrl: openaiBaseUrl.trim() }),
				},
			);
			group.text(
				"model",
				{ name: t.openaiModel, description: t.openaiModelHint },
				{
					value: settings.openaiModel,
					onChange: (openaiModel) => update({ openaiModel: openaiModel.trim() }),
				},
			);
			group.secret(
				"secret",
				{ name: t.openaiSecret, description: t.openaiSecretHint },
				{
					value: settings.openaiSecretId,
					onChange: (openaiSecretId) => update({ openaiSecretId }),
				},
			);
			group.row(
				"explanation",
				{ name: t.service, description: t.openaiServiceHint },
				() => {},
			);
		});
	});
}
