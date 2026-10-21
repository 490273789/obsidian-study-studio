// Desktop-only publication lazily imports Node built-ins. `@types/node` is a
// devDependency but is not part of the default program, so reference it here to
// keep `node:fs/promises` and `node:crypto` typed without changing the deferred
// import calls.
/// <reference types="node" />
import type { CompiledDictionarySettings } from "../types";
import { MAX_EUDIC_DICTIONARY_BYTES } from "../eudic-image";
import { pathExists } from "../fs-errors";
import { DictionaryCompiler } from "./compiler";
import {
	COMPILED_DICTIONARY_DIRECTORY,
	DictionaryCompileError,
	type CompiledDictionaryMetadata,
	type DictionaryCompileRequest,
	type DictionaryCompileSource,
} from "./internal";
import {
	compiledPackageMaximumBytes,
	describeCompiledPackage,
	parseCompiledPackageManifest,
	SAFE_COMPILED_OUTPUT_FILE,
	validateCompiledPackageFile,
} from "./manifest";
import type {
	CompiledPackagePublication,
	CompiledPackagePublisher,
	CompiledPackagePublishRequest,
	CompiledPackageProgressListener,
} from "./types";
import { CompiledPackageError } from "./types";

const MAX_DICTIONARY_CSS_BYTES = 8 * 1_048_576;
const MAX_DICTIONARY_JAVASCRIPT_BYTES = 8 * 1_048_576;

type InternalCompiledPackageCompiler = Pick<DictionaryCompiler, "close" | "compile">;

export function createCompiledPackagePublisher(): CompiledPackagePublisher {
	return new CompiledPackagePublisherModule();
}

class CompiledPackagePublisherModule implements CompiledPackagePublisher {
	constructor(
		private readonly compiler: InternalCompiledPackageCompiler = new DictionaryCompiler(),
	) {}

	close(): void {
		this.compiler.close();
	}

	async publish(
		request: CompiledPackagePublishRequest,
		onProgress?: CompiledPackageProgressListener,
		signal?: AbortSignal,
	): Promise<CompiledPackagePublication> {
		validatePublishRequest(request);
		signal?.throwIfAborted();
		const sourceBytes = request.files.reduce((total, file) => total + file.size, 0);
		const maximumBytes = compiledPackageMaximumBytes(sourceBytes);
		const staging = `${request.dictionaryDirectory}/.compiled-v2-import`;
		const published = `${request.dictionaryDirectory}/${COMPILED_DICTIONARY_DIRECTORY}`;
		const { lstat, mkdir, readFile, rename, rm, statfs, writeFile } =
			await import("node:fs/promises");
		if (
			(await pathExists(lstat, staging, storageError)) ||
			(await pathExists(lstat, published, storageError))
		) {
			throw new CompiledPackageError("collision");
		}
		const filesystem = await statfs(request.dictionaryDirectory).catch((error: unknown) => {
			throw storageError(error);
		});
		if (filesystem.bavail * filesystem.bsize < maximumBytes) {
			throw new CompiledPackageError("storage-failed");
		}
		try {
			await mkdir(staging);
			await mkdir(`${staging}/blocks`);
			await mkdir(`${staging}/indexes`);
		} catch (error) {
			await cleanupStaging(staging, rm);
			throw storageError(error);
		}

		const writtenPaths = new Set<string>();
		try {
			const sources = await describeSources(request.files, onProgress, signal);
			const compileRequest: DictionaryCompileRequest = {
				files: request.files,
				format: request.format,
				sources,
			};
			const initial = await this.compiler.compile(
				compileRequest,
				{
					write: async (path, data) => {
						if (!SAFE_COMPILED_OUTPUT_FILE.test(path) || writtenPaths.has(path)) {
							throw new CompiledPackageError("storage-failed");
						}
						await writeFile(`${staging}/${path}`, data, { flag: "wx" });
						writtenPaths.add(path);
					},
				},
				{ ...(onProgress ? { onProgress } : {}), ...(signal ? { signal } : {}) },
			);
			const metadata = await verifyPublishedCandidate(
				staging,
				initial,
				maximumBytes,
				writtenPaths,
				readFile,
			);
			await rename(staging, published);
			return publication(published, metadata, rm);
		} catch (error) {
			try {
				await rm(staging, { force: true, recursive: true });
			} catch {
				throw new CompiledPackageError("recovery-incomplete");
			}
			if (signal?.aborted) throw new CompiledPackageError("cancelled");
			throw storageError(error);
		}
	}
}

function publication(
	directory: string,
	metadata: CompiledDictionarySettings,
	rm: (path: string, options: { force: boolean; recursive: boolean }) => Promise<void>,
): CompiledPackagePublication {
	let state: "published" | "committed" | "rolled-back" = "published";
	return {
		commit(): void {
			if (state === "published") state = "committed";
		},
		metadata,
		async rollback(): Promise<void> {
			if (state !== "published") return;
			try {
				await rm(directory, { force: true, recursive: true });
				state = "rolled-back";
			} catch {
				throw new CompiledPackageError("recovery-incomplete");
			}
		},
	};
}

