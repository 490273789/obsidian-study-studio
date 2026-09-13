import type { ScopedWorkbenchSettings } from "../../../core/host/settingsSlices";
import type {
	Language,
	OnlinePronunciationProvider,
	PronunciationAccent,
	PronunciationRate,
	StudySettings,
} from "../../../core/shared/types";
import {
	defineSettings,
	type SettingsActionResult,
	type SettingsPresentation,
} from "../../../core/settings/presentation";
import type { PronunciationCacheUsage, PronunciationSnapshot } from "../domain/pronunciation";
import { createTranslator } from "../strings/index";
import { STUDY_ORDER_OPTIONS, STUDY_SETTINGS_LIMITS, parseStudyOrder } from "./studyMeta";

export interface SettingsViewModelState {
	settings: ScopedWorkbenchSettings<"flashcards">;
	availableTags: string[];
	isLoadingTags: boolean;
	hasLoadedTags: boolean;
	language: Language;
	pronunciation: PronunciationSnapshot;
}

export interface SettingsViewModelActions {
	refreshTags: (options: { cleanConfiguredTags: boolean }) => SettingsActionResult;
	updateFlashcardTag: (index: number, value: string) => SettingsActionResult;
	addFlashcardTag: () => SettingsActionResult;
	removeFlashcardTag: (index: number) => SettingsActionResult;
	addDiscoveredTag: (tag: string) => SettingsActionResult;
	setLanguage: (language: Language) => SettingsActionResult;
	setDailyNewCards: (value: number) => SettingsActionResult;
	setDailyReviewCards: (value: number) => SettingsActionResult;
	setStudyOrder: (value: StudySettings["studyOrder"]) => SettingsActionResult;
	setRequestRetention: (value: number) => SettingsActionResult;
	setMaximumInterval: (value: number) => SettingsActionResult;
	setPronunciationAutoPlay: (value: boolean) => SettingsActionResult;
	setPronunciationAccent: (value: PronunciationAccent) => SettingsActionResult;
	setPronunciationRate: (value: PronunciationRate) => SettingsActionResult;
	setOnlinePronunciationProvider: (value: OnlinePronunciationProvider) => SettingsActionResult;
	setAzureCloud: (value: "china" | "global") => SettingsActionResult;
	setAzureRegion: (value: string) => SettingsActionResult;
	setAzureSecretId: (value: string) => SettingsActionResult;
	setOpenAiSecretId: (value: string) => SettingsActionResult;
	testOnlinePronunciation: () => SettingsActionResult;
	clearPronunciationCache: () => SettingsActionResult;
}

const LANGUAGE_OPTIONS: readonly Language[] = ["zh", "en"];

