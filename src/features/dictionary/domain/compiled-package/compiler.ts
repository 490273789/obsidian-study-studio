// oxlint-disable-next-line import/default -- Vite's ?worker&inline query generates this constructor.
import CompilerWorker from "../dictionary.worker?worker&inline";
import {
	COMPILED_DICTIONARY_DIRECTORY,
	COMPILED_DICTIONARY_FORMAT_VERSION,
	DictionaryCompileError,
	digestSha256Hex,
	sourceFingerprint,
	type CompiledDictionaryMetadata,
	type DictionaryCompileErrorCode,
	type DictionaryCompileProgress,
	type DictionaryCompileRequest,
} from "./internal";

interface DictionaryPackageSink {
	write(path: string, data: Uint8Array): Promise<void>;
}

interface DictionaryCompilerOptions {
	readonly onProgress?: (progress: DictionaryCompileProgress) => void;
	readonly signal?: AbortSignal;
}

interface WorkerMessage {
	readonly code?: DictionaryCompileErrorCode;
	readonly data?: ArrayBuffer;
	readonly engineVersion?: string;
	readonly entryCount?: number;
	readonly message?: string;
	readonly path?: string;
	readonly progress?: DictionaryCompileProgress;
	readonly totalBytes?: number;
	readonly type: "complete" | "error" | "file" | "progress";
}

export class DictionaryCompiler {
	private readonly workers = new Set<Worker>();

	close(): void {
		for (const worker of this.workers) worker.terminate();
		this.workers.clear();
	}

	async compile(
		request: DictionaryCompileRequest,
		sink: DictionaryPackageSink,
		options: DictionaryCompilerOptions = {},
	): Promise<CompiledDictionaryMetadata> {
		options.signal?.throwIfAborted();
		const worker = new CompilerWorker();
		this.workers.add(worker);
		const fingerprint = sourceFingerprint(request.sources);
		let fileCount = 0;
		let manifestSha256 = "";
		const result = new Promise<CompiledDictionaryMetadata>((resolve, reject) => {
			const cancel = () => {
				worker.terminate();
				reject(
					new DictionaryCompileError(
						"cancelled",
						"Dictionary compilation was cancelled.",
					),
				);
			};
			options.signal?.addEventListener("abort", cancel, { once: true });
			worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
				const message = event.data;
				if (message.type === "progress" && message.progress) {
					options.onProgress?.(message.progress);
					return;
				}
				if (message.type === "file" && message.path && message.data) {
					fileCount += 1;
					const data = new Uint8Array(message.data);
					void sink
						.write(message.path, data)
						.then(async () => {
							if (message.path === "manifest.json")
								manifestSha256 = await digestSha256Hex(data);
							worker.postMessage({ path: message.path, type: "acknowledge" });
							return undefined;
						})
						.catch((error: unknown) => {
							worker.terminate();
							reject(
								new DictionaryCompileError(
									"storage-failed",
									error instanceof Error
										? error.message
										: "Dictionary package write failed.",
								),
							);
						});
					return;
				}
				if (message.type === "error") {
					reject(
						new DictionaryCompileError(
							message.code ?? "corrupt",
							message.message ?? "Dictionary compilation failed.",
						),
					);
					return;
				}
				if (
					message.type === "complete" &&
					typeof message.engineVersion === "string" &&
					typeof message.entryCount === "number" &&
					typeof message.totalBytes === "number"
				) {
					void fingerprint.then((sourceDigest) =>
						resolve({
							engineVersion: message.engineVersion!,
							entryCount: message.entryCount!,
							fileCount,
							formatVersion: COMPILED_DICTIONARY_FORMAT_VERSION,
							manifestPath: `${COMPILED_DICTIONARY_DIRECTORY}/manifest.json`,
							manifestSha256,
							sourceFingerprint: sourceDigest,
							totalBytes: message.totalBytes!,
						}),
					);
				}
			});
			worker.addEventListener("error", (event) => {
				reject(new DictionaryCompileError("corrupt", event.message));
			});
			worker.postMessage({ request, type: "start" });
		});
		try {
			return await result;
		} finally {
			worker.terminate();
			this.workers.delete(worker);
		}
	}
}
