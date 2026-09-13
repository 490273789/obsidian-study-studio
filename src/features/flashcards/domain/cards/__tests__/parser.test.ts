import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";
import {
	extractFirstTag,
	findAllFlashcardTags,
	parseFileIntoDeck,
	parseFlashcards,
	scanFilesWithTag,
} from "../parser";
import type { Deck, FlashCard } from "../../../../../core/shared/types";

function getOnlyCard(cards: FlashCard[]): FlashCard {
	expect(cards).toHaveLength(1);

	const card = cards[0];
	if (!card) {
		throw new Error("Expected parsed card");
	}

	return card;
}

describe("extractFirstTag", () => {
	it("extracts the first flashcard tag including Chinese characters", () => {
		const tag = extractFirstTag("\n  #单词\n#other\ncontent");

		expect(tag).toBe("#单词");
	});

	it("ignores inline hash text that is not a line tag", () => {
		const tag = extractFirstTag("front text #单词\n内容");

		expect(tag).toBeNull();
	});
});

describe("parseFlashcards", () => {
	it("uses the source marker as card identity and preserves state after reordering", () => {
		const appleState = createEmptyCard();
		appleState.reps = 7;
		const bananaState = createEmptyCard();
		bananaState.reps = 3;
		const existingCards = new Map<string, FlashCard>([
			[
				"550e8400-e29b-41d4-a716-446655440000",
				{
					id: "550e8400-e29b-41d4-a716-446655440000",
					front: "苹果",
					back: "apple",
					fsrsCard: appleState,
					sourceFile: "notes/vocab.md",
					indexInFile: 0,
				},
			],
			[
				"7d444840-9dc0-11d1-b245-5ffdce74fad2",
				{
					id: "7d444840-9dc0-11d1-b245-5ffdce74fad2",
					front: "香蕉",
					back: "banana",
					fsrsCard: bananaState,
					sourceFile: "notes/vocab.md",
					indexInFile: 1,
				},
			],
		]);

		const cards = parseFlashcards(
			`#单词
<!-- wsr-card-id: 7d444840-9dc0-11d1-b245-5ffdce74fad2 -->
香蕉 updated
??
banana
;;

<!-- wsr-card-id: 550e8400-e29b-41d4-a716-446655440000 -->
苹果
??
apple
;;`,
			"notes/vocab.md",
			existingCards,
		);

		expect(cards.map((card) => card.id)).toEqual([
			"7d444840-9dc0-11d1-b245-5ffdce74fad2",
			"550e8400-e29b-41d4-a716-446655440000",
		]);
		expect(cards[0]?.fsrsCard).toBe(bananaState);
		expect(cards[0]?.front).toBe("香蕉 updated");
		expect(cards[1]?.fsrsCard).toBe(appleState);
	});

	it("parses cards with front, back, explanation, and stable source metadata", () => {
		const cards = parseFlashcards(
			`#单词
苹果
??
apple
::
一种水果
;;

香蕉
??
banana
;;`,
			"notes/vocab.md",
		);

		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			id: "notes/vocab.md::0",
			front: "苹果",
			back: "apple",
			explanation: "一种水果",
			sourceFile: "notes/vocab.md",
			indexInFile: 0,
		});
		expect(cards[1]).toMatchObject({
			id: "notes/vocab.md::1",
			front: "香蕉",
			back: "banana",
			sourceFile: "notes/vocab.md",
			indexInFile: 1,
		});
		expect(cards[1]?.explanation).toBeUndefined();
	});

	it("preserves existing FSRS state by stable card id", () => {
		const fsrsCard = createEmptyCard();
		const existingCard: FlashCard = {
			id: "notes/vocab.md::0",
			front: "旧问题",
			back: "old answer",
			fsrsCard,
			sourceFile: "notes/vocab.md",
			indexInFile: 0,
		};

		const card = getOnlyCard(
			parseFlashcards(
				`#单词
新问题
??
new answer
;;`,
				"notes/vocab.md",
				new Map([[existingCard.id, existingCard]]),
			),
		);

		expect(card.fsrsCard).toBe(fsrsCard);
		expect(card.front).toBe("新问题");
		expect(card.back).toBe("new answer");
	});

	it("requires markers to be on their own lines and keeps inline marker text", () => {
		const card = getOnlyCard(
			parseFlashcards(
				`#单词
What does ?? mean inline?
??
Use :: inline as plain answer text.
;;
`,
				"notes/markers.md",
			),
		);

		expect(card.front).toBe("What does ?? mean inline?");
		expect(card.back).toBe("Use :: inline as plain answer text.");
	});

	it("skips incomplete blocks and assigns ids by valid card order", () => {
		const cards = parseFlashcards(
			`#单词
missing back
??
;;

valid front
??
valid back
;;`,
			"notes/mixed.md",
		);

		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: "notes/mixed.md::0",
			indexInFile: 0,
			front: "valid front",
			back: "valid back",
		});
	});
});

