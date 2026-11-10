import { aiStrings } from "../i18n/ai";
import type { Language } from "../shared/types";
import type {
	AiEngineConfig,
	AiEngineKind,
	AiModel,
	AiService,
	AsrProvider,
	LlmProvider,
} from "../ai";
import { BAILIAN_ASR_MODELS } from "../ai/configuration";
import {
	defineSettings,
	settingsKey,
	type SettingsActionResult,
	type SettingsPresentation,
	type SettingsRowBuilder,
} from "../settings/presentation";

export type AiViewMode = "list" | "form";

/** Text fields the form may patch; unknown fields for the current kind are ignored. */
export type AiEngineTextField =
	| "name"
	| "baseUrl"
	| "secretId"
	| "workspaceId"
	| "workspaceSecretId"
	| "model"
	| "appKeySecretId"
	| "appSecretSecretId";

export interface AiSettingsHost {
	readonly service: AiService;
	readonly currentKind: AiEngineKind;
	readonly currentView: AiViewMode;
	readonly currentDraft: AiEngineConfig;
	readonly isDraftNew: boolean;
	readonly availableModels: readonly AiModel[];
	readonly isSaving: boolean;

	setKind(kind: AiEngineKind): void;
	startAdd(): void;
	editEngine(id: string): void;
	backToList(): void;
	patchDraft(patch: Partial<Record<AiEngineTextField, string>>): void;
	setProvider(provider: LlmProvider | AsrProvider): void;
	setDefaultEngine(kind: "llm" | "asr", id: string): Promise<void> | void;
	saveDraft(): Promise<void> | void;
	deleteEngine(id?: string): Promise<void> | void;
	loadModels(): Promise<void> | void;
	testDraft(): Promise<void> | void;
}

const KIND_ORDER: readonly AiEngineKind[] = ["llm", "asr", "translation"];

function fieldValue(draft: AiEngineConfig, field: AiEngineTextField): string {
	return (draft as unknown as Record<string, string>)[field] ?? "";
}

function engineSummary(engine: AiEngineConfig, t: ReturnType<typeof aiStrings>): string {
	if (engine.kind === "llm") return `${t[engine.provider]} · ${engine.model || t.none}`;
	if (engine.kind === "asr")
		return engine.provider === "bailian"
			? `${t.bailian} · ${engine.model || t.none}`
			: `${t.openaiCompatible} · ${engine.model || t.none}`;
	return `${t.translationProvider} · ${engine.baseUrl}`;
}

