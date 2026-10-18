import { describe, expect, it } from "vite-plus/test";
import {
	appendDictionaryFavorite,
	createMemoryDictionaryFavoriteStore,
	dictionaryFavoriteSuggestions,
	findDictionaryFavorite,
	formatDictionaryFavorite,
	parseDictionaryFavorites,
	upsertDictionaryFavorite,
} from "../favorite-file";
import { DICTIONARY_FAVORITE_SUGGESTION_LIMIT } from "../favorite-limits";
import { parseFavoriteAiDraft } from "../favorite-ai";

describe("generated favorite Markdown", () => {
	it("round trips the generated draft and replaces an existing favorite", () => {
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
		const content = upsertDictionaryFavorite("intro\n" + old, {
			word: "exchange",
			path: "word.md",
			...draft,
		});
		expect(content).toBe("intro\n" + block);
		expect(parseDictionaryFavorites(content)).toHaveLength(1);
		expect(findDictionaryFavorite(content, "EXCHANGE")).toEqual({ word: "exchange", ...draft });
	});
});

function entry(word: string, meaning = "释义", note = "笔记") {
	return { word, meaning, note, path: "word.md" };
}

describe("favorite overwrite and targeted deduplication", () => {
	it.each([";;", " ;; ", "\t;;\t"])(
		"does not cross a %j card terminator followed by padded separators",
		(terminator) => {
			const source = `## apple\n??\nold\n${terminator}\n\n## banana\n  ??\t\nbanana meaning\n::\nbanana note\n;;\n`;
			expect(parseDictionaryFavorites(source)).toEqual([
				{ word: "banana", meaning: "banana meaning", note: "banana note" },
			]);
			expect(upsertDictionaryFavorite(source, entry("apple", "new"))).toBe(
				appendDictionaryFavorite(source, formatDictionaryFavorite(entry("apple", "new"))),
			);
		},
	);
	it.each([";;", " ;; ", "\t;;\t"])(
		"preserves trailing prose beyond the note's %j terminator",
		(terminator) => {
			const suffix = "\n个人正文\n;;\n";
			const source = `## apple\n??\nold\n::\nold note\n${terminator}\n${suffix}`;
			expect(upsertDictionaryFavorite(source, entry("apple", "new", "new note"))).toBe(
				formatDictionaryFavorite(entry("apple", "new", "new note")) + suffix,
			);
		},
	);
	it("retains the last duplicate's place and leaves other duplicates and prose untouched", () => {
		const apple = formatDictionaryFavorite(entry("apple", "first"));
		const banana = formatDictionaryFavorite(entry("banana"));
		const last = formatDictionaryFavorite(entry("APPLE", "last"));
		const prefix = "---\naliases: [words]\n---\n\n介绍\n";
		const between = "\n个人注释\n\n";
		const suffix = "\n结尾内容，不是收藏\n";
		const source = prefix + apple + banana + banana + between + last + suffix;
		const next = upsertDictionaryFavorite(source, entry(" apple ", "new", "new note"));
		expect(next).toBe(
			prefix +
				banana +
				banana +
				between +
				formatDictionaryFavorite(entry("apple", "new", "new note")) +
				suffix,
		);
		expect(parseDictionaryFavorites(next).map((favorite) => favorite.word)).toEqual([
			"banana",
			"banana",
			"apple",
		]);
	});
	it("treats repeated phrase whitespace consistently with lookup and keeps different forms distinct", () => {
		const running = formatDictionaryFavorite(entry("running"));
		const run = formatDictionaryFavorite(entry("run"));
		const phrase = formatDictionaryFavorite(entry("look up"));
		const source = running + run + phrase;
		const next = upsertDictionaryFavorite(source, entry(" LOOK   UP ", "new"));
		expect(next).toBe(running + run + formatDictionaryFavorite(entry("LOOK UP", "new")));
		expect(findDictionaryFavorite(next, "look\tup")?.meaning).toBe("new");
	});
	it("supports clearing both fields rather than retaining old values", () => {
		const next = upsertDictionaryFavorite(
			formatDictionaryFavorite(entry("apple")),
			entry("apple", "", ""),
		);
		expect(parseDictionaryFavorites(next)).toEqual([{ word: "apple", meaning: "", note: "" }]);
	});
	it("does not consume a different favorite following a card without a note separator", () => {
		const old = "## apple\n??\nold\n;;\n\n";
		const banana = formatDictionaryFavorite(entry("banana"));
		const source = old + banana;
		expect(parseDictionaryFavorites(source)).toEqual([
			{ word: "banana", meaning: "释义", note: "笔记" },
		]);
		expect(upsertDictionaryFavorite(source, entry("apple", "new"))).toBe(
			appendDictionaryFavorite(source, formatDictionaryFavorite(entry("apple", "new"))),
		);
		expect(findDictionaryFavorite(source, "banana")?.word).toBe("banana");
	});
	it.each(["\n", "\r\n", "\r"])(
		"preserves %j line endings outside and inside the replaced block",
		(newline) => {
			const block = formatDictionaryFavorite(entry("apple")).replaceAll("\n", newline);
			const prefix = `介绍${newline}${newline}`;
			const suffix = `${newline}结尾${newline}`;
			const next = upsertDictionaryFavorite(
				prefix + block + suffix,
				entry("apple", "updated"),
			);
			expect(next).toBe(
				prefix +
					formatDictionaryFavorite(entry("apple", "updated")).replaceAll("\n", newline) +
					suffix,
			);
		},
	);
	it("keeps an EOF block without a trailing newline", () => {
		const source = formatDictionaryFavorite(entry("apple")).trimEnd();
		expect(upsertDictionaryFavorite(source, entry("apple", "new"))).toBe(
			formatDictionaryFavorite(entry("apple", "new")).trimEnd(),
		);
	});
	it("appends a new word and never renames or deletes the previous word", () => {
		const source = formatDictionaryFavorite(entry("apple"));
		const next = upsertDictionaryFavorite(source, entry("banana"));
		expect(next).toBe(
			appendDictionaryFavorite(source, formatDictionaryFavorite(entry("banana"))),
		);
		expect(parseDictionaryFavorites(next).map((favorite) => favorite.word)).toEqual([
			"apple",
			"banana",
		]);
	});
});

