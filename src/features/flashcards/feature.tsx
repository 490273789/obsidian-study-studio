import { Notice, Platform, type Plugin } from "obsidian";
import { createTranslator, flashcardTranslator } from "./strings/index";
import type { Language, PronunciationSettings, StudySettings } from "../../core/shared/types";
import type { OwnedSettings } from "../../core/host/settingsSlices";
import { buildSettingsViewModel, type SettingsViewModelActions } from "./settings/viewModel";
import type { OutboundPort } from "../../core/net";
import type { WorkbenchStore } from "../../core/storage/workbenchStore";
import { createDeckIndexCacheStore } from "../../core/storage/deckIndexCache";
import { FlashcardRepository, type SerializedDeck } from "./domain/storage/flashcardRepository";
import {
	createDeckHome,
	type DeckHome,
	type DeckHomeEvent,
	type DeckHomeSettingsPatch,
} from "./domain/decks/deckHome";
import { exportDeckToPdf } from "./domain/decks/deckPdfExporter";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuity,
	type ResolutionOutcome,
} from "./domain/identity/cardIdentityContinuity";
import { createCardIdentity } from "./domain/identity/cardIdentity";
import { describeSynchronizationOutcome } from "./domain/identity/synchronizationFeedback";
import { createPronunciationRuntime, type PronunciationRuntime } from "./domain/pronunciation";
import { createSessionLifecycle, type SessionLifecycle } from "./domain/sessions/sessionLifecycle";
import { CardIdentityMigrationModal, CardIdentityRepairModal } from "./obsidian/continuityModals";
import { createObsidianContinuitySourceStore } from "./obsidian/continuityAdapters";
import { WorkbenchFlashcardAuthority } from "./obsidian/workbenchFlashcardAuthority";
import { FlashcardApp } from "./ui/FlashcardApp";
import { createReactItemView } from "../../core/host/reactItemView";
import type {
	WorkbenchModule,
	WorkbenchHost,
	WorkbenchSettingsSection,
} from "../../core/host/workbench";

/** Settings section id this feature contributes. */
export const FLASHCARD_SECTION_ID = "flashcards";

/** Obsidian view type of the 闪卡 workbench view. */
export const VIEW_TYPE_FLASHCARD = "flashcard-view";

const OPEN_COMMAND_ID = "open-flashcard-view";
const SYNC_COMMAND_ID = "sync-flashcard-decks";
const MIGRATE_IDENTITIES_COMMAND_ID = "migrate-card-identities";
const REPAIR_IDENTITIES_COMMAND_ID = "repair-card-identities";

export interface FlashcardFeatureDeps {
	store: WorkbenchStore;
	net: OutboundPort;
	plugin?: Plugin;
	repository?: FlashcardRepository;
}

interface FlashcardServices {
	sessionLifecycle: SessionLifecycle;
	cardIdentityContinuity: CardIdentityContinuity;
	deckHome: DeckHome;
	pronunciationRuntime: PronunciationRuntime;
}

type FlashcardWorkbenchHost = WorkbenchHost<"flashcards">;

/**
 * The 闪卡 workbench feature: 题库首页, 学习会话, 刷题会话, 拼写会话, 单词表, PDF 导出,
 * 卡片身份维护, and the flashcards settings section. Owns every deep module that no
 * other feature uses yet; the repository receives a feature-owned authority adapter
 * instead of the shared store's generic document interface.
 */
