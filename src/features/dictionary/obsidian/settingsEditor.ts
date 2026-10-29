import { Notice, Platform } from "obsidian";
import type { AiService } from "../../../core/ai";
import type { DictionaryRuntime } from "../domain/dictionaryRuntime";
import type { LocalDictionaryAdministrationFailureCode } from "../domain/local-administration";
import type { DictionarySettings } from "../domain/types";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import {
	buildDictionarySettingsViewModel,
	type DictionarySettingsEditorActions,
} from "../settings/viewModel";
import type { SettingsPresentation } from "../../../core/settings/presentation";
import { pickLocalDictionaryFiles } from "./localDictionaryFilePicker";
import { confirmLocalDictionaryDeletion, promptLocalDictionaryName } from "./modals";
import { FavoriteCategoryModal, confirmFavoriteCategoryDelete } from "./favoriteCategoryModal";

function dictionaryImportErrorMessage(
	code: LocalDictionaryAdministrationFailureCode,
	strings: DictionaryStrings,
): string {
	switch (code) {
		case "encrypted":
			return strings.compiledErrorEncrypted;
		case "unsupported-format":
		case "unsupported":
			return strings.compiledErrorUnsupported;
		case "corrupt":
			return strings.compiledErrorCorrupt;
		case "limit-exceeded":
			return strings.compiledErrorLimit;
		case "storage-failed":
			return strings.compiledErrorStorage;
		case "cancelled":
			return strings.portableCancelled;
		default:
			return strings.importFailed;
	}
}

/**
 * Obsidian adapter for the dictionary settings page.
 *
 * It holds no settings draft: the committed `DictionarySettingsStore` stays the
 * authority and every control commits through `DictionaryRuntime.updateSettings`.
 * The editor only tracks in-flight settings activity; the local catalog owns
 * the mobile compiled-v2 inspection state.
 */
export class DictionarySettingsEditor {
	private deleting = false;
	private importing = false;
	private saving = false;
	private testing = false;
	private unsubscribeRuntime: (() => void) | null = null;
	private unsubscribeAi: (() => void) | null = null;
	private unsubscribePackages: (() => void) | null = null;

	constructor(
		private readonly runtime: DictionaryRuntime,
		private readonly ai: AiService,
		private readonly language: () => Language,
		private readonly refresh: () => void,
	) {}

	activate(): void {
		this.unsubscribeRuntime ??= this.runtime.query.subscribe(this.refresh);
		this.unsubscribeAi ??= this.ai.subscribe(this.refresh);
		if (!Platform.isDesktopApp) {
			this.unsubscribePackages ??= this.runtime.administration.watchCompiledPackages(
				this.refresh,
			);
		}
	}

	hide(): void {
		this.unsubscribeRuntime?.();
		this.unsubscribeRuntime = null;
		this.unsubscribeAi?.();
		this.unsubscribeAi = null;
		this.unsubscribePackages?.();
		this.unsubscribePackages = null;
	}

	presentation(): SettingsPresentation {
		return buildDictionarySettingsViewModel(
			{
				settings: this.runtime.settings.getDictionarySettings(),
				aiSnapshot: this.ai.getSnapshot(),
				localDictionaries: this.runtime.administration.list(),
				desktop: Platform.isDesktopApp,
				importing: this.importing,
				saving: this.saving || this.deleting,
				testing: this.testing,
			},
			this.actions(),
			this.language(),
		);
	}

	private actions(): DictionarySettingsEditorActions {
		return {
			setEnabled: (enabled) =>
				this.patch((draft) => {
					draft.enabled = enabled;
				}),
			createFavoriteCategory: () =>
				new FavoriteCategoryModal(
					this.runtime.app,
					this.runtime.categories,
					dictionaryStrings(this.language()),
					{ kind: "create", select: false },
					this.refresh,
				).open(),
			editFavoriteCategory: (id) => {
				const category = this.runtime.categories.categories.find((item) => item.id === id);
				if (category)
					new FavoriteCategoryModal(
						this.runtime.app,
						this.runtime.categories,
						dictionaryStrings(this.language()),
						{ kind: "edit", category },
						this.refresh,
					).open();
			},
			deleteFavoriteCategory: (id) => {
				const category = this.runtime.categories.categories.find((item) => item.id === id);
				if (category)
					confirmFavoriteCategoryDelete(
						this.runtime.app,
						category,
						this.runtime.categories,
						dictionaryStrings(this.language()),
						this.refresh,
					);
			},
			setFavoriteOpenMode: (mode) =>
				this.patch((draft) => {
					draft.favoriteOpenMode = mode;
				}),
			setYoudaoAccessMode: (accessMode) =>
				this.patch((draft) => {
					draft.youdao.accessMode = accessMode;
				}),
			setYoudaoDictionary: (dictionary) =>
				this.patch((draft) => {
					draft.youdao.dictionaries = [dictionary, "ce"];
				}),
			setYoudaoSecretId: (secret, secretId) =>
				this.patch((draft) => {
					if (secret === "appKey") draft.youdao.appKeySecretId = secretId;
					else draft.youdao.appSecretSecretId = secretId;
				}),
			testYoudao: () => this.testYoudao(),
			moveSource: (fromIndex, toIndex) =>
				this.patch((draft) => {
					moveItem(draft.sources, fromIndex, toIndex);
				}),
			toggleSource: (id, enabled) =>
				this.patch((draft) => {
					const source = draft.sources.find((candidate) => candidate.id === id);
					if (source) source.enabled = enabled;
				}),
			setFavoriteAiConfigId: (configId) =>
				this.patch((draft) => {
					draft.favoriteAiConfigId = configId;
				}),
			setAiConfigId: (configId) =>
				this.patch((draft) => {
					draft.ai.configId = configId;
				}),
			pickLocalDictionaryFiles: () => this.importLocalDictionaries("files"),
			pickLocalDictionaryFolder: () => this.importLocalDictionaries("folder"),
			renameLocalDictionary: (id) => this.renameLocalDictionary(id),
			deleteLocalDictionary: (id) => this.deleteLocalDictionary(id),
		};
	}

