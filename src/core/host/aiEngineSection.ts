import { type App, Modal, Notice, Setting } from "obsidian";
import {
	aiFailureCode,
	aiFailureHttpStatus,
	type AiEngineConfig,
	type AiEngineKind,
	type AiModel,
	type AiService,
	type AsrProvider,
	type LlmProvider,
} from "../ai";
import {
	ASR_PRESETS,
	BAILIAN_ASR_MODELS,
	LLM_PRESETS,
	createEngineDraft,
	isAsrProvider,
	isLlmProvider,
} from "../ai/configuration";
import { createSharedTranslator } from "../i18n";
import { aiErrorText, aiStrings } from "../i18n/ai";
import {
	defineSettings,
	settingsKey,
	type SettingsActionResult,
	type SettingsPresentation,
	type SettingsRowBuilder,
} from "../settings/presentation";
import type { Language } from "../shared/types";
import { AI_ENGINE_SECTION_ID } from "./sectionIds";
import type { WorkbenchSettingsSection } from "./workbench";

export { AI_ENGINE_SECTION_ID };

type AiViewMode = "list" | "form";

/** Text fields the form may patch; unknown fields for the current kind are ignored. */
type AiEngineTextField =
	| "name"
	| "baseUrl"
	| "secretId"
	| "workspaceId"
	| "workspaceSecretId"
	| "model"
	| "appKeySecretId"
	| "appSecretSecretId";

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

interface AiDeleteModalStrings {
	title: string;
	message: string;
	cancel: string;
	action: string;
}

/** Confirmation modal for deleting an AI engine configuration. */
class AiEngineDeleteModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly engineName: string,
		private readonly isDefault: boolean,
		private readonly strings: AiDeleteModalStrings,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.classList.add("mod-warning");
		this.setTitle(this.strings.title);
		const message = this.contentEl.createEl("p", {
			text: `${this.strings.message}（${this.engineName}）`,
		});
		if (this.isDefault) {
			message.addClass("mod-warning");
		}
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(this.strings.cancel).onClick(() => this.finish(false)),
			)
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(this.strings.action)
					.onClick(() => this.finish(true)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.resolve(false);
	}

	private finish(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(confirmed);
		this.close();
	}
}

/** Resolves `true` when the user confirms deleting the AI engine. */
function confirmAiEngineDeletion(
	app: App,
	engineName: string,
	isDefault: boolean,
	strings: AiDeleteModalStrings,
): Promise<boolean> {
	return new Promise((resolve) => {
		new AiEngineDeleteModal(app, engineName, isDefault, strings, resolve).open();
	});
}

export interface AiEngineSectionOptions {
	app?: App;
	ai: AiService;
	confirmDelete?: (name: string, isDefault: boolean) => Promise<boolean>;
	/** Re-renders the settings tab; called on every committed change. */
	refresh(): void;
}

/**
 * Deep settings section managing AI engine configurations, draft states,
 * presentation building, and deletion confirmation lifecycle behind the WorkbenchSettingsSection contract.
 */
class AiEngineSettingsSection implements WorkbenchSettingsSection {
	readonly id = AI_ENGINE_SECTION_ID;
	readonly category = "language" as const;
	readonly order = 1;

	private language: Language = "zh";
	private kind: AiEngineKind = "llm";
	private view: AiViewMode = "list";
	private draft: AiEngineConfig;
	private draftIsNew = true;
	private models: AiModel[] = [];
	private saving = false;
	private unsubscribe: (() => void) | null = null;
	private readonly confirmDeleteCallback?: (name: string, isDefault: boolean) => Promise<boolean>;

	constructor(private readonly options: AiEngineSectionOptions) {
		this.draft = this.newDraft(this.kind);
		this.confirmDeleteCallback =
			options.confirmDelete ??
			(options.app
				? (name: string, isDefault: boolean) => {
						const t = aiStrings(this.language);
						return confirmAiEngineDeletion(options.app!, name, isDefault, {
							title: t.deleteConfirmTitle,
							message: isDefault
								? t.deleteConfirmDefaultMessage
								: t.deleteConfirmMessage,
							cancel: t.deleteConfirmCancel,
							action: t.deleteConfirmAction,
						});
					}
				: undefined);
	}

