import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError, type OutboundResponse } from "../../../../core/net/types";
import {
	cleanOnlineText,
	dictionaryErrorCodeForTransport,
	escapeDictionaryHtml,
	MAX_ONLINE_DICTIONARY_RESPONSE_BYTES,
	ONLINE_DICTIONARY_TIMEOUT_MS,
	requestOnlineResponse,
} from "../online";

function response(text = "", status = 200): OutboundResponse {
	return {
		arrayBuffer: new TextEncoder().encode(text).buffer,
		headers: {},
		status,
		text,
	};
}

describe("dictionaryErrorCodeForTransport", () => {
	it.each([
		["unauthorized", "unauthorized"],
		["not-found", "not-found"],
		["rate-limited", "rate-limit"],
		["server", "server"],
		["network", "network"],
		["timeout", "network"],
		["cancelled", "request"],
		["invalid-response", "invalid-response"],
	] as const)("maps %s to %s", (transport, dictionary) => {
		expect(dictionaryErrorCodeForTransport(transport)).toBe(dictionary);
	});
});

describe("cleanOnlineText", () => {
	it("collapses whitespace and trims", () => {
		expect(cleanOnlineText("  a \n\t b   c  ")).toBe("a b c");
		expect(cleanOnlineText("\u00a0padded\u00a0")).toBe("padded");
	});

	it("caps the text at the default and a custom limit", () => {
		expect(cleanOnlineText("x".repeat(1_500))).toHaveLength(1_000);
		expect(cleanOnlineText("abcdef", 3)).toBe("abc");
		expect(cleanOnlineText("", 3)).toBe("");
	});
});

describe("escapeDictionaryHtml", () => {
	it("escapes all five HTML metacharacters", () => {
		expect(escapeDictionaryHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
	});

	it("escapes ampersands before the other entities", () => {
		expect(escapeDictionaryHtml("&amp;")).toBe("&amp;amp;");
		expect(escapeDictionaryHtml("&lt;")).toBe("&amp;lt;");
	});

	it("leaves plain text untouched and escapes a mixed string", () => {
		expect(escapeDictionaryHtml("plain 文本")).toBe("plain 文本");
		expect(escapeDictionaryHtml(`<a href="x">it's & more</a>`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; more&lt;/a&gt;",
		);
	});
});

describe("online dictionary limits", () => {
	it("exports the documented timeout and byte cap", () => {
		expect(ONLINE_DICTIONARY_TIMEOUT_MS).toBe(12_000);
		expect(MAX_ONLINE_DICTIONARY_RESPONSE_BYTES).toBe(2_000_000);
	});
});

describe("requestOnlineResponse", () => {
	it("delegates timeout and byte limits to the outbound port", async () => {
		const request = vi.fn(async () => response("ok"));
		await expect(
			requestOnlineResponse({ url: "https://example.test" }, { request }),
		).resolves.toMatchObject({ status: 200, text: "ok" });
		expect(request).toHaveBeenCalledWith({
			label: "dictionary-online-source",
			url: "https://example.test",
			timeoutMs: ONLINE_DICTIONARY_TIMEOUT_MS,
			maxBytes: MAX_ONLINE_DICTIONARY_RESPONSE_BYTES,
		});
	});

	it.each([
		["unauthorized", "unauthorized"],
		["not-found", "not-found"],
		["rate-limited", "rate-limit"],
		["server", "server"],
		["invalid-response", "invalid-response"],
	] as const)("maps the transport code %s to %s", async (transport, code) => {
		await expect(
			requestOnlineResponse(
				{ url: "https://example.test" },
				{ request: async () => Promise.reject(new TransportError(transport)) },
			),
		).rejects.toMatchObject({ code });
	});

	it("maps an executor failure onto the network code", async () => {
		await expect(
			requestOnlineResponse(
				{ url: "https://example.test" },
				{ request: async () => Promise.reject(new Error("offline")) },
			),
		).rejects.toMatchObject({ code: "network" });
	});
});
