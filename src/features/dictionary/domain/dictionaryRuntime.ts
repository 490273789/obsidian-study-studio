import type { App, Plugin } from "obsidian";
import type { AiService } from "../../../core/ai";
import type { OutboundPort } from "../../../core/net";
import type { Language } from "../../../core/shared/types";
import { AiDictionarySource } from "./ai";
import { CambridgeDictionarySource } from "./cambridge";
import { CompiledDictionarySource } from "./compiled-source";
import { createDictionaryQuerySession, type DictionaryQuerySession } from "./querySession";
import { createFavoriteDraftGenerator } from "./favorite-ai";
import { DictionaryFavoriteController } from "./favorite-controller";
import { DictionaryFavoriteFile } from "./favorite-file";
import { HujiangDictionarySource } from "./hujiang";
import { LocalDictionaryImporter } from "./importer";
import { LocalDictionaryAdministrationModule } from "./local-administration";
import { dictionaryText } from "./messages";
import {
	DictionaryError,
	type DictionarySettings,
	type DictionarySettingsStore,
	type DictionarySource,
	type DictionarySourceSettings,
	type PersistedYoudaoDictionarySettings,
	type YoudaoDictionarySettings,
} from "./types";
import { YoudaoDictionarySource } from "./youdao";

export interface DictionaryRuntimeOptions {
	ai: AiService;
	app: App;
	language: () => Language;
	net: OutboundPort;
	notify: (message: string) => void;
	plugin: Plugin;
	settings: DictionarySettingsStore;
}

/**
 * Dictionary feature runtime for the whole plugin. Owns source construction,
 * local-dictionary storage, and the settings-driven lifecycle; the Obsidian
 * boundary owns views, commands, and persistence ordering.
 */
export class DictionaryRuntime {
	readonly app: App;
	readonly settings: DictionarySettingsStore;
	readonly query: DictionaryQuerySession;
	readonly favoriteController: DictionaryFavoriteController;
	readonly administration: LocalDictionaryAdministrationModule;
	/** Plugin-relative root that holds every compiled dictionary package. */
	readonly dictionaryRoot: string;

	private readonly options: DictionaryRuntimeOptions;
	private readonly localSources = new Map<string, CompiledDictionarySource>();
	private disposed = false;
	private readonly unsubscribeFavoriteAi: () => void;

	constructor(options: DictionaryRuntimeOptions) {
		this.options = options;
		this.app = options.app;
		this.settings = options.settings;
		this.dictionaryRoot = `${options.app.vault.configDir}/plugins/${options.plugin.manifest.id}/dictionaries`;
		this.favoriteController = new DictionaryFavoriteController(
			options.settings,
			new DictionaryFavoriteFile(options.app),
			options.notify,
			{
				generator: createFavoriteDraftGenerator(options.ai),
				language: options.language,
				engineKey: () => {
					const id = options.settings.getDictionarySettings().favoriteAiConfigId;
					const config = options.ai
						.getSnapshot()
						.settings.configs.find((item) => item.id === id);
					return config ? JSON.stringify(config) : null;
				},
			},
		);
		this.unsubscribeFavoriteAi = options.ai.subscribe(() =>
			this.favoriteController.refreshSettings(),
		);
		this.query = createDictionaryQuerySession({
			settings: options.settings,
			resolveSource: (source) => this.resolveSource(source),
			notify: options.notify,
			aiEngineInfo: () => this.aiEngineInfo(),
		});
		this.administration = new LocalDictionaryAdministrationModule(
			options.settings,
			new LocalDictionaryImporter(options.app, options.plugin),
			() => this.handleLocalDictionariesChanged(),
		);
		this.applySettings();
	}

	/** Re-reads committed settings and re-applies them to both stateful modules. */
	applySettings(): void {
		if (this.disposed) return;
		this.dropRemovedLocalSources();
		void this.query.send({ type: "settings-changed" });
		this.favoriteController.refreshSettings();
	}

	/** Drops cached compiled sources and refreshes lookups after a catalog change. */
	handleLocalDictionariesChanged(): void {
		if (this.disposed) return;
		this.closeLocalSources();
		void this.query.send({ type: "settings-changed" });
	}

	/** Cancels in-flight lookups and resets the query and favorite sessions. */
	resetSession(): void {
		this.closeLocalSources();
		void this.query.send({ type: "clear" });
		this.favoriteController.resetSession();
	}

