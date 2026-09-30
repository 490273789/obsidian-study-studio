import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";
import { isRecord } from "../../../core/shared/isRecord";
import {
	type CompiledDictionarySettings,
	type DictionarySettings,
	type DictionarySourceConfiguration,
	type DictionarySourceKind,
	type DictionarySourceSettings,
	type LocalDictionaryFileSettings,
	type LocalDictionarySettings,
	type PersistedYoudaoDictionarySettings,
	type PortableDictionarySettings,
} from "./types";

export const DICTIONARY_QUERY_MAX_LENGTH = 128;
export const DICTIONARY_HISTORY_LIMIT = 50;
export const DEFAULT_DICTIONARY_FAVORITE_PATH = "word.md";
export const DEFAULT_YOUDAO_DICTIONARIES = ["ec", "ce"] as const;

export function normalizeDictionaryQuery(value: unknown): string {
	return typeof value === "string"
		? value.trim().replace(/\s+/g, " ").slice(0, DICTIONARY_QUERY_MAX_LENGTH)
		: "";
}

function normalizeDictionaryWords(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const words: string[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		const word = normalizeDictionaryQuery(candidate);
		const key = word.toLocaleLowerCase();
		if (!word || seen.has(key)) continue;
		words.push(word);
		seen.add(key);
		if (words.length === limit) break;
	}
	return words;
}

