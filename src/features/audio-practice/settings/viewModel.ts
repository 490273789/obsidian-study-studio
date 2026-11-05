import { defineSettings } from "../../../core/settings/presentation";
import type { Language } from "../../../core/shared/types";
import type { AudioPracticeSettings } from "./slice";
import { audioSettingsCopy } from "./copy";

/** One selectable speech-recognition engine from the shared AI registry. */
export interface AudioPracticeAsrEngine {
	readonly id: string;
	readonly name: string;
}

/**
 * Listening practice only selects an ASR engine; credentials, models and Base
 * URLs are edited in the shared AI engine section (ADR-0016).
 */
export function audioPracticeSettingsPresentation(
	settings: AudioPracticeSettings,
	engines: readonly AudioPracticeAsrEngine[],
	update: (patch: Partial<AudioPracticeSettings>) => Promise<void>,
	onOpenAiSettings: () => void,
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
			group.select(
				"engine",
				{ name: t.engineLabel, description: t.engineHint },
				{
					value: settings.transcriptionEngineId,
					options: [
						{ value: "", label: t.defaultEngine },
						...engines.map((engine) => ({ value: engine.id, label: engine.name })),
					],
					missingValueLabel: `${t.missingEngine}: ${settings.transcriptionEngineId}`,
					onChange: (transcriptionEngineId) => update({ transcriptionEngineId }),
				},
			);
			group.button(
				"open-ai-settings",
				{ name: t.manageHeading, description: t.manageHint },
				{
					label: t.openAiSettings,
					onPress: () => onOpenAiSettings(),
				},
			);
		});
	});
}
