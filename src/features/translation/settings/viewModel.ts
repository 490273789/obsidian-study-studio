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
	save: () => SettingsActionResult;
	testYoudao: () => SettingsActionResult;
}

export function buildTranslationSettingsViewModel(
	state: TranslationSettingsEditorState,
	actions: TranslationSettingsEditorActions,
	language: Language,
): SettingsPresentation {
	const t = translationSettingsStrings(language);
	const { draft, saving, snapshot } = state;
	const aiConfigs = state.aiSnapshot.settings.configs.filter(
		(config) => config.provider === "deepseek" || config.provider === "bailian",
	);
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
							card.field("provider", { name: t.provider }, (row) => {
								row.select("kind", {
									value: profile.kind,
									options: [
										{ value: "engine", label: t.engine },
										{ value: "youdao", label: t.youdao },
									],
									onChange: (kind) => actions.patchProfile(profile.id, { kind }),
								});
							});
							if (profile.kind === "engine") {
								card.field(
									"engine",
									{
										name: t.engineConfig,
										description: aiConfigs.length
											? undefined
											: t.noEngineConfigs,
									},
									(row) => {
										row.select("config", {
											value: profile.configId,
											options: [
												{ value: "", label: t.selectEngine },
												...aiConfigs.map((config) => ({
													value: config.id,
													label: config.name,
												})),
											],
											missingValueLabel: t.missingEngineConfig,
											onChange: (configId) =>
												actions.patchProfile(profile.id, { configId }),
										});
									},
								);
							}
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

		page.group("youdao", t.youdaoHeading, (group) => {
			group.text(
				"endpoint",
				{ name: t.youdaoEndpoint, description: t.youdaoEndpointDesc },
				{
					value: draft.youdao.baseUrl,
					placeholder: t.youdaoEndpointPlaceholder,
					disabled: saving,
					onChange: (baseUrl) => actions.patch({ youdao: { ...draft.youdao, baseUrl } }),
				},
			);
			group.secret(
				"app-key",
				{ name: t.youdaoAppKey },
				{
					value: draft.youdao.appKeySecretId,
					disabled: saving,
					onChange: (appKeySecretId) =>
						actions.patch({ youdao: { ...draft.youdao, appKeySecretId } }),
				},
			);
			group.secret(
				"app-secret",
				{ name: t.youdaoAppSecret },
				{
					value: draft.youdao.appSecretSecretId,
					disabled: saving,
					onChange: (appSecretSecretId) =>
						actions.patch({ youdao: { ...draft.youdao, appSecretSecretId } }),
				},
			);
			group.button(
				"test",
				{ name: t.testYoudao, description: t.testYoudaoDesc },
				{
					label: snapshot.testing ? t.testing : t.testYoudao,
					disabled: saving || snapshot.testing,
					onPress: actions.testYoudao,
				},
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
