import type { CompiledDictionarySettings } from "../types";
import {
	COMPILED_DICTIONARY_DIRECTORY,
	COMPILED_DICTIONARY_FORMAT_VERSION,
	COMPILED_DICTIONARY_MANIFEST,
	DICTIONARY_ENGINE_VERSION,
	digestSha256Hex,
	sourceFingerprint,
	type CompiledDictionaryManifest,
	type CompiledFileDescriptor,
	type CompiledFrameDescriptor,
} from "./internal";
import type { CompiledPackageQueryPlan } from "./types";
import { CompiledPackageError } from "./types";
import { isRecord } from "../../../../core/shared/isRecord";

export const MAX_COMPILED_MANIFEST_BYTES = 2_000_000;
export const MAX_COMPILED_PACKAGE_FILE_BYTES = 2 * 1_048_576;
export const MAX_COMPILED_STYLESHEET_BYTES = 8 * 1_048_576;
export const MAX_COMPILED_SCRIPT_BYTES = 8 * 1_048_576;
export const SAFE_COMPILED_PACKAGE_FILE =
	/^(?:blocks|indexes)\/[a-z\d][a-z\d.-]*\.(?:bin|fst|json)$|^(?:script\.js|style\.css)$/i;
export const SAFE_COMPILED_OUTPUT_FILE =
	/^(?:blocks|indexes)\/[a-z\d][a-z\d.-]*\.(?:bin|fst|json)$|^(?:manifest\.json|script\.js|style\.css)$/i;

interface CompiledPackageFacts extends CompiledDictionarySettings {
	readonly manifest: CompiledDictionaryManifest;
}

export function compiledPackageDirectory(dictionaryRoot: string): string {
	return `${dictionaryRoot}/${COMPILED_DICTIONARY_DIRECTORY}`;
}

export function compiledPackageManifestPath(dictionaryRoot: string): string {
	return `${compiledPackageDirectory(dictionaryRoot)}/${COMPILED_DICTIONARY_MANIFEST}`;
}

export function compiledPackageMaximumBytes(sourceBytes: number): number {
	return Math.ceil(sourceBytes * 1.25);
}

export function isCompiledPackageCompatible(
	metadata: Readonly<CompiledDictionarySettings> | undefined,
): metadata is Readonly<CompiledDictionarySettings> {
	return Boolean(
		metadata &&
		metadata.formatVersion === COMPILED_DICTIONARY_FORMAT_VERSION &&
		metadata.engineVersion === DICTIONARY_ENGINE_VERSION &&
		metadata.manifestPath ===
			`${COMPILED_DICTIONARY_DIRECTORY}/${COMPILED_DICTIONARY_MANIFEST}` &&
		/^[a-f\d]{64}$/.test(metadata.manifestSha256) &&
		/^[a-f\d]{64}$/.test(metadata.sourceFingerprint) &&
		Number.isSafeInteger(metadata.entryCount) &&
		metadata.entryCount >= 0 &&
		Number.isSafeInteger(metadata.fileCount) &&
		metadata.fileCount > 0 &&
		Number.isSafeInteger(metadata.totalBytes) &&
		metadata.totalBytes > 0,
	);
}

export function parseCompiledPackageManifest(bytes: Uint8Array): CompiledDictionaryManifest {
	if (bytes.byteLength > MAX_COMPILED_MANIFEST_BYTES) throw corrupt();
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw corrupt();
	}
	if (
		isRecord(parsed) &&
		(parsed.formatVersion !== COMPILED_DICTIONARY_FORMAT_VERSION ||
			parsed.engineVersion !== DICTIONARY_ENGINE_VERSION)
	) {
		throw new CompiledPackageError("incompatible");
	}
	if (
		!isRecord(parsed) ||
		parsed.formatVersion !== COMPILED_DICTIONARY_FORMAT_VERSION ||
		parsed.engineVersion !== DICTIONARY_ENGINE_VERSION ||
		!Number.isSafeInteger(parsed.entryCount) ||
		Number(parsed.entryCount) < 0 ||
		!isRecord(parsed.files) ||
		!Object.entries(parsed.files).every(([path, descriptor]) => validFile(path, descriptor)) ||
		!Array.isArray(parsed.indexes) ||
		!parsed.indexes.every((value) =>
			validFstIndex(value, parsed.files as Record<string, unknown>),
		) ||
		!Array.isArray(parsed.recordFrames) ||
		!parsed.recordFrames.every((value) =>
			validFrame(value, parsed.files as Record<string, unknown>),
		) ||
		!Array.isArray(parsed.resources) ||
		!parsed.resources.every((value) =>
			validJsonIndex(value, parsed.files as Record<string, unknown>),
		) ||
		!Array.isArray(parsed.sources) ||
		!parsed.sources.every(validSource) ||
		(parsed.script !== null &&
			parsed.script !== undefined &&
			(parsed.script !== "script.js" || !isRecord(parsed.files["script.js"]))) ||
		(parsed.stylesheet !== null &&
			parsed.stylesheet !== undefined &&
			(parsed.stylesheet !== "style.css" || !isRecord(parsed.files["style.css"]))) ||
		(parsed.remoteResourceKind !== null &&
			parsed.remoteResourceKind !== undefined &&
			parsed.remoteResourceKind !== "eudic-word-card-en-v2")
	) {
		throw corrupt();
	}
	return parsed as unknown as CompiledDictionaryManifest;
}

