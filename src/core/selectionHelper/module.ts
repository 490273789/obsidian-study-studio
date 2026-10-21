import { Notice, Platform } from "obsidian";
import { defineFeatureLifetime } from "../host/featureLifetime";
import type { WorkbenchHost, WorkbenchModule, WorkbenchSettingsSection } from "../host/workbench";
import { isEnglishWordOrPhrase, SelectionHelper } from "./domain/selectionHelper";
import { orderSelectionDictionaries } from "./domain/dictionaryOrder";
import type {
	SelectionDictionaryAdapter,
	SelectionHelperSettings,
	SelectionTranslationAdapter,
} from "./domain/types";
import { SelectionListener } from "./obsidian/selectionListener";
import { WebviewSelectionAdapter, type WebviewSelectionStatus } from "./obsidian/webviewSelection";
import { buildSelectionHelperSettingsViewModel } from "./settings/viewModel";
import { parseOpenMainShortcut } from "./settings/openMainShortcut";
import { selectionHelperStrings } from "./strings/selectionPopup";
import type { SelectionResultContentRenderer } from "./ui/types";

const SELECTION_HELPER_SECTION_ID = "selectionPopup";

interface SelectionHelperModuleDeps {
	dictionary: SelectionDictionaryAdapter;
	translation: SelectionTranslationAdapter;
	renderResultContent?: SelectionResultContentRenderer;
}

type SelectionHelperWorkbenchHost = WorkbenchHost<"selectionHelper">;

/** The 工作台-owned 选区助手 module and its settings section. */
export function createSelectionHelperModule(
	deps: SelectionHelperModuleDeps,
): WorkbenchModule<"selectionHelper"> & { openDictionary(document?: Document): void } {
	let openDictionary: (document?: Document) => void = () => {};
	let saving = false;
	const save = async (
		host: SelectionHelperWorkbenchHost,
		patch: Partial<SelectionHelperSettings>,
	) => {
		if (saving) return;
		saving = true;
		host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
		try {
			await commitSelectionSettings(host, patch);
		} finally {
			saving = false;
			host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
		}
	};
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
					moveDictionary: async (fromIndex, toIndex) => {
						const current = host.settings.read().selectionPopup;
						const dictionaryOrder = orderSelectionDictionaries(
							sources,
							current.dictionaryOrder,
						).map((source) => source.id);
						const [moved] = dictionaryOrder.splice(fromIndex, 1);
						if (!moved) return;
						dictionaryOrder.splice(toIndex, 0, moved);
						// Keep preferences for dictionaries that are temporarily unavailable.
						const available = new Set(dictionaryOrder);
						await save(host, {
							dictionaryOrder: [
								...dictionaryOrder,
								...current.dictionaryOrder.filter((id) => !available.has(id)),
							],
						});
					},
					setEnabled: async (enabled) => {
						await save(host, { enabled });
					},
					setModifier: async (modifier) => {
						await save(host, { modifier });
					},
					setOpenMainShortcut: async (value) => {
						const shortcut = parseOpenMainShortcut(value);
						if (!shortcut) {
							new Notice(selectionHelperStrings(language).shortcutInvalid);
							host.settingsTab.refresh(SELECTION_HELPER_SECTION_ID);
							return;
						}
						await save(host, { openMainShortcut: shortcut });
					},
					toggleDictionary: async (id, enabled) => {
						const current = host.settings.read().selectionPopup.selectedDictionaries;
						const base =
							current.length > 0 ? current : sources.map((source) => source.id);
						const selectedDictionaries = enabled
							? Array.from(new Set([...base, id]))
							: base.filter((item) => item !== id);
						await save(host, { selectedDictionaries });
					},
				},
				language,
				webStatus(),
				saving,
			);
		},
	});

	const module = defineFeatureLifetime({
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
					renderResultContent: deps.renderResultContent,
				});
				const web = Platform.isDesktopApp
					? new WebviewSelectionAdapter({
							document: doc,
							isEnabled: () => host.settings.read().selectionPopup.enabled,
							openSource: () => helper.openSource(owner),
							openDictionary: (source, candidate) => {
								if (candidate && isEnglishWordOrPhrase(candidate.text))
									helper.openDictionary(source, candidate);
								else listener.openBlankDictionary();
							},
							interrupt: () => helper.interrupt(),
							isDictionaryPopup: () => {
								const snapshot = helper.getSnapshot();
								return snapshot.visible && snapshot.mode === "dictionary";
							},
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
			openDictionary = (doc) => {
				const active =
					doc ??
					[...windows.keys()].find((candidate) => candidate.hasFocus?.()) ??
					(typeof document === "undefined" ? undefined : document);
				if (!active) return;
				const entry = windows.get(active);
				helper.interrupt();
				if (!entry?.web?.openDictionary()) entry?.listener.openDictionary();
			};
			lifetime.defer(() => {
				openDictionary = () => {};
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
				host.chrome((chrome) =>
					chrome.command({
						id: "open-selection-dictionary-assistant",
						name: selectionHelperStrings(host.settings.read().language).openAssistant,
						shortcutKey: "selectionHelper",
						run: () => openDictionary(),
					}),
				);
				helper.refresh();
				for (const entry of windows.values()) entry.listener.refresh();
			};
		},
	});
	return Object.assign(module, { openDictionary: (doc?: Document) => openDictionary(doc) });
}

async function commitSelectionSettings(
	host: SelectionHelperWorkbenchHost,
	patch: Partial<SelectionHelperSettings>,
): Promise<void> {
	await host.settings.update({
		selectionPopup: { ...host.settings.read().selectionPopup, ...patch },
	});
}