function normalizeMarkdownPath(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const normalized = value
		.trim()
		.replaceAll("\\", "/")
		.split("/")
		.filter((part) => part && part !== "." && part !== "..")
		.join("/");
	if (!normalized) return fallback;
	return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

export function normalizeDictionaryFavoritePath(
	value: unknown,
	fallback = DEFAULT_DICTIONARY_FAVORITE_PATH,
): string {
	return normalizeMarkdownPath(value, fallback);
}

function normalizeLocalDictionaryFiles(value: unknown): LocalDictionaryFileSettings[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((candidate): LocalDictionaryFileSettings[] => {
		if (!isRecord(candidate) || typeof candidate.name !== "string") return [];
		const name = candidate.name.trim();
		if (!/^[^/\\]+\.(?:eudic|mdx|(?:\d+\.)?mdd|css|js)$/i.test(name)) return [];
		return [
			{
				name,
				size:
					typeof candidate.size === "number" && Number.isSafeInteger(candidate.size)
						? Math.max(0, candidate.size)
						: 0,
			},
		];
	});
}

function normalizeCompiledDictionarySettings(
	value: unknown,
): CompiledDictionarySettings | undefined {
	if (!isRecord(value)) return undefined;
	if (
		value.formatVersion !== 2 ||
		value.manifestPath !== "compiled-v2/manifest.json" ||
		typeof value.engineVersion !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(value.engineVersion) ||
		typeof value.manifestSha256 !== "string" ||
		!/^[a-f\d]{64}$/.test(value.manifestSha256) ||
		typeof value.sourceFingerprint !== "string" ||
		!/^[a-f\d]{64}$/.test(value.sourceFingerprint) ||
		!Number.isSafeInteger(value.entryCount) ||
		Number(value.entryCount) < 0 ||
		!Number.isSafeInteger(value.totalBytes) ||
		Number(value.totalBytes) <= 0 ||
		!Number.isSafeInteger(value.fileCount) ||
		Number(value.fileCount) <= 0
	) {
		return undefined;
	}
	return {
		engineVersion: value.engineVersion,
		entryCount: Number(value.entryCount),
		fileCount: Number(value.fileCount),
		formatVersion: 2,
		manifestPath: "compiled-v2/manifest.json",
		manifestSha256: value.manifestSha256,
		sourceFingerprint: value.sourceFingerprint,
		totalBytes: Number(value.totalBytes),
	};
}

function normalizePortableDictionarySettings(
	value: unknown,
): PortableDictionarySettings | undefined {
	if (!isRecord(value)) return undefined;
	if (
		value.formatVersion !== 1 ||
		value.manifestPath !== "portable-v1/manifest.json" ||
		typeof value.manifestSha256 !== "string" ||
		!/^[a-f\d]{64}$/.test(value.manifestSha256) ||
		typeof value.sourceFingerprint !== "string" ||
		!/^[a-f\d]{64}$/.test(value.sourceFingerprint) ||
		!Number.isSafeInteger(value.totalBytes) ||
		Number(value.totalBytes) <= 0 ||
		!Number.isSafeInteger(value.fileCount) ||
		Number(value.fileCount) <= 0
	) {
		return undefined;
	}
	return {
		fileCount: Number(value.fileCount),
		formatVersion: 1,
		manifestPath: "portable-v1/manifest.json",
		manifestSha256: value.manifestSha256,
		sourceFingerprint: value.sourceFingerprint,
		totalBytes: Number(value.totalBytes),
	};
}

function normalizeLocalDictionaries(value: unknown): LocalDictionarySettings[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	return value.flatMap((candidate): LocalDictionarySettings[] => {
		if (!isRecord(candidate)) return [];
		const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
		const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
		if (!/^[a-z\d][a-z\d-]{2,80}$/i.test(id) || ids.has(id) || !name) return [];
		const files = normalizeLocalDictionaryFiles(candidate.files);
		if (!files.some((file) => /\.(?:eudic|mdx)$/i.test(file.name))) return [];
		ids.add(id);
		const compiled = normalizeCompiledDictionarySettings(candidate.compiled);
		const portable = normalizePortableDictionarySettings(candidate.portable);
		const normalized: LocalDictionarySettings = {
			directory: id,
			files,
			id,
			name: name.slice(0, 120),
		};
		if (compiled) normalized.compiled = compiled;
		if (portable) normalized.portable = portable;
		return [normalized];
	});
}

const ONLINE_SOURCE_DEFAULTS = [
	{ enabled: true, id: "youdao", kind: "youdao", label: "有道词典" },
	{ enabled: true, id: "cambridge", kind: "cambridge", label: "剑桥词典" },
	{ enabled: true, id: "hujiang", kind: "hujiang", label: "沪江小D" },
] as const satisfies readonly DictionarySourceSettings[];

function normalizeDictionarySources(
	value: unknown,
	localDictionaries: readonly LocalDictionarySettings[],
): DictionarySourceSettings[] {
	const onlineKinds = new Map<string, DictionarySourceKind>(
		ONLINE_SOURCE_DEFAULTS.map((source) => [source.id, source.kind] as const),
	);
	const localIds = new Set(localDictionaries.map((dictionary) => dictionary.id));
	const ids = new Set<string>();
	const sources = Array.isArray(value)
		? value.flatMap((candidate): DictionarySourceSettings[] => {
				if (!isRecord(candidate)) return [];
				const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
				const kind = candidate.kind;
				if (
					!id ||
					ids.has(id) ||
					(kind !== "youdao" &&
						kind !== "cambridge" &&
						kind !== "hujiang" &&
						kind !== "ai" &&
						kind !== "local") ||
					(kind === "local" && !localIds.has(id))
				) {
					return [];
				}
				if (
					(kind === "ai" && id !== "ai") ||
					(kind !== "ai" && kind !== "local" && onlineKinds.get(id) !== kind)
				) {
					return [];
				}
				ids.add(id);
				const fallbackLabel =
					ONLINE_SOURCE_DEFAULTS.find((source) => source.id === id)?.label ??
					(kind === "ai"
						? "AI 词典"
						: (localDictionaries.find((dictionary) => dictionary.id === id)?.name ??
							id));
				return [
					{
						enabled:
							typeof candidate.enabled === "boolean"
								? candidate.enabled
								: kind !== "ai",
						id,
						kind,
						label:
							typeof candidate.label === "string" && candidate.label.trim()
								? candidate.label.trim().slice(0, 120)
								: fallbackLabel,
					},
				];
			})
		: [];
	const missingOnline = ONLINE_SOURCE_DEFAULTS.filter((source) => !ids.has(source.id));
	if (missingOnline.length > 0) {
		const youdaoIndex = sources.findIndex((source) => source.id === "youdao");
		const inserted = missingOnline.map((source) => ({ ...source }));
		if (youdaoIndex >= 0) sources.splice(youdaoIndex + 1, 0, ...inserted);
		else sources.unshift(...inserted);
		for (const source of missingOnline) ids.add(source.id);
	}
	for (const dictionary of localDictionaries) {
		if (!ids.has(dictionary.id)) {
			sources.push({
				enabled: true,
				id: dictionary.id,
				kind: "local",
				label: dictionary.name,
			});
		}
	}
	if (!ids.has("ai")) {
		sources.push({ enabled: false, id: "ai", kind: "ai", label: "AI 词典" });
	}
	return sources;
}

/**
 * Applies a persisted source order/toggle list to the authoritative source
 * catalog without letting the settings surface invent or drop sources.
 */
export function applyDictionarySourceConfiguration(
	current: readonly DictionarySourceSettings[],
	value: unknown,
): DictionarySourceSettings[] {
	const available = new Map(current.map((source) => [source.id, source]));
	const configured = new Set<string>();
	const ordered = Array.isArray(value)
		? value.flatMap((candidate): DictionarySourceSettings[] => {
				if (!isRecord(candidate) || typeof candidate.id !== "string") return [];
				const source = available.get(candidate.id);
				if (!source || configured.has(source.id)) return [];
				configured.add(source.id);
				return [
					{
						...source,
						enabled:
							typeof candidate.enabled === "boolean"
								? candidate.enabled
								: source.enabled,
					},
				];
			})
		: [];
	return [...ordered, ...current.filter((source) => !configured.has(source.id))];
}

function normalizeYoudao(value: unknown): PersistedYoudaoDictionarySettings {
	const youdao = isRecord(value) ? value : {};
	const dictionaries = Array.isArray(youdao.dictionaries)
		? [
				...new Set(
					youdao.dictionaries.filter(
						(item): item is string =>
							typeof item === "string" && /^[a-z\d_-]{1,30}$/i.test(item),
					),
				),
			].slice(0, 20)
		: [];
	return {
		accessMode: youdao.accessMode === "free" ? "free" : "official",
		appKeySecretId:
			typeof youdao.appKeySecretId === "string"
				? youdao.appKeySecretId.trim().slice(0, 200)
				: "",
		appSecretSecretId:
			typeof youdao.appSecretSecretId === "string"
				? youdao.appSecretSecretId.trim().slice(0, 200)
				: "",
		dictionaries: dictionaries.length > 0 ? dictionaries : [...DEFAULT_YOUDAO_DICTIONARIES],
	};
}

export const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
	ai: { configId: null },
	enabled: false,
	favoritePath: DEFAULT_DICTIONARY_FAVORITE_PATH,
	favoriteAiConfigId: null,
	history: [],
	localDictionaries: [],
	sources: [
		{ enabled: true, id: "youdao", kind: "youdao", label: "有道词典" },
		{ enabled: true, id: "cambridge", kind: "cambridge", label: "剑桥词典" },
		{ enabled: true, id: "hujiang", kind: "hujiang", label: "沪江小D" },
		{ enabled: false, id: "ai", kind: "ai", label: "AI 词典" },
	],
	youdao: {
		accessMode: "official",
		appKeySecretId: "",
		appSecretSecretId: "",
		dictionaries: [...DEFAULT_YOUDAO_DICTIONARIES],
	},
};