export function buildAiSettingsViewModel(
	host: AiSettingsHost,
	language: Language,
): SettingsPresentation {
	const t = aiStrings(language);
	const {
		currentDraft: draft,
		service,
		isSaving: saving,
		currentKind: kind,
		currentView: view,
		isDraftNew: draftIsNew,
		availableModels: models,
	} = host;
	const snapshot = service.getSnapshot();
	const engines = snapshot.settings.engines.filter((engine) => engine.kind === kind);
	const loading = snapshot.loadingModels.includes(draft.id);
	const testing = snapshot.testing.includes(draft.id);
	const kindDescription =
		kind === "llm" ? t.llmDesc : kind === "asr" ? t.asrDesc : t.translationDesc;

	const text = (row: SettingsRowBuilder, field: AiEngineTextField, placeholder: string) =>
		row.text(field, {
			value: fieldValue(draft, field),
			placeholder,
			disabled: saving,
			onChange: (value) => host.patchDraft({ [field]: value }),
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
			page.group("types", t.typeLabel, (group) => {
				group.choiceButtons(
					"kind",
					{ name: t.serviceCategory, description: kindDescription },
					{
						value: kind,
						choices: KIND_ORDER.map((candidate) => ({
							id: candidate,
							label: t[candidate],
						})),
						emptyText: t.typeLabel,
						onChoose: (value) => host.setKind(value as AiEngineKind),
					},
				);
			});

			if (kind !== "translation") {
				page.group("defaults", t.defaultConfig, (group) => {
					group.select(
						"default",
						{
							name: t.selectDefault,
							description: kind === "llm" ? t.defaultLlmHelp : t.defaultAsrHelp,
						},
						{
							value: snapshot.settings.defaults[kind] ?? "",
							disabled: saving,
							options: [
								{ value: "", label: t.none },
								...engines.map((engine) => ({
									value: engine.id,
									label: engine.name,
								})),
							],
							onChange: (value) => host.setDefaultEngine(kind, value),
						},
					);
				});
			}

			page.group("engines", t.engineList, (group) => {
				group.button(
					"add",
					{
						name: t.addEngineRow,
						description: (() => {
							switch (kind) {
								case "llm":
									return t.llmEngineListDesc;
								case "asr":
									return t.asrEngineListDesc;
								default:
									return t.translationEngineListDesc;
							}
						})(),
					},
					{ label: t.addEngine, disabled: saving, onPress: () => host.startAdd() },
				);

				if (engines.length === 0) {
					group.row("empty", {
						name: t.noConfigs,
						description: (() => {
							switch (kind) {
								case "llm":
									return t.llmNoConfigsDesc;
								case "asr":
									return t.asrNoConfigsDesc;
								default:
									return t.translationNoConfigsDesc;
							}
						})(),
					});
					return;
				}
				const defaultId =
					kind === "llm"
						? snapshot.settings.defaults.llm
						: kind === "asr"
							? snapshot.settings.defaults.asr
							: null;
				for (const engine of engines) {
					const isDefault = engine.id === defaultId;
					const name = isDefault ? `${engine.name} ${t.defaultBadge}` : engine.name;
					group.row(
						`engine-${settingsKey(engine.id)}`,
						{
							name,
							description: isDefault
								? `${engineSummary(engine, t)} · ${t.defaultEngineDesc}`
								: engineSummary(engine, t),
						},
						(row) => {
							button(row, "edit", t.edit, () => host.editEngine(engine.id));
							button(
								row,
								"delete",
								t.delete,
								() => host.deleteEngine(engine.id),
								saving,
							);
						},
					);
				}
			});
			return;
		}

		page.group(
			"engine-form",
			`${t[kind]} - ${draftIsNew ? t.addEngineHeading : t.editEngineHeading}`,
			(group) => {
				group.button(
					"back",
					{ name: t.back, description: t.backDesc },
					{ label: t.back, disabled: saving, onPress: () => host.backToList() },
				);
				group.row("name", { name: t.name }, (row) => text(row, "name", t.namePlaceholder));
				if (draft.kind === "llm") {
					group.select(
						"provider",
						{ name: t.provider },
						{
							value: draft.provider,
							disabled: saving,
							options: [
								{ value: "deepseek", label: t.deepseek },
								{ value: "bailian", label: t.bailian },
								{ value: "youdao", label: t.youdao },
							],
							onChange: (value) => host.setProvider(value as LlmProvider),
						},
					);
					group.row("base-url", { name: t.baseUrl, description: t.llmBaseHelp }, (row) =>
						text(row, "baseUrl", "https://…"),
					);
					group.secret(
						"secret",
						{ name: t.secret, description: t.secretHelp },
						{
							value: draft.secretId,
							disabled: saving,
							onChange: (secretId) => host.patchDraft({ secretId }),
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
							() => host.loadModels(),
							saving || loading,
						);
						if (models.length > 0) {
							row.select("available", {
								value: draft.model,
								disabled: saving,
								options: models.map((model) => ({
									value: model.id,
									label: `${model.id} (${t[model.imageInput]})`,
								})),
								missingValueLabel: draft.model || t.none,
								onChange: (model) => host.patchDraft({ model }),
							});
						}
					});
					group.button(
						"test",
						{ name: t.test, description: t.testHelp },
						{
							label: testing ? t.testing : t.test,
							disabled: saving || testing,
							onPress: () => host.testDraft(),
						},
					);
				} else if (draft.kind === "asr") {
					group.select(
						"provider",
						{ name: t.provider },
						{
							value: draft.provider,
							disabled: saving,
							options: [
								{ value: "bailian", label: t.bailian },
								{ value: "openai-compatible", label: t.openaiCompatible },
							],
							onChange: (value) => host.setProvider(value as AsrProvider),
						},
					);
					if (draft.provider === "bailian") {
						group.secret(
							"workspace",
							{ name: t.workspace, description: t.workspaceHelp },
							{
								value: draft.workspaceSecretId,
								disabled: saving,
								onChange: (workspaceSecretId) =>
									host.patchDraft({ workspaceSecretId, workspaceId: "" }),
							},
						);
						if (draft.workspaceId)
							group.status(
								"workspace-legacy",
								{ name: t.workspaceLegacy, description: t.workspaceLegacyHint },
								draft.workspaceId,
							);
						group.select(
							"model",
							{ name: t.model, description: t.asrModelHelp },
							{
								value: draft.model,
								disabled: saving,
								options: BAILIAN_ASR_MODELS.map((model) => ({
									value: model,
									label: model,
								})),
								missingValueLabel: `${t.asrModelLegacy}: ${draft.model}`,
								onChange: (model) => host.patchDraft({ model }),
							},
						);
						group.secret(
							"secret",
							{ name: t.secret, description: t.secretHelp },
							{
								value: draft.secretId,
								disabled: saving,
								onChange: (secretId) => host.patchDraft({ secretId }),
							},
						);
					} else {
						group.row(
							"base-url",
							{ name: t.baseUrl, description: t.asrBaseHelp },
							(row) => text(row, "baseUrl", "https://api.openai.com/v1"),
						);
						group.row("model", { name: t.model }, (row) =>
							text(row, "model", "whisper-1"),
						);
						group.secret(
							"secret",
							{ name: t.secret, description: t.secretHelp },
							{
								value: draft.secretId,
								disabled: saving,
								onChange: (secretId) => host.patchDraft({ secretId }),
							},
						);
					}
				} else {
					group.status("provider", { name: t.provider }, t.translationProvider);
					group.row(
						"base-url",
						{ name: t.baseUrl, description: t.translationBaseHelp },
						(row) => text(row, "baseUrl", "https://openapi.youdao.com/api"),
					);
					group.secret(
						"app-key",
						{ name: t.appKey, description: t.appCredentialHelp },
						{
							value: draft.appKeySecretId,
							disabled: saving,
							onChange: (appKeySecretId) => host.patchDraft({ appKeySecretId }),
						},
					);
					group.secret(
						"app-secret",
						{ name: t.appSecret },
						{
							value: draft.appSecretSecretId,
							disabled: saving,
							onChange: (appSecretSecretId) => host.patchDraft({ appSecretSecretId }),
						},
					);
					group.button(
						"test",
						{ name: t.test, description: t.testTranslationHelp },
						{
							label: testing ? t.testing : t.test,
							disabled: saving || testing,
							onPress: () => host.testDraft(),
						},
					);
				}
				group.row("configuration", { name: t.configActions }, (row) => {
					button(row, "save", t.save, () => host.saveDraft());
					button(row, "cancel", t.cancel, () => host.backToList());
					if (!draftIsNew)
						button(
							row,
							"remove",
							t.remove,
							() => host.deleteEngine(draft.id),
							saving,
							"warning",
						);
				});
			},
		);
	});
}