function validatePublishRequest(request: CompiledPackagePublishRequest): void {
	const hasExpectedSource = request.files.some((file) =>
		file.name.toLowerCase().endsWith(request.format === "mdict" ? ".mdx" : ".eudic"),
	);
	if (
		request.files.length === 0 ||
		!hasExpectedSource ||
		request.files.some(
			(file) => !/^[^/\\]+\.(?:eudic|mdx|(?:\d+\.)?mdd|css|js)$/i.test(file.name),
		) ||
		request.files.some(
			(file) =>
				file.name.toLowerCase().endsWith(".css") && file.size > MAX_DICTIONARY_CSS_BYTES,
		) ||
		request.files.some(
			(file) =>
				file.name.toLowerCase().endsWith(".js") &&
				file.size > MAX_DICTIONARY_JAVASCRIPT_BYTES,
		) ||
		(request.format === "eudic" &&
			request.files.some((file) => file.size <= 0 || file.size > MAX_EUDIC_DICTIONARY_BYTES))
	) {
		throw new CompiledPackageError("storage-failed");
	}
}

async function describeSources(
	files: readonly File[],
	onProgress: CompiledPackageProgressListener | undefined,
	signal: AbortSignal | undefined,
): Promise<DictionaryCompileSource[]> {
	const { createHash } = await import("node:crypto");
	const sourceBytes = files.reduce((total, file) => total + file.size, 0);
	const totalBytes = Math.ceil(sourceBytes * 2.25);
	let completedBefore = 0;
	// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array for deterministic hashing.
	const sorted = [...files].sort((left, right) => {
		const leftName = left.name.normalize("NFKC");
		const rightName = right.name.normalize("NFKC");
		return leftName < rightName ? -1 : Number(leftName > rightName);
	});
	const result: DictionaryCompileSource[] = [];
	for (const file of sorted) {
		signal?.throwIfAborted();
		const hash = createHash("sha256");
		const reader = file.stream().getReader();
		let completed = 0;
		try {
			while (true) {
				signal?.throwIfAborted();
				// oxlint-disable-next-line no-await-in-loop -- source hashing preserves bounded chunk order.
				const item = await reader.read();
				if (item.done) break;
				hash.update(item.value);
				completed += item.value.byteLength;
				onProgress?.({
					completedBytes: completedBefore + completed,
					fileName: file.name,
					phase: "validate",
					totalBytes,
				});
			}
		} finally {
			reader.releaseLock();
		}
		if (completed !== file.size) throw new CompiledPackageError("corrupt");
		result.push({ name: file.name, sha256: hash.digest("hex"), size: file.size });
		completedBefore += completed;
	}
	return result;
}

async function verifyPublishedCandidate(
	directory: string,
	initial: Readonly<CompiledDictionaryMetadata>,
	maximumBytes: number,
	writtenPaths: ReadonlySet<string>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<CompiledDictionarySettings> {
	const manifestBytes = new Uint8Array(await readFile(`${directory}/manifest.json`));
	const manifest = parseCompiledPackageManifest(manifestBytes);
	const facts = await describeCompiledPackage(manifestBytes, manifest);
	const expectedPaths = new Set(["manifest.json", ...Object.keys(manifest.files)]);
	if (
		writtenPaths.size !== expectedPaths.size ||
		[...writtenPaths].some((path) => !expectedPaths.has(path)) ||
		initial.engineVersion !== facts.engineVersion ||
		initial.entryCount !== facts.entryCount ||
		initial.fileCount !== facts.fileCount ||
		initial.formatVersion !== facts.formatVersion ||
		initial.manifestPath !== facts.manifestPath ||
		initial.manifestSha256 !== facts.manifestSha256 ||
		initial.sourceFingerprint !== facts.sourceFingerprint ||
		initial.totalBytes !== facts.totalBytes
	) {
		throw new CompiledPackageError("corrupt");
	}
	for (const [path, descriptor] of Object.entries(manifest.files)) {
		// oxlint-disable-next-line no-await-in-loop -- complete verification precedes publication.
		const bytes = new Uint8Array(await readFile(`${directory}/${path}`));
		// oxlint-disable-next-line no-await-in-loop -- ordered readback bounds verification memory.
		await validateCompiledPackageFile(bytes, descriptor);
	}
	if (facts.totalBytes > maximumBytes) throw new CompiledPackageError("limit-exceeded");
	const { manifest: _manifest, ...metadata } = facts;
	return metadata;
}

async function cleanupStaging(
	directory: string,
	rm: (path: string, options: { force: boolean; recursive: boolean }) => Promise<void>,
): Promise<void> {
	try {
		await rm(directory, { force: true, recursive: true });
	} catch {
		throw new CompiledPackageError("recovery-incomplete");
	}
}

function storageError(error: unknown): CompiledPackageError {
	if (error instanceof CompiledPackageError) return error;
	if (error instanceof DictionaryCompileError) {
		return new CompiledPackageError(error.code, error.message);
	}
	if (error instanceof DOMException && error.name === "AbortError") {
		return new CompiledPackageError("cancelled");
	}
	return new CompiledPackageError(
		"storage-failed",
		error instanceof Error ? error.message : undefined,
	);
}
