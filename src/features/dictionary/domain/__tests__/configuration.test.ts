import { describe, expect, it } from "vitest";
import {
	applyDictionarySourceConfiguration,
	DEFAULT_DICTIONARY_FAVORITE_PATH,
	DEFAULT_DICTIONARY_SETTINGS,
	DEFAULT_YOUDAO_DICTIONARIES,
	DICTIONARY_HISTORY_LIMIT,
	DICTIONARY_QUERY_MAX_LENGTH,
	normalizeDictionaryFavoritePath,
	normalizeDictionaryQuery,
	normalizeDictionarySettings,
} from "../configuration";
import type { DictionarySourceSettings } from "../types";

const VALID_COMPILED = {
	engineVersion: "2.0.6",
	entryCount: 10,
	fileCount: 2,
	formatVersion: 2,
	manifestPath: "compiled-v2/manifest.json",
	manifestSha256: "a".repeat(64),
	sourceFingerprint: "b".repeat(64),
	totalBytes: 1_024,
};

function localDictionary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		files: [{ name: "sample.mdx", size: 128 }],
		id: "sample-dict",
		name: "Sample Dictionary",
		...overrides,
	};
}

function sourcesFor(
	value: unknown,
	localDictionaries: readonly unknown[] = [],
): DictionarySourceSettings[] {
	return normalizeDictionarySettings({ localDictionaries, sources: value }).sources;
}

describe("normalizeDictionaryQuery", () => {
	it.each([[null], [undefined], [42], [true], [{}], [[]], [Symbol("q")]])(
		"returns an empty string for the non-string value %p",
		(value) => {
			expect(normalizeDictionaryQuery(value)).toBe("");
		},
	);

	it("trims the query and collapses inner whitespace", () => {
		expect(normalizeDictionaryQuery("  hello   world\t\n foo  ")).toBe("hello world foo");
		expect(normalizeDictionaryQuery("\u3000padded\u3000")).toBe("padded");
		expect(normalizeDictionaryQuery("   ")).toBe("");
	});

	it("truncates to the documented maximum length", () => {
		expect(DICTIONARY_QUERY_MAX_LENGTH).toBe(128);
		const result = normalizeDictionaryQuery("a".repeat(DICTIONARY_QUERY_MAX_LENGTH + 40));
		expect(result).toBe("a".repeat(DICTIONARY_QUERY_MAX_LENGTH));
	});

	it("truncates after collapsing whitespace", () => {
		const result = normalizeDictionaryQuery("ab ".repeat(100));
		expect(result.length).toBe(DICTIONARY_QUERY_MAX_LENGTH);
		expect(result).not.toContain("  ");
	});
});

describe("normalizeDictionaryFavoritePath", () => {
	it("defaults to word.md", () => {
		expect(DEFAULT_DICTIONARY_FAVORITE_PATH).toBe("word.md");
	});

	it.each([
		["notes/word", "notes/word.md"],
		["notes\\word.md", "notes/word.md"],
		["a/../b/./c", "a/b/c.md"],
		["notes//word/", "notes/word.md"],
		["Word.MD", "Word.MD"],
		["  spaced/name  ", "spaced/name.md"],
	])("normalizes %j to %j", (value, expected) => {
		expect(normalizeDictionaryFavoritePath(value)).toBe(expected);
	});

	it("falls back when nothing usable remains", () => {
		expect(normalizeDictionaryFavoritePath("")).toBe(DEFAULT_DICTIONARY_FAVORITE_PATH);
		expect(normalizeDictionaryFavoritePath("..")).toBe(DEFAULT_DICTIONARY_FAVORITE_PATH);
		expect(normalizeDictionaryFavoritePath("../../")).toBe(DEFAULT_DICTIONARY_FAVORITE_PATH);
		expect(normalizeDictionaryFavoritePath(null)).toBe(DEFAULT_DICTIONARY_FAVORITE_PATH);
		expect(normalizeDictionaryFavoritePath(7)).toBe(DEFAULT_DICTIONARY_FAVORITE_PATH);
	});

	it("uses a supplied fallback verbatim", () => {
		expect(normalizeDictionaryFavoritePath("", "custom/fallback.md")).toBe(
			"custom/fallback.md",
		);
		expect(normalizeDictionaryFavoritePath("../..", "custom/fallback.md")).toBe(
			"custom/fallback.md",
		);
	});
});