export function createFlashcardFeature(deps: FlashcardFeatureDeps): WorkbenchModule<"flashcards"> {
	let repository: FlashcardRepository | null = deps.repository ?? null;
	let services: FlashcardServices | null = null;
	let exportNotice: Notice | null = null;
	let pronunciationUnsubscribe: (() => void) | null = null;
	let didRetryFailedCacheUsage = false;
	// Tag discovery state belongs to the settings section's presentation.
	let availableTags: string[] = [];
	let isLoadingTags = false;
	let hasLoadedTags = false;

	const t = (host: FlashcardWorkbenchHost) => createTranslator(host.settings.read().language);

	const ensureRepository = (host: FlashcardWorkbenchHost): FlashcardRepository => {
		if (!repository) {
			repository = new FlashcardRepository({
				authority: new WorkbenchFlashcardAuthority({
					store: deps.store,
					adapter: host.app?.vault?.adapter,
					pluginDirectory: deps.plugin?.manifest?.dir,
				}),
				deckIndexCache: createDeckIndexCacheStore<SerializedDeck>(
					host.app?.vault?.adapter,
					deps.plugin?.manifest?.dir,
				),
			});
		}
		return repository;
	};

	const ensureServices = (host: FlashcardWorkbenchHost): FlashcardServices => {
		if (services) return services;
		const repo = ensureRepository(host);
		const sessionLifecycleWiring = createSessionLifecycle(repo);
		const cardIdentityContinuity = createCardIdentityContinuity({
			sources: createObsidianContinuitySourceStore(host.app),
			state: repo.createContinuityStateStore(),
			sessions: sessionLifecycleWiring.continuitySessions,
			createIdentity: createCardIdentity,
		});
		const pronunciationRuntime = createPronunciationRuntime(
			deps.net,
			host.settings.read().pronunciation,
			{
				persistSettings: async (pronunciation) => {
					await host.settings.update({ pronunciation: { ...pronunciation } });
				},
			},
		);
		const deckHome = createDeckHome({
			repository: repo,
			identity: cardIdentityContinuity,
			saveSettingsPatch: async (patch) => saveDeckSettingsPatch(host, patch),
			saveDeckOrder: async (deckOrder) => {
				await host.settings.update({ deckOrder: [...deckOrder] });
			},
			exportDeck: async (deck, onProgress) => {
				if (!Platform.isDesktopApp) {
					throw new Error(t(host)("notice.pdfExportDesktopOnly"));
				}
				return exportDeckToPdf(
					host.app,
					deck,
					{
						frontColumn: t(host)("common.cardFront"),
						backColumn: t(host)("common.cardBack"),
						cardCount: (count) => t(host)("pdf.cardCount", { count }),
						saveDialogTitle: t(host)("pdf.saveDialogTitle"),
					},
					{ onProgress },
				);
			},
			report: (event) => reportDeckHomeEvent(host, event),
		});
		services = {
			sessionLifecycle: sessionLifecycleWiring.lifecycle,
			cardIdentityContinuity,
			deckHome,
			pronunciationRuntime,
		};
		return services;
	};

	/** A deck settings patch writes both per-deck maps in one durable commit. */
	const saveDeckSettingsPatch = async (
		host: FlashcardWorkbenchHost,
		patch: DeckHomeSettingsPatch,
	): Promise<void> => {
		const deckStudySettings = { ...host.settings.read().deckStudySettings };
		if (patch.overrides === null) {
			delete deckStudySettings[patch.deckId];
		} else {
			deckStudySettings[patch.deckId] = patch.overrides;
		}
		const wordLearningDecks = { ...host.settings.read().wordLearningDecks };
		if (patch.wordLearningEnabled) {
			wordLearningDecks[patch.deckId] = true;
		} else {
			delete wordLearningDecks[patch.deckId];
		}
		await host.settings.update({ deckStudySettings, wordLearningDecks });
	};

	// ------------------------------------------------------------------
	// Deck-home reporting and card identity maintenance
	// ------------------------------------------------------------------

	const reportDeckHomeEvent = (host: FlashcardWorkbenchHost, event: DeckHomeEvent): void => {
		const strings = t(host);
		if (event.kind === "refresh-completed") {
			const message = describeSynchronizationOutcome(
				event.outcome,
				services!.cardIdentityContinuity.inspect(),
				host.settings.read().language,
			);
			if (message) new Notice(message, 12000);
			return;
		}
		if (event.kind === "migration-completed") {
			showIdentityResolutionOutcome(host, event.outcome);
			return;
		}
		if (event.kind === "settings-save-failed") {
			new Notice(strings("notice.deckSettingsSaveFailed", { message: event.message }));
			return;
		}
		if (event.kind === "export-progress") {
			const message =
				event.progress.phase === "rendering"
					? strings("notice.pdfExportRendering", {
							completed: event.progress.completed,
							total: event.progress.total,
						})
					: strings("notice.pdfExportGenerating");
			if (exportNotice) {
				exportNotice.setMessage(message);
			} else {
				exportNotice = new Notice(message, 0);
			}
			return;
		}
		exportNotice?.hide();
		exportNotice = null;
		if (event.kind === "export-completed") {
			if (event.result.kind === "saved") {
				new Notice(
					strings("notice.pdfExportSaved", { filePath: event.result.filePath }),
					8000,
				);
			}
			return;
		}
		new Notice(strings("notice.pdfExportFailed", { message: event.message }));
	};

	const showIdentityResolutionOutcome = (
		host: FlashcardWorkbenchHost,
		outcome: ResolutionOutcome,
	): void => {
		const strings = t(host);
		if (outcome.kind === "applied") {
			new Notice(strings("identity.migrationApplied"));
			return;
		}
		if (outcome.kind === "resumable") {
			new Notice(strings("identity.operationResumable"));
			return;
		}
		if (outcome.kind === "failed") {
			new Notice(strings("identity.operationFailed", { message: outcome.message }));
			return;
		}
		new Notice(
			strings(
				outcome.reason === "active-session"
					? "identity.migrationBlocked"
					: outcome.reason === "legacy-source-mismatch"
						? "identity.migrationSourceMismatch"
						: "identity.previewExpired",
			),
		);
	};

	const applyIdentityResolution = async (
		host: FlashcardWorkbenchHost,
		resolution: Promise<ResolutionOutcome>,
		type: "migration" | "repair",
	): Promise<void> => {
		const outcome = await resolution;
		const strings = t(host);
		if (outcome.kind === "applied") {
			new Notice(
				strings(
					type === "migration" ? "identity.migrationApplied" : "identity.repairApplied",
				),
			);
			return;
		}
		if (outcome.kind === "resumable") {
			new Notice(strings("identity.operationResumable"));
			return;
		}
		if (outcome.kind === "failed") {
			new Notice(strings("identity.operationFailed", { message: outcome.message }));
			return;
		}
		new Notice(
			strings(
				outcome.reason === "active-session"
					? "identity.migrationBlocked"
					: outcome.reason === "legacy-source-mismatch"
						? "identity.migrationSourceMismatch"
						: "identity.previewExpired",
			),
		);
	};

	const openIdentityMigration = async (host: FlashcardWorkbenchHost): Promise<void> => {
		const { cardIdentityContinuity, deckHome } = ensureServices(host);
		const ownerId = "command:migrate-card-identities";
		const request = await deckHome.act({ kind: "request-migration", ownerId });
		if (request.kind === "rejected" && request.reason === "migration-unavailable") {
			new Notice(t(host)("identity.noMigration"));
			return;
		}
		if (request.kind !== "confirmation-required") return;
		const preview = cardIdentityContinuity.inspect().migration;
		if (!preview) {
			await deckHome.act({
				kind: "continue",
				ownerId,
				continuation: request.continuation,
				confirmed: false,
			});
			return;
		}
		new CardIdentityMigrationModal(
			host.app,
			preview,
			t(host),
			() => {
				void deckHome.act({
					kind: "continue",
					ownerId,
					continuation: request.continuation,
					confirmed: true,
				});
			},
			() => {
				void deckHome.act({
					kind: "continue",
					ownerId,
					continuation: request.continuation,
					confirmed: false,
				});
			},
		).open();
	};

	const openIdentityRepair = async (host: FlashcardWorkbenchHost): Promise<void> => {
		const { cardIdentityContinuity } = ensureServices(host);
		const outcome = await cardIdentityContinuity.synchronize();
		if (outcome.kind === "failed") {
			new Notice(t(host)("identity.syncFailed", { message: outcome.message }));
			return;
		}
		const issue = cardIdentityContinuity.inspect().issues[0];
		if (!issue) {
			new Notice(t(host)("identity.noRepair"));
			return;
		}
		new CardIdentityRepairModal(
			host.app,
			issue,
			t(host),
			(successors) => {
				void applyIdentityResolution(
					host,
					cardIdentityContinuity.resolve({
						kind: "repair",
						ticket: issue.ticket,
						issueId: issue.id,
						successors,
					}),
					"repair",
				);
			},
			() => new Notice(t(host)("identity.duplicateAssignment")),
		).open();
	};

	const runIdentitySynchronization = async (host: FlashcardWorkbenchHost): Promise<void> => {
		const { cardIdentityContinuity, deckHome } = ensureServices(host);
		const outcome = await deckHome.act({ kind: "refresh" });
		if (outcome.kind === "applied" && cardIdentityContinuity.inspect().issues.length === 0) {
			new Notice(t(host)("identity.syncCurrent"));
		}
	};

	// ------------------------------------------------------------------
	// Flashcards settings section
	// ------------------------------------------------------------------

	const writeSettings = async (
		host: FlashcardWorkbenchHost,
		patch: Partial<OwnedSettings<"flashcards">>,
		refreshSection: boolean,
	): Promise<void> => {
		await host.settings.update(patch);
		if (refreshSection) host.settingsTab.refresh();
	};

	const ensureAvailableTagsLoaded = (host: FlashcardWorkbenchHost): void => {
		if (hasLoadedTags || isLoadingTags) return;
		// Opening settings must stay cheap. A full vault scan is reserved for the
		// explicit refresh action; otherwise large vaults make the first render wait.
		const repo = ensureRepository(host);
		if (!repo.hasAvailableTagsSnapshot()) return;
		availableTags = repo.getAvailableTags();
		hasLoadedTags = true;
	};

	const cleanMissingConfiguredTags = (
		host: FlashcardWorkbenchHost,
		nextAvailableTags: string[],
	): { flashcardTags: string[]; removedCount: number } => {
		const availableTagSet = new Set(nextAvailableTags.map((tag) => tag.trim().toLowerCase()));
		const originalTags = host.settings.read().flashcardTags;
		const flashcardTags = originalTags.filter((tag) => {
			const normalizedTag = tag.trim();
			return normalizedTag.length === 0 || availableTagSet.has(normalizedTag.toLowerCase());
		});
		return { flashcardTags, removedCount: originalTags.length - flashcardTags.length };
	};

	const refreshAvailableTags = async (
		host: FlashcardWorkbenchHost,
		options: { cleanConfiguredTags: boolean },
	): Promise<void> => {
		if (isLoadingTags) return;
		const strings = t(host);
		isLoadingTags = true;
		host.settingsTab.refresh();

		try {
			await ensureServices(host).cardIdentityContinuity.synchronize();
			availableTags = ensureRepository(host).getAvailableTags();
			hasLoadedTags = true;

			let removedCount = 0;
			if (options.cleanConfiguredTags) {
				const cleaned = cleanMissingConfiguredTags(host, availableTags);
				removedCount = cleaned.removedCount;
				await host.settings.update({ flashcardTags: cleaned.flashcardTags });
			}

			new Notice(
				options.cleanConfiguredTags
					? strings("settings.tagsRefreshedAndCleaned", {
							count: String(removedCount),
						})
					: strings("settings.tagsRefreshed"),
			);
		} catch (error) {
			console.error("Failed to refresh flashcard tags:", error);
			new Notice(strings("settings.tagsRefreshFailed"));
		} finally {
			isLoadingTags = false;
			host.settingsTab.refresh();
		}
	};

	const configurePronunciation = async (
		host: FlashcardWorkbenchHost,
		patch: Partial<PronunciationSettings>,
	): Promise<void> => {
		const outcome = await ensureServices(host).pronunciationRuntime.configure(patch);
		if (outcome.status === "applied") return;
		const strings = t(host);
		new Notice(
			outcome.status === "busy"
				? strings("settings.pronunciationBusy")
				: strings("settings.pronunciationSaveFailed"),
		);
	};

	const testOnlinePronunciation = async (host: FlashcardWorkbenchHost): Promise<void> => {
		const strings = t(host);
		try {
			const outcome =
				await ensureServices(host).pronunciationRuntime.testOnlineProvider("hello");
			if (outcome.status === "success") {
				new Notice(strings("settings.pronunciationTestSuccess"));
				return;
			}
			if (outcome.status === "cancelled") return;
			if (outcome.status === "busy") {
				new Notice(strings("settings.pronunciationBusy"));
				return;
			}
			const key =
				outcome.reason === "offline"
					? "settings.pronunciationTestOffline"
					: outcome.reason === "not-configured"
						? "settings.pronunciationTestNotConfigured"
						: outcome.reason === "unauthorized"
							? "settings.pronunciationTestUnauthorized"
							: outcome.reason === "quota"
								? "settings.pronunciationTestQuota"
								: "settings.pronunciationTestFailed";
			new Notice(strings(key));
		} catch {
			new Notice(strings("settings.pronunciationTestFailed"));
		}
	};

	const clearPronunciationCache = async (host: FlashcardWorkbenchHost): Promise<void> => {
		const strings = t(host);
		try {
			const outcome = await ensureServices(host).pronunciationRuntime.clearCache();
			new Notice(
				outcome.status === "cleared"
					? strings("settings.pronunciationCacheCleared")
					: outcome.status === "busy"
						? strings("settings.pronunciationBusy")
						: strings("settings.pronunciationCacheClearFailed"),
			);
		} catch {
			new Notice(strings("settings.pronunciationCacheClearFailed"));
		}
	};

	const createSettingsActions = (host: FlashcardWorkbenchHost): SettingsViewModelActions => {
		const patchTags = (mutate: (tags: string[]) => void) => {
			const flashcardTags = [...host.settings.read().flashcardTags];
			mutate(flashcardTags);
			return writeSettings(host, { flashcardTags }, true);
		};
		const patchStudy = (patch: Partial<StudySettings>) => writeSettings(host, patch, false);

		return {
			refreshTags: (options) => refreshAvailableTags(host, options),
			updateFlashcardTag: (index, value) =>
				patchTags((tags) => {
					tags[index] = value;
				}),
			addFlashcardTag: () => patchTags((tags) => tags.push("")),
			removeFlashcardTag: (index) =>
				patchTags((tags) => {
					tags.splice(index, 1);
				}),
			addDiscoveredTag: (tag) => patchTags((tags) => tags.push(tag)),
			setLanguage: async (language) => {
				await host.settings.setLanguage(language);
				host.settingsTab.refresh();
			},
			setDailyNewCards: (value) => patchStudy({ dailyNewCards: value }),
			setDailyReviewCards: (value) => patchStudy({ dailyReviewCards: value }),
			setStudyOrder: (value) => patchStudy({ studyOrder: value }),
			setRequestRetention: (value) =>
				writeSettings(
					host,
					{
						fsrsParameters: {
							...host.settings.read().fsrsParameters,
							requestRetention: value,
						},
					},
					false,
				),
			setMaximumInterval: (value) =>
				writeSettings(
					host,
					{
						fsrsParameters: {
							...host.settings.read().fsrsParameters,
							maximumInterval: value,
						},
					},
					false,
				),
			setPronunciationAutoPlay: (value) =>
				configurePronunciation(host, { spellingAutoPlay: value }),
			setPronunciationAccent: (value) => configurePronunciation(host, { accent: value }),
			setPronunciationRate: (value) => configurePronunciation(host, { rate: value }),
			setOnlinePronunciationProvider: (value) =>
				configurePronunciation(host, { onlineProvider: value }),
			setAzureCloud: (value) => configurePronunciation(host, { azureCloud: value }),
			setAzureRegion: (value) => configurePronunciation(host, { azureRegion: value }),
			setAzureSecretId: (value) => configurePronunciation(host, { azureSecretId: value }),
			setOpenAiSecretId: (value) => configurePronunciation(host, { openaiSecretId: value }),
			testOnlinePronunciation: () => testOnlinePronunciation(host),
			clearPronunciationCache: () => clearPronunciationCache(host),
		};
	};

	const section = (host: FlashcardWorkbenchHost): WorkbenchSettingsSection => ({
		id: FLASHCARD_SECTION_ID,
		order: 0,
		label: (language: Language) => createTranslator(language)("settings.tabFlashcards"),
		presentation: (language) => {
			ensureAvailableTagsLoaded(host);
			return buildSettingsViewModel(
				{
					settings: host.settings.read(),
					availableTags,
					isLoadingTags,
					hasLoadedTags,
					language,
					pronunciation: ensureServices(host).pronunciationRuntime.getSnapshot(),
				},
				createSettingsActions(host),
			);
		},
		activate: () => {
			const { pronunciationRuntime } = ensureServices(host);
			pronunciationUnsubscribe ??= pronunciationRuntime.subscribe(() =>
				host.settingsTab.refresh(),
			);
			if (
				!didRetryFailedCacheUsage &&
				pronunciationRuntime.getSnapshot().cacheUsage.status === "failed"
			) {
				didRetryFailedCacheUsage = true;
				void pronunciationRuntime.refreshCacheUsage();
			}
		},
		hide: () => {
			pronunciationUnsubscribe?.();
			pronunciationUnsubscribe = null;
			didRetryFailedCacheUsage = false;
		},
	});

	return {
		id: "flashcards",

		render: (host) => {
			const { sessionLifecycle, cardIdentityContinuity, deckHome, pronunciationRuntime } =
				ensureServices(host);

			host.registerView(
				VIEW_TYPE_FLASHCARD,
				createReactItemView({
					type: VIEW_TYPE_FLASHCARD,
					icon: "layers",
					title: (language) => createTranslator(language)("main.viewTitle"),
					readSettings: () => host.settings.read(),
					renderErrorMessage: (language) =>
						createTranslator(language)("notice.viewRenderFailed"),
					translator: flashcardTranslator,
					onOpen: () => {
						void deckHome.act({ kind: "refresh" });
					},
					onClose: () => pronunciationRuntime.stop(),
					render: ({ app, settings, rootEl }) => (
						<FlashcardApp
							app={app}
							modalHost={rootEl}
							cardIdentityContinuity={cardIdentityContinuity}
							sessionLifecycle={sessionLifecycle}
							pronunciationRuntime={pronunciationRuntime}
							deckHome={deckHome}
							settings={settings}
							onOpenSettings={() => host.settingsTab.open()}
							onOpenTranslation={() => host.openFeature("translation")}
							onOpenDictionary={() => host.openFeature("dictionary")}
						/>
					),
				}),
			);

			// The workbench owns the entry point (ribbon, home list, and the open
			// command); a feature only declares what it is and what else it offers.
			host.catalog({
				id: "flashcards",
				icon: "layers",
				title: (language) => createTranslator(language)("main.viewTitle"),
				openCommandId: OPEN_COMMAND_ID,
				openHotkeys: [{ modifiers: ["Alt"], key: "1" }],
				settingsSectionId: FLASHCARD_SECTION_ID,
				available: () => true,
				open: () => {
					void host.activateView(VIEW_TYPE_FLASHCARD);
				},
			});

			const strings = t(host);
			host.chrome((chrome) => {
				chrome.command({
					id: SYNC_COMMAND_ID,
					name: strings("main.commandSyncDecks"),
					run: () => {
						void runIdentitySynchronization(host);
					},
				});
				chrome.command({
					id: MIGRATE_IDENTITIES_COMMAND_ID,
					name: strings("main.commandMigrateCardIdentities"),
					run: () => {
						void openIdentityMigration(host);
					},
				});
				chrome.command({
					id: REPAIR_IDENTITIES_COMMAND_ID,
					name: strings("main.commandRepairCardIdentities"),
					run: () => {
						void openIdentityRepair(host);
					},
				});
			});

			host.settingsSection(section(host));
		},

		stop: () => {
			pronunciationUnsubscribe?.();
			pronunciationUnsubscribe = null;
			exportNotice?.hide();
			exportNotice = null;
			services?.deckHome.dispose();
			services?.pronunciationRuntime.dispose();
			services = null;
		},
	};
}
