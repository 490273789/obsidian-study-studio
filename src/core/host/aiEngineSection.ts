import type { App } from "obsidian";
import type { AiService } from "../ai";
import { aiStrings } from "../i18n/ai";
import { createSharedTranslator } from "../i18n";
import type { Language } from "../shared/types";
import { confirmAiEngineDeletion } from "./aiEngineDeleteModal";
import { AiSettingsEditor } from "./aiSettingsEditor";
import { AI_ENGINE_SECTION_ID } from "./sectionIds";
import type { WorkbenchSettingsSection } from "./workbench";

export { AI_ENGINE_SECTION_ID };

interface AiEngineSectionOptions {
	app?: App;
	ai: AiService;
	confirmDelete?: (name: string, isDefault: boolean) => Promise<boolean>;
	/** Re-renders the settings tab; the editor calls it on every committed change. */
	refresh(): void;
}

/**
 * The AI engine configuration is shared by every feature that calls AI, so it is
 * a host-owned section rather than any one feature's. Its position sits between
 * the flashcards section and the feature sections, matching the historical tab order.
 */
export function createAiEngineSection(options: AiEngineSectionOptions): WorkbenchSettingsSection {
	let language: Language = "zh";
	const confirmDelete =
		options.confirmDelete ??
		(options.app
			? (name: string, isDefault: boolean) => {
					const t = aiStrings(language);
					return confirmAiEngineDeletion(options.app!, name, isDefault, {
						title: t.deleteConfirmTitle,
						message: isDefault ? t.deleteConfirmDefaultMessage : t.deleteConfirmMessage,
						cancel: t.deleteConfirmCancel,
						action: t.deleteConfirmAction,
					});
				}
			: undefined);

	const editor = new AiSettingsEditor(
		options.ai,
		() => language,
		() => options.refresh(),
		confirmDelete,
	);

	return {
		id: AI_ENGINE_SECTION_ID,
		category: "language",
		order: 1,
		label: (next) => createSharedTranslator(next)("settings.tabAi"),
		presentation: (next) => {
			language = next;
			return editor.presentation();
		},
		activate: () => editor.activate(),
		hide: () => editor.hide(),
	};
}