	/** Creates an isolated, short-lived lookup session for the 工作台's 选区助手. */
	createSelectionLookupSession(
		query: string,
		sourceIds: readonly string[],
	): DictionaryQuerySession | null {
		if (this.disposed) return null;
		const selected = new Set(sourceIds);
		const currentDictionary = this.settings.getDictionarySettings();
		const frozenSources = currentDictionary.sources.filter(
			(source) => source.enabled && selected.has(source.id),
		);
		if (frozenSources.length === 0) return null;
		const frozenDictionary: DictionarySettings = {
			...structuredClone(currentDictionary),
			sources: structuredClone(frozenSources),
		};

		const scopedSettings: DictionarySettingsStore = {
			getDictionarySettings: () => ({
				...structuredClone(frozenDictionary),
				history: [...this.settings.getDictionarySettings().history],
			}),
			updateDictionarySettings: (mutate) => this.settings.updateDictionarySettings(mutate),
			getLocalDictionaryAdministrationState: () =>
				this.settings.getLocalDictionaryAdministrationState(),
			setLocalDictionaryAdministrationState: (state) =>
				this.settings.setLocalDictionaryAdministrationState(state),
			save: () => this.settings.save(),
		};
		const session = createDictionaryQuerySession({
			settings: scopedSettings,
			resolveSource: (source) => this.resolveSource(source, frozenDictionary),
			notify: this.options.notify,
			aiEngineInfo: () => this.aiEngineInfo(),
		});
		void session.send({ type: "lookup", query });
		return session;
	}

	closeLocalSources(): void {
		for (const source of this.localSources.values()) source.close();
		this.localSources.clear();
	}

	/** Persists a settings mutation through the injected store and re-applies it. */
	async updateSettings(mutate: (draft: DictionarySettings) => void): Promise<boolean> {
		if (this.disposed) return false;
		let saved = false;
		try {
			saved = await this.options.settings.updateDictionarySettings(mutate);
		} catch {
			saved = false;
		}
		if (!saved) {
			this.options.notify(dictionaryText(this.options.language()).saveFailed);
			return false;
		}
		this.applySettings();
		return true;
	}

	/** Exercises the committed Youdao connection through the shared outbound port. */
	async testYoudao(): Promise<void> {
		const dictionary = this.options.settings.getDictionarySettings();
		await new YoudaoDictionarySource(
			this.resolveYoudao(dictionary.youdao),
			this.options.net,
		).lookup({
			text: "test",
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.closeLocalSources();
		this.administration.cancelActiveOperations();
		this.query.dispose();
		this.unsubscribeFavoriteAi();
		this.favoriteController.dispose();
	}

	private aiEngineInfo(): { readonly configId: string | null; readonly name: string | null } {
		const configId = this.options.settings.getDictionarySettings().ai.configId;
		if (!configId) return { configId: null, name: null };
		const config = this.options.ai
			.getSnapshot()
			.settings.configs.find((candidate) => candidate.id === configId);
		return { configId, name: config?.name ?? null };
	}

	private resolveSource(
		settings: Readonly<DictionarySourceSettings>,
		dictionary: Readonly<DictionarySettings> = this.options.settings.getDictionarySettings(),
	): DictionarySource {
		switch (settings.kind) {
			case "youdao":
				return new YoudaoDictionarySource(
					this.resolveYoudao(dictionary.youdao),
					this.options.net,
				);
			case "cambridge":
				return new CambridgeDictionarySource(this.options.net);
			case "hujiang":
				return new HujiangDictionarySource(this.options.net);
			case "ai": {
				const info = this.aiEngineInfo();
				return new AiDictionarySource(info.configId, info.name, this.options.ai);
			}
			case "local":
				return this.resolveLocalSource(settings.id, dictionary);
		}
	}

	private resolveLocalSource(
		sourceId: string,
		dictionary: Readonly<DictionarySettings>,
	): DictionarySource {
		const metadata = dictionary.localDictionaries.find((item) => item.id === sourceId);
		if (!metadata)
			throw new DictionaryError(
				"configuration",
				dictionaryText(this.options.language()).importFailed,
			);
		const existing = this.localSources.get(metadata.id);
		if (existing) return existing;
		const source = new CompiledDictionarySource(
			metadata,
			this.options.app.vault.adapter,
			`${this.dictionaryRoot}/${metadata.id}`,
			this.options.net,
		);
		this.localSources.set(metadata.id, source);
		return source;
	}

	private resolveYoudao(
		persisted: Readonly<PersistedYoudaoDictionarySettings>,
	): YoudaoDictionarySettings {
		return {
			accessMode: persisted.accessMode,
			appKey: this.readSecret(persisted.appKeySecretId),
			appSecret: this.readSecret(persisted.appSecretSecretId),
			dictionaries: [...persisted.dictionaries],
		};
	}

	private readSecret(secretId: string): string {
		if (!secretId.trim()) return "";
		try {
			return this.options.net.readSecret(secretId)?.trim() ?? "";
		} catch {
			return "";
		}
	}

	private dropRemovedLocalSources(): void {
		const configured = new Set(
			this.options.settings
				.getDictionarySettings()
				.localDictionaries.map((dictionary) => dictionary.id),
		);
		for (const [id, source] of this.localSources) {
			if (configured.has(id)) continue;
			source.close();
			this.localSources.delete(id);
		}
	}
}
