import {
	TransportError,
	type OutboundPort,
	type OutboundRequest,
	type OutboundResponse,
	type TransportErrorCode,
} from "../../../core/net/types";
import { dictionaryText } from "./messages";
import { prepareDictionarySandboxDocument, type SandboxDocument } from "./sandbox-document";
import {
	DictionaryError,
	dictionaryErrorCodeMessage,
	type DictionaryErrorCode,
	type DictionaryQuery,
	type DictionaryResult,
	type Pronunciation,
} from "./types";

export const ONLINE_DICTIONARY_TIMEOUT_MS = 12_000;
export const MAX_ONLINE_DICTIONARY_RESPONSE_BYTES = 2_000_000;

export type DictionaryOutboundPort = Pick<OutboundPort, "request">;
type DictionaryOnlineRequest = Omit<OutboundRequest, "label" | "timeoutMs" | "maxBytes">;

export function cleanOnlineText(value: string, limit = 1_000): string {
	return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseOnlineDocument(value: string): Document {
	return new DOMParser().parseFromString(value, "text/html");
}

async function prepareOnlineDictionaryDocument(
	html: string,
	stylesheet: string,
): Promise<SandboxDocument> {
	return prepareDictionarySandboxDocument(html, async () => null, stylesheet);
}

export interface OnlineHtmlDictionaryParsed {
	html: string;
	pronunciations: Pronunciation[];
	suggestions: string[];
	word: string;
}

export interface OnlineHtmlDictionarySource {
	readonly attribution: string;
	readonly id: string;
	readonly label: string;
	readonly styles: string;
	parse(documentNode: Document, query: string): OnlineHtmlDictionaryParsed;
	request(query: string): Promise<string>;
}

/**
 * Runs the shared HTML dictionary lookup skeleton for an online source:
 * request, parse, empty-result handling, sanitization, and assembly. Each
 * source only provides request + parse + presentation details.
 */
export async function lookupOnlineHtmlDictionary(
	query: DictionaryQuery,
	source: OnlineHtmlDictionarySource,
): Promise<DictionaryResult> {
	const parsed = source.parse(parseOnlineDocument(await source.request(query.text)), query.text);
	if (!parsed.html && parsed.suggestions.length === 0) {
		throw new DictionaryError("not-found", dictionaryText().errors.notFound);
	}
	return {
		attribution: source.attribution,
		pronunciations: parsed.pronunciations,
		sections: parsed.html
			? [
					{
						content: {
							document: await prepareOnlineDictionaryDocument(
								parsed.html,
								source.styles,
							),
							kind: "document",
						},
						presentation: "stack",
						title: dictionaryText().sections.definitions,
					},
				]
			: [],
		sourceId: source.id,
		sourceLabel: source.label,
		suggestions: parsed.suggestions,
		word: parsed.word,
	};
}

export function dictionaryErrorCodeForTransport(code: TransportErrorCode): DictionaryErrorCode {
	switch (code) {
		case "unauthorized":
			return "unauthorized";
		case "not-found":
			return "not-found";
		case "rate-limited":
			return "rate-limit";
		case "server":
			return "server";
		case "network":
		case "timeout":
			return "network";
		case "invalid-response":
			return "invalid-response";
		case "cancelled":
			return "request";
	}
}

export async function requestOnlineResponse(
	request: DictionaryOnlineRequest,
	net: DictionaryOutboundPort,
): Promise<OutboundResponse> {
	try {
		return await net.request({
			...request,
			label: "dictionary-online-source",
			timeoutMs: ONLINE_DICTIONARY_TIMEOUT_MS,
			maxBytes: MAX_ONLINE_DICTIONARY_RESPONSE_BYTES,
		});
	} catch (error) {
		if (error instanceof DictionaryError) throw error;
		if (error instanceof TransportError) {
			const code = dictionaryErrorCodeForTransport(error.code);
			const message =
				error.code === "timeout"
					? dictionaryText().errors.timeout
					: dictionaryErrorCodeMessage(code, dictionaryText());
			throw new DictionaryError(code, message, error.httpStatus);
		}
		throw new DictionaryError("network", dictionaryText().errors.network);
	}
}

export async function requestOnlineDictionary(
	url: string,
	net: DictionaryOutboundPort,
	headers: Readonly<Record<string, string>> = {},
): Promise<string> {
	const response = await requestOnlineResponse(
		{
			headers: {
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
				...headers,
			},
			method: "GET",
			url,
		},
		net,
	);
	return response.text;
}

export async function requestOnlineText(
	request: DictionaryOnlineRequest,
	net: DictionaryOutboundPort,
): Promise<string> {
	return (await requestOnlineResponse(request, net)).text;
}
