import { describe, expect, it, vi } from "vitest";
import {
	appendDictionaryFavorite,
	findDictionaryFavorite,
	formatDictionaryFavorite,
	parseDictionaryFavorites,
} from "../favorite-file";
import { parseFavoriteAiDraft } from "../favorite-ai";
vi.mock("obsidian", () => ({
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) => path,
}));

describe("generated favorite Markdown", () => {
	it("round trips the generated block and continues to append duplicate words", () => {
		const draft = parseFavoriteAiDraft(
			JSON.stringify({
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
			}),
			"exchange",
		);
		const block = formatDictionaryFavorite({ word: "exchange", path: "word.md", ...draft });
		expect(block).toBe(
			"## exchange\n??\nn. 交换；交流\nvt. 交换；兑换\n::\n/ɪksˈtʃeɪndʒ/\n\nWe exchanged ideas after the meeting.\n会议结束后我们交流了想法。\n;;\n",
		);
		const old = formatDictionaryFavorite({
			word: "exchange",
			path: "word.md",
			meaning: "旧释义",
			note: "旧笔记",
		});
		const content = appendDictionaryFavorite("intro\n" + old, block);
		expect(content.startsWith("intro\n" + old)).toBe(true);
		expect(parseDictionaryFavorites(content)).toHaveLength(2);
		expect(findDictionaryFavorite(content, "EXCHANGE")).toEqual({ word: "exchange", ...draft });
	});
});
