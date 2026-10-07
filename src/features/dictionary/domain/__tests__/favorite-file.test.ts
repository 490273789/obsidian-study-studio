import { describe, expect, it, vi } from "vitest";
import {
	appendDictionaryFavorite,
	findDictionaryFavorite,
	formatDictionaryFavorite,
	parseDictionaryFavorites,
	upsertDictionaryFavorite,
	DictionaryFavoriteFile,
} from "../favorite-file";
import { FavoriteSaveError } from "../favorite-save-error";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type {
	CardSourceMutation,
	CardSourcePreparation,
} from "../../../../core/shared/cardSourceMutation";
import { parseFavoriteAiDraft } from "../favorite-ai";
vi.mock("obsidian", () => ({
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) => path,
}));

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

function fileSetup(source: string, preparation: CardSourcePreparation = { kind: "unmanaged" }) {
	const file = Object.assign(new TFile(), { path: "word.md" });
	let content = source;
	const process = vi.fn(async (_file, update: (current: string) => string) => {
		content = update(content);
	});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => content),
			process,
			create: vi.fn(),
		},
	} as unknown as App;
	const sourceEdits = {
		prepare: vi.fn(async () => preparation),
		change: vi.fn<CardSourceMutation["change"]>(async () => ({ kind: "applied" })),
	} satisfies CardSourceMutation;
	return {
		app,
		process,
		sourceEdits,
		favorite: new DictionaryFavoriteFile(app, sourceEdits),
		content: () => content,
		replace: (next: string) => {
			content = next;
		},
	};
}

describe("favorite file persistence", () => {
	it("passes the complete note to card validation instead of truncating it at a reserved marker", async () => {
		const source = formatDictionaryFavorite(entry("apple"));
		const setup = fileSetup(source, {
			kind: "ready",
			cards: [{ identity: "last", front: "## apple", back: "释义", explanation: "笔记" }],
		});
		setup.sourceEdits.change.mockResolvedValueOnce({
			kind: "validation-failed",
			error: { type: "reserved-marker", marker: ";;" },
		});
		await expect(
			setup.favorite.save(entry("apple", "new", "before\n;;\nafter")),
		).rejects.toMatchObject({ reason: "invalid-card-content" });
		expect(setup.sourceEdits.change.mock.calls[0]?.[0].changes[0]).toEqual({
			kind: "edit",
			identity: "last",
			content: { front: "## apple", back: "new", explanation: "before\n;;\nafter" },
		});
		expect(setup.content()).toBe(source);
		expect(setup.process).not.toHaveBeenCalled();
	});
	it("writes only the selected target using an authoritative snapshot", async () => {
		const original = formatDictionaryFavorite(entry("apple"));
		const setup = fileSetup(original);
		await expect(setup.favorite.save(entry("APPLE", "new"))).resolves.toBe("word.md");
		expect(setup.sourceEdits.prepare).toHaveBeenCalledWith("word.md", original);
		expect(setup.content()).toBe(formatDictionaryFavorite(entry("APPLE", "new")));
		expect(setup.sourceEdits.change).not.toHaveBeenCalled();
	});
	it("does not overwrite edits arriving after source preparation", async () => {
		const setup = fileSetup(formatDictionaryFavorite(entry("apple")));
		setup.sourceEdits.prepare.mockImplementationOnce(async () => {
			setup.replace("externally changed");
			return { kind: "unmanaged" };
		});
		await expect(setup.favorite.save(entry("apple", "new"))).rejects.toMatchObject({
			reason: "source-changing",
		});
		expect(setup.content()).toBe("externally changed");
	});
	it.each(["migration-required", "source-needs-repair"] as const)(
		"blocks %s without changing the file",
		async (reason) => {
			const source = formatDictionaryFavorite(entry("apple"));
			const setup = fileSetup(source, { kind: "blocked", reason });
			await expect(setup.favorite.save(entry("apple", "new"))).rejects.toEqual(
				new FavoriteSaveError(reason),
			);
			expect(setup.process).not.toHaveBeenCalled();
			expect(setup.sourceEdits.change).not.toHaveBeenCalled();
			expect(setup.content()).toBe(source);
		},
	);
	it("submits one identity-aware update and deletes only earlier same-word cards", async () => {
		const source =
			formatDictionaryFavorite(entry("apple", "old")) +
			formatDictionaryFavorite(entry("banana")) +
			formatDictionaryFavorite(entry("APPLE", "last"));
		const setup = fileSetup(source, {
			kind: "ready",
			cards: [
				{ identity: "first", front: "## apple", back: "old", explanation: "笔记" },
				{ identity: "other", front: "## banana", back: "释义", explanation: "笔记" },
				{ identity: "last", front: "## APPLE", back: "last", explanation: "笔记" },
			],
		});
		await setup.favorite.save(entry("apple", "new", ""));
		expect(setup.sourceEdits.change).toHaveBeenCalledExactlyOnceWith({
			path: "word.md",
			expectedContent: source,
			changes: [
				{
					kind: "edit",
					identity: "last",
					content: { front: "## apple", back: "new", explanation: "" },
				},
				{ kind: "delete", identity: "first" },
			],
		});
		expect(setup.process).not.toHaveBeenCalled();
	});
	it("adds a new word through the identity owner when the target is a deck", async () => {
		const setup = fileSetup("#deck\n", { kind: "ready", cards: [] });
		await setup.favorite.save(entry("banana"));
		expect(setup.sourceEdits.change).toHaveBeenCalledWith({
			path: "word.md",
			expectedContent: "#deck\n",
			changes: [
				{ kind: "add", content: { front: "## banana", back: "释义", explanation: "笔记" } },
			],
		});
		expect(setup.process).not.toHaveBeenCalled();
	});
});
