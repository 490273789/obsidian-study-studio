import { describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { createEmptyCard } from "ts-fsrs";
import { ObsidianDictionaryFavoriteStore } from "../../../features/dictionary/obsidian/favoriteStore";
import { parseFlashcards } from "../../../features/flashcards/domain/cards/parser";
import { formatCardIdentityMarker } from "../../../features/flashcards/domain/cards/cardFormat";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
} from "../../../features/flashcards/domain/identity/cardIdentityContinuity";

vi.mock("obsidian", () => ({
	TFile: class {},
	normalizePath: (path: string) => path,
}));

describe("batch favorite persistence across dictionary and card identity", () => {
	it("adds to a managed deck without changing existing identity, progress, or outside text", async () => {
		const existingId = "550e8400-e29b-41d4-a716-446655440000";
		const addedId = "7d444840-9dc0-11d1-b245-5ffdce74fad2";
		const original =
			`#deck\r\n\r\n${formatCardIdentityMarker(existingId)}\r\n` +
			"## apple\r\n??\r\n苹果\r\n::\r\n旧笔记\r\n;;\r\n\r\n尾部正文\r\n";
		let content = original;
		let state: CardIdentityContinuityState = {
			configuredTags: ["#deck"],
			decks: new Map([
				[
					"word.md",
					{
						id: "word.md",
						filePath: "word.md",
						name: "word",
						tag: "#deck",
						studyCount: 4,
						lastStudied: null,
						cards: parseFlashcards(original, "word.md").map((card) => ({
							...card,
							fsrsCard: { ...createEmptyCard(), reps: 5 },
						})),
					},
				],
			]),
			continuity: { sources: {}, issues: [], journal: null },
		};
		const document = () => ({ path: "word.md", basename: "word", content });
		const continuity = createCardIdentityContinuity({
			sources: {
				list: async () => [document()],
				read: async () => document(),
				replaceIfUnchanged: async (_path, expected, next) => {
					if (content !== expected) return "stale" as const;
					content = next;
					return "written" as const;
				},
			},
			state: {
				load: async () => state,
				commit: async (next) => {
					state = next;
				},
			},
			createIdentity: () => addedId,
		});
		const file = Object.assign(new TFile(), { path: "word.md", extension: "md" });
		const process = vi.fn();
		const app = {
			vault: {
				getFileByPath: () => file,
				read: async () => content,
				process,
			},
		} as unknown as App;
		const favorite = new ObsidianDictionaryFavoriteStore(app, continuity.sourceEdits);

		await expect(favorite.inspect("word.md")).resolves.toEqual(["apple"]);
		await expect(
			favorite.saveNew({ path: "word.md", word: "banana", meaning: "香蕉", note: "新笔记" }),
		).resolves.toBe("saved");
		expect(process).not.toHaveBeenCalled();
		expect(content.startsWith("#deck\r\n\r\n")).toBe(true);
		expect(content.endsWith("\r\n尾部正文\r\n")).toBe(true);
		expect(content).toContain(`${formatCardIdentityMarker(existingId)}\r\n## apple`);
		expect(content).toContain(`${formatCardIdentityMarker(addedId)}\r\n## banana`);
		expect(state.decks.get("word.md")?.cards).toMatchObject([
			{ id: existingId, fsrsCard: { reps: 5 } },
			{ id: addedId, fsrsCard: { reps: 0 } },
		]);
	});
});
