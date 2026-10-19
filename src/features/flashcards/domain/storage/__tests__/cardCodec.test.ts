import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import { CardCodec } from "../cardCodec";
import type { SerializedCard, SerializedFSRSCard } from "../persistenceTypes";

function makeDeck(): Deck {
	return {
		id: "notes/words.md",
		name: "Words",
		filePath: "notes/words.md",
		tag: "#word",
		studyCount: 3,
		lastStudied: "2026-03-01T00:00:00.000Z",
		cards: [
			{
				id: "card-1",
				front: "apple",
				back: "苹果",
				explanation: "  a fruit  ",
				fsrsCard: {
					...createEmptyCard(new Date("2026-10-13T00:00:00.000Z")),
					state: State.Review,
					reps: 2,
				},
				sourceFile: "notes/words.md",
				indexInFile: 0,
			},
		],
	};
}

describe("CardCodec", () => {
	it("round-trips a deck, its cards, and their FSRS state", () => {
		const codec = new CardCodec();
		const serialized = codec.deck(makeDeck());
		const serializedCard = serialized.cards[0]!;

		expect(serializedCard.fsrsCard.due).toBe("2026-10-13T00:00:00.000Z");
		expect(serializedCard.fsrsCard.learning_steps).toBe(0);
		expect(serializedCard.fsrsCard.last_review).toBeNull();

		const decoded = codec.decodeDeck(serialized);
		const decodedCard = decoded.cards[0]!;

		expect(decoded.studyCount).toBe(3);
		expect(decodedCard.front).toBe("apple");
		expect(decodedCard.back).toBe("苹果");
		expect(decodedCard.explanation).toBe("a fruit");
		expect(decodedCard.fsrsCard.due).toEqual(new Date("2026-10-13T00:00:00.000Z"));
		expect(decodedCard.fsrsCard.state).toBe(State.Review);
		expect(decodedCard.fsrsCard.reps).toBe(2);
		expect(decodedCard.fsrsCard.last_review).toBeUndefined();
	});

	it("memoizes serialized values by object identity and drops them on reset", () => {
		const codec = new CardCodec();
		const deck = makeDeck();
		const first = codec.deck(deck);
		const card = deck.cards[0]!;
		const serializedCard = codec.card(card);
		const serializedFsrsCard = codec.fsrsCard(card.fsrsCard);

		expect(codec.deck(deck)).toBe(first);
		expect(codec.card(card)).toBe(serializedCard);
		expect(codec.fsrsCard(card.fsrsCard)).toBe(serializedFsrsCard);
		expect(codec.deck({ ...deck, name: "Renamed" })).not.toBe(first);

		codec.reset();

		expect(codec.deck(deck)).not.toBe(first);
		expect(codec.card(card)).not.toBe(serializedCard);
		expect(codec.fsrsCard(card.fsrsCard)).not.toBe(serializedFsrsCard);
	});

	it("decodes legacy question/answer cards", () => {
		const codec = new CardCodec();
		const serialized = codec.card(makeDeck().cards[0]!) as SerializedCard & {
			question?: string;
			answer?: string;
		};
		const legacy: SerializedCard & { question?: string; answer?: string } = {
			...serialized,
			front: undefined as unknown as string,
			back: undefined as unknown as string,
			question: "legacy front",
			answer: "legacy back",
		};
		const fsrsCard = codec.decodeFsrsCard(
			(legacy as unknown as { fsrsCard: SerializedFSRSCard }).fsrsCard,
		);

		const decoded = codec.decodeCard(legacy);

		expect(decoded.front).toBe("legacy front");
		expect(decoded.back).toBe("legacy back");
		expect(decoded.fsrsCard.due).toEqual(fsrsCard.due);
	});
});
