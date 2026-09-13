import { Notice } from "obsidian";
import {
	aiFailureCode,
	aiFailureHttpStatus,
	type AiEngineConfig,
	type AiModel,
	type AiService,
} from "../ai";
import { AI_PRESETS } from "../ai/configuration";
import { aiErrorText, aiStrings } from "../i18n/ai";
import type { Language } from "../shared/types";
import { buildAiSettingsViewModel, type AiViewMode } from "./aiSettingsViewModel";

/** Only unsaved form drafts live here. Committed state and requests belong to AiService. */
export class AiSettingsEditor {
	private view: AiViewMode = "list";
	private draft: AiEngineConfig;
	private draftIsNew: boolean;
	private models: AiModel[] = [];
	private saving = false;
	private unsubscribe: (() => void) | null = null;
	private revision = 0;
	constructor(
		private service: AiService,
		private language: () => Language,
		private refresh: () => void,
	) {
		this.draftIsNew = true;
		this.draft = this.newDraft();
	}
	activate(): void {
		this.unsubscribe ??= this.service.subscribe(this.refresh);
	}
	hide(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.view = "list";
	}
	presentation() {
		return buildAiSettingsViewModel(
			{
				snapshot: this.service.getSnapshot(),
				draft: this.draft,
				draftIsNew: this.draftIsNew,
				view: this.view,
				models: this.models,
				saving: this.saving,
			},
			{
				toAdd: () => {
					this.draft = this.newDraft();
					this.draftIsNew = true;
					this.models = [];
					this.revision++;
					this.view = "form";
					this.refresh();
				},
				toEdit: (id) => {
					const config = this.service
						.getSnapshot()
						.settings.configs.find((item) => item.id === id);
					if (config) {
						this.draft = { ...config };
						this.draftIsNew = false;
						this.models = [];
						this.revision++;
						this.view = "form";
						this.refresh();
					}
				},
				back: () => {
					this.view = "list";
					this.models = [];
					this.revision++;
					this.refresh();
				},
				select: (id) => {
					const config = this.service
						.getSnapshot()
						.settings.configs.find((item) => item.id === id);
					if (config) {
						this.draft = { ...config };
						this.draftIsNew = false;
						this.models = [];
						this.revision++;
						this.refresh();
					}
				},
				add: () => {
					this.draft = this.newDraft();
					this.draftIsNew = true;
					this.models = [];
					this.revision++;
					this.view = "form";
					this.refresh();
				},
				selectModel: (model) => {
					this.draft = { ...this.draft, model };
					this.revision++;
					this.refresh();
				},
				patch: (patch) => {
					this.draft = { ...this.draft, ...patch };
					this.revision++;
					if (patch.baseUrl !== undefined || patch.secretId !== undefined)
						this.models = [];
				},
				provider: (provider) => {
					this.draft = { ...this.draft, provider, ...AI_PRESETS[provider], secretId: "" };
					this.models = [];
					this.revision++;
					this.refresh();
				},
				setDefault: (id) => this.perform(() => this.service.setDefault(id || null)),
				save: () =>
					this.perform(async () => {
						const id = await this.service.saveConfig({
							...this.draft,
							id: this.draftIsNew ? undefined : this.draft.id,
						});
						this.draft = {
							...this.service
								.getSnapshot()
								.settings.configs.find((config) => config.id === id)!,
						};
						this.draftIsNew = false;
						this.view = "list";
						this.models = [];
						this.revision++;
						new Notice(aiStrings(this.language()).saved);
					}),
				remove: (id) =>
					this.perform(async () => {
						const targetId = id ?? this.draft.id;
						await this.service.deleteConfig(targetId);
						if (this.draft.id === targetId) {
							this.draft = this.newDraft();
							this.draftIsNew = true;
						}
						this.view = "list";
						this.models = [];
						this.revision++;
						new Notice(aiStrings(this.language()).deleted);
					}),
				loadModels: async () => {
					const revision = this.revision;
					try {
						const models = await this.service.listModels(this.draft);
						if (revision === this.revision) this.models = models;
					} catch (error) {
						this.report(error, aiStrings(this.language()).modelsFailed);
					} finally {
						if (this.unsubscribe) this.refresh();
					}
				},
				test: async () => {
					try {
						await this.service.testConnection(this.draft);
						new Notice(aiStrings(this.language()).success);
					} catch (error) {
						this.report(error);
					}
				},
			},
			this.language(),
		);
	}
	private newDraft(): AiEngineConfig {
		return {
			id: `draft-${crypto.randomUUID()}`,
			name: "",
			provider: "deepseek",
			...AI_PRESETS.deepseek,
			secretId: "",
		};
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
