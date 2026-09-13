import { Notice } from "obsidian";
import type { AiService } from "../../core/ai";
import type { OutboundPort } from "../../core/net";
import { translationStrings } from "./strings/translation";
import { translationSettingsStrings } from "./strings/settings";
import { normalizeTranslationSettings } from "./domain/configuration";
import { TranslationRuntime } from "./domain/translationRuntime";
import { detectTranslationDirection } from "./domain/selectionDirection";
import { translateYoudao } from "./domain/youdao";
import { createSharedTranslator } from "../../core/i18n";
import { TranslatorView } from "./ui";
import { createReactItemView } from "../../core/host/reactItemView";
import { TranslationSettingsEditor } from "./obsidian/settingsEditor";
import type {
	WorkbenchHost,
	WorkbenchModule,
	WorkbenchSettingsSection,
} from "../../core/host/workbench";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import type { SelectionTranslationAdapter } from "../../core/selectionHelper/domain/types";

/** Settings section id this feature contributes. */
export const TRANSLATION_SECTION_ID = "translation";

/** Obsidian view type of the translator view. */
export const VIEW_TYPE_TRANSLATOR = "flashcard-translator-view";

const OPEN_COMMAND_ID = "open-ai-translator";
const SELECTION_COMMAND_ID = "translate-selection";

export interface TranslationFeatureDeps {
	ai: AiService;
	net: OutboundPort;
}

export interface TranslationFeature extends WorkbenchModule<"translation"> {
	readonly selectionAdapter: SelectionTranslationAdapter;
}

type TranslationWorkbenchHost = WorkbenchHost<"translation">;

/**
 * The AI 翻译 workbench feature: the translator view and its settings section.
 * Owns its runtime, its chrome, and its persisted settings slice.
 */
export function createTranslationFeature(deps: TranslationFeatureDeps): TranslationFeature {
	let active: { host: TranslationWorkbenchHost; runtime: TranslationRuntime } | null = null;

	const activateView = async (host: TranslationWorkbenchHost): Promise<void> => {
		try {
			await host.activateView(VIEW_TYPE_TRANSLATOR);
		} catch {
			new Notice(translationStrings(host.settings.read().language).openFailed);
		}
	};

	const selectionAdapter: SelectionTranslationAdapter = {
		available: () => Boolean(active?.host.settings.read().translation.enabled),
		openPrefilled: async (text) => {
			if (!active) return;
			const { host, runtime: translation } = active;
			const direction = detectTranslationDirection(text);
			const snapshot = translation.getSnapshot();
			if (snapshot.settings.direction !== direction) {
				await translation.configure({ ...snapshot.settings, direction });
			}
			translation.prefill(text);
			try {
				await host.activateView(VIEW_TYPE_TRANSLATOR, { mainTab: true });
			} catch {
				new Notice(translationStrings(host.settings.read().language).openFailed);
			}
		},
	};

	const section = (
		translation: TranslationRuntime,
		editor: TranslationSettingsEditor,
	): WorkbenchSettingsSection => {
		return {
			id: TRANSLATION_SECTION_ID,
			order: 2,
			label: (language) => translationSettingsStrings(language).heading,
			presentation: () => editor.presentation(),
			activate: () => editor.activate(),
			hide: () => editor.hide(),
		};
	};

	const module = defineFeatureLifetime({
		id: "translation",
		start(host, lifetime) {
			const translation = lifetime.own(
				new TranslationRuntime(host.settings.read().translation, deps.ai, {
					persist: async (settings) => {
						await host.settings.update({
							translation: normalizeTranslationSettings(settings),
						});
					},
					youdao: (connection, text, direction, signal) =>
						translateYoudao(connection, text, direction, deps.net, signal),
				}),
			);
			active = { host, runtime: translation };

			const editor = new TranslationSettingsEditor(
				translation,
				deps.ai,
				() => host.settings.read().language,
				() => host.settingsTab.refresh(),
			);
			let detachOpenView: (() => void) | null = null;
			lifetime.defer(() => {
				editor.hide();
				detachOpenView?.();
				detachOpenView = null;
				active = null;
			});

			host.registerView(
				VIEW_TYPE_TRANSLATOR,
				createReactItemView({
					type: VIEW_TYPE_TRANSLATOR,
					icon: "languages",
					title: (language) => translationStrings(language).title,
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) =>
						createSharedTranslator(language)("notice.viewRenderFailed"),
					onOpen: () => {
						detachOpenView = translation.attachView();
					},
					onClose: () => {
						detachOpenView?.();
						detachOpenView = null;
					},
					render: ({ language }) => (
						<TranslatorView
							runtime={translation}
							language={language}
							onOpenSettings={() => host.settingsTab.open(TRANSLATION_SECTION_ID)}
						/>
					),
				}),
			);

			host.catalog({
				id: "translation",
				icon: "languages",
				title: (language) => translationStrings(language).title,
				openCommandId: OPEN_COMMAND_ID,
				openHotkeys: [{ modifiers: ["Alt"], key: "3" }],
				settingsSectionId: TRANSLATION_SECTION_ID,
				available: () => host.settings.read().translation.enabled,
				open: () => {
					void activateView(host);
				},
			});

			host.settingsSection(section(translation, editor));

			return () => {
				const strings = translationStrings(host.settings.read().language);
				host.chrome((chrome) => {
					if (!host.settings.read().translation.enabled) return;
					chrome.command({
						id: SELECTION_COMMAND_ID,
						name: strings.selectionCommand,
						selection: {
							// Prefilling only: translating always needs an explicit action.
							run: (selection) => {
								translation.prefill(selection);
								void activateView(host);
							},
						},
					});
				});
			};
		},
	});

	return { ...module, selectionAdapter };
}
