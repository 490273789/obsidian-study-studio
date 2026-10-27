import React from "react";
import { Notice, type Plugin } from "obsidian";
import { BookOpen } from "lucide-react";
import type { AiService } from "../../core/ai";
import type { OutboundPort } from "../../core/net";
import { normalizeDictionarySettings } from "./domain/configuration";
import { DictionaryRuntime } from "./domain/dictionaryRuntime";
import { FavoriteBatchController } from "./domain/favorite-batch";
import { createFavoriteDraftGenerator } from "./domain/favorite-ai";
import { dictionaryStrings } from "./strings/dictionary";
import type { Language } from "../../core/shared/types";
import type { CardSourceMutation } from "../../core/shared/cardSourceMutation";
import { FlashcardButton } from "../../core/ui/primitives/Button";
import { DictionaryFavoriteView, DictionaryView } from "./ui";
import { playDictionaryAudio, stopDictionaryAudio } from "./ui/audio";
import { DictionaryFavoriteModal } from "./obsidian/favoriteModal";
import { DictionaryFavoriteBatchModal } from "./obsidian/favoriteBatchModal";
import { ObsidianFavoriteBatchSource } from "./obsidian/favoriteBatchSource";
import { FavoriteCategoryModal } from "./obsidian/favoriteCategoryModal";
import { DictionaryFavoritePresentation } from "./obsidian/favoritePresentation";
import { ObsidianDictionaryFavoriteStore } from "./obsidian/favoriteStore";
import { DictionarySettingsEditor } from "./obsidian/settingsEditor";
import { createDictionarySettingsStore } from "./obsidian/settingsStore";
import { createDictionarySelectionAdapter } from "./selectionAdapter";
import type { SelectionDictionaryAdapter } from "../../core/selectionHelper/domain/types";
import { createReactItemView } from "../../core/host/reactItemView";
import { defineFeatureLifetime } from "../../core/host/featureLifetime";
import { cls } from "../../core/shared/classNames";
import styles from "./ui/Dictionary.module.scss";
import type {
	WorkbenchHost,
	WorkbenchModule,
	WorkbenchSettingsSection,
} from "../../core/host/workbench";

const OPEN_COMMAND_ID = "open-dictionary";
const LOOKUP_SELECTION_COMMAND_ID = "dictionary-lookup-selection";

/** Settings section id this feature contributes. */
const DICTIONARY_SECTION_ID = "dictionary";

/** Obsidian view types of the dictionary lookup view and the favorites sidebar. */
const VIEW_TYPE_DICTIONARY = "flashcard-dictionary-view";
export const VIEW_TYPE_DICTIONARY_FAVORITE = "flashcard-dictionary-favorite-view";

interface DictionaryFeatureDeps {
	sourceEdits?: CardSourceMutation;
	ai: AiService;
	net: OutboundPort;
	plugin: Plugin;
}

interface DictionaryFeature extends WorkbenchModule<"dictionary"> {
	readonly selectionAdapter: SelectionDictionaryAdapter;
}

type DictionaryWorkbenchHost = WorkbenchHost<"dictionary">;

/**
 * The 词典 workbench feature: dictionary lookup, the favorites sidebar, and the
 * dictionary settings section. Owns its runtime, its views, its chrome, and its
 * persisted settings slice.
 */
