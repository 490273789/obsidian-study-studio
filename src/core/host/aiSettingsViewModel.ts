import { aiStrings } from "../i18n/ai";
import type { Language } from "../shared/types";
import type { AiEngineConfig, AiModel, AiProvider, AiSnapshot } from "../ai";
import {
	defineSettings,
	settingsKey,
	type SettingsActionResult,
	type SettingsPresentation,
	type SettingsRowBuilder,
} from "../settings/presentation";

export type AiViewMode = "list" | "form";

export interface AiEditorState {
	snapshot: AiSnapshot;
	draft: AiEngineConfig;
	models: readonly AiModel[];
	saving: boolean;
	view?: AiViewMode;
	draftIsNew?: boolean;
}
export interface AiEditorActions {
	select?: (id: string) => SettingsActionResult;
	add?: () => SettingsActionResult;
	toAdd?: () => SettingsActionResult;
	toEdit?: (id: string) => SettingsActionResult;
	back?: () => SettingsActionResult;
	selectModel: (model: string) => SettingsActionResult;
	patch: (patch: Partial<AiEngineConfig>) => SettingsActionResult;
	provider: (provider: AiProvider) => SettingsActionResult;
	setDefault: (id: string) => SettingsActionResult;
	save: () => SettingsActionResult;
	remove: (id?: string) => SettingsActionResult;
	loadModels: () => SettingsActionResult;
	test: () => SettingsActionResult;
}

export function buildAiSettingsViewModel(
	state: AiEditorState,
	actions: AiEditorActions,
	language: Language,
): SettingsPresentation {
	const t = aiStrings(language);
	const { draft, snapshot, saving, view = "list", draftIsNew = false } = state;
	const loading = snapshot.loadingModels.includes(draft.id);
	const testing = snapshot.testing.includes(draft.id);

	const text = (
		row: SettingsRowBuilder,
		field: "name" | "baseUrl" | "model",
		placeholder: string,
	) =>
		row.text(field, {
			value: draft[field],
			placeholder,
			disabled: saving,
			onChange: (value) => actions.patch({ [field]: value }),
		});
	const button = (
		row: SettingsRowBuilder,
		key: string,
		label: string,
		onClick: () => SettingsActionResult,
		disabled = saving,
		tone?: "neutral" | "warning",
	) => row.button(key, { label, onPress: onClick, disabled, tone });

	return defineSettings("ai-engines", (page) => {
		if (view === "list") {
			page.group("engines", t.heading, (group) => {
				group.select(
					"default",
					{ name: t.defaultConfig, description: t.defaultHelp },
					{
						value: snapshot.settings.defaultConfigId ?? "",
						disabled: saving,
						options: [
							{ value: "", label: t.none },
							...snapshot.settings.configs.map((config) => ({
								value: config.id,
								label: config.name,
							})),
						],
						onChange: actions.setDefault,
					},
				);
				group.button(
					"add",
					{ name: t.engineList, description: t.engineListDesc },
					{
						label: t.addEngine,
						disabled: saving,
						onPress: () => (actions.toAdd ? actions.toAdd() : actions.add?.()),
					},
				);

				if (snapshot.settings.configs.length === 0) {
					group.row("empty", { name: t.noConfigs, description: t.noConfigsDesc });
					return;
				}
				for (const config of snapshot.settings.configs) {
					const isDefault = config.id === snapshot.settings.defaultConfigId;
					const name = isDefault ? `${config.name} ${t.defaultBadge}` : config.name;
					const providerLabel = t[config.provider] ?? config.provider;
					group.row(
						`engine-${settingsKey(config.id)}`,
						{ name, description: `${providerLabel} · ${config.model || t.none}` },
						(row) => {
							button(row, "edit", t.edit, () =>
								actions.toEdit
									? actions.toEdit(config.id)
									: actions.select?.(config.id),
							);
							button(
								row,
								"delete",
								t.delete,
								() => actions.remove(config.id),
								saving,
								"warning",
							);
						},
					);
				}
			});
			return;
		}

		page.group(
			"engine-form",
			`${t.heading} - ${draftIsNew ? t.addEngineHeading : t.editEngineHeading}`,
			(group) => {
				group.button(
					"back",
					{ name: t.back, description: t.backDesc },
					{
						label: t.back,
						disabled: saving,
						onPress: () => actions.back?.(),
					},
				);
				group.row("name", { name: t.name }, (row) => text(row, "name", t.namePlaceholder));
				group.select(
					"provider",
					{ name: t.provider },
					{
						value: draft.provider,
						disabled: saving,
						options: (["deepseek", "bailian", "youdao"] as const).map((provider) => ({
							value: provider,
							label: t[provider],
						})),
						onChange: actions.provider,
					},
				);
				group.row("base-url", { name: t.baseUrl, description: t.baseHelp }, (row) =>
					text(row, "baseUrl", "https://…"),
				);
				group.secret(
					"secret",
					{ name: t.secret, description: t.secretHelp },
					{
						value: draft.secretId,
						disabled: saving,
						onChange: (secretId) => actions.patch({ secretId }),
					},
				);
				group.row("model", { name: t.model, description: t.modelHelp }, (row) =>
					text(row, "model", t.modelPlaceholder),
				);
				group.row("models", { name: t.modelList }, (row) => {
					button(
						row,
						"load",
						loading ? t.loading : t.loadModels,
						actions.loadModels,
						saving || loading,
					);
					if (state.models.length > 0) {
						row.select("available", {
							value: draft.model,
							disabled: saving,
							options: state.models.map((model) => ({
								value: model.id,
								label: `${model.id} (${t[model.imageInput]})`,
							})),
							missingValueLabel: draft.model || t.none,
							onChange: actions.selectModel,
						});
					}
				});
				group.button(
					"test",
					{ name: t.test, description: t.testHelp },
					{
						label: testing ? t.testing : t.test,
						disabled: saving || testing,
						onPress: actions.test,
					},
				);
				group.row("configuration", { name: t.configuration }, (row) => {
					button(row, "save", t.save, actions.save);
					button(row, "cancel", t.cancel, () => actions.back?.());
					if (!draftIsNew)
						button(
							row,
							"remove",
							t.remove,
							() => actions.remove(draft.id),
							saving,
							"warning",
						);
				});
			},
		);
	});
}