describe("normalizeDictionarySettings enabled flag", () => {
	it("is only true for the boolean true", () => {
		expect(normalizeDictionarySettings({ enabled: true }).enabled).toBe(true);
		for (const value of ["true", 1, {}, [], "yes", null, undefined]) {
			expect(normalizeDictionarySettings({ enabled: value }).enabled).toBe(false);
		}
	});
});

describe("normalizeDictionarySettings history", () => {
	it("caps history at the documented limit", () => {
		expect(DICTIONARY_HISTORY_LIMIT).toBe(50);
		const history = Array.from({ length: 60 }, (_value, index) => `word-${index}`);
		const normalized = normalizeDictionarySettings({ history }).history;
		expect(normalized).toHaveLength(50);
		expect(normalized[0]).toBe("word-0");
		expect(normalized[normalized.length - 1]).toBe("word-49");
	});

	it("de-duplicates case-insensitively while keeping the first spelling", () => {
		expect(
			normalizeDictionarySettings({ history: ["Word", "word", "WORD", "Other", "other"] })
				.history,
		).toEqual(["Word", "Other"]);
	});

	it("drops blank and non-string entries and collapses whitespace", () => {
		expect(
			normalizeDictionarySettings({ history: [null, "  ", "hello  world", 7, "hello world"] })
				.history,
		).toEqual(["hello world"]);
	});

	it("treats a missing or non-array history as empty", () => {
		expect(normalizeDictionarySettings({}).history).toEqual([]);
		expect(normalizeDictionarySettings({ history: "word" }).history).toEqual([]);
	});
});

describe("normalizeDictionarySettings ai configId", () => {
	it("normalizes absent or blank config ids to null", () => {
		expect(normalizeDictionarySettings({}).ai).toEqual({ configId: null });
		expect(normalizeDictionarySettings({ ai: {} }).ai).toEqual({ configId: null });
		expect(normalizeDictionarySettings({ ai: { configId: "   " } }).ai).toEqual({
			configId: null,
		});
		expect(normalizeDictionarySettings({ ai: { configId: 42 } }).ai).toEqual({
			configId: null,
		});
	});

	it("trims and caps a supplied config id", () => {
		expect(normalizeDictionarySettings({ ai: { configId: "  cfg-1  " } }).ai.configId).toBe(
			"cfg-1",
		);
		expect(
			normalizeDictionarySettings({ ai: { configId: "c".repeat(300) } }).ai.configId,
		).toHaveLength(200);
	});
});

