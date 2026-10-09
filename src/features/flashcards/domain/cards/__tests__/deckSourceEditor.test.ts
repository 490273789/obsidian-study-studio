import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import { DeckSourceEditException, editDeckSource, validateCardDraft } from "../deckSourceEditor";
import type { Deck, FlashCard } from "../../../../../core/shared/types";

function makeDeck(cardCount: number): Deck {
	return {
		id: "notes/deck.md",
		name: "deck",
		filePath: "notes/deck.md",
		tag: "#单词",
		cards: Array.from({ length: cardCount }, (_, index) => makeCard(index)),
		studyCount: 0,
		lastStudied: null,
	};
}

function makeCard(index: number): FlashCard {
	return {
		id: `notes/deck.md::${index}`,
		front: `front ${index}`,
		back: `back ${index}`,
		fsrsCard: createEmptyCard(),
		sourceFile: "notes/deck.md",
		indexInFile: index,
	};
}

const threeCardSource = `#单词

苹果
??
apple
;;

香蕉
??
banana
::
黄色水果
;;

梨
??
pear
;;`;

const stableCards = [
	"550e8400-e29b-41d4-a716-446655440000",
	"7d444840-9dc0-11d1-b245-5ffdce74fad2",
	"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
] as const;

function makeStableDeck(): Deck {
	return {
		...makeDeck(3),
		cards: stableCards.map((id, index) => ({ ...makeCard(index), id })),
	};
}

const stableThreeCardSource = `#单词

<!-- wsr-card-id: 550e8400-e29b-41d4-a716-446655440000 -->
苹果
??
apple
;;

<!-- wsr-card-id: 7d444840-9dc0-11d1-b245-5ffdce74fad2 -->
香蕉
??
banana
::
黄色水果
;;

<!-- wsr-card-id: 6ba7b810-9dad-11d1-80b4-00c04fd430c8 -->
梨
??
pear
;;`;

describe("editDeckSource", () => {
	it("preserves stable identities when updating and deleting cards", () => {
		const updated = editDeckSource(stableThreeCardSource, makeStableDeck(), {
			type: "update",
			cardId: stableCards[0],
			front: "苹果 updated",
			back: "apple updated",
		});

		expect(updated.nextContent).toContain(
			`<!-- wsr-card-id: ${stableCards[0]} -->\n苹果 updated\n??\napple updated`,
		);

		const deleted = editDeckSource(stableThreeCardSource, makeStableDeck(), {
			type: "delete",
			cardId: stableCards[1],
		});

		expect(deleted.nextContent).not.toContain(stableCards[1]);
		expect(deleted.nextContent).toContain(stableCards[2]);
	});

	it("writes the supplied stable identity when adding a card", () => {
		const newIdentity = "16fd2706-8baf-433b-82eb-8c7fada847da";
		const result = editDeckSource(stableThreeCardSource, makeStableDeck(), {
			type: "add",
			cardId: newIdentity,
			front: "葡萄",
			back: "grape",
		});

		expect(result.newCardId).toBe(newIdentity);
		expect(result.nextContent).toContain(
			`<!-- wsr-card-id: ${newIdentity} -->\n葡萄\n??\ngrape\n;;`,
		);
	});

	it("appends new cards to the end and returns the new card id", () => {
		const result = editDeckSource(threeCardSource, makeDeck(3), {
			type: "add",
			front: " 葡萄 ",
			back: " grape ",
			explanation: " fruit ",
		});

		expect(result.newCardId).toBe("notes/deck.md::3");
		expect(result.nextContent).toBe(`${threeCardSource}

葡萄
??
grape
::
fruit
;;
`);
	});

	it("updates a card block while preserving the first tag prefix", () => {
		const result = editDeckSource(threeCardSource, makeDeck(3), {
			type: "update",
			cardId: "notes/deck.md::0",
			front: "苹果 updated",
			back: "apple updated",
		});

		expect(result.nextContent).toBe(`#单词

苹果 updated
??
apple updated
;;

香蕉
??
banana
::
黄色水果
;;

梨
??
pear
;;`);
	});

	it("deletes a middle card without exposing identity remaps", () => {
		const result = editDeckSource(threeCardSource, makeDeck(3), {
			type: "delete",
			cardId: "notes/deck.md::1",
		});

		expect(result.nextContent).toBe(`#单词

苹果
??
apple
;;

梨
??
pear
;;`);
	});

	it("keeps the source tag when deleting the first card", () => {
		const result = editDeckSource(threeCardSource, makeDeck(3), {
			type: "delete",
			cardId: "notes/deck.md::0",
		});

		expect(result.nextContent.startsWith("#单词\n")).toBe(true);
		expect(result.nextContent).toContain("香蕉\n??\nbanana");
		expect(result.nextContent).not.toContain("苹果\n??\napple");
	});

	it("throws structured validation errors before editing the source", () => {
		expect(() =>
			editDeckSource(threeCardSource, makeDeck(3), {
				type: "add",
				front: "valid",
				back: "::",
			}),
		).toThrowError(DeckSourceEditException);

		try {
			editDeckSource(threeCardSource, makeDeck(3), {
				type: "add",
				front: "valid",
				back: "::",
			});
		} catch (error) {
			expect(error).toMatchObject({
				editError: { type: "reserved-marker", marker: "::" },
			});
		}
	});

	it("throws structured errors for missing cards and invalid source blocks", () => {
		expect(() =>
			editDeckSource(threeCardSource, makeDeck(3), {
				type: "delete",
				cardId: "notes/deck.md::99",
			}),
		).toThrowError(DeckSourceEditException);

		try {
			editDeckSource("#单词\ninvalid\n;;", makeDeck(1), {
				type: "update",
				cardId: "notes/deck.md::0",
				front: "front",
				back: "back",
			});
		} catch (error) {
			expect(error).toMatchObject({
				editError: { type: "source-file-invalid" },
			});
		}
	});

	describe("validateCardDraft", () => {
		it("returns missing-front for empty front content", () => {
			expect(validateCardDraft("", "back")).toEqual({ type: "missing-front" });
			expect(validateCardDraft("   ", "back")).toEqual({ type: "missing-front" });
		});

		it("returns missing-back for empty back content", () => {
			expect(validateCardDraft("front", "")).toEqual({ type: "missing-back" });
			expect(validateCardDraft("front", "  \n  ")).toEqual({ type: "missing-back" });
		});

		it("returns reserved-marker when content contains separator lines", () => {
			expect(validateCardDraft("front\n;;", "back")).toEqual({
				type: "reserved-marker",
				marker: ";;",
			});
			expect(validateCardDraft("front", "back\n??")).toEqual({
				type: "reserved-marker",
				marker: "??",
			});
			expect(validateCardDraft("front", "back", "exp\n::")).toEqual({
				type: "reserved-marker",
				marker: "::",
			});
		});

		it("returns null for valid card draft", () => {
			expect(
				validateCardDraft("Valid Front", "Valid Back", "Optional Explanation"),
			).toBeNull();
		});
	});
});
