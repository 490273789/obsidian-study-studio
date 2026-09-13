import React from "react";
import { Notice, type Plugin } from "obsidian";
import type { AiService } from "../../core/ai";
import type { OutboundPort } from "../../core/net";
import { normalizeDictionarySettings } from "./domain/configuration";
import { DictionaryRuntime } from "./domain/dictionaryRuntime";
import { dictionaryStrings } from "./strings/dictionary";
import type { Language } from "../../core/shared/types";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { DictionaryFavoriteView, DictionaryView } from "./ui";
import { playDictionaryAudio, stopDictionaryAudio } from "./ui/audio";
import { DictionaryLookupModal } from "./obsidian/modals";
import { DictionarySettingsEditor } from "./obsidian/settingsEditor";
import { createDictionarySettingsStore } from "./obsidian/settingsStore";
import { createDictionarySelectionAdapter } from "./selectionAdapter";
import type { SelectionDictionaryAdapter } from "../../core/selectionHelper/domain/types";
import { createReactItemView } from "../../core/host/reactItemView";
import { cls } from "../../core/shared/classNames";
import styles from "./ui/Dictionary.module.scss";
import type {
	WorkbenchModule,
	WorkbenchHost,
	WorkbenchSettingsSection,
} from "../../core/host/workbench";

const OPEN_COMMAND_ID = "open-dictionary";
const LOOKUP_SELECTION_COMMAND_ID = "dictionary-lookup-selection";

/** Settings section id this feature contributes. */
export const DICTIONARY_SECTION_ID = "dictionary";

/** Obsidian view types of the dictionary lookup view and the favorites sidebar. */
export const VIEW_TYPE_DICTIONARY = "flashcard-dictionary-view";
export const VIEW_TYPE_DICTIONARY_FAVORITE = "flashcard-dictionary-favorite-view";

export interface DictionaryFeatureDeps {
	ai: AiService;
	net: OutboundPort;
	plugin: Plugin;
}

export interface DictionaryFeature extends WorkbenchModule<"dictionary"> {
	readonly selectionAdapter: SelectionDictionaryAdapter;
}

type DictionaryWorkbenchHost = WorkbenchHost<"dictionary">;

/**
 * The 词典 workbench feature: dictionary lookup, the favorites sidebar, and the
 * dictionary settings section. Owns its runtime, its views, its chrome, and its
 * persisted settings slice.
 */