export function createDictionaryFeature(deps: DictionaryFeatureDeps): DictionaryFeature {
	let active: {
		host: DictionaryWorkbenchHost;
		runtime: DictionaryRuntime;
		favorites: DictionaryFavoritePresentation;
	} | null = null;
	const searchFocus = new Map<HTMLElement, () => void>();

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

	const openPage = async (host: DictionaryWorkbenchHost): Promise<void> => {
		try {
			await host.activateView(VIEW_TYPE_DICTIONARY, { mainTab: true });
			const workspace = host.app.workspace;
			const leaf = workspace
				.getLeavesOfType(VIEW_TYPE_DICTIONARY)
				.find((candidate) => candidate.getRoot() === workspace.rootSplit);
			if (!leaf) return;
			for (const [root, focus] of searchFocus) {
				if (leaf.view.containerEl.contains(root)) {
					focus();
					break;
				}
			}
		} catch (error) {
			console.error("Failed to open the dictionary view:", error);
			new Notice(dictionaryStrings(host.settings.read().language).openFailed);
		}
	};

	const openQuery = async (
		host: DictionaryWorkbenchHost,
		dictionary: DictionaryRuntime,
		query: string,
		mainTab = false,
	): Promise<void> => {
		const strings = dictionaryStrings(host.settings.read().language);
		try {
			const lookup = dictionary.query.send({ type: "lookup", query });
			await host.activateView(VIEW_TYPE_DICTIONARY, mainTab ? { mainTab: true } : undefined);
			await lookup;
		} catch (error) {
			console.error("Failed to open the dictionary view:", error);
			new Notice(strings.openFailed);
		}
	};

	const selectionAdapter = createDictionarySelectionAdapter({
		runtime: () => active?.runtime ?? null,
		openInMainTab: async (query) => {
			if (!active) return;
			await openQuery(active.host, active.runtime, query, true);
		},
		openFavorite: async (word) => {
			if (!active) return;
			await active.favorites.open(word);
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

	const section = (editor: DictionarySettingsEditor): WorkbenchSettingsSection => {
		return {
			id: DICTIONARY_SECTION_ID,
			order: 3,
			label: (language) => dictionaryStrings(language).settingsHeading,
			presentation: () => editor.presentation(),
			activate: () => editor.activate(),
			hide: () => editor.hide(),
		};
	};

	const module = defineFeatureLifetime({
		id: "dictionary",
		start: (host, lifetime) => {
			const favoriteStore = new ObsidianDictionaryFavoriteStore(host.app, deps.sourceEdits);
			const dictionary = lifetime.own(
				new DictionaryRuntime({
					sourceEdits: deps.sourceEdits,
					favoriteStore,
					app: host.app,
					plugin: deps.plugin,
					settings: createDictionarySettingsStore({
						readDictionarySettings: () => host.settings.read().dictionary,
						commitDictionarySettings: async (dictionarySettings) => {
							await host.settings.update({
								dictionary: normalizeDictionarySettings(dictionarySettings),
							});
						},
					}),
					ai: deps.ai,
					language: () => host.settings.read().language,
					net: deps.net,
					notify: (message) => new Notice(message),
				}),
			);
			let batchModal: DictionaryFavoriteBatchModal | null = null;
			const openBatchFavorite = (): void => {
				if (batchModal) return;
				const controller = new FavoriteBatchController({
					session: dictionary.favorites,
					settings: dictionary.settings,
					source: new ObsidianFavoriteBatchSource(host.app),
					store: favoriteStore,
					generator: createFavoriteDraftGenerator(deps.ai),
					hasAiConfig: (id) =>
						deps.ai.getSnapshot().settings.configs.some((config) => config.id === id),
					language: () => host.settings.read().language,
				});
				batchModal = new DictionaryFavoriteBatchModal(
					host.app,
					controller,
					() => host.settings.read().language,
					() => {
						batchModal = null;
					},
				);
				batchModal.open();
			};
			lifetime.defer(() => batchModal?.forceClose());
			const favorites = lifetime.own(
				new DictionaryFavoritePresentation({
					session: dictionary.favorites,
					mode: () => host.settings.read().dictionary.favoriteOpenMode,
					sidebar: {
						open: () =>
							host.activateView(VIEW_TYPE_DICTIONARY_FAVORITE, {
								rightSidebar: true,
							}),
					},
					createModal: (onClosing) =>
						new DictionaryFavoriteModal(
							host.app,
							dictionary.favorites,
							() => host.settings.read().language,
							onClosing,
							() =>
								new FavoriteCategoryModal(
									host.app,
									dictionary.favorites,
									dictionaryStrings(host.settings.read().language),
									{ kind: "create", select: true },
								).open(),
						),
					reportOpenFailure: (error) => {
						console.error("Failed to open the dictionary favorite form:", error);
						new Notice(
							dictionaryStrings(host.settings.read().language).favoriteOpenFailed,
						);
					},
				}),
			);
			active = { host, runtime: dictionary, favorites };
			const editor = new DictionarySettingsEditor(
				dictionary,
				deps.ai,
				() => host.settings.read().language,
				// Source changes also affect the selection helper's dictionary choices.
				() => host.settingsTab.refresh(),
			);
			lifetime.defer(() => {
				editor.hide();
				searchFocus.clear();
				stopDictionaryAudio();
				active = null;
			});

			host.registerView(
				VIEW_TYPE_DICTIONARY,
				createReactItemView({
					type: VIEW_TYPE_DICTIONARY,
					icon: "book-open",
					title: (language) => dictionaryStrings(language).displayName,
					// The sandbox document follows Obsidian's theme independently of CSS.
					trackTheme: true,
					acquire: ({ rootEl }) => {
						let input: HTMLInputElement | null = null;
						let pending = false;
						searchFocus.set(rootEl, () => {
							pending = true;
							if (input) {
								pending = false;
								input.focus();
							}
						});
						return {
							resource: (element: HTMLInputElement | null): void => {
								input = element;
								if (input && pending) {
									pending = false;
									input.focus();
								}
							},
							dispose: () => {
								pending = false;
								input = null;
								searchFocus.delete(rootEl);
							},
						};
					},
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) => dictionaryStrings(language).openFailed,
					onClose: () =>
						resetWhenClosed(
							host,
							VIEW_TYPE_DICTIONARY,
							() => void dictionary.query.send({ type: "clear" }),
						),
					render: ({ language, theme, resource }) =>
						renderDictionaryBody(host, language, () => (
							<DictionaryView
								query={dictionary.query}
								searchInputRef={resource}
								language={language}
								onOpenFavorite={(word) => favorites.open(word)}
								onOpenBatchFavorite={openBatchFavorite}
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
					acquire: () => ({ resource: undefined, dispose: favorites.attachSidebar() }),
					render: ({ language }) =>
						renderDictionaryBody(host, language, () => (
							<DictionaryFavoriteView
								session={dictionary.favorites}
								language={language}
								onCreateCategory={() =>
									new FavoriteCategoryModal(
										host.app,
										dictionary.favorites,
										dictionaryStrings(language),
										{ kind: "create", select: true },
									).open()
								}
							/>
						)),
				}),
			);

			host.catalog({
				id: "dictionary",
				icon: BookOpen,
				order: 20,
				title: (language) => dictionaryStrings(language).displayName,
				openCommandId: OPEN_COMMAND_ID,
				shortcutKey: "dictionary",
				settingsSectionId: DICTIONARY_SECTION_ID,
				available: () => host.settings.read().dictionary.enabled,
				open: () => openPage(host),
			});
			host.settingsSection(section(editor));

			return () => {
				dictionary.applySettings();
				favorites.refresh();
				const strings = dictionaryStrings(host.settings.read().language);
				host.chrome((chrome) => {
					if (!host.settings.read().dictionary.enabled) return;
					chrome.command({
						id: LOOKUP_SELECTION_COMMAND_ID,
						name: strings.selectionCommand,
						selection: {
							run: (selection) => void openQuery(host, dictionary, selection),
						},
					});
				});
			};
		},
	});

	return { ...module, selectionAdapter };
}
