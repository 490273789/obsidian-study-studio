import { dictionaryText } from "./messages";
import {
	requestYoudaoJson,
	resolveYoudaoConnection,
	YoudaoTransportError,
} from "../../../core/net/youdaoTransport";
import { TransportError } from "../../../core/net/types";
import type { YoudaoDictionarySettings } from "./types";
import {
	DictionaryError,
	dictionaryErrorCodeMessage,
	type DictionaryErrorCode,
	type DictionaryQuery,
	type DictionaryResult,
	type DictionarySection,
	type DictionarySource,
	type Pronunciation,
} from "./types";
import {
	dictionaryErrorCodeForTransport,
	MAX_ONLINE_DICTIONARY_RESPONSE_BYTES,
	ONLINE_DICTIONARY_TIMEOUT_MS,
	requestOnlineResponse,
	type DictionaryOutboundPort,
} from "./online";
import { isRecord } from "../../../core/shared/isRecord";

export const YOUDAO_FREE_ENDPOINT = "https://dict.youdao.com/jsonapi";
export const YOUDAO_OFFICIAL_ENDPOINT = "https://openapi.youdao.com/v2/dict";

const MAX_ITEMS_PER_SECTION = 20;
const MAX_TEXT_LENGTH = 500;

function cleanText(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_TEXT_LENGTH);
}

function collectStrings(value: unknown, limit = MAX_ITEMS_PER_SECTION): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const visit = (candidate: unknown, depth: number): void => {
		if (result.length >= limit || depth > 8) return;
		if (typeof candidate === "string") {
			const text = cleanText(candidate);
			if (text && !seen.has(text)) {
				seen.add(text);
				result.push(text);
			}
			return;
		}
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item, depth + 1);
			return;
		}
		if (!isRecord(candidate)) return;
		for (const [key, item] of Object.entries(candidate)) {
			if (
				key.startsWith("@") ||
				/speech|audio|url|image|video|music|encrypted|cipher/i.test(key)
			)
				continue;
			visit(item, depth + 1);
		}
	};
	visit(value, 0);
	return result;
}

interface TextPair {
	primary: string[];
	secondary: string[];
}

const DETAIL_TEXT_PAIRS: TextPair[] = [
	{ primary: ["word"], secondary: ["definition", "explain", "meaning", "tran", "translation"] },
	{ primary: ["name"], secondary: ["value"] },
	{ primary: ["headword"], secondary: ["usage", "trs"] },
	{ primary: ["eng_sent"], secondary: ["chn_sent"] },
	{ primary: ["pos"], secondary: ["pos_tips"] },
	{ primary: ["headwords"], secondary: ["tran", "translation"] },
	{ primary: ["ws"], secondary: ["tran", "translation"] },
	{ primary: ["key"], secondary: ["value"] },
];

function collectDetailStrings(value: unknown): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const add = (valueToAdd: string): void => {
		const text = cleanText(valueToAdd);
		if (!text || seen.has(text) || result.length >= MAX_ITEMS_PER_SECTION) return;
		seen.add(text);
		result.push(text);
	};
	const visit = (candidate: unknown, depth: number): void => {
		if (result.length >= MAX_ITEMS_PER_SECTION || depth > 12) return;
		if (typeof candidate === "string") {
			add(candidate);
			return;
		}
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item, depth + 1);
			return;
		}
		if (!isRecord(candidate)) return;

		const consumedKeys = new Set<string>();
		for (const pair of DETAIL_TEXT_PAIRS) {
			const primaryKey = pair.primary.find((key) => candidate[key] !== undefined);
			const secondaryKey = pair.secondary.find((key) => candidate[key] !== undefined);
			if (!primaryKey || !secondaryKey) continue;
			const primary = collectStrings(candidate[primaryKey]).join("；");
			const secondary = collectStrings(candidate[secondaryKey]).join("；");
			if (!primary || !secondary) continue;
			if (primaryKey === "ws") {
				const partOfSpeech = readString(candidate, "pos");
				if (partOfSpeech) {
					add(partOfSpeech);
					consumedKeys.add("pos");
				}
			}
			add(`${primary} ${secondary}`);
			consumedKeys.add(primaryKey);
			consumedKeys.add(secondaryKey);
			break;
		}

		for (const [key, item] of Object.entries(candidate)) {
			if (/speech|audio|url|source|image|video|music|encrypted|cipher/i.test(key)) continue;
			if (consumedKeys.has(key)) continue;
			visit(item, depth + 1);
		}
	};
	visit(value, 0);
	return result;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return cleanText(value);
	}
	return "";
}

function firstRecord(value: unknown): Record<string, unknown> {
	if (isRecord(value)) return value;
	if (Array.isArray(value) && isRecord(value[0])) return value[0];
	return {};
}

