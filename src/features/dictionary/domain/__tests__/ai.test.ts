import { describe, expect, it, vi } from "vite-plus/test";
import { AiError, type AiErrorCode, type AiService } from "../../../../core/ai";
import { TransportError, type TransportErrorCode } from "../../../../core/net/types";
import {
	AiDictionarySource,
	dictionaryErrorCodeForAiError,
	dictionaryErrorCodeForAiTransport,
	parseAiDictionaryResult,
} from "../ai";
import type { DictionaryErrorCode } from "../types";

const AI_ERROR_CODES: readonly AiErrorCode[] = [
	"busy",
	"config-not-found",
	"disposed",
	"incomplete-response",
	"invalid-config",
	"invalid-input",
	"missing-key",
	"no-default",
	"save-failed",
	"unsupported-image",
];

const ERROR_CODE_MAPPING: ReadonlyArray<
	readonly [AiErrorCode | "configuration", DictionaryErrorCode]
> = [
	["configuration", "configuration"],
	["missing-key", "configuration"],
	["invalid-config", "configuration"],
	["config-not-found", "configuration"],
	["no-default", "configuration"],
	["incomplete-response", "invalid-response"],
	["invalid-input", "invalid-response"],
	["unsupported-image", "invalid-response"],
	["busy", "request"],
	["disposed", "request"],
	["save-failed", "request"],
];

const TRANSPORT_ERROR_MAPPING: ReadonlyArray<readonly [TransportErrorCode, DictionaryErrorCode]> = [
	["unauthorized", "unauthorized"],
	["rate-limited", "rate-limit"],
	["not-found", "server"],
	["server", "server"],
	["network", "network"],
	["timeout", "network"],
	["invalid-response", "invalid-response"],
	["cancelled", "request"],
];

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		antonyms: ["certainty（确定性）"],
		examples: [{ sentence: "This is a test.", translation: "这是一次测试。" }],
		explanation: "用于检查能力、质量或性能。",
		meaning: "测试；检验",
		partOfSpeech: "noun",
		synonyms: ["trial（试验）"],
		...overrides,
	};
}

function aiJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		definitions: [definition()],
		phonetics: [{ accent: "UK", phonetic: "test" }],
		word: "test",
		...overrides,
	});
}

function stubAi(generate: unknown): AiService {
	return { generate } as unknown as AiService;
}

describe("dictionaryErrorCodeForAiError", () => {
	it.each(ERROR_CODE_MAPPING)("maps %s to %s", (code, expected) => {
		expect(dictionaryErrorCodeForAiError(code)).toBe(expected);
	});

	it.each(TRANSPORT_ERROR_MAPPING)("maps transport %s to %s", (code, expected) => {
		expect(dictionaryErrorCodeForAiTransport(code)).toBe(expected);
	});

	it("covers every AiErrorCode member", () => {
		expect(ERROR_CODE_MAPPING.map(([code]) => code).sort()).toEqual(
			["configuration", ...AI_ERROR_CODES].sort(),
		);
	});
});

