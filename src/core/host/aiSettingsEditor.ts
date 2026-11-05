import { Notice } from "obsidian";
import {
	aiFailureCode,
	aiFailureHttpStatus,
	type AiEngineConfig,
	type AiEngineKind,
	type AiModel,
	type AiService,
} from "../ai";
import {
	ASR_PRESETS,
	LLM_PRESETS,
	createEngineDraft,
	isAsrProvider,
	isLlmProvider,
} from "../ai/configuration";
import { aiErrorText, aiStrings } from "../i18n/ai";
import type { Language } from "../shared/types";
import {
	buildAiSettingsViewModel,
	type AiEngineTextField,
	type AiViewMode,
} from "./aiSettingsViewModel";

/**
 * Only unsaved form drafts live here. Committed engines and requests belong to
 * `AiService`; this editor never mirrors the registry.
 */
export class AiSettingsEditor {
	private kind: AiEngineKind = "llm";
	private view: AiViewMode = "list";
	private draft: AiEngineConfig;
	private draftIsNew = true;
	private models: AiModel[] = [];
	private saving = false;
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly service: AiService,
		private readonly language: () => Language,
		private readonly refresh: () => void,
	) {
		this.draft = this.newDraft(this.kind);
	}

	activate(): void {
		this.unsubscribe ??= this.service.subscribe(this.refresh);
	}

	hide(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.view = "list";
		this.models = [];
		this.draft = this.newDraft(this.kind);
		this.draftIsNew = true;
	}

	presentation() {
		return buildAiSettingsViewModel(
			{
				snapshot: this.service.getSnapshot(),
				kind: this.kind,
				draft: this.draft,
				draftIsNew: this.draftIsNew,
				view: this.view,
				models: this.models,
				saving: this.saving,
			},
			{
				kind: (kind) => {
					if (this.saving) return;
					this.kind = kind;
					this.view = "list";
					this.models = [];
					this.draft = this.newDraft(kind);
					this.draftIsNew = true;
					this.refresh();
				},
				add: () => {
					this.draft = this.newDraft(this.kind);
					this.draftIsNew = true;
					this.models = [];
					this.view = "form";
					this.refresh();
				},
				toEdit: (id) => {
					const engine = this.find(id);
					if (!engine) return;
					this.draft = { ...engine } as AiEngineConfig;
					this.draftIsNew = false;
					this.models = [];
					this.view = "form";
					this.refresh();
				},
				back: () => {
					this.view = "list";
					this.models = [];
					this.refresh();
				},
				selectModel: (model) => this.patch({ model }),
				patch: (patch) => this.patch(patch),
				provider: (provider) => {
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
					this.refresh();
				},
				setDefault: (kind, id) =>
					this.perform(() => this.service.setDefault(kind, id || null)),
				save: () =>
					this.perform(async () => {
						const id = await this.service.saveEngine(this.draft);
						const saved = this.find(id);
						this.draft = saved
							? ({ ...saved } as AiEngineConfig)
							: this.newDraft(this.kind);
						this.draftIsNew = saved ? false : true;
						this.view = "list";
						this.models = [];
						this.refresh();
						new Notice(aiStrings(this.language()).saved);
					}),
				remove: (id) =>
					this.perform(async () => {
						const targetId = id ?? this.draft.id;
						await this.service.deleteEngine(targetId);
						if (this.draft.id === targetId) {
							this.draft = this.newDraft(this.kind);
							this.draftIsNew = true;
						}
						this.view = "list";
						this.models = [];
						this.refresh();
						new Notice(aiStrings(this.language()).deleted);
					}),
				loadModels: async () => {
					const draft = this.draft;
					if (draft.kind !== "llm") return;
					try {
						const models = await this.service.listModels(draft);
						if (draft.id === this.draft.id) this.models = models;
					} catch (error) {
						this.report(error, aiStrings(this.language()).modelsFailed);
					} finally {
						if (this.unsubscribe) this.refresh();
					}
				},
				test: async () => {
					const t = aiStrings(this.language());
					try {
						await this.service.testEngine(this.draft);
						new Notice(
							this.draft.kind === "translation" ? t.translationSuccess : t.success,
						);
					} catch (error) {
						this.report(error);
					}
				},
			},
			this.language(),
		);
	}

	private find(id: string): AiEngineConfig | undefined {
		return this.service.getSnapshot().settings.engines.find((engine) => engine.id === id);
	}

	private patch(patch: Partial<Record<AiEngineTextField, string>>): void {
		if (this.saving) return;
		this.draft = { ...this.draft, ...patch } as AiEngineConfig;
		if ("baseUrl" in patch || "secretId" in patch) this.models = [];
		this.refresh();
	}

	private newDraft(kind: AiEngineKind): AiEngineConfig {
		return createEngineDraft(kind, this.service.createEngineId());
	}

	private async perform(action: () => Promise<void>): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		this.refresh();
		try {
			await action();
		} catch (error) {
			this.report(error);
		} finally {
			this.saving = false;
			if (this.unsubscribe) this.refresh();
		}
	}

	private report(error: unknown, prefix?: string): void {
		const t = aiStrings(this.language());
		const code = aiFailureCode(error);
		const httpStatus = aiFailureHttpStatus(error);
		new Notice(
			`${prefix ?? t.errorPrefix} ${aiErrorText(this.language(), code)}${httpStatus ? ` (${t.http} ${httpStatus})` : ""}`,
		);
	}
}
