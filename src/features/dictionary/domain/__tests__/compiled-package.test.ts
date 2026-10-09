import { describe, expect, it } from "vite-plus/test";
import {
	COMPILED_DICTIONARY_DIRECTORY,
	COMPILED_DICTIONARY_FORMAT_VERSION,
	COMPILED_DICTIONARY_MANIFEST,
	DICTIONARY_ENGINE_VERSION,
	isCompiledResourceMime,
	normalizeCompiledLookupKey,
	normalizeCompiledResourceKey,
} from "../compiled-package/internal";
import {
	compiledPackageDirectory,
	compiledPackageManifestPath,
	compiledPackageMaximumBytes,
	isCompiledPackageCompatible,
	MAX_COMPILED_MANIFEST_BYTES,
	MAX_COMPILED_PACKAGE_FILE_BYTES,
	MAX_COMPILED_SCRIPT_BYTES,
	MAX_COMPILED_STYLESHEET_BYTES,
	parseCompiledPackageManifest,
	SAFE_COMPILED_OUTPUT_FILE,
	SAFE_COMPILED_PACKAGE_FILE,
} from "../compiled-package/manifest";
import { CompiledPackageError } from "../compiled-package/types";
import type { CompiledDictionarySettings } from "../types";

const VALID_METADATA: CompiledDictionarySettings = {
	engineVersion: DICTIONARY_ENGINE_VERSION,
	entryCount: 10,
	fileCount: 2,
	formatVersion: 2,
	manifestPath: "compiled-v2/manifest.json",
	manifestSha256: "a".repeat(64),
	sourceFingerprint: "b".repeat(64),
	totalBytes: 1_024,
};

function metadata(overrides: Record<string, unknown>): CompiledDictionarySettings {
	return { ...VALID_METADATA, ...overrides } as unknown as CompiledDictionarySettings;
}

function manifestBytes(overrides: Record<string, unknown> = {}): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			engineVersion: DICTIONARY_ENGINE_VERSION,
			entryCount: 0,
			files: {},
			formatVersion: COMPILED_DICTIONARY_FORMAT_VERSION,
			indexes: [],
			recordFrames: [],
			resources: [],
			sources: [],
			...overrides,
		}),
	);
}

function manifestError(bytes: Uint8Array): unknown {
	try {
		parseCompiledPackageManifest(bytes);
	} catch (error) {
		return error;
	}
	throw new Error("Expected the manifest parse to throw");
}

describe("compiled package constants and paths", () => {
	it("declares the compiled-v2 layout", () => {
		expect(COMPILED_DICTIONARY_DIRECTORY).toBe("compiled-v2");
		expect(COMPILED_DICTIONARY_FORMAT_VERSION).toBe(2);
		expect(COMPILED_DICTIONARY_MANIFEST).toBe("manifest.json");
		expect(DICTIONARY_ENGINE_VERSION).toBe("2.0.6");
	});

	it("builds the package directory and manifest path", () => {
		expect(compiledPackageDirectory("dictionaries/sample")).toBe(
			"dictionaries/sample/compiled-v2",
		);
		expect(compiledPackageManifestPath("dictionaries/sample")).toBe(
			"dictionaries/sample/compiled-v2/manifest.json",
		);
		expect(compiledPackageDirectory("")).toBe("/compiled-v2");
	});

	it.each([
		[0, 0],
		[1, 2],
		[4, 5],
		[8, 10],
		[1_000, 1_250],
	])("reserves 25%% headroom for %i source bytes", (sourceBytes, maximum) => {
		expect(compiledPackageMaximumBytes(sourceBytes)).toBe(maximum);
	});

	it("declares the exported size limits", () => {
		expect(MAX_COMPILED_MANIFEST_BYTES).toBe(2_000_000);
		expect(MAX_COMPILED_PACKAGE_FILE_BYTES).toBe(2 * 1_048_576);
		expect(MAX_COMPILED_STYLESHEET_BYTES).toBe(8 * 1_048_576);
		expect(MAX_COMPILED_SCRIPT_BYTES).toBe(8 * 1_048_576);
	});
});

