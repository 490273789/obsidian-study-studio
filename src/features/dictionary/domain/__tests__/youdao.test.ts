import { describe, expect, it, vi } from "vite-plus/test";
import {
	TransportError,
	type OutboundRequest,
	type OutboundResponse,
} from "../../../../core/net/types";
import { buildYoudaoV3Body, youdaoV3SignInput } from "../../../../core/shared/youdaoSign";
import type { YoudaoDictionarySettings } from "../types";
import {
	parseYoudaoFreeResponse,
	parseYoudaoOfficialResponse,
	YOUDAO_FREE_ENDPOINT,
	YOUDAO_OFFICIAL_ENDPOINT,
	YoudaoDictionarySource,
} from "../youdao";

const FREE_FIXTURE = {
	blng_sents_part: {
		sentence_pair: [{ eng_sent: "This is a test.", chn_sent: "这是一次测试。" }],
	},
	collins: {
		collins_entries: [
			{
				entries: {
					entry: [
						{
							tran_entry: [
								{
									pos_entry: { pos: "N-COUNT", pos_tips: "可数名词" },
									exam_sents: {
										sent: [
											{
												eng_sent: "This is a test.",
												chn_sent: "这是一次测试。",
											},
										],
									},
									tran: "A trial. 试验",
								},
							],
						},
					],
				},
			},
		],
	},
	discriminate: {
		data: [
			{
				headwords: ["test", "trial"],
				tran: "测试辨析",
				usages: [{ headword: "test", usage: "辨析内容" }],
			},
		],
	},
	ec: {
		word: [
			{
				trs: [{ tr: [{ l: { i: ["n. 测试；试验"] } }] }],
				wfs: [{ wf: { name: "复数", value: "tests" } }],
			},
		],
	},
	ee: {
		word: { trs: [{ pos: "n.", tr: [{ l: { i: "an examination of something" } }] }] },
	},
	encryptedData: "must-not-render",
	etym: { etym: "源自拉丁语 testum。" },
	phrs: { phrs: [{ phr: { headword: "test case", trs: ["测试用例"] } }] },
	rel_word: {
		rels: [
			{
				rel: {
					pos: "adj.",
					words: [
						{ tran: "值得尊敬的；人格高尚的；相当数量的", word: "respectable" },
						{ tran: "恭敬的；有礼貌的", word: "respectful" },
					],
				},
			},
		],
	},
	simple: {
		word: [
			{
				"return-phrase": "test",
				ukphone: "test",
				ukspeech: "https://evil.example/audio",
				usphone: "test",
			},
		],
	},
	syno: { synos: [{ pos: "n.", tran: "测试", ws: ["trial"] }] },
	web_trans: { web_translation: ["must-not-render"] },
};

const OFFICIAL_FIXTURE = {
	errorCode: "0",
	result: [
		{
			ec: {
				basic: { explains: ["n. 测试"], ukPhonetic: "test", usPhonetic: "test" },
				sentenceSample: [{ sentence: "This is a test.", translation: "这是一个测试。" }],
				word: "test",
			},
		},
	],
};

function response(json: unknown, status = 200): OutboundResponse {
	return {
		arrayBuffer: new ArrayBuffer(0),
		headers: {},
		status,
		text: JSON.stringify(json),
	};
}

function settings(overrides: Partial<YoudaoDictionarySettings> = {}): YoudaoDictionarySettings {
	return {
		accessMode: "official",
		appKey: "app-key",
		appSecret: "app-secret",
		dictionaries: ["ec", "ce"],
		...overrides,
	};
}

function thrown(action: () => unknown): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	throw new Error("Expected the action to throw");
}

function sectionItems(result: { sections: { content: unknown; title: string }[] }, title: string) {
	const section = result.sections.find((candidate) => candidate.title === title);
	return (section?.content as { items?: string[] } | undefined)?.items;
}

