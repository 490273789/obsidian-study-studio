import { dictionaryText } from "./messages";
import {
	cleanOnlineText,
	lookupOnlineHtmlDictionary,
	requestOnlineDictionary,
	type OnlineHtmlDictionaryParsed,
	type OnlineHtmlDictionarySource,
	type DictionaryOutboundPort,
} from "./online";
import {
	type DictionaryQuery,
	type DictionaryResult,
	type DictionarySource,
	type Pronunciation,
} from "./types";

const CAMBRIDGE_HOST = "https://dictionary.cambridge.org";
const CAMBRIDGE_STYLES = `
body{padding:4px 6px 18px;font-size:15px}.entry-body__el{padding:4px 0 18px}.entry-body__el+.entry-body__el{border-top:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding-top:18px}.di-title,.headword{font-size:1.45em;font-weight:750}.posgram,.pos{color:#8b5cf6;font-weight:700}.ddef_h{margin-top:14px}.def{font-weight:600}.trans{color:#e05f78}.examp{padding-inline-start:16px;border-inline-start:2px solid color-mix(in srgb,#22a6b3 45%,transparent);margin:8px 0}.eg{font-style:italic}.hdb,.sense-body{margin-top:8px}ul{padding-inline-start:20px}a{text-decoration:none}
`;

function pronunciationUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value, CAMBRIDGE_HOST);
		return url.protocol === "https:" && url.hostname === "dictionary.cambridge.org"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

function parseCambridgeDocument(
	documentNode: Document,
	query: string,
): {
	html: string;
	pronunciations: Pronunciation[];
	suggestions: string[];
	word: string;
} {
	const entries: string[] = [];
	const pronunciations: Pronunciation[] = [];
	let word = query;
	for (const entry of documentNode.querySelectorAll<HTMLElement>(".entry-body__el")) {
		const headword = cleanOnlineText(entry.querySelector(".headword")?.textContent ?? "", 128);
		if (!headword) continue;
		if (entries.length === 0) word = headword;
		const clone = entry.cloneNode(true) as HTMLElement;
		clone
			.querySelectorAll(".smartt,.grammar,.bb,.dimg,.xref,.share")
			.forEach((item) => item.remove());
		for (const pronunciation of clone.querySelectorAll<HTMLElement>(".dpron-i")) {
			const phonetic = cleanOnlineText(
				pronunciation.querySelector(".ipa")?.textContent ?? "",
				80,
			);
			const source = pronunciation.querySelector<HTMLSourceElement>(
				'source[type="audio/mpeg"]',
			);
			const accent = pronunciation.classList.contains("uk") ? "uk" : "us";
			if (phonetic && !pronunciations.some((candidate) => candidate.accent === accent)) {
				pronunciations.push({
					accent,
					audioUrl: pronunciationUrl(source?.getAttribute("src") ?? null),
					label: accent === "uk" ? "英" : "美",
					phonetic,
				});
			}
		}
		clone.querySelectorAll("audio,amp-audio,source").forEach((item) => item.remove());
		entries.push(clone.outerHTML);
	}
	const suggestions = [
		...documentNode.querySelectorAll<HTMLElement>(".spellcheck a,.didyoumean a"),
	]
		.map((item) => cleanOnlineText(item.textContent ?? "", 128))
		.filter(Boolean)
		.slice(0, 12);
	return { html: entries.join(""), pronunciations, suggestions, word };
}

export class CambridgeDictionarySource implements DictionarySource, OnlineHtmlDictionarySource {
	readonly id = "cambridge";
	readonly kind = "cambridge" as const;
	readonly label = dictionaryText().cambridge;
	readonly attribution = dictionaryText().cambridgeAttribution;
	readonly styles = CAMBRIDGE_STYLES;

	constructor(private readonly net: DictionaryOutboundPort) {}

	async request(query: string): Promise<string> {
		const url = `${CAMBRIDGE_HOST}/search/direct/?datasetsearch=english-chinese-simplified&q=${encodeURIComponent(query)}`;
		return requestOnlineDictionary(url, this.net);
	}

	parse(documentNode: Document, query: string): OnlineHtmlDictionaryParsed {
		return parseCambridgeDocument(documentNode, query);
	}

	async lookup(query: DictionaryQuery): Promise<DictionaryResult> {
		return lookupOnlineHtmlDictionary(query, this);
	}
}