describe("isCompiledPackageCompatible", () => {
	it("accepts only an exact engine match at format version 2", () => {
		expect(isCompiledPackageCompatible(VALID_METADATA)).toBe(true);
		expect(
			isCompiledPackageCompatible(metadata({ engineVersion: DICTIONARY_ENGINE_VERSION })),
		).toBe(true);
	});

	it("rejects absent metadata", () => {
		expect(isCompiledPackageCompatible(undefined)).toBe(false);
	});

	it.each([
		["a different engine version", { engineVersion: "2.0.5" }],
		["a longer engine version", { engineVersion: "2.0.60" }],
		["a prefixed engine version", { engineVersion: "v2.0.6" }],
		["a different format version", { formatVersion: 1 }],
		["a future format version", { formatVersion: 3 }],
		["a different manifest path", { manifestPath: "compiled-v2/other.json" }],
		["an uppercase manifest digest", { manifestSha256: "A".repeat(64) }],
		["a short manifest digest", { manifestSha256: "a".repeat(63) }],
		["a non-hex fingerprint", { sourceFingerprint: "z".repeat(64) }],
		["a negative entry count", { entryCount: -1 }],
		["a fractional entry count", { entryCount: 0.5 }],
		["a zero file count", { fileCount: 0 }],
		["a zero byte count", { totalBytes: 0 }],
		["a fractional byte count", { totalBytes: 1.5 }],
	])("rejects %s", (_label, overrides) => {
		expect(isCompiledPackageCompatible(metadata(overrides))).toBe(false);
	});

	it("accepts a zero entry count", () => {
		expect(isCompiledPackageCompatible(metadata({ entryCount: 0 }))).toBe(true);
	});
});

describe("normalizeCompiledLookupKey", () => {
	it.each([
		["Hello", "hello"],
		["ＴＥＳＴ", "test"],
		["ＡＢＣ１２３", "abc123"],
		["①", "1"],
		["ﬁle", "file"],
		["CAFÉ", "café"],
		["TÜRKÇE", "türkçe"],
		["Straße", "straße"],
		["well-known", "wellknown"],
		["don't", "dont"],
		["a.b,c(d)e", "abcde"],
		["a&b、c", "abc"],
		["a b/c\\d@e_f$g!h", "abcdefgh"],
		["  spaced  ", "spaced"],
		["...", ""],
		["", ""],
	])("normalizes %j to %j", (value, expected) => {
		expect(normalizeCompiledLookupKey(value)).toBe(expected);
	});
});

describe("normalizeCompiledResourceKey", () => {
	it.each([
		["\\a\\b", "a/b"],
		["/a/b", "a/b"],
		["A/B", "a/b"],
		["Ｃ/Ｄ", "c/d"],
		["", ""],
	])("normalizes %j to %j", (value, expected) => {
		expect(normalizeCompiledResourceKey(value)).toBe(expected);
	});

	it("does not itself reject traversal segments", () => {
		expect(normalizeCompiledResourceKey("../a")).toBe("../a");
	});
});

describe("compiled package safe-path patterns", () => {
	it.each([
		"blocks/records-0.bin",
		"blocks/UPPER.BIN",
		"blocks/a.b-c.bin",
		"indexes/terms.fst",
		"indexes/terms-postings.json",
		"script.js",
		"style.css",
	])("accepts the package file %j", (path) => {
		expect(SAFE_COMPILED_PACKAGE_FILE.test(path)).toBe(true);
	});

	it.each([
		["a traversal segment", "../blocks/x.bin"],
		["an absolute path", "/blocks/x.bin"],
		["a backslash path", "blocks\\x.bin"],
		["an inner traversal", "blocks/../x.bin"],
		["the manifest", "manifest.json"],
		["an unknown extension", "blocks/x.exe"],
		["an unknown directory", "other/x.bin"],
		["a hidden file", "blocks/.hidden.bin"],
		["a missing file name", "blocks/"],
	])("rejects %s", (_label, path) => {
		expect(SAFE_COMPILED_PACKAGE_FILE.test(path)).toBe(false);
	});

	it.each(["manifest.json", "script.js", "style.css", "blocks/x.bin"])(
		"accepts the output file %j",
		(path) => {
			expect(SAFE_COMPILED_OUTPUT_FILE.test(path)).toBe(true);
		},
	);

	it.each([
		["a traversal segment", "../manifest.json"],
		["an absolute path", "/manifest.json"],
		["a backslash path", "manifest\\json"],
		["a nested manifest", "nested/manifest.json"],
		["an unknown extension", "other.json"],
	])("rejects %s as an output file", (_label, path) => {
		expect(SAFE_COMPILED_OUTPUT_FILE.test(path)).toBe(false);
	});
});

describe("isCompiledResourceMime", () => {
	it.each([
		["text/css", true],
		["application/json", true],
		["application/wasm", true],
		["image/svg+xml", true],
		["font/woff2", true],
		["audio/mpeg", true],
		["text/html; charset=utf-8", false],
		["application/x-msdownload", false],
		["", false],
	])("classifies %j as %s", (mime, expected) => {
		expect(isCompiledResourceMime(mime)).toBe(expected);
	});
});