function section(
	title: string,
	value: unknown,
	presentation: DictionarySection["presentation"] = "stack",
): DictionarySection | null {
	const items = collectStrings(value);
	return items.length > 0 ? { content: { items, kind: "list" }, presentation, title } : null;
}

function detailSection(title: string, value: unknown): DictionarySection | null {
	const items = collectDetailStrings(value);
	return items.length > 0
		? { content: { items, kind: "list" }, presentation: "tab", title }
		: null;
}

function audioUrl(word: string, accent: "uk" | "us"): string {
	const type = accent === "uk" ? "1" : "2";
	return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
}

function pronunciationsFromRecord(value: Record<string, unknown>, word: string): Pronunciation[] {
	const result: Pronunciation[] = [];
	const uk = readString(value, "ukphone", "ukPhonetic", "uk-phonetic");
	const us = readString(value, "usphone", "usPhonetic", "us-phonetic");
	const generic = readString(value, "phone", "phonetic");
	if (uk)
		result.push({ accent: "uk", audioUrl: audioUrl(word, "uk"), label: "英", phonetic: uk });
	if (us)
		result.push({ accent: "us", audioUrl: audioUrl(word, "us"), label: "美", phonetic: us });
	if (!uk && !us && generic) {
		result.push({ accent: "generic", audioUrl: null, label: "音标", phonetic: generic });
	}
	return result;
}

function uniqueSections(sections: Array<DictionarySection | null>): DictionarySection[] {
	return sections.filter((candidate): candidate is DictionarySection => candidate !== null);
}

export function parseYoudaoFreeResponse(value: unknown, query: string): DictionaryResult {
	if (!isRecord(value)) {
		throw new DictionaryError("invalid-response", dictionaryText().errors.invalidResponse);
	}
	const simple = firstRecord(value.simple);
	const simpleWord = firstRecord(simple.word);
	const ec = firstRecord(value.ec);
	const ecWord = firstRecord(ec.word);
	const ce = firstRecord(value.ce);
	const ceWord = firstRecord(ce.word);
	const dictWord = Object.keys(ecWord).length > 0 ? ecWord : ceWord;
	const word =
		readString(simpleWord, "return-phrase", "word") ||
		readString(ecWord, "return-phrase", "word") ||
		readString(ceWord, "return-phrase", "word") ||
		query;
	const pronunciations = pronunciationsFromRecord(
		Object.keys(simpleWord).length > 0 ? simpleWord : dictWord,
		word,
	);
	const sections = uniqueSections([
		section(dictionaryText().sections.definitions, dictWord.trs),
		detailSection(dictionaryText().sections.englishDefinitions, firstRecord(value.ee).word),
		detailSection(dictionaryText().sections.wordForms, ecWord.wfs),
		section(dictionaryText().sections.etymology, firstRecord(value.etym).etym),
		section(
			dictionaryText().sections.examples,
			firstRecord(value.blng_sents_part).sentence_pair,
		),
		detailSection(dictionaryText().sections.collins, value.collins),
		detailSection(dictionaryText().sections.discrimination, value.discriminate),
		detailSection(dictionaryText().sections.phrases, firstRecord(value.phrs).phrs),
		detailSection(dictionaryText().sections.synonyms, firstRecord(value.syno).synos),
		detailSection(dictionaryText().sections.relatedWords, firstRecord(value.rel_word).rels),
	]);
	if (sections.length === 0 && pronunciations.length === 0) {
		throw new DictionaryError("not-found", dictionaryText().errors.notFound);
	}
	return {
		attribution: dictionaryText().youdaoFreeAttribution,
		pronunciations,
		sections,
		sourceId: "youdao",
		sourceLabel: dictionaryText().youdao,
		suggestions: [],
		word,
	};
}

function officialPayloads(value: Record<string, unknown>): Record<string, unknown>[] {
	const result = Array.isArray(value.result) ? value.result : [];
	const payloads: Record<string, unknown>[] = [];
	for (const entry of result) {
		if (!isRecord(entry)) continue;
		for (const key of ["ec", "ee", "ce", "yw", "jc", "cj", "kc", "ck"]) {
			const payload = entry[key];
			if (isRecord(payload)) payloads.push(payload);
		}
	}
	return payloads;
}