	label(language: Language): string {
		return createSharedTranslator(language)("settings.tabAi");
	}

	activate(): void {
		this.unsubscribe ??= this.options.ai.subscribe(() => this.options.refresh());
	}

	hide(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.view = "list";
		this.models = [];
		this.draft = this.newDraft(this.kind);
		this.draftIsNew = true;
	}

	presentation(language: Language): SettingsPresentation {
		this.language = language;
		const t = aiStrings(language);
		const { draft, saving, kind, view, draftIsNew, models } = this;
		const snapshot = this.options.ai.getSnapshot();
		const engines = snapshot.settings.engines.filter((engine) => engine.kind === kind);
		const loading = snapshot.loadingModels.includes(draft.id);
		const testing = snapshot.testing.includes(draft.id);
		const kindCopy = {
			llm: {
				description: t.llmDesc,
				defaultHelp: t.defaultLlmHelp,
				listDesc: t.llmEngineListDesc,
				emptyDesc: t.llmNoConfigsDesc,
				defaultId: snapshot.settings.defaults.llm,
			},
			asr: {
				description: t.asrDesc,
				defaultHelp: t.defaultAsrHelp,
				listDesc: t.asrEngineListDesc,
				emptyDesc: t.asrNoConfigsDesc,
				defaultId: snapshot.settings.defaults.asr,
			},
			translation: {
				description: t.translationDesc,
				defaultHelp: "",
				listDesc: t.translationEngineListDesc,
				emptyDesc: t.translationNoConfigsDesc,
				defaultId: null,
			},
		}[kind];

		const text = (row: SettingsRowBuilder, field: AiEngineTextField, placeholder: string) =>
			row.text(field, {
				value: fieldValue(draft, field),
				placeholder,
				disabled: saving,
				onChange: (value) => this.patchDraft({ [field]: value }),
			});
		const button = (
			row: SettingsRowBuilder,
			key: string,
			label: string,
			onClick: () => SettingsActionResult,
			disabled = saving,
			tone?: "neutral" | "warning",
		) => row.button(key, { label, onPress: onClick, disabled, tone });
		const apiKeySecret = (
			group: {
				secret(
					key: string,
					copy: { name: string; description?: string },
					spec: { value: string; disabled?: boolean; onChange: (value: string) => void },
				): void;
			},
			value: string,
		) =>
			group.secret(
				"secret",
				{ name: t.secret, description: t.secretHelp },
				{ value, disabled: saving, onChange: (secretId) => this.patchDraft({ secretId }) },
			);

		return defineSettings("ai-engines", (page) => {
			if (view === "list") {
				page.group("types", t.typeLabel, (group) => {
					group.choiceButtons(
						"kind",
						{ name: t.serviceCategory, description: kindCopy.description },
						{
							value: kind,
							choices: KIND_ORDER.map((candidate) => ({
								id: candidate,
								label: t[candidate],
							})),
							emptyText: t.typeLabel,
							onChoose: (value) => this.setKind(value as AiEngineKind),
						},
					);
				});

				if (kind !== "translation") {
					page.group("defaults", t.defaultConfig, (group) => {
						group.select(
							"default",
							{
								name: t.selectDefault,
								description: kindCopy.defaultHelp,
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
								onChange: (value) => this.setDefaultEngine(kind, value),
							},
						);
					});
				}

				page.group("engines", t.engineList, (group) => {
					group.button(
						"add",
						{ name: t.addEngineRow, description: kindCopy.listDesc },
						{ label: t.addEngine, disabled: saving, onPress: () => this.startAdd() },
					);

					if (engines.length === 0) {
						group.row("empty", {
							name: t.noConfigs,
							description: kindCopy.emptyDesc,
						});
						return;
					}
					for (const engine of engines) {
						const isDefault = engine.id === kindCopy.defaultId;
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
								button(row, "edit", t.edit, () => this.editEngine(engine.id));
								button(
									row,
									"delete",
									t.delete,
									() => this.deleteEngine(engine.id),
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
						{ label: t.back, disabled: saving, onPress: () => this.backToList() },
					);
					group.row("name", { name: t.name }, (row) =>
						text(row, "name", t.namePlaceholder),
					);
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
								onChange: (value) => this.setProvider(value as LlmProvider),
							},
						);
						group.row(
							"base-url",
							{ name: t.baseUrl, description: t.llmBaseHelp },
							(row) => text(row, "baseUrl", "https://…"),
						);
						apiKeySecret(group, draft.secretId);
						group.row("model", { name: t.model, description: t.modelHelp }, (row) =>
							text(row, "model", t.modelPlaceholder),
						);
						group.row("models", { name: t.modelList }, (row) => {
							button(
								row,
								"load",
								loading ? t.loading : t.loadModels,
								() => this.loadModels(),
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
									onChange: (model) => this.patchDraft({ model }),
								});
							}
						});
						group.button(
							"test",
							{ name: t.test, description: t.testHelp },
							{
								label: testing ? t.testing : t.test,
								disabled: saving || testing,
								onPress: () => this.testDraft(),
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
								onChange: (value) => this.setProvider(value as AsrProvider),
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
										this.patchDraft({ workspaceSecretId, workspaceId: "" }),
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
									onChange: (model) => this.patchDraft({ model }),
								},
							);
							apiKeySecret(group, draft.secretId);
						} else {
							group.row(
								"base-url",
								{ name: t.baseUrl, description: t.asrBaseHelp },
								(row) => text(row, "baseUrl", "https://api.openai.com/v1"),
							);
							group.row("model", { name: t.model }, (row) =>
								text(row, "model", "whisper-1"),
							);
							apiKeySecret(group, draft.secretId);
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
								onChange: (appKeySecretId) => this.patchDraft({ appKeySecretId }),
							},
						);
						group.secret(
							"app-secret",
							{ name: t.appSecret },
							{
								value: draft.appSecretSecretId,
								disabled: saving,
								onChange: (appSecretSecretId) =>
									this.patchDraft({ appSecretSecretId }),
							},
						);
						group.button(
							"test",
							{ name: t.test, description: t.testTranslationHelp },
							{
								label: testing ? t.testing : t.test,
								disabled: saving || testing,
								onPress: () => this.testDraft(),
							},
						);
					}
					group.row("configuration", { name: t.configActions }, (row) => {
						button(row, "save", t.save, () => this.saveDraft());
						button(row, "cancel", t.cancel, () => this.backToList());
						if (!draftIsNew)
							button(
								row,
								"remove",
								t.remove,
								() => this.deleteEngine(draft.id),
								saving,
								"warning",
							);
					});
				},
			);
		});
	}

	private setKind(kind: AiEngineKind): void {
		if (this.saving) return;
		this.kind = kind;
		this.view = "list";
		this.models = [];
		this.draft = this.newDraft(kind);
		this.draftIsNew = true;
		this.options.refresh();
	}

	private startAdd(): void {
		this.draft = this.newDraft(this.kind);
		this.draftIsNew = true;
		this.models = [];
		this.view = "form";
		this.options.refresh();
	}

	private editEngine(id: string): void {
		const engine = this.find(id);
		if (!engine) return;
		this.draft = { ...engine } as AiEngineConfig;
		this.draftIsNew = false;
		this.models = [];
		this.view = "form";
		this.options.refresh();
	}

	private backToList(): void {
		this.view = "list";
		this.models = [];
		this.options.refresh();
	}

	private patchDraft(patch: Partial<Record<AiEngineTextField, string>>): void {
		if (this.saving) return;
		this.draft = { ...this.draft, ...patch } as AiEngineConfig;
		if ("baseUrl" in patch || "secretId" in patch) this.models = [];
		this.options.refresh();
	}

	private setProvider(provider: LlmProvider | AsrProvider): void {
		if (this.saving) return;
		if (this.draft.kind === "llm" && isLlmProvider(provider)) {
			this.draft = {
				...this.draft,
				provider,
				...LLM_PRESETS[provider],
				secretId: "",
			};
			this.models = [];
		} else if (this.draft.kind === "asr" && isAsrProvider(provider)) {
			this.draft = { ...this.draft, provider, ...ASR_PRESETS[provider] };
		}
		this.options.refresh();
	}

	private setDefaultEngine(kind: "llm" | "asr", id: string): Promise<void> {
		return this.perform(() => this.options.ai.setDefault(kind, id || null));
	}

	private saveDraft(): Promise<void> {
		return this.perform(async () => {
			const id = await this.options.ai.saveEngine(this.draft);
			const saved = this.find(id);
			this.draft = saved ? ({ ...saved } as AiEngineConfig) : this.newDraft(this.kind);
			this.draftIsNew = saved ? false : true;
			this.view = "list";
			this.models = [];
			this.options.refresh();
			new Notice(aiStrings(this.language).saved);
		});
	}

	private deleteEngine(id?: string): Promise<void> {
		return this.perform(async () => {
			const targetId = id ?? this.draft.id;
			const snapshot = this.options.ai.getSnapshot();
			const engine = snapshot.settings.engines.find((e) => e.id === targetId);
			if (!engine) return;

			const isDefault =
				this.kind !== "translation" && snapshot.settings.defaults[this.kind] === targetId;

			if (this.confirmDeleteCallback) {
				const confirmed = await this.confirmDeleteCallback(engine.name, isDefault);
				if (!confirmed) return;
			}

			await this.options.ai.deleteEngine(targetId);
			if (this.draft.id === targetId) {
				this.draft = this.newDraft(this.kind);
				this.draftIsNew = true;
			}
			this.view = "list";
			this.models = [];
			this.options.refresh();
			new Notice(aiStrings(this.language).deleted);
		});
	}

	private async loadModels(): Promise<void> {
		const draft = this.draft;
		if (draft.kind !== "llm") return;
		try {
			const models = await this.options.ai.listModels(draft);
			if (draft.id === this.draft.id) this.models = models;
		} catch (error) {
			this.report(error, aiStrings(this.language).modelsFailed);
		} finally {
			if (this.unsubscribe) this.options.refresh();
		}
	}

	private async testDraft(): Promise<void> {
		const t = aiStrings(this.language);
		try {
			await this.options.ai.testEngine(this.draft);
			new Notice(this.draft.kind === "translation" ? t.translationSuccess : t.success);
		} catch (error) {
			this.report(error);
		}
	}

	private find(id: string): AiEngineConfig | undefined {
		return this.options.ai.getSnapshot().settings.engines.find((engine) => engine.id === id);
	}

	private newDraft(kind: AiEngineKind): AiEngineConfig {
		return createEngineDraft(kind, this.options.ai.createEngineId());
	}

	private async perform(action: () => Promise<void>): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		this.options.refresh();
		try {
			await action();
		} catch (error) {
			this.report(error);
		} finally {
			this.saving = false;
			if (this.unsubscribe) this.options.refresh();
		}
	}

	private report(error: unknown, prefix?: string): void {
		const t = aiStrings(this.language);
		const code = aiFailureCode(error);
		const httpStatus = aiFailureHttpStatus(error);
		new Notice(
			`${prefix ?? t.errorPrefix} ${aiErrorText(this.language, code)}${httpStatus ? ` (${t.http} ${httpStatus})` : ""}`,
		);
	}
}

/**
 * Creates the AI engine workbench settings section.
 */
export function createAiEngineSection(options: AiEngineSectionOptions): WorkbenchSettingsSection {
	return new AiEngineSettingsSection(options);
}