export function buildSettingsViewModel(
	state: SettingsViewModelState,
	actions: SettingsViewModelActions,
): SettingsPresentation {
	const t = createTranslator(state.language);
	const unusedTags = getUnusedTags(state.availableTags, state.settings.flashcardTags);
	const pronunciation = state.pronunciation;
	const pronunciationSettings = pronunciation.settings;
	const pronunciationBusy = pronunciation.management !== "idle";

	return defineSettings("flashcards", (page) => {
		page.group("flashcards", t("settings.flashcardGroup"), (group) => {
			group.row(
				"configured-tags",
				{
					name: t("settings.flashcardTagsName"),
					description: t("settings.flashcardTagsDesc"),
				},
				(row) => {
					row.button("refresh", {
						label: state.isLoadingTags
							? t("settings.refreshingTags")
							: t("settings.refreshAndCleanTags"),
						disabled: state.isLoadingTags,
						onPress: () => actions.refreshTags({ cleanConfiguredTags: true }),
					});
					row.editableList("tags", {
						values: state.settings.flashcardTags,
						placeholder: t("settings.flashcardTagPlaceholder"),
						addLabel: t("settings.addTag"),
						removeAriaLabel: t("settings.delete"),
						onChange: actions.updateFlashcardTag,
						onAdd: actions.addFlashcardTag,
						onRemove: actions.removeFlashcardTag,
					});
				},
			);
			group.row(
				"discovered-tags",
				{
					name: t("settings.discoveredTagsName"),
					description: t("settings.discoveredTagsDesc"),
				},
				(row) => {
					row.button("refresh", {
						label: state.isLoadingTags
							? t("settings.refreshingTags")
							: t("settings.refreshTags"),
						disabled: state.isLoadingTags,
						onPress: () => actions.refreshTags({ cleanConfiguredTags: false }),
					});
					row.choiceButtons("tags", {
						choices: unusedTags.map((tag) => ({ id: tag, label: tag })),
						emptyText: state.hasLoadedTags
							? t("settings.noDiscoveredTags")
							: t("settings.discoveredTagsNotLoaded"),
						onChoose: actions.addDiscoveredTag,
					});
				},
			);
		});

		page.group("interface", t("settings.interfaceGroup"), (group) => {
			group.select(
				"language",
				{ name: t("settings.languageName"), description: t("settings.languageDesc") },
				{
					value: state.language,
					options: LANGUAGE_OPTIONS.map((language) => ({
						value: language,
						label:
							language === "zh" ? t("settings.languageZh") : t("settings.languageEn"),
					})),
					onChange: actions.setLanguage,
				},
			);
		});

		page.group("study", t("settings.defaultStudyGroup"), (group) => {
			group.row("scope", {
				name: t("settings.scopeName"),
				description: t("settings.scopeDesc"),
			});
			group.slider(
				"daily-new",
				{ name: t("settings.dailyNewName"), description: t("settings.dailyNewDesc") },
				{
					...STUDY_SETTINGS_LIMITS.dailyNewCards,
					value: state.settings.dailyNewCards,
					onChange: actions.setDailyNewCards,
				},
			);
			group.slider(
				"daily-review",
				{ name: t("settings.dailyReviewName"), description: t("settings.dailyReviewDesc") },
				{
					...STUDY_SETTINGS_LIMITS.dailyReviewCards,
					value: state.settings.dailyReviewCards,
					onChange: actions.setDailyReviewCards,
				},
			);
			group.select(
				"study-order",
				{ name: t("settings.studyOrderName"), description: t("settings.studyOrderDesc") },
				{
					value: state.settings.studyOrder,
					options: STUDY_ORDER_OPTIONS.map((order) => ({
						value: order,
						label: t(order === "sequential" ? "order.sequential" : "order.random"),
					})),
					onChange: (value) => actions.setStudyOrder(parseStudyOrder(value)),
				},
			);
		});

		page.group("pronunciation", t("settings.pronunciationGroup"), (group) => {
			group.toggle(
				"auto-play",
				{
					name: t("settings.pronunciationAutoName"),
					description: t("settings.pronunciationAutoDesc"),
				},
				{
					value: pronunciationSettings.spellingAutoPlay,
					disabled: pronunciationBusy,
					onChange: actions.setPronunciationAutoPlay,
				},
			);
			group.select(
				"accent",
				{
					name: t("settings.pronunciationAccentName"),
					description: t("settings.pronunciationAccentDesc"),
				},
				{
					value: pronunciationSettings.accent,
					disabled: pronunciationBusy,
					options: [
						{ value: "system", label: t("settings.pronunciationAccentSystem") },
						{ value: "en-US", label: t("settings.pronunciationAccentUs") },
						{ value: "en-GB", label: t("settings.pronunciationAccentGb") },
					],
					onChange: (value) =>
						actions.setPronunciationAccent(parsePronunciationAccent(value)),
				},
			);
			group.select(
				"rate",
				{ name: t("settings.pronunciationRateName") },
				{
					value: pronunciationSettings.rate,
					disabled: pronunciationBusy,
					options: [
						{ value: "normal", label: t("settings.pronunciationRateNormal") },
						{ value: "slow", label: t("settings.pronunciationRateSlow") },
					],
					onChange: (value) =>
						actions.setPronunciationRate(parsePronunciationRate(value)),
				},
			);
			group.select(
				"provider",
				{
					name: t("settings.pronunciationProviderName"),
					description: t("settings.pronunciationProviderDesc"),
				},
				{
					value: pronunciationSettings.onlineProvider,
					disabled: pronunciationBusy,
					options: [
						{ value: "none", label: t("settings.pronunciationProviderNone") },
						{ value: "azure", label: t("settings.pronunciationProviderAzure") },
						{ value: "openai", label: t("settings.pronunciationProviderOpenAi") },
					],
					onChange: (value) =>
						actions.setOnlinePronunciationProvider(
							parseOnlinePronunciationProvider(value),
						),
				},
			);
			group.select(
				"azure-cloud",
				{
					name: t("settings.pronunciationAzureCloudName"),
					visible: pronunciationSettings.onlineProvider === "azure",
				},
				{
					value: pronunciationSettings.azureCloud,
					disabled: pronunciationBusy,
					options: [
						{ value: "china", label: t("settings.pronunciationAzureChina") },
						{ value: "global", label: t("settings.pronunciationAzureGlobal") },
					],
					onChange: actions.setAzureCloud,
				},
			);
			group.text(
				"azure-region",
				{
					name: t("settings.pronunciationAzureRegionName"),
					description:
						pronunciationSettings.azureCloud === "china"
							? t("settings.pronunciationAzureChinaRegionDesc")
							: t("settings.pronunciationAzureGlobalRegionDesc"),
					visible: pronunciationSettings.onlineProvider === "azure",
				},
				{
					value: pronunciationSettings.azureRegion,
					placeholder:
						pronunciationSettings.azureCloud === "china" ? "chinaeast2" : "eastus",
					disabled: pronunciationBusy,
					onChange: actions.setAzureRegion,
				},
			);
			group.secret(
				"azure-secret",
				{
					name: t("settings.pronunciationAzureSecretName"),
					description: t("settings.pronunciationAzureSecretDesc"),
					visible: pronunciationSettings.onlineProvider === "azure",
				},
				{
					value: pronunciationSettings.azureSecretId,
					disabled: pronunciationBusy,
					onChange: actions.setAzureSecretId,
				},
			);
			group.secret(
				"openai-secret",
				{
					name: t("settings.pronunciationOpenAiSecretName"),
					description: t("settings.pronunciationOpenAiSecretDesc"),
					visible: pronunciationSettings.onlineProvider === "openai",
				},
				{
					value: pronunciationSettings.openaiSecretId,
					disabled: pronunciationBusy,
					onChange: actions.setOpenAiSecretId,
				},
			);
			group.row("openai-warning", {
				name: t("settings.pronunciationOpenAiWarningName"),
				description: t("settings.pronunciationOpenAiWarningDesc"),
				visible: pronunciationSettings.onlineProvider === "openai",
			});
			group.button(
				"test-provider",
				{
					name: t("settings.pronunciationTestName"),
					description: t("settings.pronunciationTestDesc"),
					visible: pronunciationSettings.onlineProvider !== "none",
				},
				{
					label:
						pronunciation.management === "testing-provider"
							? t("settings.pronunciationTesting")
							: t("settings.pronunciationTestButton"),
					disabled: pronunciationBusy,
					onPress: actions.testOnlinePronunciation,
				},
			);
			group.row(
				"cache",
				{
					name: t("settings.pronunciationCacheName"),
					description: t("settings.pronunciationCacheDesc"),
				},
				(row) => {
					row.status("usage", formatPronunciationCacheUsage(pronunciation.cacheUsage, t));
					row.button("clear", {
						label:
							pronunciation.management === "clearing-cache"
								? t("settings.pronunciationCacheClearing")
								: t("settings.pronunciationCacheClear"),
						disabled: pronunciationBusy,
						onPress: actions.clearPronunciationCache,
					});
				},
			);
		});

		page.group("fsrs", t("settings.fsrsGroup"), (group) => {
			group.slider(
				"retention",
				{ name: t("settings.retentionName"), description: t("settings.retentionDesc") },
				{
					...STUDY_SETTINGS_LIMITS.requestRetention,
					value: state.settings.fsrsParameters.requestRetention,
					onChange: actions.setRequestRetention,
				},
			);
			group.integer(
				"maximum-interval",
				{
					name: t("settings.maxIntervalName"),
					description: t("settings.maxIntervalDesc"),
				},
				{
					min: STUDY_SETTINGS_LIMITS.maximumInterval.min,
					max: STUDY_SETTINGS_LIMITS.maximumInterval.max,
					step: 1,
					value: state.settings.fsrsParameters.maximumInterval,
					onChange: actions.setMaximumInterval,
				},
			);
		});

		page.group("help", t("settings.helpGroup"), (group) => {
			group.row("usage", {
				name: t("settings.helpName"),
				description: [
					{ kind: "paragraph", text: t("settings.cardFormatTitle") },
					{ kind: "code", text: t("settings.cardFormatExample") },
					{ kind: "paragraph", text: t("settings.shortcutsTitle") },
					{
						kind: "list",
						items: [
							t("settings.shortcutSpace"),
							t("settings.shortcutAgain"),
							t("settings.shortcutHard"),
							t("settings.shortcutGood"),
							t("settings.shortcutEasy"),
							t("settings.shortcutTrash"),
							t("settings.shortcutPrevious"),
						],
					},
				],
			});
		});
	});
}

export function getUnusedTags(availableTags: string[], configuredTags: string[]): string[] {
	return availableTags.filter((tag) => !configuredTags.includes(tag));
}

function parsePronunciationAccent(value: string): PronunciationAccent {
	return value === "en-US" || value === "en-GB" ? value : "system";
}

function parsePronunciationRate(value: string): PronunciationRate {
	return value === "slow" ? "slow" : "normal";
}

function parseOnlinePronunciationProvider(value: string): OnlinePronunciationProvider {
	return value === "azure" || value === "openai" ? value : "none";
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPronunciationCacheUsage(
	usage: PronunciationCacheUsage,
	t: ReturnType<typeof createTranslator>,
): string {
	if (usage.status === "loading") return t("settings.pronunciationCacheLoading");
	if (usage.status === "failed") return t("settings.pronunciationCacheReadFailed");
	return formatBytes(usage.bytes);
}