describe("normalizeDictionarySettings youdao", () => {
	it("defaults to the official access mode and only honours free", () => {
		expect(normalizeDictionarySettings({}).youdao.accessMode).toBe("official");
		expect(normalizeDictionarySettings({ youdao: {} }).youdao.accessMode).toBe("official");
		expect(
			normalizeDictionarySettings({ youdao: { accessMode: "official" } }).youdao.accessMode,
		).toBe("official");
		expect(
			normalizeDictionarySettings({ youdao: { accessMode: "free" } }).youdao.accessMode,
		).toBe("free");
		expect(
			normalizeDictionarySettings({ youdao: { accessMode: "Free" } }).youdao.accessMode,
		).toBe("official");
	});

	it("filters dictionary ids and falls back to the ec/ce default", () => {
		expect(DEFAULT_YOUDAO_DICTIONARIES).toEqual(["ec", "ce"]);
		expect(normalizeDictionarySettings({}).youdao.dictionaries).toEqual(["ec", "ce"]);
		expect(
			normalizeDictionarySettings({ youdao: { dictionaries: ["ec", "bad id!", "ce"] } })
				.youdao.dictionaries,
		).toEqual(["ec", "ce"]);
		expect(
			normalizeDictionarySettings({ youdao: { dictionaries: ["no spaces", "a/b"] } }).youdao
				.dictionaries,
		).toEqual(["ec", "ce"]);
		expect(
			normalizeDictionarySettings({ youdao: { dictionaries: [42, null, "ec"] } }).youdao
				.dictionaries,
		).toEqual(["ec"]);
	});

	it("de-duplicates the dictionary list and caps it at 20", () => {
		expect(
			normalizeDictionarySettings({ youdao: { dictionaries: ["ec", "ec", "ce"] } }).youdao
				.dictionaries,
		).toEqual(["ec", "ce"]);
		const many = Array.from({ length: 25 }, (_value, index) => `dict-${index}`);
		expect(
			normalizeDictionarySettings({ youdao: { dictionaries: many } }).youdao.dictionaries,
		).toHaveLength(20);
	});

	it("trims and caps the secret identifiers", () => {
		const youdao = normalizeDictionarySettings({
			youdao: { appKeySecretId: `  key-1  `, appSecretSecretId: "s".repeat(300) },
		}).youdao;
		expect(youdao.appKeySecretId).toBe("key-1");
		expect(youdao.appSecretSecretId).toHaveLength(200);
	});
});

describe("normalizeDictionarySettings localDictionaries", () => {
	it("normalizes a valid catalog entry", () => {
		const normalized = normalizeDictionarySettings({
			localDictionaries: [
				localDictionary({
					directory: "somewhere-else",
					files: [
						{ name: " sample.mdx ", size: 10 },
						{ name: "cover.css", size: -5 },
						{ name: "dict.1.mdd", size: 1.5 },
					],
				}),
			],
		}).localDictionaries;
		expect(normalized).toEqual([
			{
				directory: "sample-dict",
				files: [
					{ name: "sample.mdx", size: 10 },
					{ name: "cover.css", size: 0 },
					{ name: "dict.1.mdd", size: 0 },
				],
				id: "sample-dict",
				name: "Sample Dictionary",
			},
		]);
	});

	it.each(["ab", "-sample", "sample_dict", "sample dict", "", "a!", "a/b"])(
		"drops the invalid id %j",
		(id) => {
			expect(
				normalizeDictionarySettings({ localDictionaries: [localDictionary({ id })] })
					.localDictionaries,
			).toEqual([]);
		},
	);

	it("drops entries with a blank name", () => {
		expect(
			normalizeDictionarySettings({ localDictionaries: [localDictionary({ name: "  " })] })
				.localDictionaries,
		).toEqual([]);
	});

	it("drops duplicate ids, keeping the first entry", () => {
		const normalized = normalizeDictionarySettings({
			localDictionaries: [
				localDictionary({ name: "First" }),
				localDictionary({ name: "Second" }),
			],
		}).localDictionaries;
		expect(normalized).toHaveLength(1);
		expect(normalized[0]?.name).toBe("First");
	});

	it("requires at least one eudic or mdx file", () => {
		expect(
			normalizeDictionarySettings({
				localDictionaries: [
					localDictionary({ files: [{ name: "cover.css" }, { name: "dict.mdd" }] }),
				],
			}).localDictionaries,
		).toEqual([]);
		expect(
			normalizeDictionarySettings({
				localDictionaries: [localDictionary({ files: [{ name: "sample.eudic" }] })],
			}).localDictionaries,
		).toHaveLength(1);
	});

	it("drops unknown file names while keeping the recognized ones", () => {
		const normalized = normalizeDictionarySettings({
			localDictionaries: [
				localDictionary({
					files: [
						{ name: "sample.mdx", size: 1 },
						{ name: "notes.txt", size: 2 },
						{ name: "sub/sample.mdx", size: 3 },
						{ name: "evil\\x.mdx", size: 4 },
						{ name: "cover.css", size: 5 },
						{ name: "dict.1.mdd", size: 6 },
						{ name: "reader.js", size: 7 },
					],
				}),
			],
		}).localDictionaries;
		expect(normalized[0]?.files.map((file) => file.name)).toEqual([
			"sample.mdx",
			"cover.css",
			"dict.1.mdd",
			"reader.js",
		]);
	});

	it("caps the display name at 120 characters", () => {
		const normalized = normalizeDictionarySettings({
			localDictionaries: [localDictionary({ name: "n".repeat(200) })],
		}).localDictionaries;
		expect(normalized[0]?.name).toHaveLength(120);
	});

	it("treats a missing or non-array catalog as empty", () => {
		expect(normalizeDictionarySettings({}).localDictionaries).toEqual([]);
		expect(normalizeDictionarySettings({ localDictionaries: {} }).localDictionaries).toEqual(
			[],
		);
		expect(
			normalizeDictionarySettings({ localDictionaries: [null, 7] }).localDictionaries,
		).toEqual([]);
	});
});