describe("parseAiDictionaryResult structured output", () => {
	it("parses the strict JSON allowlist into definitions and sections", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				phrases: ["test case：测试用例"],
				unknownHtml: "<script>bad()</script>",
			}),
			"test",
			"AI 生成 · 引擎 · 模型",
		);

		expect(result.attribution).toBe("AI 生成 · 引擎 · 模型");
		expect(result.sourceId).toBe("ai");
		expect(result.sourceLabel).toBe("AI 词典");
		expect(result.suggestions).toEqual([]);
		expect(result.word).toBe("test");
		expect(result.pronunciations).toEqual([
			{ accent: "uk", audioUrl: null, label: "英", phonetic: "test" },
		]);
		expect(result.sections[0]).toEqual({
			content: {
				definitions: [
					{
						antonyms: ["certainty（确定性）"],
						examples: [{ sentence: "This is a test.", translation: "这是一次测试。" }],
						explanation: "用于检查能力、质量或性能。",
						meaning: "测试；检验",
						partOfSpeech: "名词",
						synonyms: ["trial（试验）"],
					},
				],
				kind: "ai-definitions",
			},
			presentation: "stack",
			title: "释义",
		});
		expect(result.sections[1]).toMatchObject({ presentation: "tab", title: "短语" });

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("unknownHtml");
		expect(serialized).not.toContain("bad()");
	});

	it("never trusts model-supplied audio URLs", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				phonetics: [{ accent: "UK", audioUrl: "https://evil.example", phonetic: "t" }],
			}),
			"test",
			"AI",
		);
		expect(result.pronunciations[0]?.audioUrl).toBeNull();
		expect(JSON.stringify(result)).not.toContain("evil.example");
	});

	it("caps definitions at five and examples at two each", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				definitions: Array.from({ length: 7 }, (_value, index) =>
					definition({
						examples: Array.from({ length: 4 }, (_entry, example) => ({
							sentence: `Sentence ${index}-${example}.`,
							translation: `例句 ${index}-${example}。`,
						})),
						meaning: `释义 ${index}`,
					}),
				),
			}),
			"test",
			"AI",
		);
		const content = result.sections[0]?.content;
		expect(content?.kind).toBe("ai-definitions");
		if (content?.kind !== "ai-definitions") throw new Error("Expected ai definitions");
		expect(content.definitions).toHaveLength(5);
		for (const item of content.definitions) {
			expect(item.examples).toHaveLength(2);
		}
	});

	it("caps meaning at 180 and explanation at 360 characters", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				definitions: [
					definition({ explanation: "说".repeat(500), meaning: "中".repeat(300) }),
				],
			}),
			"test",
			"AI",
		);
		const content = result.sections[0]?.content;
		if (content?.kind !== "ai-definitions") throw new Error("Expected ai definitions");
		expect(content.definitions[0]?.meaning).toHaveLength(180);
		expect(content.definitions[0]?.explanation).toHaveLength(360);
	});

	it("drops a non-Chinese explanation and non-Chinese synonyms/antonyms", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				definitions: [
					definition({
						antonyms: ["certainty", "确定性"],
						explanation: "An examination of quality.",
						synonyms: Array.from({ length: 8 }, (_value, index) => `近义词${index}`),
					}),
				],
			}),
			"test",
			"AI",
		);
		const content = result.sections[0]?.content;
		if (content?.kind !== "ai-definitions") throw new Error("Expected ai definitions");
		expect(content.definitions[0]?.explanation).toBe("");
		expect(content.definitions[0]?.antonyms).toEqual(["确定性"]);
		expect(content.definitions[0]?.synonyms).toHaveLength(6);
	});

	it("caps phonetics at three and section lists at twenty Chinese entries", () => {
		const result = parseAiDictionaryResult(
			aiJson({
				phrases: [
					...Array.from({ length: 25 }, (_v, i) => `短语${i}：释义`),
					"english only",
				],
				phonetics: Array.from({ length: 5 }, (_v, i) => ({
					accent: i % 2 === 0 ? "US" : "UK",
					phonetic: `p${i}`,
				})),
			}),
			"test",
			"AI",
		);
		expect(result.pronunciations).toHaveLength(3);
		expect(result.pronunciations[0]).toMatchObject({ accent: "us", label: "美" });
		expect(result.pronunciations[1]).toMatchObject({ accent: "uk", label: "英" });
		const content = result.sections[1]?.content;
		if (content?.kind !== "list") throw new Error("Expected a list section");
		expect(content.items).toHaveLength(20);
		expect(content.items).not.toContain("english only");
	});

	it("falls back to the query when the word is absent or blank", () => {
		expect(parseAiDictionaryResult(aiJson({ word: "" }), "query-word", "AI").word).toBe(
			"query-word",
		);
		expect(parseAiDictionaryResult(aiJson({ word: 42 }), "query-word", "AI").word).toBe(
			"query-word",
		);
	});

	it("strips HTML from structured strings", () => {
		const result = parseAiDictionaryResult(
			aiJson({ definitions: [definition({ meaning: "<b>中文</b>释义" })] }),
			"test",
			"AI",
		);
		const content = result.sections[0]?.content;
		if (content?.kind !== "ai-definitions") throw new Error("Expected ai definitions");
		expect(content.definitions[0]?.meaning).toBe("中文 释义");
	});
});

