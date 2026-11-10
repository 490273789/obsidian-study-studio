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
	LLM_PRESETS,
	createEngineDraft,
	isAsrProvider,
	isLlmProvider,
} from "../ai/configuration";
import { createSharedTranslator } from "../i18n";
import { aiErrorText, aiStrings } from "../i18n/ai";
import type { SettingsPresentation } from "../settings/presentation";
import type { Language } from "../shared/types";
import {
	buildAiSettingsViewModel,
	type AiEngineTextField,
	type AiSettingsHost,
	type AiViewMode,
} from "./aiSettingsViewModel";
import { AI_ENGINE_SECTION_ID } from "./sectionIds";
import type { WorkbenchSettingsSection } from "./workbench";

export { AI_ENGINE_SECTION_ID };

export interface AiDeleteModalStrings {
	title: string;
	message: string;
	cancel: string;
	action: string;
}

/** Confirmation modal for deleting an AI engine configuration. */
export class AiEngineDeleteModal extends Modal {
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
export function confirmAiEngineDeletion(
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
 * and deletion confirmation lifecycle directly behind the WorkbenchSettingsSection contract.
 */
export class AiEngineSettingsSection implements WorkbenchSettingsSection, AiSettingsHost {
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
		return buildAiSettingsViewModel(this, language);
	}

	// AiSettingsHost properties
	get service(): AiService {
		return this.options.ai;
	}

	get currentKind(): AiEngineKind {
		return this.kind;
	}

	get currentView(): AiViewMode {
		return this.view;
	}

	get currentDraft(): AiEngineConfig {
		return this.draft;
	}

	get isDraftNew(): boolean {
		return this.draftIsNew;
	}

	get availableModels(): readonly AiModel[] {
		return this.models;
	}

	get isSaving(): boolean {
		return this.saving;
	}

	get currentLanguage(): Language {
		return this.language;
	}

	// Actions
	setKind(kind: AiEngineKind): void {
		if (this.saving) return;
		this.kind = kind;
		this.view = "list";
		this.models = [];
		this.draft = this.newDraft(kind);
		this.draftIsNew = true;
		this.options.refresh();
	}

	startAdd(): void {
		this.draft = this.newDraft(this.kind);
		this.draftIsNew = true;
		this.models = [];
		this.view = "form";
		this.options.refresh();
	}

	editEngine(id: string): void {
		const engine = this.find(id);
		if (!engine) return;
		this.draft = { ...engine } as AiEngineConfig;
		this.draftIsNew = false;
		this.models = [];
		this.view = "form";
		this.options.refresh();
	}

	backToList(): void {
		this.view = "list";
		this.models = [];
		this.options.refresh();
	}

	patchDraft(patch: Partial<Record<AiEngineTextField, string>>): void {
		if (this.saving) return;
		this.draft = { ...this.draft, ...patch } as AiEngineConfig;
		if ("baseUrl" in patch || "secretId" in patch) this.models = [];
		this.options.refresh();
	}

	setProvider(provider: LlmProvider | AsrProvider): void {
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

	setDefaultEngine(kind: "llm" | "asr", id: string): Promise<void> {
		return this.perform(() => this.options.ai.setDefault(kind, id || null));
	}

	saveDraft(): Promise<void> {
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

	deleteEngine(id?: string): Promise<void> {
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

	async loadModels(): Promise<void> {
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

	async testDraft(): Promise<void> {
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
