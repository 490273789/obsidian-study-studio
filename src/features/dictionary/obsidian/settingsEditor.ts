import { Notice, Platform } from "obsidian";
import type { AiService } from "../../../core/ai";
import { inspectCompiledPackage, type CompiledPackageStatus } from "../domain/compiled-package";
import {
	DEFAULT_DICTIONARY_FAVORITE_PATH,
	normalizeDictionaryFavoritePath,
} from "../domain/configuration";
import type { DictionaryRuntime } from "../domain/dictionaryRuntime";
import type { LocalDictionaryAdministrationFailureCode } from "../domain/local-administration";
import type { DictionarySettings } from "../domain/types";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import {
	buildDictionarySettingsViewModel,
	formatDictionaryBytes,
	type DictionarySettingsEditorActions,
} from "../settings/viewModel";
import type { SettingsPresentation } from "../../../core/settings/presentation";
import { pickLocalDictionaryFiles } from "./localDictionaryFilePicker";
import { confirmLocalDictionaryDeletion } from "./modals";

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
 * The editor only tracks in-flight activity and the mobile compiled-v2 probe.
 */
export class DictionarySettingsEditor {
	private deleting = false;
	private importing = false;
	private saving = false;
	private testing = false;
	private visible = false;
	private unsubscribeRuntime: (() => void) | null = null;
	private unsubscribeAi: (() => void) | null = null;
	private readonly compiledStatus: Record<string, string> = {};
	private readonly probed = new Set<string>();

	constructor(
		private readonly runtime: DictionaryRuntime,
		private readonly ai: AiService,
		private readonly language: () => Language,
		private readonly refresh: () => void,
	) {}

	activate(): void {
		this.visible = true;
		this.unsubscribeRuntime ??= this.runtime.query.subscribe(this.refresh);
		this.unsubscribeAi ??= this.ai.subscribe(this.refresh);
		this.probeCompiledPackages();
	}

	hide(): void {
		this.visible = false;
		this.unsubscribeRuntime?.();
		this.unsubscribeRuntime = null;
		this.unsubscribeAi?.();
		this.unsubscribeAi = null;
	}

	presentation(): SettingsPresentation {
		return buildDictionarySettingsViewModel(
			{
				settings: this.runtime.settings.getDictionarySettings(),
				aiSnapshot: this.ai.getSnapshot(),
				localDictionaries: this.runtime.administration.list(),
				compiledStatus: { ...this.compiledStatus },
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
			setFavoritePath: (path) =>
				this.patch((draft) => {
					draft.favoritePath = normalizeDictionaryFavoritePath(
						path,
						DEFAULT_DICTIONARY_FAVORITE_PATH,
					);
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
			setAiConfigId: (configId) =>
				this.patch((draft) => {
					draft.ai.configId = configId;
				}),
			pickLocalDictionaryFiles: () => this.importLocalDictionaries("files"),
			pickLocalDictionaryFolder: () => this.importLocalDictionaries("folder"),
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

	/**
	 * Mobile cannot compile dictionaries, so it can only report whether the
	 * synced compiled-v2 package is fully present. Desktop reads the local files
	 * directly, where the catalog snapshot is already authoritative.
	 */
	private probeCompiledPackages(): void {
		if (Platform.isDesktopApp) return;
		const strings = dictionaryStrings(this.language());
		for (const local of this.runtime.administration.list()) {
			const compiled = local.compiled;
			if (!compiled || local.requiresReimport || this.probed.has(local.id)) continue;
			this.probed.add(local.id);
			this.compiledStatus[local.id] = strings.compiledChecking;
			const dictionaryRoot = `${this.runtime.dictionaryRoot}/${local.id}`;
			void inspectCompiledPackage({
				adapter: this.runtime.app.vault.adapter,
				dictionaryRoot,
				expected: compiled,
			})
				.then((status) => {
					this.compiledStatus[local.id] = compiledStatusText(status, compiled, strings);
					this.refreshIfVisible();
					return undefined;
				})
				.catch(() => {
					this.compiledStatus[local.id] = strings.compiledCorrupt;
					this.refreshIfVisible();
				});
		}
	}

	private refreshIfVisible(): void {
		if (this.visible) this.refresh();
	}
}

function compiledStatusText(
	status: CompiledPackageStatus,
	compiled: {
		readonly engineVersion: string;
		readonly entryCount: number;
		readonly totalBytes: number;
	},
	strings: DictionaryStrings,
): string {
	if (status === "ready") {
		return strings.compiledReady(
			compiled.entryCount,
			formatDictionaryBytes(compiled.totalBytes),
			compiled.engineVersion,
		);
	}
	if (status === "incomplete" || status === "missing") return strings.compiledIncomplete;
	if (status === "incompatible") return strings.compiledReimportRequired;
	return strings.compiledCorrupt;
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
