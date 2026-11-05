import type { AiSnapshot } from "../../../core/ai";
import { translationSettingsStrings } from "../strings/settings";
import type { Language } from "../../../core/shared/types";
import type { TranslationProfile, TranslationSnapshot } from "../domain/types";
import {
	defineSettings,
	type SettingsActionResult,
	type SettingsPresentation,
} from "../../../core/settings/presentation";

export interface TranslationSettingsEditorState {
	snapshot: TranslationSnapshot;
	draft: TranslationSnapshot["settings"];
	aiSnapshot: AiSnapshot;
	saving: boolean;
}

export interface TranslationSettingsEditorActions {
	patch: (patch: Partial<TranslationSnapshot["settings"]>) => SettingsActionResult;
	patchProfile: (id: string, patch: Partial<TranslationProfile>) => SettingsActionResult;
	addProfile: () => SettingsActionResult;
	removeProfile: (id: string) => SettingsActionResult;
	moveProfile: (id: string, offset: -1 | 1) => SettingsActionResult;
	resetPrompt: () => SettingsActionResult;
	openAiSettings?: () => SettingsActionResult;
	save: () => SettingsActionResult;
}

export function buildTranslationSettingsViewModel(
	state: TranslationSettingsEditorState,
	actions: TranslationSettingsEditorActions,
	language: Language,
): SettingsPresentation {
	const t = translationSettingsStrings(language);
	const { draft, saving } = state;
	// Profiles may select any engine that is not speech recognition: LLM engines
	// translate through a prompt, translation engines call their provider's API.
	const engines = state.aiSnapshot.settings.engines.filter((engine) => engine.kind !== "asr");
	return defineSettings("translation", (page) => {
		page.group("general", t.generalHeading, (group) => {
			group.toggle(
				"enabled",
				{ name: t.enabled, description: t.enabledDesc },
				{
					value: draft.enabled,
					disabled: saving,
					onChange: (enabled) => actions.patch({ enabled }),
				},
			);
			group.toggle(
				"thinking",
				{ name: t.thinking, description: t.thinkingDesc },
				{
					value: draft.thinkingEnabled,
					disabled: saving,
					onChange: (thinkingEnabled) => actions.patch({ thinkingEnabled }),
				},
			);
		});

		page.group("profiles", t.profilesHeading, (group) => {
			group.button(
				"add",
				{ name: t.profiles, description: t.profilesDesc },
				{
					label: t.addProfile,
					disabled: saving,
					tone: "primary",
					onPress: actions.addProfile,
				},
			);
			group.cards(
				"profile-cards",
				{ name: "", layout: "wide" },
				{
					emptyText: t.profilesDesc,
					disabled: saving,
					items: draft.profiles.map((profile, index) => ({
						key: profile.id,
						badge: t.profile(index + 1),
						enabled: profile.enabled,
						build: (card) => {
							card.title("name", {
								value: profile.name,
								placeholder: t.profileNamePlaceholder,
								onChange: (name) => actions.patchProfile(profile.id, { name }),
							});
							card.toggle("enabled", {
								value: profile.enabled,
								tooltip: t.profileEnabled,
								onChange: (enabled) =>
									actions.patchProfile(profile.id, { enabled }),
							});
							card.action("move-up", {
								label: t.moveUp,
								icon: "move-up",
								disabled: index === 0,
								onPress: () => actions.moveProfile(profile.id, -1),
							});
							card.action("move-down", {
								label: t.moveDown,
								icon: "move-down",
								disabled: index === draft.profiles.length - 1,
								onPress: () => actions.moveProfile(profile.id, 1),
							});
							card.action("remove", {
								label: t.remove,
								icon: "remove",
								disabled: draft.profiles.length <= 1,
								onPress: () => actions.removeProfile(profile.id),
							});
							card.field(
								"engine",
								{
									name: t.engine,
									description: engines.length
										? t.engineSelectDesc
										: t.noEngineConfigs,
								},
								(row) => {
									row.select("engine", {
										value: profile.engineId,
										options: [
											{ value: "", label: t.selectEngine },
											...engines.map((engine) => ({
												value: engine.id,
												label: engine.name,
											})),
										],
										missingValueLabel: t.missingEngineConfig,
										onChange: (engineId) =>
											actions.patchProfile(profile.id, { engineId }),
									});
								},
							);
						},
					})),
				},
			);
		});

		page.group("prompt", t.promptHeading, (group) => {
			group.row("template", { name: t.prompt, description: t.promptDesc }, (row) => {
				row.textarea("template", {
					value: draft.promptTemplate,
					disabled: saving,
					onChange: (promptTemplate) => actions.patch({ promptTemplate }),
				});
				row.button("reset", {
					label: t.resetPrompt,
					disabled: saving,
					onPress: actions.resetPrompt,
				});
			});
		});
		if (actions.openAiSettings)
			page.group("connections", t.connectionsHeading, (group) => {
				group.button(
					"ai-engine-settings",
					{ name: t.connectionsName, description: t.connectionsDesc },
					{ label: t.openAiSettings, onPress: actions.openAiSettings! },
				);
			});

		page.group("save", t.saveHeading, (group) => {
			group.button(
				"save",
				{ name: t.save, description: t.saveDesc },
				{
					label: t.save,
					disabled: saving,
					tone: "primary",
					onPress: actions.save,
				},
			);
		});
	});
}