	private async patch(mutate: (draft: DictionarySettings) => void): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		this.refresh();
		try {
			// A failed write already surfaces through the runtime's own Notice.
			await this.runtime.updateSettings(mutate);
		} finally {
			this.saving = false;
			this.refresh();
		}
	}

	private async testYoudao(): Promise<void> {
		if (this.testing) return;
		const strings = dictionaryStrings(this.language());
		this.testing = true;
		this.refresh();
		try {
			await this.runtime.testYoudao();
			new Notice(strings.testSuccess);
		} catch (error) {
			const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
			new Notice(`${strings.testFailed}${detail}`);
		} finally {
			this.testing = false;
			this.refresh();
		}
	}

	private async importLocalDictionaries(kind: "files" | "folder"): Promise<void> {
		if (this.importing) return;
		const strings = dictionaryStrings(this.language());
		const files = await pickLocalDictionaryFiles(
			kind,
			kind === "folder" ? strings.folderImport : strings.import,
		);
		if (files.length === 0) return;
		this.importing = true;
		this.refresh();
		const progress = new Notice(strings.compiledProgress("validate", 0), 0);
		try {
			const result = await this.runtime.administration.importFiles(files, (update) => {
				const percent =
					update.totalBytes > 0
						? Math.min(
								100,
								Math.floor((update.completedBytes / update.totalBytes) * 100),
							)
						: 0;
				progress.setMessage(strings.compiledProgress(update.phase, percent));
			});
			if (result.ok) {
				new Notice(strings.importSuccess(result.imported.length));
			} else {
				new Notice(
					result.error.recovery === "incomplete"
						? strings.localRecoveryRequired
						: dictionaryImportErrorMessage(result.error.code, strings),
				);
			}
		} catch {
			new Notice(strings.importFailed);
		} finally {
			progress.hide();
			this.importing = false;
			this.refresh();
		}
	}

	private async deleteLocalDictionary(id: string): Promise<void> {
		if (this.deleting) return;
		const strings = dictionaryStrings(this.language());
		const item = this.runtime.administration.list().find((candidate) => candidate.id === id);
		if (!item) {
			new Notice(strings.localSourceMissing);
			return;
		}
		if (!(await confirmLocalDictionaryDeletion(this.runtime.app, strings, item.name))) return;
		this.deleting = true;
		this.refresh();
		try {
			const result = await this.runtime.administration.remove(id);
			if (!result.ok && result.error.code !== "not-found") {
				new Notice(
					result.error.recovery === "incomplete"
						? strings.localRecoveryRequired
						: strings.localDeleteFailed,
				);
			}
		} catch {
			new Notice(strings.localDeleteFailed);
		} finally {
			this.deleting = false;
			this.refresh();
		}
	}

	private async renameLocalDictionary(id: string): Promise<void> {
		if (this.saving || this.deleting || this.importing) return;
		const strings = dictionaryStrings(this.language());
		const item = this.runtime.administration.list().find((candidate) => candidate.id === id);
		if (!item) {
			new Notice(strings.localSourceMissing);
			return;
		}
		const name = await promptLocalDictionaryName(this.runtime.app, strings, item.name);
		if (name === null || name === item.name) return;
		this.saving = true;
		this.refresh();
		try {
			const result = await this.runtime.administration.rename(id, name);
			if (!result.ok) {
				new Notice(
					result.error.code === "not-found"
						? strings.localSourceMissing
						: result.error.recovery === "incomplete"
							? strings.localRecoveryRequired
							: strings.localRenameFailed,
				);
			}
		} catch {
			new Notice(strings.localRenameFailed);
		} finally {
			this.saving = false;
			this.refresh();
		}
	}
}

/** In-place array move shared by the reorderable source list. */
function moveItem<T>(items: T[], fromIndex: number, toIndex: number): void {
	if (
		fromIndex < 0 ||
		fromIndex >= items.length ||
		toIndex < 0 ||
		toIndex >= items.length ||
		fromIndex === toIndex
	) {
		return;
	}
	const [item] = items.splice(fromIndex, 1);
	if (item !== undefined) items.splice(toIndex, 0, item);
}