export function cloneDictionarySettings(settings: DictionarySettings): DictionarySettings {
	return structuredClone(settings);
}

/**
 * Validates and fills a persisted dictionary settings slice. Unknown or invalid
 * catalog entries are dropped rather than silently repaired, matching the
 * catalog-authority invariant.
 */
export function normalizeDictionarySettings(value: unknown): DictionarySettings {
	const candidate = isRecord(value) ? value : {};
	const ai = isRecord(candidate.ai) ? candidate.ai : {};
	const localDictionaries = normalizeLocalDictionaries(candidate.localDictionaries);
	return {
		ai: {
			configId:
				typeof ai.configId === "string" && ai.configId.trim()
					? ai.configId.trim().slice(0, 200)
					: null,
		},
		favoriteAiConfigId:
			typeof candidate.favoriteAiConfigId === "string" && candidate.favoriteAiConfigId.trim()
				? candidate.favoriteAiConfigId.trim().slice(0, 200)
				: null,
		enabled: candidate.enabled === true,
		favoritePath: normalizeDictionaryFavoritePath(
			candidate.favoritePath,
			DEFAULT_DICTIONARY_FAVORITE_PATH,
		),
		history: normalizeDictionaryWords(candidate.history, DICTIONARY_HISTORY_LIMIT),
		localDictionaries,
		sources: normalizeDictionarySources(candidate.sources, localDictionaries),
		youdao: normalizeYoudao(candidate.youdao),
	};
}

export function toSourceConfigurations(
	sources: readonly DictionarySourceSettings[],
): DictionarySourceConfiguration[] {
	return sources.map((source) => ({ enabled: source.enabled, id: source.id }));
}

/**
 * The 词典 feature's own settings slice. Its clone is a structural deep copy
 * because the slice holds the local dictionary catalog, which normalization
 * would rewrite rather than copy.
 */
export const dictionarySettingsSlice: SettingsSlice<{ dictionary: DictionarySettings }> = {
	id: "dictionary",
	keys: ["dictionary"],

	defaults: () => ({ dictionary: structuredClone(DEFAULT_DICTIONARY_SETTINGS) }),

	normalize: (raw) => ({
		dictionary: normalizeDictionarySettings(settingsRecord(raw).dictionary),
	}),

	clone: (document) => ({ dictionary: structuredClone(document.dictionary) }),
};