describe("parseYoudaoFreeResponse", () => {
	it("parses the whitelisted free sections and builds fixed pronunciation URLs", () => {
		const result = parseYoudaoFreeResponse(FREE_FIXTURE, "test");

		expect(result.word).toBe("test");
		expect(result.sourceId).toBe("youdao");
		expect(result.suggestions).toEqual([]);
		expect(result.pronunciations).toEqual([
			{
				accent: "uk",
				audioUrl: "https://dict.youdao.com/dictvoice?audio=test&type=1",
				label: "英",
				phonetic: "test",
			},
			{
				accent: "us",
				audioUrl: "https://dict.youdao.com/dictvoice?audio=test&type=2",
				label: "美",
				phonetic: "test",
			},
		]);

		expect(
			result.sections
				.filter((section) => section.presentation === "tab")
				.map((section) => section.title),
		).toEqual(["英英释义", "词形变化", "柯林斯", "词义辨析", "短语", "近义词", "相关词"]);
		expect(
			result.sections
				.filter((section) => section.presentation === "stack")
				.map((section) => section.title),
		).toEqual(["释义", "词源", "例句"]);

		expect(sectionItems(result, "释义")).toEqual(["n. 测试；试验"]);
		expect(sectionItems(result, "词源")).toEqual(["源自拉丁语 testum。"]);
		expect(sectionItems(result, "例句")).toEqual(["This is a test.", "这是一次测试。"]);
		expect(sectionItems(result, "英英释义")).toEqual(["n.", "an examination of something"]);
		expect(sectionItems(result, "词形变化")).toEqual(["复数 tests"]);
		expect(sectionItems(result, "短语")).toEqual(["test case 测试用例"]);
		expect(sectionItems(result, "近义词")).toEqual(["n.", "trial 测试"]);
		expect(sectionItems(result, "词义辨析")).toEqual(["test；trial 测试辨析", "test 辨析内容"]);
		expect(sectionItems(result, "柯林斯")).toEqual([
			"N-COUNT 可数名词",
			"This is a test. 这是一次测试。",
			"A trial. 试验",
		]);
		expect(sectionItems(result, "相关词")).toEqual([
			"adj.",
			"respectable 值得尊敬的；人格高尚的；相当数量的",
			"respectful 恭敬的；有礼貌的",
		]);
	});

	it("never renders encrypted payloads or third-party audio URLs", () => {
		const serialized = JSON.stringify(parseYoudaoFreeResponse(FREE_FIXTURE, "test"));
		expect(serialized).not.toContain("must-not-render");
		expect(serialized).not.toContain("evil.example");
	});

	it("falls back to the query for the headword and the first usable word record", () => {
		const result = parseYoudaoFreeResponse(
			{ ec: { word: [{ phone: "fəˈnetɪk" }] } },
			"fallback",
		);
		expect(result.word).toBe("fallback");
		expect(result.pronunciations).toEqual([
			{ accent: "generic", audioUrl: null, label: "音标", phonetic: "fəˈnetɪk" },
		]);
	});

	it("rejects a non-object payload as an invalid response", () => {
		expect(thrown(() => parseYoudaoFreeResponse([], "test"))).toMatchObject({
			code: "invalid-response",
		});
		expect(thrown(() => parseYoudaoFreeResponse("test", "test"))).toMatchObject({
			code: "invalid-response",
		});
	});

	it("parses Chinese-to-English definitions from ce payload and ignores @ attributes", () => {
		const result = parseYoudaoFreeResponse(
			{
				ce: {
					word: [
						{
							phone: "nǐ hǎo",
							"return-phrase": "你好",
							trs: [
								{
									tr: [
										{
											l: {
												i: [
													"",
													{
														"#text": "hello",
														"@action": "link",
														"@href": "app:ds:hello",
													},
												],
												"#tran": "喂，你好",
											},
										},
									],
								},
							],
						},
					],
				},
				simple: {
					word: [
						{
							phone: "nǐ hǎo",
							"return-phrase": "你好",
						},
					],
				},
			},
			"你好",
		);
		expect(result.word).toBe("你好");
		expect(result.pronunciations).toEqual([
			{ accent: "generic", audioUrl: null, label: "音标", phonetic: "nǐ hǎo" },
		]);
		expect(sectionItems(result, "释义")).toEqual(["hello", "喂，你好"]);
	});

	it("reports not-found when no section or pronunciation can be read", () => {
		expect(thrown(() => parseYoudaoFreeResponse({}, "missing"))).toMatchObject({
			code: "not-found",
			message: "没有找到这个单词。",
		});
	});
});