describe("parseAiDictionaryResult fallbacks and rejection", () => {
	it("turns non-JSON Chinese prose into the single-list fallback section", () => {
		const result = parseAiDictionaryResult("<b>中文解释</b>", "test", "AI");
		expect(result.sections).toEqual([
			{
				content: { items: ["中文解释"], kind: "list" },
				presentation: "stack",
				title: "释义",
			},
		]);
		expect(result.word).toBe("test");
		expect(result.pronunciations).toEqual([]);
	});

	it.each([
		["plain English", "plain explanation"],
		["whitespace", "   "],
		["an empty string", ""],
	])("rejects %s that carries no Chinese meaning", (_label, text) => {
		expect(() => parseAiDictionaryResult(text, "test", "AI")).toThrow(
			"词典返回了无法识别的数据。",
		);
	});

	it.each([
		["a JSON array", JSON.stringify([{ meaning: "测试" }])],
		["a JSON string", JSON.stringify("测试")],
		["no definitions", JSON.stringify({ word: "test" })],
		["an empty definitions array", JSON.stringify({ definitions: [] })],
		[
			"definitions without Chinese",
			JSON.stringify({ definitions: [{ meaning: "A procedure." }] }),
		],
	])("rejects %s", (_label, text) => {
		expect(() => parseAiDictionaryResult(text, "test", "AI")).toThrow(
			"词典返回了无法识别的数据。",
		);
	});
});

describe("AiDictionarySource", () => {
	it("raises configuration when no engine config id is set", async () => {
		const generate = vi.fn();
		for (const configId of [null, "", "   "]) {
			const source = new AiDictionarySource(configId, null, stubAi(generate));
			await expect(source.lookup({ text: "test" })).rejects.toMatchObject({
				code: "configuration",
			});
		}
		expect(generate).not.toHaveBeenCalled();
	});

	it("sends the query with thinking disabled and JSON mode enabled", async () => {
		const generate = vi.fn(async () => ({
			configId: "cfg",
			model: "model-x",
			text: aiJson(),
		}));
		const source = new AiDictionarySource("cfg", "Engine", stubAi(generate));
		const result = await source.lookup({ text: "test" });

		expect(result.attribution).toContain("Engine");
		expect(result.attribution).toContain("model-x");
		expect(result.sourceId).toBe("ai");
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({
				configId: "cfg",
				jsonMode: true,
				messages: [
					expect.objectContaining({ role: "system" }),
					{ role: "user", text: "test" },
				],
				thinkingEnabled: false,
			}),
		);
	});

	it.each([
		["missing-key", "configuration"],
		["incomplete-response", "invalid-response"],
		["busy", "request"],
	] as const)("maps an AiError(%s) onto %s", async (aiCode, expected) => {
		const error = new AiError(aiCode);
		const source = new AiDictionarySource(
			"cfg",
			"Engine",
			stubAi(async () => {
				throw error;
			}),
		);
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({
			code: expected,
			status: null,
		});
	});

	it.each([
		["server", 502, "server"],
		["rate-limited", 429, "rate-limit"],
		["timeout", null, "network"],
		["cancelled", null, "request"],
	] as const)("maps a TransportError(%s) onto %s", async (transportCode, status, expected) => {
		const source = new AiDictionarySource(
			"cfg",
			"Engine",
			stubAi(async () => {
				throw new TransportError(transportCode, { httpStatus: status });
			}),
		);
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({
			code: expected,
			status,
		});
	});

	it("maps a non-AiError failure onto the request code", async () => {
		const source = new AiDictionarySource(
			"cfg",
			"Engine",
			stubAi(async () => {
				throw new TypeError("boom");
			}),
		);
		await expect(source.lookup({ text: "test" })).rejects.toMatchObject({ code: "request" });
	});
});
