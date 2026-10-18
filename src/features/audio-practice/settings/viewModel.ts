import { defineSettings } from "../../../core/settings/presentation";
import type { Language } from "../../../core/shared/types";
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
			group.text(
				"workspace",
				{ name: t.workspace, description: t.workspaceHint },
				{
					value: settings.workspaceId,
					onChange: (workspaceId) => update({ workspaceId: workspaceId.trim() }),
				},
			);
			group.secret(
				"secret",
				{ name: t.secret, description: t.secretHint },
				{
					value: settings.secretId,
					onChange: (secretId) => update({ secretId }),
				},
			);
			group.row("explanation", { name: t.service, description: t.serviceHint }, () => {});
		});
	});
}