describe("parseYoudaoOfficialResponse", () => {
	it("parses the official result payload", () => {
		const result = parseYoudaoOfficialResponse(OFFICIAL_FIXTURE, "test");
		expect(result.word).toBe("test");
		expect(result.sourceId).toBe("youdao");
		expect(result.suggestions).toEqual([]);
		expect(result.pronunciations.map((item) => item.accent)).toEqual(["uk", "us"]);
		expect(result.sections.map((section) => section.title)).toEqual(["释义", "例句"]);
		expect(sectionItems(result, "释义")).toEqual(["n. 测试"]);
		expect(sectionItems(result, "例句")).toEqual(["This is a test.", "这是一个测试。"]);
	});

	it.each([
		["120", "not-found"],
		["411", "rate-limit"],
		["500", "request"],
		["108", "request"],
	])("maps the official error code %s to %s", (errorCode, code) => {
		const error = thrown(() =>
			parseYoudaoOfficialResponse({ errorCode, result: [] }, "missing"),
		);
		expect(error).toMatchObject({ code });
		expect((error as Error).message).toContain(`错误码 ${errorCode}`);
	});

	it("treats an errorCode of 0 as success", () => {
		expect(() => parseYoudaoOfficialResponse({ errorCode: "0" }, "test")).toThrow(
			"没有找到这个单词。",
		);
	});

	it("rejects a non-object payload as an invalid response", () => {
		expect(thrown(() => parseYoudaoOfficialResponse(null, "test"))).toMatchObject({
			code: "invalid-response",
		});
	});
});

describe("YoudaoDictionarySource dictionary selection", () => {
	function requestsFrom(payload: unknown, calls: OutboundRequest[]) {
		return {
			request: vi.fn(async (request: OutboundRequest): Promise<OutboundResponse> => {
				calls.push(request);
				return response(payload);
			}),
		};
	}

	async function selectDict(
		query: string,
		dictionaries: string[],
	): Promise<{ dicts: string | null; langType: string | null }> {
		const calls: OutboundRequest[] = [];
		const source = new YoudaoDictionarySource(
			settings({ accessMode: "official", dictionaries }),
			requestsFrom(OFFICIAL_FIXTURE, calls),
		);
		await source.lookup({ text: query });
		const rawBody = calls[0]?.body;
		const body = new URLSearchParams(typeof rawBody === "string" ? rawBody : "");
		return { dicts: body.get("dicts"), langType: body.get("langType") };
	}

	it.each([
		["test", ["ec", "ce"], "ec", "en"],
		["don't", ["ec", "ce"], "ec", "en"],
		["well-known", ["ee", "ce"], "ee", "en"],
		["测试", ["ec", "ce"], "ce", "zh-CHS"],
		["测试", ["yw", "ec"], "yw", "zh-CHS"],
		["hello 世界", ["ec", "ce"], "ce", "zh-CHS"],
		["test", ["ce"], "ec", "en"],
		["测试", ["ec"], "ce", "zh-CHS"],
	])("selects %s for dictionaries %j", async (query, dictionaries, dicts, langType) => {
		await expect(selectDict(query, dictionaries)).resolves.toEqual({ dicts, langType });
	});
});