describe("parseFileIntoDeck", () => {
	it("builds a deck from preloaded content without reading the vault again", async () => {
		const vault = {
			cachedRead: vi.fn(),
		};
		const file = {
			path: "notes/vocab.md",
			basename: "vocab",
		};

		const deck = await parseFileIntoDeck(
			file as never,
			vault as never,
			{
				id: file.path,
				name: "old name",
				filePath: file.path,
				tag: "#单词",
				cards: [],
				studyCount: 7,
				lastStudied: "2026-06-01T00:00:00.000Z",
			},
			`#单词
苹果
??
apple
;;`,
		);

		expect(vault.cachedRead).not.toHaveBeenCalled();
		expect(deck).toMatchObject({
			id: "notes/vocab.md",
			name: "vocab",
			filePath: "notes/vocab.md",
			tag: "#单词",
			studyCount: 7,
			lastStudied: "2026-06-01T00:00:00.000Z",
		});
		expect(deck?.cards).toHaveLength(1);
	});

	it("returns null for files without valid cards", async () => {
		const vault = {
			cachedRead: vi.fn().mockResolvedValue("#单词\n只有标签"),
		};
		const file = {
			path: "notes/empty.md",
			basename: "empty",
		};

		await expect(parseFileIntoDeck(file as never, vault as never)).resolves.toBeNull();
	});
});

describe("scanFilesWithTag", () => {
	it("matches tags case-insensitively and preserves existing card state", async () => {
		const existingFsrsCard = createEmptyCard();
		const existingDeck: Deck = {
			id: "notes/one.md",
			name: "one",
			filePath: "notes/one.md",
			tag: "#Word",
			cards: [
				{
					id: "notes/one.md::0",
					front: "old",
					back: "old",
					fsrsCard: existingFsrsCard,
					sourceFile: "notes/one.md",
					indexInFile: 0,
				},
			],
			studyCount: 3,
			lastStudied: null,
		};
		const files = [
			{ path: "notes/one.md", basename: "one" },
			{ path: "notes/two.md", basename: "two" },
		];
		const contentByPath = new Map([
			[
				"notes/one.md",
				`#Word
front
??
back
;;`,
			],
			[
				"notes/two.md",
				`#other
front
??
back
;;`,
			],
		]);
		const vault = {
			getMarkdownFiles: () => files,
			cachedRead: vi.fn((file: { path: string }) =>
				Promise.resolve(contentByPath.get(file.path)),
			),
		};

		const decks = await scanFilesWithTag(
			vault as never,
			"#word",
			new Map([[existingDeck.id, existingDeck]]),
		);

		expect(decks).toHaveLength(1);
		expect(vault.cachedRead).toHaveBeenCalledTimes(files.length);
		expect(decks[0]?.cards[0]?.fsrsCard).toBe(existingFsrsCard);
		expect(decks[0]?.studyCount).toBe(3);
	});
});

describe("findAllFlashcardTags", () => {
	it("returns unique tags only for files with flashcard syntax", async () => {
		const files = [
			{ path: "notes/one.md" },
			{ path: "notes/two.md" },
			{ path: "notes/three.md" },
		];
		const contentByPath = new Map([
			[
				"notes/one.md",
				`#单词
front
??
back
;;`,
			],
			["notes/two.md", "#单词\n只有普通笔记"],
			[
				"notes/three.md",
				`#短语
front
??
back
;;`,
			],
		]);
		const vault = {
			getMarkdownFiles: () => files,
			cachedRead: vi.fn((file: { path: string }) =>
				Promise.resolve(contentByPath.get(file.path)),
			),
		};

		const tags = await findAllFlashcardTags(vault as never);

		expect(tags).toEqual(["#单词", "#短语"]);
	});
});