export function parseYoudaoOfficialResponse(value: unknown, query: string): DictionaryResult {
	if (!isRecord(value)) {
		throw new DictionaryError("invalid-response", dictionaryText().errors.invalidResponse);
	}
	const errorCode = typeof value.errorCode === "string" ? value.errorCode : "";
	if (errorCode && errorCode !== "0") {
		const code =
			errorCode === "120" ? "not-found" : errorCode === "411" ? "rate-limit" : "request";
		throw new DictionaryError(code, dictionaryText().youdaoError(errorCode));
	}
	const payloads = officialPayloads(value);
	const first = payloads[0] ?? {};
	const entry = firstRecord(first.word);
	const basic = firstRecord(first.basic ?? entry.basic);
	const content = Object.keys(entry).length > 0 ? entry : first;
	const phoneticSource = Object.keys(basic).length > 0 ? basic : content;
	const word = readString(content, "query", "word", "return-phrase") || query;
	const pronunciations = pronunciationsFromRecord(phoneticSource, word);
	const sections = uniqueSections([
		section(
			dictionaryText().sections.definitions,
			basic.explains ?? content.explains ?? content.trs,
		),
		detailSection(dictionaryText().sections.wordForms, content.wordFormats ?? content.wfs),
		section(dictionaryText().sections.examples, content.sentenceSample),
		detailSection(dictionaryText().sections.phrases, content.web),
		detailSection(dictionaryText().sections.synonyms, content.synonyms),
		detailSection(dictionaryText().sections.antonyms, content.antonyms),
		detailSection(dictionaryText().sections.relatedWords, content.relatedWords),
	]);
	if (sections.length === 0 && pronunciations.length === 0) {
		throw new DictionaryError("not-found", dictionaryText().errors.notFound);
	}
	return {
		attribution: dictionaryText().youdaoOfficialAttribution,
		pronunciations,
		sections,
		sourceId: "youdao",
		sourceLabel: dictionaryText().youdao,
		suggestions: [],
		word,
	};
}

function responseJson(response: { json?: unknown; text?: string }): unknown {
	if (response.json !== undefined) return response.json;
	if (typeof response.text === "string" && response.text.trim()) {
		try {
			return JSON.parse(response.text);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export class YoudaoDictionarySource implements DictionarySource {
	readonly id = "youdao";
	readonly kind = "youdao" as const;
	readonly label = dictionaryText().youdao;

	constructor(
		private readonly settings: Readonly<YoudaoDictionarySettings>,
		private readonly net: DictionaryOutboundPort,
	) {}

	async lookup(query: DictionaryQuery): Promise<DictionaryResult> {
		return this.settings.accessMode === "free"
			? this.lookupFree(query.text)
			: this.lookupOfficial(query.text);
	}

	private async lookupFree(query: string): Promise<DictionaryResult> {
		const response = await requestOnlineResponse(
			{
				method: "GET",
				url: `${YOUDAO_FREE_ENDPOINT}?q=${encodeURIComponent(query)}`,
			},
			this.net,
		);
		try {
			return parseYoudaoFreeResponse(responseJson(response), query);
		} catch (error) {
			if (error instanceof DictionaryError) throw error;
			throw new DictionaryError("invalid-response", dictionaryText().freeUnavailable);
		}
	}

	private async lookupOfficial(query: string): Promise<DictionaryResult> {
		const english = /^[\p{Script=Latin}\s'’-]+$/u.test(query);
		const preferred = english ? ["ec", "ee"] : ["ce", "yw"];
		const dictionary = preferred.find((candidate) =>
			this.settings.dictionaries.includes(candidate),
		);
		try {
			const connection = resolveYoudaoConnection({
				endpoint: YOUDAO_OFFICIAL_ENDPOINT,
				appKey: this.settings.appKey,
				appSecret: this.settings.appSecret,
			});
			const payload = await requestYoudaoJson({
				connection,
				query,
				fields: {
					dicts: dictionary ?? (english ? "ec" : "ce"),
					docType: "json",
					langType: english ? "en" : "zh-CHS",
				},
				net: this.net,
				label: "dictionary-youdao-official",
				timeoutMs: ONLINE_DICTIONARY_TIMEOUT_MS,
				maxBytes: MAX_ONLINE_DICTIONARY_RESPONSE_BYTES,
			});
			return parseYoudaoOfficialResponse(payload, query);
		} catch (error) {
			if (error instanceof DictionaryError) throw error;
			if (error instanceof YoudaoTransportError) {
				throw new DictionaryError(
					dictionaryCodeForTransport(error),
					dictionaryErrorCodeMessage(dictionaryCodeForTransport(error)),
					error.httpStatus,
				);
			}
			if (error instanceof TransportError) {
				const code = dictionaryErrorCodeForTransport(error.code);
				throw new DictionaryError(code, dictionaryErrorCodeMessage(code), error.httpStatus);
			}
			throw new DictionaryError("invalid-response", dictionaryText().errors.invalidResponse);
		}
	}
}

function dictionaryCodeForTransport(error: YoudaoTransportError): DictionaryErrorCode {
	switch (error.kind) {
		case "invalid-config":
		case "missing-key":
			return "configuration";
		case "unauthorized":
			return "unauthorized";
		case "rate-limited":
			return "rate-limit";
		case "not-found":
			return "not-found";
		case "server":
			return "server";
		case "invalid-response":
			return "invalid-response";
		case "network":
			return "network";
	}
}
