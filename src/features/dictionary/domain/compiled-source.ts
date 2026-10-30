import { Platform, type DataAdapter } from "obsidian";
import type { OutboundPort } from "../../../core/net/types";
import { dictionaryText } from "./messages";
import type { LocalDictionarySettings } from "./types";
import {
	CompiledPackageError,
	openCompiledPackage,
	type CompiledPackageReader,
} from "./compiled-package";
import { EUDIC_IMAGE_RESOURCE_KIND, EudicImageResourceLoader } from "./eudic-image";
import { CompiledDictionaryResources } from "./compiled-resources";
import { prepareDictionarySandboxDocument } from "./sandbox-document";
import type { DictionarySandboxStorageMutation } from "./sandbox-document/protocol";
import { LocalDictionarySandboxStorage } from "./sandbox-storage";
import {
	getSharedDictionaryQueryWorker,
	type SharedDictionaryQueryWorker,
} from "./sharedQueryWorker";
import {
	DictionaryError,
	type DictionaryQuery,
	type DictionaryResult,
	type DictionarySection,
	type DictionarySource,
} from "./types";

const MAX_VISIBLE_DEFINITIONS = 8;

export class CompiledDictionarySource implements DictionarySource {
	readonly kind = "local" as const;
	readonly id: string;
	readonly label: string;
	private readonly packageCacheBytes: number;
	private readonly resources: CompiledDictionaryResources;
	private readonly sandboxStorage: LocalDictionarySandboxStorage;
	private closed = false;
	private packageReader: CompiledPackageReader | null = null;
	private opening: Promise<void> | null = null;
	private script = "";
	private stylesheet = "";

	constructor(
		private readonly metadata: Readonly<LocalDictionarySettings>,
		private readonly adapter: DataAdapter,
		private readonly dictionaryRoot: string,
		net: Pick<OutboundPort, "requestHostPinned">,
		private readonly workerClient: SharedDictionaryQueryWorker = getSharedDictionaryQueryWorker(),
	) {
		this.id = metadata.id;
		this.label = metadata.name;
		const totalBudget = Platform.isMobile ? 24 * 1_048_576 : 64 * 1_048_576;
		this.packageCacheBytes = (totalBudget * 3) / 8;
		this.sandboxStorage = new LocalDictionarySandboxStorage(adapter, dictionaryRoot);
		this.resources = new CompiledDictionaryResources({
			read: (path) => this.workerClient.resolveResource(this.id, path),
			canReadRemote: () =>
				this.packageReader?.remoteResourceKind === EUDIC_IMAGE_RESOURCE_KIND,
			remote: new EudicImageResourceLoader(net),
			budgetBytes: totalBudget / 4,
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.workerClient.unregister(this.id);
		this.resources.close();
		this.packageReader?.close();
		this.packageReader = null;
		this.sandboxStorage.close();
	}

	async lookup(query: DictionaryQuery): Promise<DictionaryResult> {
		await this.open();
		const storage = {
			update: (mutation: DictionarySandboxStorageMutation) =>
				this.sandboxStorage.update(mutation),
			values: await this.sandboxStorage.snapshot(),
		};
		const content = await this.workerClient.lookup(this.id, query.text);
		const visible = content.definitions.slice(0, MAX_VISIBLE_DEFINITIONS);
		const sections: DictionarySection[] = await Promise.all(
			visible.map(async ({ definition, keyText }): Promise<DictionarySection> => ({
				content: {
					document: await prepareDictionarySandboxDocument(
						definition,
						(path) => this.resources.resolve(path),
						this.stylesheet,
						{
							localCompatibility: true,
							resolveScript: (path) =>
								this.resources.resolveText(path, "text/javascript"),
							resolveStylesheet: (path) =>
								this.resources.resolveText(path, "text/css"),
							script: this.script,
							storage,
						},
					),
					kind: "document",
				},
				presentation: "stack",
				title:
					content.definitions.length > 1
						? `${dictionaryText().sections.definitions} · ${keyText}`
						: dictionaryText().sections.definitions,
			})),
		);
		if (content.definitions.length > MAX_VISIBLE_DEFINITIONS) {
			const remaining = content.definitions.slice(MAX_VISIBLE_DEFINITIONS);
			const html = `<details><summary>${escapeHtml(dictionaryText().moreDefinitions(remaining.length))}</summary>${remaining
				.map(
					({ definition, keyText }) =>
						`<article><h3>${escapeHtml(keyText)}</h3>${definition}</article>`,
				)
				.join("")}</details>`;
			sections.push({
				content: {
					document: await prepareDictionarySandboxDocument(
						html,
						(path) => this.resources.resolve(path),
						this.stylesheet,
						{
							localCompatibility: true,
							resolveScript: (path) =>
								this.resources.resolveText(path, "text/javascript"),
							resolveStylesheet: (path) =>
								this.resources.resolveText(path, "text/css"),
							script: this.script,
							storage,
						},
					),
					kind: "document",
				},
				presentation: "stack",
				title: dictionaryText().sections.definitions,
			});
		}
		if (this.closed) throw new DictionaryError("request", dictionaryText().errors.request);
		if (sections.length === 0 && content.suggestions.length === 0) {
			throw new DictionaryError("not-found", dictionaryText().errors.notFound);
		}
		return {
			attribution: `${dictionaryText().local} · ${this.metadata.name}`,
			pronunciations: [],
			sections,
			sourceId: this.id,
			sourceLabel: this.label,
			suggestions: [...content.suggestions],
			word: visible[0]?.keyText ?? query.text,
		};
	}

	private async open(): Promise<void> {
		if (this.closed) throw new DictionaryError("request", dictionaryText().errors.request);
		this.opening ??= this.openNow();
		return this.opening;
	}

	private async openNow(): Promise<void> {
		const compiled = this.metadata.compiled;
		if (!compiled) {
			throw new DictionaryError("unsupported", dictionaryText().compiledReimportRequired);
		}
		let reader: CompiledPackageReader;
		try {
			reader = await openCompiledPackage({
				adapter: this.adapter,
				cacheBytes: this.packageCacheBytes,
				dictionaryRoot: this.dictionaryRoot,
				expected: compiled,
			});
		} catch (error) {
			if (error instanceof CompiledPackageError && error.code === "incompatible") {
				throw new DictionaryError("unsupported", dictionaryText().compiledReimportRequired);
			}
			throw packageCorrupt();
		}
		if (this.closed) {
			reader.close();
			throw new DictionaryError("request", dictionaryText().errors.request);
		}
		this.packageReader = reader;
		this.script = reader.script;
		this.stylesheet = reader.stylesheet;
		this.workerClient.register(this.id, {
			readPackageFile: (path) => this.readPackageFile(path),
		});
		this.workerClient.open(this.id, reader.queryPlan, this.packageCacheBytes);
	}

	private async readPackageFile(path: string): Promise<Uint8Array> {
		const reader = this.packageReader;
		if (!reader) throw packageCorrupt();
		try {
			return await reader.readFile(path);
		} catch {
			throw packageCorrupt();
		}
	}
}
function packageCorrupt(): DictionaryError {
	return new DictionaryError("invalid-response", dictionaryText().compiledCorrupt);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
