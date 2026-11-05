import { createSharedTranslator } from "../i18n";
import { defineSettings } from "../settings/presentation";
import type { Language } from "../shared/types";
import type { WorkbenchSettingsSection } from "./workbench";

export const GENERAL_SETTINGS_SECTION_ID = "general";

interface GeneralSettingsSectionOptions {
	readLanguage(): Language;
	updateLanguage(language: Language): Promise<void>;
	refresh(): void;
}

/** Global preferences belong to the host rather than an individual learning tool. */
export function createGeneralSettingsSection(
	options: GeneralSettingsSectionOptions,
): WorkbenchSettingsSection {
	let saving = false;
	let saveFailed = false;

	return {
		id: GENERAL_SETTINGS_SECTION_ID,
		category: "general",
		order: -1,
		label: (language) => createSharedTranslator(language)("settings.general"),
		presentation: (language) => {
			const t = createSharedTranslator(language);
			return defineSettings(GENERAL_SETTINGS_SECTION_ID, (page) => {
				page.group("interface", t("settings.interface"), (group) => {
					group.select(
						"language",
						{
							name: t("settings.language"),
							description: t("settings.languageDescription"),
						},
						{
							value: options.readLanguage(),
							disabled: saving,
							options: [
								{ value: "zh", label: "简体中文" },
								{ value: "en", label: "English" },
							],
							onChange: async (value) => {
								if (saving || value === options.readLanguage()) return;
								saving = true;
								saveFailed = false;
								options.refresh();
								try {
									await options.updateLanguage(value === "en" ? "en" : "zh");
								} catch (error) {
									saveFailed = true;
									console.error("Failed to save interface language:", error);
								} finally {
									saving = false;
									options.refresh();
								}
							},
						},
					);
					if (saveFailed) {
						group.row("save-error", { name: t("settings.saveFailed"), tone: "danger" });
					}
				});
			});
		},
	};
}
