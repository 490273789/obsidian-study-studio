import type { Card } from "ts-fsrs";
import type { Deck, FlashCard } from "../../../../core/shared/types";
import type { SerializedCard, SerializedDeck, SerializedFSRSCard } from "./persistenceTypes";

/**
 * Serializes decks, cards, and FSRS state for journal entries and the
 * rebuildable deck-index cache, and decodes them back.
 *
 * Serialized values are memoized by object identity: an unchanged card keeps one
 * serialized representation across commits. The repository calls `reset()` after
 * a full restore so cached identities from a replaced snapshot cannot leak.
 */
export class CardCodec {
	private decks = new WeakMap<Deck, SerializedDeck>();
	private cards = new WeakMap<FlashCard, SerializedCard>();
	private fsrsCards = new WeakMap<Card, SerializedFSRSCard>();

	deck(deck: Deck): SerializedDeck {
		const cached = this.decks.get(deck);
		if (cached) return cached;
		const serialized: SerializedDeck = {
			...deck,
			cards: deck.cards.map((card) => this.card(card)),
		};
		this.decks.set(deck, serialized);
		return serialized;
	}

	card(card: FlashCard): SerializedCard {
		const cached = this.cards.get(card);
		if (cached) return cached;
		const serialized: SerializedCard = {
			...card,
			fsrsCard: this.fsrsCard(card.fsrsCard),
		};
		this.cards.set(card, serialized);
		return serialized;
	}

	fsrsCard(card: Card): SerializedFSRSCard {
		const cached = this.fsrsCards.get(card);
		if (cached) return cached;
		const { due, last_review, ...serializedCard } = card;
		const serialized: SerializedFSRSCard = {
			...serializedCard,
			due: due instanceof Date ? due.toISOString() : due,
			last_review:
				last_review instanceof Date ? last_review.toISOString() : (last_review ?? null),
			learning_steps: serializedCard.learning_steps ?? 0,
		};
		this.fsrsCards.set(card, serialized);
		return serialized;
	}

	decodeDeck(data: SerializedDeck): Deck {
		return {
			...data,
			cards: data.cards.map((card) => this.decodeCard(card)),
		};
	}

	decodeCard(
		data: SerializedCard & {
			question?: string;
			answer?: string;
		},
	): FlashCard {
		return {
			...data,
			front: data.front ?? data.question ?? "",
			back: data.back ?? data.answer ?? "",
			explanation: data.explanation?.trim() || undefined,
			fsrsCard: this.decodeFsrsCard(data.fsrsCard),
		};
	}

	decodeFsrsCard(data: SerializedFSRSCard): Card {
		return {
			due: new Date(data.due),
			stability: data.stability,
			difficulty: data.difficulty,
			elapsed_days: data.elapsed_days,
			scheduled_days: data.scheduled_days,
			reps: data.reps,
			lapses: data.lapses,
			state: data.state,
			last_review: data.last_review ? new Date(data.last_review) : undefined,
			learning_steps: data.learning_steps ?? 0,
		};
	}

	/** Drops identity caches after a full snapshot restore. */
	reset(): void {
		this.decks = new WeakMap();
		this.cards = new WeakMap();
		this.fsrsCards = new WeakMap();
	}
}