export function createDictionaryFeature(deps: DictionaryFeatureDeps): DictionaryFeature {
	let runtime: DictionaryRuntime | null = null;
	let editor: DictionarySettingsEditor | null = null;
	let modal: DictionaryLookupModal | null = null;
	let activeHost: DictionaryWorkbenchHost | null = null;

	const openSettings = (host: DictionaryWorkbenchHost): void => {
		host.settingsTab.open(DICTIONARY_SECTION_ID);
	};

	/** A view only resets its session once the last leaf of that type is gone. */
	const resetWhenClosed = (
		host: DictionaryWorkbenchHost,
		viewType: string,
		reset: () => void,
	): void => {
		queueMicrotask(() => {
			if (host.app.workspace.getLeavesOfType(viewType).length === 0) reset();
		});
	};

	const ensureRuntime = (host: DictionaryWorkbenchHost): DictionaryRuntime => {
		if (runtime) return runtime;
		runtime = new DictionaryRuntime({
			app: host.app,
			plugin: deps.plugin,
			settings: createDictionarySettingsStore({
				readDictionarySettings: () => host.settings.read().dictionary,
				commitDictionarySettings: async (dictionary) => {
					await host.settings.update({
						dictionary: normalizeDictionarySettings(dictionary),
					});
				},
			}),
			ai: deps.ai,
			language: () => host.settings.read().language,
			net: deps.net,
			notify: (message) => new Notice(message),
		});
		return runtime;
	};

	/** The open command and ribbon prompt for a word first, matching the source tool. */
	const openPrompt = (host: DictionaryWorkbenchHost): void => {
		modal?.close();
		modal = new DictionaryLookupModal(
			host.app,
			(query) => {
				modal = null;
				void openQuery(host, query);
			},
			dictionaryStrings(host.settings.read().language),
		);
		modal.open();
	};

	const openQuery = async (
		host: DictionaryWorkbenchHost,
		query: string,
		mainTab = false,
	): Promise<void> => {
		const strings = dictionaryStrings(host.settings.read().language);
		try {
			const dictionary = ensureRuntime(host);
			const lookup = dictionary.query.send({ type: "lookup", query });
			await host.activateView(VIEW_TYPE_DICTIONARY, mainTab ? { mainTab: true } : undefined);
			await lookup;
		} catch (error) {
			console.error("Failed to open the dictionary view:", error);
			new Notice(strings.openFailed);
		}
	};

	const selectionAdapter = createDictionarySelectionAdapter({
		runtime: () => runtime,
		openInMainTab: async (query) => {
			if (!activeHost) return;
			await openQuery(activeHost, query, true);
		},
	});
	/**
	 * The 词典 feature keeps both views registered while disabled: the previous
	 * adapters rendered this placeholder instead of the lookup UI.
	 */
	const renderDictionaryBody = (
		host: DictionaryWorkbenchHost,
		language: Language,
		body: () => React.ReactNode,
	): React.ReactNode => {
		if (host.settings.read().dictionary.enabled) return body();
		const strings = dictionaryStrings(language);
		return (
			<div className={cls("flashcard-dictionary-disabled", styles.disabled)}>
				<p className="fc-kicker">{strings.disabled}</p>
				<FlashcardButton variant="primary" onClick={() => openSettings(host)}>
					{strings.openSettings}
				</FlashcardButton>
			</div>
		);
	};

	const section = (
		host: DictionaryWorkbenchHost,
		dictionary: DictionaryRuntime,
	): WorkbenchSettingsSection => {
		editor ??= new DictionarySettingsEditor(
			dictionary,
			deps.ai,
			() => host.settings.read().language,
			() => host.settingsTab.refresh(),
		);
		const settingsEditor = editor;
		return {
			id: DICTIONARY_SECTION_ID,
			order: 3,
			label: (language) => dictionaryStrings(language).settingsHeading,
			presentation: () => settingsEditor.presentation(),
			activate: () => settingsEditor.activate(),
			hide: () => settingsEditor.hide(),
		};
	};

	return {
		id: "dictionary",

		render: (host) => {
			activeHost = host;
			const dictionary = ensureRuntime(host);

			host.registerView(
				VIEW_TYPE_DICTIONARY,
				createReactItemView({
					type: VIEW_TYPE_DICTIONARY,
					icon: "book-open",
					title: (language) => dictionaryStrings(language).displayName,
					// The sandbox document follows Obsidian's theme independently of CSS.
					trackTheme: true,
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) => dictionaryStrings(language).openFailed,
					onClose: () =>
						resetWhenClosed(
							host,
							VIEW_TYPE_DICTIONARY,
							() => void dictionary.query.send({ type: "clear" }),
						),
					render: ({ language, theme }) =>
						renderDictionaryBody(host, language, () => (
							<DictionaryView
								query={dictionary.query}
								language={language}
								onOpenFavorite={async (word) => {
									await dictionary.favoriteController.prefill(word);
									await host.activateView(VIEW_TYPE_DICTIONARY_FAVORITE, {
										rightSidebar: true,
									});
								}}
								onOpenSettings={() => openSettings(host)}
								onPlayAudio={async (url) => {
									if (!(await playDictionaryAudio(url))) {
										new Notice(dictionaryStrings(language).errors.network);
									}
								}}
								theme={theme}
							/>
						)),
				}),
			);
			host.registerView(
				VIEW_TYPE_DICTIONARY_FAVORITE,
				createReactItemView({
					type: VIEW_TYPE_DICTIONARY_FAVORITE,
					icon: "bookmark",
					title: (language) => dictionaryStrings(language).favoriteSidebarTitle,
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) =>
						dictionaryStrings(language).favoriteRenderFailed,
					onClose: () =>
						resetWhenClosed(host, VIEW_TYPE_DICTIONARY_FAVORITE, () =>
							dictionary.favoriteController.resetSession(),
						),
					render: ({ language }) =>
						renderDictionaryBody(host, language, () => (
							<DictionaryFavoriteView
								controller={dictionary.favoriteController}
								language={language}
							/>
						)),
				}),
			);

			dictionary.applySettings();

			host.catalog({
				id: "dictionary",
				icon: "book-open",
				title: (language) => dictionaryStrings(language).displayName,
				openCommandId: OPEN_COMMAND_ID,
				openHotkeys: [{ modifiers: ["Alt"], key: "2" }],
				settingsSectionId: DICTIONARY_SECTION_ID,
				available: () => host.settings.read().dictionary.enabled,
				open: () => openPrompt(host),
			});

			const strings = dictionaryStrings(host.settings.read().language);
			host.chrome((chrome) => {
				if (!host.settings.read().dictionary.enabled) return;
				chrome.command({
					id: LOOKUP_SELECTION_COMMAND_ID,
					name: strings.selectionCommand,
					selection: { run: (selection) => void openQuery(host, selection) },
				});
			});

			host.settingsSection(section(host, dictionary));
		},

		stop: () => {
			activeHost = null;
			modal?.close();
			modal = null;
			stopDictionaryAudio();
			runtime?.dispose();
			runtime = null;
		},

		selectionAdapter,
	};
}
