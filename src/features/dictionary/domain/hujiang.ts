import { dictionaryText } from "./messages";
import {
	cleanOnlineText,
	lookupOnlineHtmlDictionary,
	requestOnlineText,
	type DictionaryOutboundPort,
	type OnlineHtmlDictionaryParsed,
	type OnlineHtmlDictionarySource,
} from "./online";
import { type DictionaryQuery, type DictionaryResult, type DictionarySource } from "./types";

const HUJIANG_ENDPOINT = "https://dict.hujiang.com/w";
const HUJIANG_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.0.3 Chrome/100.0.4896.160 Electron/18.3.5 Safari/537.36";
const HUJIANG_STYLES = `
body{padding:4px 6px 18px;font-size:15px}h2{font-size:1.35em;border-bottom:1px solid color-mix(in srgb,CanvasText 22%,transparent);padding-bottom:6px}h3{font-size:1.1em}.word-details-pane{padding-bottom:16px}.word-details-pane+.word-details-pane{border-top:1px solid color-mix(in srgb,CanvasText 16%,transparent);padding-top:16px}.detail-groups{margin-top:12px}.detail-groups dt{font-weight:750;margin:10px 0}.detail-groups dd{margin:0 0 12px 22px}.detail-tags-en{display:flex;flex-wrap:wrap;gap:6px;padding:0;list-style:none}.detail-tags-en li{padding:2px 6px;border-radius:4px;background:color-mix(in srgb,#22a6b3 15%,Canvas);color:#168596}.detail-source{color:GrayText}.word-audio{display:none}
`;

function createHujiangRequestHeaders(
	now = Date.now(),
	createId: () => string = () => crypto.randomUUID(),
): Record<string, string> {
	const cookies = {
		HJ_SITEID: "3",
		HJ_UID: createId(),
		HJ_SID: createId(),
		HJ_SSID: createId(),
		HJID: "0",
		HJ_VT: "2",
		HJ_SST: "1",
		HJ_CSST: "1",
		HJ_ST: "1",
		HJ_CST: "1",
		HJ_T: String(now),
		_: createId().replace(/-/g, "").slice(0, 16),
	};
	return {
		cookie: Object.entries(cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join("; "),
		"User-Agent": HUJIANG_USER_AGENT,
	};
}

function parseHujiangDocument(documentNode: Document): {
	html: string;
	suggestions: string[];
} {
	const suggestions = [...documentNode.querySelectorAll<HTMLElement>(".word-suggestions a")]
		.map((item) => cleanOnlineText(item.textContent ?? "", 128))
		.filter(Boolean)
		.slice(0, 12);
	const panes = [...documentNode.querySelectorAll<HTMLElement>(".word-details-pane")].map(
		(pane) => {
			const clone = pane.cloneNode(true) as HTMLElement;
			clone.querySelectorAll(".word-audio,audio,source").forEach((item) => item.remove());
			return clone.outerHTML;
		},
	);
	if (panes.length === 0 && documentNode.querySelector(".word-notfound")) {
		return { html: "", suggestions };
	}
	return { html: panes.join(""), suggestions };
}

export class HujiangDictionarySource implements DictionarySource, OnlineHtmlDictionarySource {
	readonly id = "hujiang";
	readonly kind = "hujiang" as const;
	readonly label = dictionaryText().hujiang;
	readonly attribution = dictionaryText().hujiangAttribution;
	readonly styles = HUJIANG_STYLES;

	constructor(private readonly net: DictionaryOutboundPort) {}

	async request(query: string): Promise<string> {
		return requestOnlineText(
			{
				headers: createHujiangRequestHeaders(),
				method: "GET",
				url: `${HUJIANG_ENDPOINT}/${encodeURIComponent(query)}`,
			},
			this.net,
		);
	}

	parse(documentNode: Document, query: string): OnlineHtmlDictionaryParsed {
		const parsed = parseHujiangDocument(documentNode);
		return {
			html: parsed.html,
			pronunciations: [],
			suggestions: parsed.suggestions,
			word: query,
		};
	}

	async lookup(query: DictionaryQuery): Promise<DictionaryResult> {
		return lookupOnlineHtmlDictionary(query, this);
	}
}