describe("parseCompiledPackageManifest", () => {
	it("accepts a minimal valid manifest", () => {
		expect(parseCompiledPackageManifest(manifestBytes())).toMatchObject({
			engineVersion: DICTIONARY_ENGINE_VERSION,
			entryCount: 0,
			formatVersion: 2,
		});
	});

	it("accepts valid file descriptors, indexes, frames, resources, and sources", () => {
		const descriptor = { sha256: "a".repeat(64), size: 4 };
		const manifest = parseCompiledPackageManifest(
			manifestBytes({
				files: {
					"blocks/records-0.bin": descriptor,
					"indexes/terms.fst": descriptor,
					"indexes/postings.json": descriptor,
				},
				indexes: [
					{
						firstKey: "a",
						fstFile: "indexes/terms.fst",
						lastKey: "z",
						postingsFile: "indexes/postings.json",
					},
				],
				recordFrames: [
					{
						codec: "deflate",
						file: "blocks/records-0.bin",
						length: 2,
						offset: 0,
						unpackedSize: 4,
					},
				],
				resources: [{ file: "indexes/postings.json", firstKey: "a", lastKey: "z" }],
				sources: [{ name: "Sample.mdx", sha256: "b".repeat(64), size: 128 }],
			}),
		);
		expect(Object.keys(manifest.files)).toHaveLength(3);
		expect(manifest.sources[0]?.name).toBe("Sample.mdx");
	});

	it("classifies an oversized manifest as corrupt", () => {
		const error = manifestError(new Uint8Array(MAX_COMPILED_MANIFEST_BYTES + 1));
		expect(error).toBeInstanceOf(CompiledPackageError);
		expect(error).toMatchObject({ code: "corrupt" });
	});

	it("classifies invalid JSON as corrupt", () => {
		expect(manifestError(new TextEncoder().encode("{not json"))).toMatchObject({
			code: "corrupt",
		});
	});

	it.each([
		["a format version", { formatVersion: 1 }],
		["an engine version", { engineVersion: "2.0.5" }],
	])("classifies a mismatched %s as incompatible", (_label, overrides) => {
		expect(manifestError(manifestBytes(overrides))).toMatchObject({ code: "incompatible" });
	});

	it.each([
		["a negative entry count", { entryCount: -1 }],
		["a fractional entry count", { entryCount: 1.5 }],
		[
			"an unsafe file path",
			{ files: { "../escape.bin": { sha256: "a".repeat(64), size: 4 } } },
		],
		[
			"an unknown file extension",
			{ files: { "blocks/x.exe": { sha256: "a".repeat(64), size: 4 } } },
		],
		["a zero-sized file", { files: { "blocks/x.bin": { sha256: "a".repeat(64), size: 0 } } }],
		["a short file digest", { files: { "blocks/x.bin": { sha256: "a", size: 4 } } }],
		[
			"an index pointing at a missing file",
			{
				indexes: [
					{
						firstKey: "a",
						fstFile: "indexes/missing.fst",
						lastKey: "z",
						postingsFile: "x",
					},
				],
			},
		],
		[
			"an inverted index range",
			{
				files: { "indexes/x.fst": { sha256: "a".repeat(64), size: 4 } },
				indexes: [
					{
						firstKey: "z",
						fstFile: "indexes/x.fst",
						lastKey: "a",
						postingsFile: "indexes/x.fst",
					},
				],
			},
		],
		[
			"a frame overflowing its file",
			{
				files: { "blocks/x.bin": { sha256: "a".repeat(64), size: 4 } },
				recordFrames: [
					{ codec: "none", file: "blocks/x.bin", length: 8, offset: 0, unpackedSize: 8 },
				],
			},
		],
		[
			"a frame with an unknown codec",
			{
				files: { "blocks/x.bin": { sha256: "a".repeat(64), size: 4 } },
				recordFrames: [
					{ codec: "gzip", file: "blocks/x.bin", length: 2, offset: 0, unpackedSize: 2 },
				],
			},
		],
		[
			"an invalid source name",
			{ sources: [{ name: "notes.txt", sha256: "a".repeat(64), size: 1 }] },
		],
		[
			"a negative source size",
			{ sources: [{ name: "a.mdx", sha256: "a".repeat(64), size: -1 }] },
		],
		["an unknown script file", { script: "other.js" }],
		["an unknown stylesheet file", { stylesheet: "other.css" }],
		["an unknown remote resource kind", { remoteResourceKind: "evil" }],
	])("classifies %s as corrupt", (_label, overrides) => {
		expect(manifestError(manifestBytes(overrides))).toMatchObject({ code: "corrupt" });
	});
});
