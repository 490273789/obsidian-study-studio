import type { AiSnapshot } from "../../../core/ai";
import type { LocalDictionaryListItem } from "../domain/local-administration";
import type {
	DictionaryFavoriteOpenMode,
	DictionarySettings,
	DictionarySourceKind,
	YoudaoAccessMode,
} from "../domain/types";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import {
	defineSettings,
	settingsKey,
	type SettingsActionResult,
	type SettingsPresentation,
} from "../../../core/settings/presentation";

export interface DictionarySettingsEditorState {
	/** Committed dictionary settings; the editor never owns a second authority. */
	settings: DictionarySettings;
	aiSnapshot: AiSnapshot;
	localDictionaries: readonly LocalDictionaryListItem[];
	desktop: boolean;
	importing: boolean;
	saving: boolean;
	testing: boolean;
}

export interface DictionarySettingsEditorActions {
	setEnabled: (enabled: boolean) => SettingsActionResult;
	createFavoriteCategory: () => SettingsActionResult;
	editFavoriteCategory: (id: string) => SettingsActionResult;
	deleteFavoriteCategory: (id: string) => SettingsActionResult;
	setFavoriteOpenMode: (mode: DictionaryFavoriteOpenMode) => SettingsActionResult;
	setFavoriteAiConfigId: (configId: string | null) => SettingsActionResult;
	setYoudaoAccessMode: (mode: YoudaoAccessMode) => SettingsActionResult;
	setYoudaoDictionary: (dictionary: "ec" | "ee") => SettingsActionResult;
	setYoudaoSecretId: (secret: "appKey" | "appSecret", secretId: string) => SettingsActionResult;
	testYoudao: () => SettingsActionResult;
	moveSource: (fromIndex: number, toIndex: number) => SettingsActionResult;
	toggleSource: (id: string, enabled: boolean) => SettingsActionResult;
	setAiConfigId: (configId: string | null) => SettingsActionResult;
	pickLocalDictionaryFiles: () => SettingsActionResult;
	pickLocalDictionaryFolder: () => SettingsActionResult;
	renameLocalDictionary: (id: string) => SettingsActionResult;
	deleteLocalDictionary: (id: string) => SettingsActionResult;
}

