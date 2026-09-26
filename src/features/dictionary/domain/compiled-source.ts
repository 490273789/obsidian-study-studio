import { Platform, type DataAdapter } from "obsidian";
import type { OutboundPort } from "../../../core/net/types";
import { dictionaryText } from "./messages";
import type { LocalDictionarySettings } from "./types";
// oxlint-disable-next-line import/default -- Vite's ?worker&inline query generates this constructor.
import QueryWorker from "./dictionary.worker?worker&inline";
import {
	CompiledPackageError,
	openCompiledPackage,
	type CompiledPackageReader,
} from "./compiled-package";
import { EUDIC_IMAGE_RESOURCE_KIND, EudicImageResourceLoader } from "./eudic-image";
import { CompiledDictionaryResources, type CompiledResource } from "./compiled-resources";
import { prepareDictionarySandboxDocument } from "./sandbox-document";
import type { DictionarySandboxStorageMutation } from "./sandbox-document/protocol";
import { LocalDictionarySandboxStorage } from "./sandbox-storage";
import {
	DictionaryError,
	type DictionaryQuery,
	type DictionaryResult,
	type DictionarySection,
	type DictionarySource,
} from "./types";

const MAX_VISIBLE_DEFINITIONS = 8;

interface QueryResult {
	readonly definitions: readonly { definition: string; keyText: string }[];
	readonly suggestions: readonly string[];
}

interface WorkerOutput {
	readonly data?: ArrayBuffer;
	readonly error?: string;
	readonly id: number;
	readonly mime?: string;
	readonly path?: string;
	readonly result?: QueryResult | CompiledResource | null;
	readonly type: "error" | "lookup-result" | "read" | "resource-result";
}

interface PendingRequest {
	reject(error: Error): void;
	resolve(value: unknown): void;
}

export class CompiledDictionarySource implements DictionarySource {
	readonly kind = "local" as const;
	readonly id: string;
	readonly label: string;
	private readonly packageCacheBytes: number;
	private readonly resources: CompiledDictionaryResources;
	private readonly sandboxStorage: LocalDictionarySandboxStorage;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly queryWorker = new QueryWorker();
	private closed = false;
	private packageReader: CompiledPackageReader | null = null;
	private nextRequestId = 1;
	private opening: Promise<void> | null = null;
	private script = "";
	private stylesheet = "";

	constructor(
		private readonly metadata: Readonly<LocalDictionarySettings>,
		private readonly adapter: DataAdapter,
		private readonly dictionaryRoot: string,
		net: Pick<OutboundPort, "requestHostPinned">,
	) {
		this.id = metadata.id;
		this.label = metadata.name;
		const totalBudget = Platform.isMobile ? 24 * 1_048_576 : 64 * 1_048_576;
		this.packageCacheBytes = (totalBudget * 3) / 8;
		this.sandboxStorage = new LocalDictionarySandboxStorage(adapter, dictionaryRoot);
		this.resources = new CompiledDictionaryResources({
			read: (path) => this.request<CompiledResource | null>({ path, type: "resource" }),
			canReadRemote: () =>
				this.packageReader?.remoteResourceKind === EUDIC_IMAGE_RESOURCE_KIND,
			remote: new EudicImageResourceLoader(net),
			budgetBytes: totalBudget / 4,
		});
		this.queryWorker.addEventListener("message", (event: MessageEvent<WorkerOutput>) => {
			void this.handleWorkerMessage(event.data);
		});
		this.queryWorker.addEventListener("error", (event) => {
			this.failAll(new DictionaryError("invalid-response", event.message));
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.queryWorker.terminate();
		this.resources.close();
		this.failAll(new DictionaryError("request", dictionaryText().errors.request));
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
		const content = await this.request<QueryResult>({ type: "lookup", word: query.text });
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
		this.queryWorker.postMessage({
			cacheBytes: this.packageCacheBytes,
			queryPlan: reader.queryPlan,
			type: "open",
		});
	}

	private request<T>(value: Record<string, unknown>): Promise<T> {
		if (this.closed)
			return Promise.reject(new DictionaryError("request", dictionaryText().errors.request));
		const id = this.nextRequestId;
		this.nextRequestId += 1;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				reject,
				resolve: (result) => resolve(result as T),
			});
			this.queryWorker.postMessage({ ...value, id });
		});
	}

	private async handleWorkerMessage(message: WorkerOutput): Promise<void> {
		if (this.closed) return;
		if (message.type === "read" && message.path) {
			try {
				const data = await this.readPackageFile(message.path);
				if (this.closed) return;
				const transfer = data.buffer.slice(
					data.byteOffset,
					data.byteOffset + data.byteLength,
				);
				this.queryWorker.postMessage(
					{ data: transfer, id: message.id, type: "read-result" },
					[transfer],
				);
			} catch (error) {
				if (this.closed) return;
				this.queryWorker.postMessage({
					error:
						error instanceof Error ? error.message : "Dictionary package read failed.",
					id: message.id,
					type: "read-result",
				});
			}
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.type === "error") {
			pending.reject(
				new DictionaryError(
					"invalid-response",
					message.error ?? dictionaryText().errors.invalidResponse,
				),
			);
			return;
		}
		pending.resolve(message.result);
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

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
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
