// oxlint-disable-next-line import/default -- Vite's ?worker&inline query generates this constructor.
import QueryWorker from "./dictionary.worker?worker&inline";
import { DictionaryError } from "./types";
import { dictionaryText } from "./messages";
import type { CompiledPackageQueryPlan } from "./compiled-package/types";
import type { CompiledResource } from "./compiled-resources";

export interface QueryResult {
	readonly definitions: readonly { definition: string; keyText: string }[];
	readonly suggestions: readonly string[];
}

export interface WorkerOutput {
	readonly data?: ArrayBuffer;
	readonly error?: string;
	readonly id: number;
	readonly mime?: string;
	readonly path?: string;
	readonly result?: QueryResult | CompiledResource | null;
	readonly type: "error" | "lookup-result" | "read" | "resource-result";
	readonly dictionaryId?: string;
}

interface PendingRequest {
	readonly dictionaryId: string;
	reject(error: Error): void;
	resolve(value: unknown): void;
}

export interface RegisteredDictionaryPackageReader {
	readPackageFile(path: string): Promise<Uint8Array>;
}

/**
 * Shared query worker multiplexer for local compiled dictionaries.
 *
 * Multiplexes multiple local dictionary sessions over a single Web Worker
 * and single WASM engine instance, while lazily instantiating the worker
 * on first demand and terminating it when all dictionaries unregister.
 */
export class SharedDictionaryQueryWorker {
	private worker: Worker | null = null;
	private readonly registrations = new Map<string, RegisteredDictionaryPackageReader>();
	private readonly pending = new Map<number, PendingRequest>();
	private nextRequestId = 1;

	get activeWorkerCount(): number {
		return this.worker ? 1 : 0;
	}

	get registeredDictionaryCount(): number {
		return this.registrations.size;
	}

	private ensureWorker(): Worker {
		if (!this.worker) {
			this.worker = new QueryWorker();
			this.worker.addEventListener("message", (event: MessageEvent<WorkerOutput>) => {
				void this.handleWorkerMessage(event.data);
			});
			this.worker.addEventListener("error", (event) => {
				this.failAll(new DictionaryError("invalid-response", event.message));
			});
		}
		return this.worker;
	}

	register(dictionaryId: string, reader: RegisteredDictionaryPackageReader): void {
		this.registrations.set(dictionaryId, reader);
	}

	unregister(dictionaryId: string): void {
		if (!this.registrations.has(dictionaryId)) return;
		this.registrations.delete(dictionaryId);

		if (this.worker) {
			this.worker.postMessage({ type: "close", dictionaryId });
		}

		for (const [id, req] of this.pending) {
			if (req.dictionaryId === dictionaryId) {
				this.pending.delete(id);
				req.reject(new DictionaryError("request", dictionaryText().errors.request));
			}
		}

		if (this.registrations.size === 0 && this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}

	open(dictionaryId: string, queryPlan: CompiledPackageQueryPlan, cacheBytes: number): void {
		const worker = this.ensureWorker();
		worker.postMessage({
			type: "open",
			dictionaryId,
			queryPlan,
			cacheBytes,
		});
	}

	lookup(dictionaryId: string, word: string): Promise<QueryResult> {
		return this.request<QueryResult>(dictionaryId, { type: "lookup", word });
	}

	resolveResource(dictionaryId: string, path: string): Promise<CompiledResource | null> {
		return this.request<CompiledResource | null>(dictionaryId, { type: "resource", path });
	}

	request<T>(dictionaryId: string, value: Record<string, unknown>): Promise<T> {
		if (!this.registrations.has(dictionaryId)) {
			return Promise.reject(new DictionaryError("request", dictionaryText().errors.request));
		}
		const worker = this.ensureWorker();
		const id = this.nextRequestId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				dictionaryId,
				reject,
				resolve: (result) => resolve(result as T),
			});
			worker.postMessage({ ...value, id, dictionaryId });
		});
	}

	private async handleWorkerMessage(message: WorkerOutput): Promise<void> {
		if (message.type === "read" && message.path) {
			const dictionaryId = message.dictionaryId;
			const registration = dictionaryId
				? this.registrations.get(dictionaryId)
				: (this.registrations.values().next().value ?? null);
			if (!registration) return;

			try {
				const data = await registration.readPackageFile(message.path);
				if (dictionaryId && !this.registrations.has(dictionaryId)) return;
				const transfer = data.buffer.slice(
					data.byteOffset,
					data.byteOffset + data.byteLength,
				);
				this.ensureWorker().postMessage(
					{ data: transfer, id: message.id, type: "read-result", dictionaryId },
					[transfer],
				);
			} catch (error) {
				if (dictionaryId && !this.registrations.has(dictionaryId)) return;
				this.ensureWorker().postMessage({
					error:
						error instanceof Error ? error.message : "Dictionary package read failed.",
					id: message.id,
					type: "read-result",
					dictionaryId,
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

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}

	dispose(): void {
		this.failAll(new DictionaryError("request", dictionaryText().errors.request));
		this.registrations.clear();
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}
}

let sharedWorkerInstance: SharedDictionaryQueryWorker | null = null;

export function getSharedDictionaryQueryWorker(): SharedDictionaryQueryWorker {
	return (sharedWorkerInstance ??= new SharedDictionaryQueryWorker());
}

export function resetSharedDictionaryQueryWorker(): void {
	if (sharedWorkerInstance) {
		sharedWorkerInstance.dispose();
		sharedWorkerInstance = null;
	}
}