describe("normalizeDictionarySettings compiled metadata", () => {
	it("accepts exactly the compiled-v2 metadata shape", () => {
		const normalized = normalizeDictionarySettings({
			localDictionaries: [localDictionary({ compiled: VALID_COMPILED })],
		}).localDictionaries;
		expect(normalized[0]?.compiled).toEqual(VALID_COMPILED);
	});

	it("accepts a zero entry count but rejects a zero file count or byte count", () => {
		const compiledFor = (overrides: Record<string, unknown>) =>
			normalizeDictionarySettings({
				localDictionaries: [
					localDictionary({ compiled: { ...VALID_COMPILED, ...overrides } }),
				],
			}).localDictionaries[0]?.compiled;

		expect(compiledFor({ entryCount: 0 })).toMatchObject({ entryCount: 0 });
		expect(compiledFor({ fileCount: 0 })).toBeUndefined();
		expect(compiledFor({ totalBytes: 0 })).toBeUndefined();
	});

	it.each([
		["a different format version", { formatVersion: 1 }],
		["a different manifest path", { manifestPath: "compiled-v2/other.json" }],
		["a non-semver engine version", { engineVersion: "2.0" }],
		["an uppercase manifest digest", { manifestSha256: "A".repeat(64) }],
		["a short manifest digest", { manifestSha256: "a".repeat(63) }],
		["a non-hex source fingerprint", { sourceFingerprint: "z".repeat(64) }],
		["a fractional entry count", { entryCount: 1.5 }],
		["a negative entry count", { entryCount: -1 }],
		["a negative file count", { fileCount: -1 }],
		["a fractional total byte count", { totalBytes: 1.5 }],
		["a negative total byte count", { totalBytes: -1 }],
	])("drops metadata with %s instead of repairing it", (_label, overrides) => {
		const entry = normalizeDictionarySettings({
			localDictionaries: [localDictionary({ compiled: { ...VALID_COMPILED, ...overrides } })],
		}).localDictionaries[0];
		expect(entry).toBeDefined();
		expect(entry).not.toHaveProperty("compiled");
	});

	it("drops non-object metadata", () => {
		for (const compiled of [null, "compiled", 42, []]) {
			expect(
				normalizeDictionarySettings({ localDictionaries: [localDictionary({ compiled })] })
					.localDictionaries[0],
			).not.toHaveProperty("compiled");
		}
	});
});

