import { Platform } from "obsidian";
import { defineFeatureLifetime } from "../host/featureLifetime";
import type { WorkbenchHost, WorkbenchModule, WorkbenchSettingsSection } from "../host/workbench";
import { SelectionHelper } from "./domain/selectionHelper";
import type {
	SelectionDictionaryAdapter,
	SelectionHelperSettings,
	SelectionTranslationAdapter,
} from "./domain/types";
import { SelectionListener } from "./obsidian/selectionListener";
import { WebviewSelectionAdapter, type WebviewSelectionStatus } from "./obsidian/webviewSelection";
import { buildSelectionHelperSettingsViewModel } from "./settings/viewModel";
import { selectionHelperStrings } from "./strings/selectionPopup";
import type { SelectionEmbeddedContentRenderer } from "./ui/types";

export const SELECTION_HELPER_SECTION_ID = "selectionPopup";

export interface SelectionHelperModuleDeps {
	dictionary: SelectionDictionaryAdapter;
	translation: SelectionTranslationAdapter;
	renderEmbeddedContent?: SelectionEmbeddedContentRenderer;
}

type SelectionHelperWorkbenchHost = WorkbenchHost<"selectionHelper">;

/** The 工作台-owned 选区助手 module and its settings section. */
export function createSelectionHelperModule(
	deps: SelectionHelperModuleDeps,
): WorkbenchModule<"selectionHelper"> {
	const webStatuses = new Map<Document, WebviewSelectionStatus>();
	const webStatus = () =>
		!Platform.isDesktopApp
			? ("mobile" as const)
			: [...webStatuses.values()].includes("unavailable")
				? ("unavailable" as const)
				: [...webStatuses.values()].includes("available")
					? ("available" as const)
					: ("idle" as const);
	const section = (host: SelectionHelperWorkbenchHost): WorkbenchSettingsSection => ({
		id: SELECTION_HELPER_SECTION_ID,
		order: 4,
		label: (language) => selectionHelperStrings(language).settingsHeading,
		presentation: (language) => {
			const sources = deps.dictionary.sources();
			return buildSelectionHelperSettingsViewModel(
				host.settings.read().selectionPopup,
				sources.map(({ id, label }) => ({ id, label })),
				{
					setEnabled: async (enabled) => {
						await commitSelectionSettings(host, { enabled });
						host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
					},
					setModifier: async (modifier) => {
						await commitSelectionSettings(host, { modifier });
						host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
					},
					toggleDictionary: async (id, enabled) => {
						const current = host.settings.read().selectionPopup.selectedDictionaries;
						const base =
							current.length > 0 ? current : sources.map((source) => source.id);
						const selectedDictionaries = enabled
							? Array.from(new Set([...base, id]))
							: base.filter((item) => item !== id);
						await commitSelectionSettings(host, { selectedDictionaries });
						host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
					},
				},
				language,
				webStatus(),
			);
		},
	});

	return defineFeatureLifetime({
		id: "selectionHelper",
		start: (host, lifetime) => {
			const helper = lifetime.own(
				new SelectionHelper({
					settings: () => host.settings.read().selectionPopup,
					dictionary: deps.dictionary,
					translation: deps.translation,
				}),
			);
			const windows = new Map<
				Document,
				{ listener: SelectionListener; web: WebviewSelectionAdapter | null }
			>();
			const attach = (doc: Document) => {
				if (windows.has(doc)) return;
				const owner = {};
				const listener = new SelectionListener({
					owner,
					helper,
					document: doc,
					isEnabled: () => host.settings.read().selectionPopup.enabled,
					getLanguage: () => host.settings.read().language,
					getTheme: () => (host.app.isDarkMode() ? "dark" : "light"),
					renderEmbeddedContent: deps.renderEmbeddedContent,
				});
				const web = Platform.isDesktopApp
					? new WebviewSelectionAdapter({
							document: doc,
							isEnabled: () => host.settings.read().selectionPopup.enabled,
							openSource: () => helper.openSource(owner),
							interrupt: () => helper.interrupt(),
							onStatus: (status) => {
								if (webStatuses.get(doc) === status) return;
								webStatuses.set(doc, status);
								host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
							},
						})
					: null;
				windows.set(doc, { listener, web });
				listener.start();
				web?.start();
			};
			const detach = (doc: Document) => {
				const entry = windows.get(doc);
				if (!entry) return;
				entry.web?.stop();
				entry.listener.stop();
				windows.delete(doc);
				webStatuses.delete(doc);
			};
			lifetime.defer(() => {
				for (const doc of windows.keys()) detach(doc);
			});
			if (typeof document !== "undefined") {
				attach(document);
				host.app.workspace.iterateAllLeaves((leaf) =>
					attach(leaf.view.containerEl.ownerDocument),
				);
				const opened = host.app.workspace.on("window-open", (_workspaceWindow, win) =>
					attach(win.document),
				);
				const closed = host.app.workspace.on("window-close", (_workspaceWindow, win) =>
					detach(win.document),
				);
				const themeEvent = host.app.workspace.on("css-change", () => {
					for (const entry of windows.values()) entry.listener.refresh();
				});
				lifetime.defer(() => {
					host.app.workspace.offref(opened);
					host.app.workspace.offref(closed);
					host.app.workspace.offref(themeEvent);
				});
			}
			host.settingsSection(section(host));

			return () => {
				helper.refresh();
				for (const entry of windows.values()) entry.listener.refresh();
			};
		},
	});
}

async function commitSelectionSettings(
	host: SelectionHelperWorkbenchHost,
	patch: Partial<SelectionHelperSettings>,
): Promise<void> {
	await host.settings.update({
		selectionPopup: { ...host.settings.read().selectionPopup, ...patch },
	});
}