export async function describeCompiledPackage(
	manifestBytes: Uint8Array,
	manifest: CompiledDictionaryManifest,
): Promise<CompiledPackageFacts> {
	const files = Object.values(manifest.files);
	return {
		engineVersion: manifest.engineVersion,
		entryCount: manifest.entryCount,
		fileCount: files.length + 1,
		formatVersion: COMPILED_DICTIONARY_FORMAT_VERSION,
		manifest,
		manifestPath: `${COMPILED_DICTIONARY_DIRECTORY}/${COMPILED_DICTIONARY_MANIFEST}`,
		manifestSha256: await digestSha256Hex(manifestBytes),
		sourceFingerprint: await sourceFingerprint(manifest.sources),
		totalBytes: files.reduce(
			(total, descriptor) => total + descriptor.size,
			manifestBytes.length,
		),
	};
}

export function assertCompiledPackageIdentity(
	expected: Readonly<CompiledDictionarySettings>,
	actual: Readonly<CompiledDictionarySettings>,
): void {
	if (
		!isCompiledPackageCompatible(expected) ||
		expected.engineVersion !== actual.engineVersion ||
		expected.entryCount !== actual.entryCount ||
		expected.fileCount !== actual.fileCount ||
		expected.formatVersion !== actual.formatVersion ||
		expected.manifestPath !== actual.manifestPath ||
		expected.manifestSha256 !== actual.manifestSha256 ||
		expected.sourceFingerprint !== actual.sourceFingerprint ||
		expected.totalBytes !== actual.totalBytes
	) {
		throw new CompiledPackageError(
			isCompiledPackageCompatible(expected) ? "corrupt" : "incompatible",
		);
	}
}

export function createCompiledPackageQueryPlan(
	manifest: CompiledDictionaryManifest,
): CompiledPackageQueryPlan {
	return manifest as unknown as CompiledPackageQueryPlan;
}

export function readCompiledPackageQueryPlan(
	queryPlan: CompiledPackageQueryPlan,
): CompiledDictionaryManifest {
	return queryPlan as unknown as CompiledDictionaryManifest;
}

export async function validateCompiledPackageFile(
	data: Uint8Array,
	descriptor: CompiledFileDescriptor,
): Promise<void> {
	if (
		data.byteLength !== descriptor.size ||
		(await digestSha256Hex(data)) !== descriptor.sha256
	) {
		throw corrupt();
	}
}

function validFile(path: string, value: unknown): boolean {
	const maximumBytes = path.startsWith("indexes/")
		? 512 * 1_024
		: path === "script.js"
			? MAX_COMPILED_SCRIPT_BYTES
			: path === "style.css"
				? MAX_COMPILED_STYLESHEET_BYTES
				: MAX_COMPILED_PACKAGE_FILE_BYTES;
	return (
		SAFE_COMPILED_PACKAGE_FILE.test(path) &&
		isRecord(value) &&
		typeof value.sha256 === "string" &&
		/^[a-f\d]{64}$/.test(value.sha256) &&
		Number.isSafeInteger(value.size) &&
		Number(value.size) > 0 &&
		Number(value.size) <= maximumBytes
	);
}

function validFstIndex(value: unknown, files: Record<string, unknown>): boolean {
	return (
		isRecord(value) &&
		validRange(value) &&
		typeof value.fstFile === "string" &&
		typeof value.postingsFile === "string" &&
		isRecord(files[value.fstFile]) &&
		isRecord(files[value.postingsFile])
	);
}

function validJsonIndex(value: unknown, files: Record<string, unknown>): boolean {
	return (
		isRecord(value) &&
		validRange(value) &&
		typeof value.file === "string" &&
		isRecord(files[value.file])
	);
}

function validRange(value: Record<string, unknown>): boolean {
	return (
		typeof value.firstKey === "string" &&
		typeof value.lastKey === "string" &&
		value.firstKey.length <= 1_024 &&
		value.lastKey.length <= 1_024 &&
		value.firstKey <= value.lastKey
	);
}

function validFrame(value: unknown, files: Record<string, unknown>): boolean {
	if (!isRecord(value) || typeof value.file !== "string" || !isRecord(files[value.file])) {
		return false;
	}
	const file = files[value.file] as Record<string, unknown>;
	return validFrameDescriptor(value, Number(file.size));
}

function validFrameDescriptor(
	value: Record<string, unknown> | CompiledFrameDescriptor,
	fileSize: number,
): boolean {
	return (
		(value.codec === "deflate" || value.codec === "none") &&
		Number.isSafeInteger(value.offset) &&
		Number(value.offset) >= 0 &&
		Number.isSafeInteger(value.length) &&
		Number(value.length) > 0 &&
		Number.isSafeInteger(value.unpackedSize) &&
		Number(value.unpackedSize) >= 0 &&
		Number(value.unpackedSize) <= 32 * 1_048_576 &&
		Number(value.offset) + Number(value.length) <= fileSize
	);
}

function validSource(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		/^[^/\\]+\.(?:eudic|mdx|(?:\d+\.)?mdd|css|js)$/i.test(value.name) &&
		typeof value.sha256 === "string" &&
		/^[a-f\d]{64}$/.test(value.sha256) &&
		Number.isSafeInteger(value.size) &&
		Number(value.size) >= 0
	);
}

function corrupt(): CompiledPackageError {
	return new CompiledPackageError("corrupt");
}
