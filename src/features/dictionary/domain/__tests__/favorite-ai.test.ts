import { describe, expect, it, vi } from "vitest";
import {
	createFavoriteDraftGenerator,
	isFavoriteAiWord,
	parseFavoriteAiDraft,
} from "../favorite-ai";
import type { AiService } from "../../../../core/ai";

function response(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		definitions: [
			{ partOfSpeech: "n.", meanings: ["交换", "交流"] },
			{ partOfSpeech: "vt.", meanings: ["交换", "兑换"] },
		],
		phonetic: "ɪksˈtʃeɪndʒ",
		morphology: [],
		example: {
			sentence: "We exchanged ideas after the meeting.",
			translation: "会议结束后我们交流了想法。",
		},
		...overrides,
	});
}

describe("favorite AI draft", () => {
	it("formats common meanings and one bilingual example, without an empty morphology block", () => {
		expect(parseFavoriteAiDraft(response(), "exchange")).toEqual({
			meaning: "n. 交换；交流\nvt. 交换；兑换",
			note: "/ɪksˈtʃeɪndʒ/\n\nWe exchanged ideas after the meeting.\n会议结束后我们交流了想法。",
		});
	});
	it("groups repeated parts of speech and formats provided morphology", () => {
		const result = parseFavoriteAiDraft(
			response({
				definitions: [
					{ partOfSpeech: "vt.", meanings: ["交换"] },
					{ partOfSpeech: "vt.", meanings: ["交换", "兑换"] },
				],
				morphology: [
					{
						kind: "prefix",
						form: "re-",
						englishMeaning: "again",
						chineseMeaning: "再次",
					},
					{ kind: "root", form: "play", englishMeaning: "play", chineseMeaning: "播放" },
				],
			}),
			"replay",
		);
		expect(result.meaning).toBe("vt. 交换；兑换");
		expect(result.note).toContain("\n\nprefix: re- = again 再次\nroot: play = play 播放\n\n");
	});
	it.each(["θɪŋk", "ˈθɜrti", "ðɪs", "ˈbʌt̬ɚ", "ˈwɔːtɚ"])("accepts American IPA %s", (phonetic) => {
		expect(parseFavoriteAiDraft(response({ phonetic }), "word").note).toContain(
			`/${phonetic}/`,
		);
	});
	it("accepts words and phrases but never includes morphology for a phrase", () => {
		for (const word of ["take off", "mother-in-law", "don't", "Exchange"])
			expect(isFavoriteAiWord(word)).toBe(true);
		for (const word of ["你好", "word\n;;", "<script>", "123", ""])
			expect(isFavoriteAiWord(word)).toBe(false);
		expect(
			parseFavoriteAiDraft(
				response({
					morphology: [
						{
							kind: "root",
							form: "take",
							englishMeaning: "take",
							chineseMeaning: "拿",
						},
					],
				}),
				"take off",
			).note,
		).not.toContain("root:");
	});
	it.each([
		"not json",
		"{}",
		response({ definitions: [] }),
		response({ phonetic: "" }),
		response({ phonetic: "中文" }),
		response({ example: { sentence: "English sentence.", translation: "" } }),
		response({ example: { sentence: "", translation: "中文" } }),
		response({ definitions: [{ partOfSpeech: "noun", meanings: ["词义"] }] }),
		response({ definitions: [{ partOfSpeech: "n.", meanings: ["English only"] }] }),
		response({ phonetic: "test\n;;" }),
		response({ morphology: [{ kind: "guess" }] }),
		response({ definitions: [{ partOfSpeech: "n.", meanings: ["中".repeat(8001)] }] }),
		response({ example: { sentence: "x".repeat(16001), translation: "中文" } }),
	])("rejects invalid, incomplete, unsafe or oversized responses", (text) => {
		expect(() => parseFavoriteAiDraft(text, "exchange")).toThrow("invalid-response");
	});
	it("sends only the word with an explicit selected configuration and cancellation", async () => {
		const generate = vi.fn(async () => ({ text: response() }));
		const generator = createFavoriteDraftGenerator({ generate } as unknown as Pick<
			AiService,
			"generate"
		>);
		const signal = new AbortController().signal;
		await generator.generate("exchange", "favorite-engine", signal);
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({
				configId: "favorite-engine",
				signal,
				jsonMode: true,
				thinkingEnabled: false,
				messages: [
					expect.objectContaining({ role: "system" }),
					{ role: "user", text: "exchange" },
				],
			}),
		);
		await expect(generator.generate("exchange", "", signal)).rejects.toThrow(
			"config-not-found",
		);
		expect(generate).toHaveBeenCalledTimes(1);
	});
});