describe("normalizeDictionarySettings source synthesis", () => {
	it("synthesizes the three online defaults and a disabled ai source", () => {
		expect(sourcesFor(undefined)).toEqual([
			{ enabled: true, id: "youdao", kind: "youdao", label: "有道词典" },
			{ enabled: true, id: "cambridge", kind: "cambridge", label: "剑桥词典" },
			{ enabled: true, id: "hujiang", kind: "hujiang", label: "沪江小D" },
			{ enabled: false, id: "ai", kind: "ai", label: "AI 词典" },
		]);
		expect(sourcesFor({})).toEqual(sourcesFor("not-an-array"));
	});

	it("inserts missing online defaults directly after youdao", () => {
		const sources = sourcesFor([{ enabled: true, id: "youdao", kind: "youdao" }]);
		expect(sources.map((source) => source.id)).toEqual([
			"youdao",
			"cambridge",
			"hujiang",
			"ai",
		]);
	});

	it("keeps a persisted online order and repairs only the missing defaults", () => {
		const sources = sourcesFor([
			{ enabled: false, id: "hujiang", kind: "hujiang" },
			{ enabled: true, id: "youdao", kind: "youdao" },
		]);
		expect(sources.map((source) => source.id)).toEqual([
			"hujiang",
			"youdao",
			"cambridge",
			"ai",
		]);
		expect(sources[0]?.enabled).toBe(false);
	});

	it("appends a local source for every catalog entry before ai", () => {
		const sources = normalizeDictionarySettings({
			localDictionaries: [localDictionary({ name: "我的词典" })],
		}).sources;
		expect(sources.map((source) => source.id)).toEqual([
			"youdao",
			"cambridge",
			"hujiang",
			"sample-dict",
			"ai",
		]);
		expect(sources.find((source) => source.id === "sample-dict")).toEqual({
			enabled: true,
			id: "sample-dict",
			kind: "local",
			label: "我的词典",
		});
	});

	it("keeps a persisted ai source without duplicating it", () => {
		const sources = sourcesFor([{ enabled: true, id: "ai", kind: "ai" }]);
		expect(sources.map((source) => source.id)).toEqual([
			"youdao",
			"cambridge",
			"hujiang",
			"ai",
		]);
		expect(sources[3]?.enabled).toBe(true);
	});

	it.each([
		["an unknown kind", [{ id: "youdao", kind: "bing" }]],
		["an unknown online id", [{ id: "bing", kind: "youdao" }]],
		["a tampered online kind", [{ id: "cambridge", kind: "hujiang" }]],
		["an ai source with another id", [{ id: "other", kind: "ai" }]],
		["a local source without a catalog entry", [{ id: "ghost", kind: "local" }]],
		["a non-record entry", [null, 7, "youdao"]],
		["a missing id", [{ kind: "youdao" }]],
	])("drops %s and restores the authoritative defaults", (_label, value) => {
		expect(sourcesFor(value).map((source) => source.id)).toEqual([
			"youdao",
			"cambridge",
			"hujiang",
			"ai",
		]);
	});

	it("de-duplicates by id, keeping the first entry", () => {
		const sources = sourcesFor([
			{ enabled: false, id: "youdao", kind: "youdao", label: "first" },
			{ enabled: true, id: "youdao", kind: "youdao", label: "second" },
		]);
		expect(sources[0]).toMatchObject({ enabled: false, label: "first" });
		expect(sources.filter((source) => source.id === "youdao")).toHaveLength(1);
	});

	it("falls back to the catalog label and caps a persisted label", () => {
		const sources = sourcesFor([
			{ id: "cambridge", kind: "cambridge" },
			{ id: "ai", kind: "ai", label: "  " },
			{ id: "youdao", kind: "youdao", label: "y".repeat(200) },
		]);
		expect(sources.find((source) => source.id === "cambridge")?.label).toBe("剑桥词典");
		expect(sources.find((source) => source.id === "ai")?.label).toBe("AI 词典");
		expect(sources.find((source) => source.id === "youdao")?.label).toHaveLength(120);
	});

	it("defaults an unspecified online source to enabled and ai to disabled", () => {
		const sources = sourcesFor([
			{ id: "youdao", kind: "youdao" },
			{ id: "ai", kind: "ai" },
		]);
		expect(sources.find((source) => source.id === "youdao")?.enabled).toBe(true);
		expect(sources.find((source) => source.id === "ai")?.enabled).toBe(false);
	});
});

