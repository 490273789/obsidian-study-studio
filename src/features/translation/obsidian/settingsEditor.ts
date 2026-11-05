import { Notice } from "obsidian";
import { aiFailureCode, aiFailureHttpStatus, type AiService } from "../../../core/ai";
import { aiErrorText } from "../../../core/i18n/ai";
import { translationSettingsStrings } from "../strings/settings";
import type { Language } from "../../../core/shared/types";
import {
	buildTranslationSettingsViewModel,
	type TranslationSettingsEditorActions,
} from "../settings/viewModel";
import { DEFAULT_TRANSLATION_PROMPT, normalizeTranslationSettings } from "../domain/configuration";
import type { TranslationRuntime } from "../domain/translationRuntime";
import type { TranslationSettings } from "../domain/types";
import type { SettingsPresentation } from "../../../core/settings/presentation";

export type TranslationSettingsRuntime = Pick<
	TranslationRuntime,
	"getSnapshot" | "subscribe" | "configure"
>;

/** Holds one unsaved settings draft; TranslationRuntime remains the committed authority. */
export class TranslationSettingsEditor {
	private draft: TranslationSettings;
	private saving = false;
	private unsubscribeRuntime: (() => void) | null = null;
	private unsubscribeAi: (() => void) | null = null;

	constructor(
		private readonly runtime: TranslationSettingsRuntime,
		private readonly ai: AiService,
		private readonly language: () => Language,
		private readonly refresh: () => void,
		private readonly openAiSettings?: () => void,
	) {
		this.draft = normalizeTranslationSettings(runtime.getSnapshot().settings);
	}

	activate(): void {
		this.unsubscribeRuntime ??= this.runtime.subscribe(this.refresh);
		this.unsubscribeAi ??= this.ai.subscribe(this.refresh);
	}

	hide(): void {
		this.unsubscribeRuntime?.();
		this.unsubscribeRuntime = null;
		this.unsubscribeAi?.();
		this.unsubscribeAi = null;
		if (!this.saving)
			this.draft = normalizeTranslationSettings(this.runtime.getSnapshot().settings);
	}

	presentation(): SettingsPresentation {
		const snapshot = this.runtime.getSnapshot();
		return buildTranslationSettingsViewModel(
			{
				snapshot,
				draft: this.draft,
				aiSnapshot: this.ai.getSnapshot(),
				saving: this.saving || snapshot.saving,
			},
			this.actions(),
			this.language(),
		);
	}

	private actions(): TranslationSettingsEditorActions {
		return {
			patch: (patch) => this.patch(patch),
			patchProfile: (id, patch) => {
				this.patch({
					profiles: this.draft.profiles.map((profile) =>
						profile.id === id ? { ...profile, ...patch } : profile,
					),
				});
			},
			addProfile: () => {
				const number = this.draft.profiles.length + 1;
				this.patch({
					profiles: [
						...this.draft.profiles,
						{
							id: `translation-profile-${crypto.randomUUID()}`,
							name: translationSettingsStrings(this.language()).newProfileName(
								number,
							),
							enabled: true,
							// ADR-0016: a profile always selects its engine explicitly.
							engineId: "",
						},
					],
				});
			},
			removeProfile: (id) => {
				if (this.draft.profiles.length <= 1) return;
				this.patch({
					profiles: this.draft.profiles.filter((profile) => profile.id !== id),
				});
			},
			moveProfile: (id, offset) => this.moveProfile(id, offset),
			resetPrompt: () => this.patch({ promptTemplate: DEFAULT_TRANSLATION_PROMPT }),
			...(this.openAiSettings ? { openAiSettings: this.openAiSettings } : {}),
			save: () => this.save(),
		};
	}

	private patch(patch: Partial<TranslationSettings>): void {
		if (this.saving) return;
		this.draft = normalizeTranslationSettings({ ...this.draft, ...patch });
		this.refresh();
	}

	private moveProfile(id: string, offset: -1 | 1): void {
		if (this.saving) return;
		const from = this.draft.profiles.findIndex((profile) => profile.id === id);
		const to = from + offset;
		if (from < 0 || to < 0 || to >= this.draft.profiles.length) return;
		const profiles = [...this.draft.profiles];
		const [profile] = profiles.splice(from, 1);
		if (!profile) return;
		profiles.splice(to, 0, profile);
		this.patch({ profiles });
	}

	private async save(): Promise<void> {
		if (this.saving || this.runtime.getSnapshot().saving) return;
		this.saving = true;
		this.refresh();
		try {
			// The translation view owns direction and swaps it independently of settings.
			const committed = this.runtime.getSnapshot().settings;
			await this.runtime.configure({ ...this.draft, direction: committed.direction });
			this.draft = normalizeTranslationSettings(this.runtime.getSnapshot().settings);
			new Notice(translationSettingsStrings(this.language()).saved);
		} catch (error) {
			this.report(error);
		} finally {
			this.saving = false;
			if (this.unsubscribeRuntime) this.refresh();
		}
	}

	private report(error: unknown): void {
		const t = translationSettingsStrings(this.language());
		const code = aiFailureCode(error);
		const httpStatus = aiFailureHttpStatus(error);
		new Notice(
			`${t.errorPrefix}${aiErrorText(this.language(), code)}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
		);
	}
}