describe("favorite path suggestions", () => {
	const savedPath = "1-English/Grammar/从句/word.md";
	/** Hidden notes that sort before `1-English` in a real vault. */
	const hiddenNotes = Array.from(
		{ length: 320 },
		(_, index) => `.agents/note-${String(index).padStart(3, "0")}.md`,
	);
	const vaultPaths = [
		...hiddenNotes,
		"1-English/Article/3.An Interesting Festival.md",
		"1-English/Grammar/从句/word.md",
		"1-English/Grammar/时态.md",
		"2-Programming/TypeScript.md",
	];

	it("keeps every path under the typed folder instead of truncating the sorted vault list", () => {
		expect(dictionaryFavoriteSuggestions(savedPath, vaultPaths, "1-English")).toEqual([
			savedPath,
			"1-English/Article/3.An Interesting Festival.md",
			"1-English/Grammar/时态.md",
		]);
	});

	it("normalizes separators and matches case-insensitively", () => {
		expect(dictionaryFavoriteSuggestions("word.md", vaultPaths, "1-ENGLISH\\")).toEqual([
			"1-English/Article/3.An Interesting Festival.md",
			"1-English/Grammar/从句/word.md",
			"1-English/Grammar/时态.md",
		]);
	});

	it("does not append a markdown extension to the typed query", () => {
		expect(
			dictionaryFavoriteSuggestions("word.md", vaultPaths, "1-English/Grammar/时"),
		).toEqual(["1-English/Grammar/时态.md"]);
	});

	it("ranks prefix matches above paths that only contain the typed text", () => {
		expect(
			dictionaryFavoriteSuggestions(
				"word.md",
				["archive/1-English/old.md", "1-English/note.md"],
				"1-English",
			),
		).toEqual(["1-English/note.md", "archive/1-English/old.md"]);
	});

	it("applies the limit after matching so typed folders stay complete", () => {
		const paths = Array.from(
			{ length: DICTIONARY_FAVORITE_SUGGESTION_LIMIT + 20 },
			(_, index) => `1-English/${String(index).padStart(3, "0")}.md`,
		);
		const suggestions = dictionaryFavoriteSuggestions("word.md", paths, "1-English");
		expect(suggestions).toHaveLength(DICTIONARY_FAVORITE_SUGGESTION_LIMIT);
		expect(suggestions[0]).toBe("1-English/000.md");
	});

	it("pins the committed path and word.md when nothing is typed", () => {
		const suggestions = dictionaryFavoriteSuggestions(savedPath, vaultPaths);
		expect(suggestions.slice(0, 2)).toEqual([savedPath, "word.md"]);
		expect(suggestions).toHaveLength(DICTIONARY_FAVORITE_SUGGESTION_LIMIT);
	});
});

describe("memory favorite store", () => {
	it("matches suggestions against the typed query", () => {
		const store = createMemoryDictionaryFavoriteStore({
			"1-English/Grammar/word.md": "",
			"2-Programming/TypeScript.md": "",
		});
		expect(store.suggestions("word.md", "1-English")).toEqual(["1-English/Grammar/word.md"]);
	});
	it("saves, finds, and opens favorite entries purely in memory", async () => {
		const store = createMemoryDictionaryFavoriteStore();
		expect(store.suggestions("word.md")).toEqual(["word.md"]);
		expect(await store.open("word.md")).toBe(false);
		expect(await store.find("word.md", "apple")).toBeNull();

		const savedPath = await store.save(entry("apple", "苹果", "好吃的苹果"));
		expect(savedPath).toBe("word.md");
		expect(await store.open("word.md")).toBe(true);

		const found = await store.find("word.md", " APPLE ");
		expect(found).toEqual({
			word: "apple",
			meaning: "苹果",
			note: "好吃的苹果",
			path: "word.md",
		});

		// Update same word
		await store.save(entry("apple", "新释义", "新笔记"));
		const updated = await store.find("word.md", "apple");
		expect(updated?.meaning).toBe("新释义");
		expect(updated?.note).toBe("新笔记");
	});
});