describe("YoudaoDictionarySource never falls back between access modes", () => {
	it("uses only the free endpoint in free mode", async () => {
		const calls: OutboundRequest[] = [];
		const source = new YoudaoDictionarySource(
			settings({ accessMode: "free", appKey: "", appSecret: "" }),
			{ request: async (request) => (calls.push(request), response(FREE_FIXTURE)) },
		);
		const result = await source.lookup({ text: "test" });

		expect(result.word).toBe("test");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toContain(YOUDAO_FREE_ENDPOINT);
		expect(calls[0]?.url).toContain("q=test");
		expect(calls.some((call) => call.url.includes(YOUDAO_OFFICIAL_ENDPOINT))).toBe(false);
	});

	it("keeps a free-mode parse failure on the free endpoint", async () => {
		const calls: OutboundRequest[] = [];
		const source = new YoudaoDictionarySource(settings({ accessMode: "free" }), {
			request: async (request) => (calls.push(request), response({})),
		});
		await expect(source.lookup({ text: "missing" })).rejects.toMatchObject({
			code: "not-found",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain(YOUDAO_FREE_ENDPOINT);
	});

	it("maps a free-mode transport failure without an official retry", async () => {
		const calls: OutboundRequest[] = [];
		const source = new YoudaoDictionarySource(settings({ accessMode: "free" }), {
			request: async (request) => {
				calls.push(request);
				throw new TransportError("server", { httpStatus: 503 });
			},
		});
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({ code: "server" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("GET");
	});

	it("uses only the official endpoint in official mode", async () => {
		const calls: OutboundRequest[] = [];
		const source = new YoudaoDictionarySource(settings({ accessMode: "official" }), {
			request: async (request) => (calls.push(request), response({ errorCode: "120" })),
		});
		await expect(source.lookup({ text: "missing" })).rejects.toMatchObject({
			code: "not-found",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(YOUDAO_OFFICIAL_ENDPOINT);
		expect(calls.some((call) => call.url.includes(YOUDAO_FREE_ENDPOINT))).toBe(false);
	});

	it.each([
		["108", "unauthorized"],
		["411", "rate-limit"],
	])("maps shared Youdao code %s to %s in official mode", async (errorCode, code) => {
		const source = new YoudaoDictionarySource(settings({ accessMode: "official" }), {
			request: async () => response({ errorCode }),
		});
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({ code });
	});

	it("requires credentials in official mode before any request", async () => {
		const request = vi.fn(async () => response(OFFICIAL_FIXTURE));
		const source = new YoudaoDictionarySource(
			settings({ accessMode: "official", appKey: "  ", appSecret: "" }),
			{ request },
		);
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({
			code: "configuration",
		});
		expect(request).not.toHaveBeenCalled();
	});

	it("parses free-mode response when json is undefined on response", async () => {
		const source = new YoudaoDictionarySource(settings({ accessMode: "free" }), {
			request: async () => ({
				arrayBuffer: new ArrayBuffer(0),
				headers: {},
				status: 200,
				text: JSON.stringify(FREE_FIXTURE),
			}),
		});
		const result = await source.lookup({ text: "test" });
		expect(result.word).toBe("test");
		expect(result.sections.length).toBeGreaterThan(0);
	});

	it("parses official-mode response when json is undefined on response", async () => {
		const source = new YoudaoDictionarySource(settings({ accessMode: "official" }), {
			request: async () => ({
				arrayBuffer: new ArrayBuffer(0),
				headers: {},
				status: 200,
				text: JSON.stringify(OFFICIAL_FIXTURE),
			}),
		});
		const result = await source.lookup({ text: "test" });
		expect(result.word).toBe("test");
		expect(result.sections.length).toBeGreaterThan(0);
	});
});

describe("youdaoV3SignInput", () => {
	it.each([
		["", ""],
		["a".repeat(20), "a".repeat(20)],
		["abcdefghijklmnopqrstu", "abcdefghij21lmnopqrstu"],
		["😀".repeat(20), "😀".repeat(20)],
	])("returns %j unchanged or truncated by code points", (query, expected) => {
		expect(youdaoV3SignInput(query)).toBe(expected);
	});

	it("counts an astral character as one code point", () => {
		expect(youdaoV3SignInput("😀".repeat(21))).toBe(`${"😀".repeat(10)}21${"😀".repeat(10)}`);
		// 22 UTF-16 code units but 21 code points, so the embedded count is 21.
		expect(youdaoV3SignInput(`${"a".repeat(10)}😀${"b".repeat(10)}`)).toBe(
			`${"a".repeat(10)}21${"b".repeat(10)}`,
		);
	});
});

describe("buildYoudaoV3Body", () => {
	it("includes the supplied fields and signs the documented concatenation", async () => {
		const body = await buildYoudaoV3Body({
			appKey: "app-key",
			appSecret: "app-secret",
			curtime: "1700000000",
			fields: { dicts: "ee", docType: "json", langType: "en" },
			query: "a".repeat(30),
			salt: "fixed-salt",
		});
		const form = new URLSearchParams(body);

		expect(form.get("appKey")).toBe("app-key");
		expect(form.get("curtime")).toBe("1700000000");
		expect(form.get("salt")).toBe("fixed-salt");
		expect(form.get("signType")).toBe("v3");
		expect(form.get("q")).toBe("a".repeat(30));
		expect(form.get("dicts")).toBe("ee");
		expect(form.get("docType")).toBe("json");
		expect(form.get("langType")).toBe("en");

		const expected = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				`app-key${youdaoV3SignInput("a".repeat(30))}fixed-salt1700000000app-secret`,
			),
		);
		const expectedHex = Array.from(new Uint8Array(expected), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		expect(form.get("sign")).toBe(expectedHex);
	});

	it("is deterministic for a fixed salt and curtime", async () => {
		const options = {
			appKey: "app-key",
			appSecret: "app-secret",
			curtime: "1700000000",
			query: "test",
			salt: "fixed-salt",
		};
		await expect(buildYoudaoV3Body(options)).resolves.toBe(await buildYoudaoV3Body(options));
	});
});