/** Compiled-v2 byte sizes, matching the source tool's KiB/MiB reporting. */
export function formatDictionaryBytes(bytes: number): string {
	if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1_024))} KiB`;
	return `${(bytes / 1_048_576).toFixed(bytes < 10 * 1_048_576 ? 1 : 0)} MiB`;
}

function sourceKindLabel(kind: DictionarySourceKind, t: DictionaryStrings): string {
	if (kind === "local") return t.local;
	if (kind === "ai") return t.ai;
	return t.sourceOnline;
}

/** Compiled status line for one catalog entry, preferring a probe result. */
function localDictionaryStatusText(local: LocalDictionaryListItem, t: DictionaryStrings): string {
	const status = local.compiledSyncStatus;
	if (status === "checking") return t.compiledChecking;
	if (status === "incomplete" || status === "missing") return t.compiledIncomplete;
	if (status === "incompatible") return t.compiledReimportRequired;
	if (status === "corrupt") return t.compiledCorrupt;
	const compiled = local.compiled;
	if (compiled && !local.requiresReimport) {
		return t.compiledReady(
			compiled.entryCount,
			formatDictionaryBytes(compiled.totalBytes),
			compiled.engineVersion,
		);
	}
	return t.compiledReimportRequired;
}

export function buildDictionarySettingsViewModel(
	state: DictionarySettingsEditorState,
	actions: DictionarySettingsEditorActions,
	language: Language,
): SettingsPresentation {
	const t = dictionaryStrings(language);
	const { settings } = state;
	const busy = state.saving || state.testing || state.importing;
	const accessModeDescription =
		settings.youdao.accessMode === "free"
			? t.freeModeDescription
			: t.officialCredentialsDescription;
	const aiConfigs = state.aiSnapshot.settings.configs;
	return defineSettings("dictionary", (page) => {
		page.group("dictionary", t.settingsHeading, (group) => {
			group.toggle(
				"enabled",
				{ name: t.settingName, description: t.description },
				{
					value: settings.enabled,
					disabled: state.saving,
					onChange: actions.setEnabled,
				},
			);
			group.button(
				"favorite-category-create",
				{ name: t.favoriteCategory, description: t.favoriteCategoryDescription },
				{
					label: t.favoriteCategoryCreate,
					disabled: busy,
					onPress: actions.createFavoriteCategory,
				},
			);
			for (const category of settings.favoriteCategories) {
				group.row(
					`favorite-category-${settingsKey(category.id)}`,
					{
						name: category.name,
						description: category.path,
					},
					(row) => {
						row.button("edit", {
							label: t.favoriteCategoryEdit,
							disabled: busy,
							onPress: () => actions.editFavoriteCategory(category.id),
						});
						row.button("delete", {
							label: t.favoriteCategoryDelete,
							disabled: busy || settings.favoriteCategories.length === 1,
							tone: "warning",
							onPress: () => actions.deleteFavoriteCategory(category.id),
						});
					},
				);
			}
			group.select(
				"favorite-open-mode",
				{ name: t.favoriteOpenMode, description: t.favoriteOpenModeDescription },
				{
					value: settings.favoriteOpenMode,
					disabled: state.saving,
					options: [
						{ value: "modal", label: t.favoriteOpenModeModal },
						{ value: "sidebar", label: t.favoriteOpenModeSidebar },
					],
					onChange: actions.setFavoriteOpenMode,
				},
			);
			const favoriteAiConfigId = settings.favoriteAiConfigId ?? "";
			group.select(
				"favorite-ai-engine",
				{ name: t.favoriteAiEngine, description: t.favoriteAiEngineDescription },
				{
					value: favoriteAiConfigId,
					disabled: state.saving,
					options: [
						{ value: "", label: t.favoriteAiNotConfigured },
						...(favoriteAiConfigId &&
						!aiConfigs.some((config) => config.id === favoriteAiConfigId)
							? [
									{
										value: favoriteAiConfigId,
										label: t.favoriteAiConfigMissing(favoriteAiConfigId),
									},
								]
							: []),
						...aiConfigs.map((config) => ({ value: config.id, label: config.name })),
					],
					onChange: (value) => actions.setFavoriteAiConfigId(value || null),
				},
			);
			group.select(
				"youdao-mode",
				{ name: t.youdaoAccessMode, description: accessModeDescription },
				{
					value: settings.youdao.accessMode,
					disabled: state.saving,
					options: [
						{ value: "official", label: t.officialMode },
						{ value: "free", label: t.freeMode },
					],
					onChange: actions.setYoudaoAccessMode,
				},
			);

			if (settings.youdao.accessMode === "official") {
				group.secret(
					"youdao-app-key",
					{ name: t.officialAppKey, description: t.officialCredentialsDescription },
					{
						value: settings.youdao.appKeySecretId,
						disabled: state.saving,
						onChange: (secretId) => actions.setYoudaoSecretId("appKey", secretId),
					},
				);
				group.secret(
					"youdao-app-secret",
					{ name: t.officialAppSecret, description: t.officialCredentialsDescription },
					{
						value: settings.youdao.appSecretSecretId,
						disabled: state.saving,
						onChange: (secretId) => actions.setYoudaoSecretId("appSecret", secretId),
					},
				);
				group.select(
					"youdao-dictionary",
					{ name: t.youdaoDictionary, description: t.youdaoDictionaryDescription },
					{
						value: settings.youdao.dictionaries.includes("ee") ? "ee" : "ec",
						disabled: state.saving,
						options: [
							{ value: "ec", label: t.youdaoEc },
							{ value: "ee", label: t.youdaoEe },
						],
						onChange: actions.setYoudaoDictionary,
					},
				);
			}

			group.button(
				"test-connection",
				{ name: t.testConnection, description: accessModeDescription },
				{
					label: state.testing ? t.testing : t.testConnection,
					disabled: busy,
					onPress: actions.testYoudao,
				},
			);

			group.reorderable(
				"source-order",
				{ name: t.orderHeading },
				{
					allowDrag: true,
					items: settings.sources.map((source) => ({
						id: source.id,
						label: source.label,
						enabled: source.enabled,
						kindLabel: sourceKindLabel(source.kind, t),
						onToggle: (enabled) => actions.toggleSource(source.id, enabled),
					})),
					onMove: actions.moveSource,
					tooltips: {
						drag: t.orderDescription,
						moveUp: t.sourceMoveUp,
						moveDown: t.sourceMoveDown,
						remove: t.localDelete,
					},
				},
			);

			const aiConfigId = settings.ai.configId ?? "";
			group.select(
				"ai-engine",
				{ name: t.aiEngine, description: t.aiEngineDescription },
				{
					value: aiConfigId,
					disabled: state.saving || aiConfigs.length === 0,
					options: [
						{ value: "", label: t.sourceDisabled },
						...(aiConfigId && !aiConfigs.some((config) => config.id === aiConfigId)
							? [{ value: aiConfigId, label: aiConfigId }]
							: []),
						...aiConfigs.map((config) => ({ value: config.id, label: config.name })),
					],
					onChange: (value) => actions.setAiConfigId(value || null),
				},
			);

			if (state.desktop) {
				group.button(
					"import-files",
					{ name: t.import, description: t.importDescription },
					{
						label: t.import,
						disabled: busy,
						onPress: actions.pickLocalDictionaryFiles,
					},
				);
				group.button(
					"import-folder",
					{ name: t.folderImport, description: t.folderImportDescription },
					{
						label: t.folderImport,
						disabled: busy,
						onPress: actions.pickLocalDictionaryFolder,
					},
				);
			} else {
				group.status(
					"import-unavailable",
					{ name: t.import, description: t.importDescription },
					t.localUnsupported,
				);
			}

			if (state.localDictionaries.length === 0) {
				group.status("local-empty", { name: t.local }, t.localEmpty);
				return;
			}
			for (const local of state.localDictionaries) {
				const description = [
					...local.files.map((file) => file.name),
					localDictionaryStatusText(local, t),
				].join(" · ");
				if (state.desktop) {
					group.row(
						`local-${settingsKey(local.id)}`,
						{ name: local.name, description },
						(row) => {
							row.button("rename", {
								label: t.localRename,
								disabled: busy,
								onPress: () => actions.renameLocalDictionary(local.id),
							});
							row.button("delete", {
								label: t.localDelete,
								disabled: busy,
								tone: "warning",
								onPress: () => actions.deleteLocalDictionary(local.id),
							});
						},
					);
				} else {
					group.row(`local-${settingsKey(local.id)}`, { name: local.name, description });
				}
			}
		});
	});
}
