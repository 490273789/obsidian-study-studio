// Private compiled-v2 contract shared by the package implementation and its workers.
export const COMPILED_DICTIONARY_DIRECTORY = "compiled-v2";
export const COMPILED_DICTIONARY_FORMAT_VERSION = 2 as const;
export const COMPILED_DICTIONARY_MANIFEST = "manifest.json";
export const DICTIONARY_ENGINE_VERSION = "2.0.6";

type DictionaryCompileFormat = "eudic" | "mdict";

type DictionaryCompilePhase = "validate" | "parse" | "index" | "records" | "resources" | "verify";

export type DictionaryCompileErrorCode =
	| "unsupported-format"
	| "encrypted"
	| "corrupt"
	| "limit-exceeded"
	| "cancelled"
	| "storage-failed";

export interface DictionaryCompileSource {
	readonly name: string;
	readonly sha256: string;
	readonly size: number;
}

export interface DictionaryCompileRequest {
	readonly files: readonly File[];
	readonly format: DictionaryCompileFormat;
	readonly sources: readonly DictionaryCompileSource[];
}

export interface DictionaryCompileProgress {
	readonly completedBytes: number;
	readonly fileName: string;
	readonly phase: DictionaryCompilePhase;
	readonly totalBytes: number;
}

export interface CompiledDictionaryMetadata {
	readonly engineVersion: string;
	readonly entryCount: number;
	readonly fileCount: number;
	readonly formatVersion: typeof COMPILED_DICTIONARY_FORMAT_VERSION;
	readonly manifestPath: `${typeof COMPILED_DICTIONARY_DIRECTORY}/manifest.json`;
	readonly manifestSha256: string;
	readonly sourceFingerprint: string;
	readonly totalBytes: number;
}

export interface CompiledFileDescriptor {
	readonly sha256: string;
	readonly size: number;
}

export interface CompiledFrameDescriptor {
	readonly codec: "deflate" | "none";
	readonly file: string;
	readonly length: number;
	readonly offset: number;
	readonly unpackedSize: number;
}

export interface CompiledIndexDescriptor {
	readonly firstKey: string;
	readonly fstFile: string;
	readonly lastKey: string;
	readonly postingsFile: string;
}

export interface CompiledJsonIndexDescriptor {
	readonly file: string;
	readonly firstKey: string;
	readonly lastKey: string;
}

export interface CompiledDictionaryManifest {
	readonly engineVersion: string;
	readonly entryCount: number;
	readonly files: Readonly<Record<string, CompiledFileDescriptor>>;
	readonly formatVersion: typeof COMPILED_DICTIONARY_FORMAT_VERSION;
	readonly indexes: readonly CompiledIndexDescriptor[];
	readonly recordFrames: readonly CompiledFrameDescriptor[];
	readonly remoteResourceKind?: "eudic-word-card-en-v2" | null;
	readonly resources: readonly CompiledJsonIndexDescriptor[];
	readonly script?: string | null;
	readonly sources: readonly DictionaryCompileSource[];
	readonly stylesheet?: string | null;
}

export class DictionaryCompileError extends Error {
	constructor(
		readonly code: DictionaryCompileErrorCode,
		message: string,
	) {
		super(message);
		this.name = "DictionaryCompileError";
	}
}

export function normalizeCompiledLookupKey(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[().,\-&、 '/\\@_$!]/g, "")
		.trim();
}

export function normalizeCompiledResourceKey(value: string): string {
	return value.normalize("NFKC").replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
}

export async function digestSha256Hex(data: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data.slice().buffer));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isCompiledResourceMime(value: string): boolean {
	return /^(?:text\/(?:css|html|javascript|plain|vtt)|application\/(?:json|manifest\+json|octet-stream|vnd\.ms-fontobject|wasm|xml)|image\/(?:apng|avif|bmp|gif|jpeg|png|svg\+xml|webp|x-icon)|audio\/(?:aac|flac|mp4|mpeg|ogg|opus|wav|webm)|video\/(?:mp4|ogg|quicktime|webm)|font\/(?:otf|ttf|woff|woff2))$/.test(
		value,
	);
}

export async function sourceFingerprint(
	sources: readonly DictionaryCompileSource[],
): Promise<string> {
	const value = sources
		.map((source) => `${source.name}\0${source.size}\0${source.sha256}\n`)
		.join("");
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value).buffer),
	);
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