describe("applyDictionarySourceConfiguration", () => {
	const current = DEFAULT_DICTIONARY_SETTINGS.sources;

	it("appends every catalog source when nothing was persisted", () => {
		expect(applyDictionarySourceConfiguration(current, undefined)).toEqual([...current]);
		expect(applyDictionarySourceConfiguration(current, "nope")).toEqual([...current]);
	});

	it("drops unknown ids and de-duplicates", () => {
		expect(
			applyDictionarySourceConfiguration(current, [
				{ enabled: true, id: "ghost" },
				{ enabled: true, id: "ai" },
				{ enabled: false, id: "ai" },
			]).map((source) => source.id),
		).toEqual(["ai", "youdao", "cambridge", "hujiang"]);
	});

	it("applies enabled overrides and keeps the catalog label/kind", () => {
		const [first] = applyDictionarySourceConfiguration(current, [
			{ enabled: false, id: "youdao" },
		]);
		expect(first).toEqual({ enabled: false, id: "youdao", kind: "youdao", label: "有道词典" });
	});

	it("keeps the catalog default when enabled is not a boolean", () => {
		const [first] = applyDictionarySourceConfiguration(current, [{ enabled: "yes", id: "ai" }]);
		expect(first?.enabled).toBe(false);
	});

	it("appends sources missing from the persisted order", () => {
		expect(
			applyDictionarySourceConfiguration(current, [{ enabled: true, id: "hujiang" }]).map(
				(source) => source.id,
			),
		).toEqual(["hujiang", "youdao", "cambridge", "ai"]);
	});
});

describe("DEFAULT_DICTIONARY_SETTINGS", () => {
	it("carries the documented defaults", () => {
		expect(DEFAULT_DICTIONARY_SETTINGS).toMatchObject({
			ai: { configId: null },
			enabled: false,
			favoritePath: "word.md",
			history: [],
			localDictionaries: [],
		});
		expect(DEFAULT_DICTIONARY_SETTINGS.youdao).toEqual({
			accessMode: "official",
			appKeySecretId: "",
			appSecretSecretId: "",
			dictionaries: ["ec", "ce"],
		});
		expect(DEFAULT_DICTIONARY_SETTINGS.sources).toEqual([
			{ enabled: true, id: "youdao", kind: "youdao", label: "有道词典" },
			{ enabled: true, id: "cambridge", kind: "cambridge", label: "剑桥词典" },
			{ enabled: true, id: "hujiang", kind: "hujiang", label: "沪江小D" },
			{ enabled: false, id: "ai", kind: "ai", label: "AI 词典" },
		]);
	});

	it("round-trips through the normalizer unchanged", () => {
		expect(normalizeDictionarySettings(DEFAULT_DICTIONARY_SETTINGS)).toEqual(
			DEFAULT_DICTIONARY_SETTINGS,
		);
		expect(normalizeDictionarySettings(null)).toEqual(DEFAULT_DICTIONARY_SETTINGS);
	});
});

describe("favorite AI engine selection", () => {
	it("defaults legacy data to no selection without copying the dictionary engine", () => {
		expect(
			normalizeDictionarySettings({ ai: { configId: "dictionary-engine" } })
				.favoriteAiConfigId,
		).toBeNull();
	});
	it("normalizes an independent id and retains missing ids for explicit re-selection", () => {
		expect(
			normalizeDictionarySettings({ favoriteAiConfigId: "  missing  " }).favoriteAiConfigId,
		).toBe("missing");
		expect(
			normalizeDictionarySettings({ favoriteAiConfigId: 42 }).favoriteAiConfigId,
		).toBeNull();
	});
});
