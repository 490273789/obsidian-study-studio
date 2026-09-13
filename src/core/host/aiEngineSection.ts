import type { AiService } from "../ai";
import { createSharedTranslator } from "../i18n";
import type { Language } from "../shared/types";
import { AiSettingsEditor } from "./aiSettingsEditor";
import type { WorkbenchSettingsSection } from "./workbench";

/** Settings section id; also the section features target when opening AI settings. */
export const AI_ENGINE_SECTION_ID = "ai";

export interface AiEngineSectionOptions {
	ai: AiService;
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
	const editor = new AiSettingsEditor(
		options.ai,
		() => language,
		() => options.refresh(),
	);

	return {
		id: AI_ENGINE_SECTION_ID,
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
