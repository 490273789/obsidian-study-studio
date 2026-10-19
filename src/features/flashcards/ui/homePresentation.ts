import type { DeckHomeDeckSnapshot } from "../domain/decks/deckHome";

/**
 * A deck's presentation state, derived only from the shared snapshot:
 * - `done`   — nothing left to learn; the deck keeps its reviews.
 * - `fresh`  — untouched, so progress is not worth rendering as a bar.
 * - `active` — partly learned; the row leads with progress.
 */
export type DeckCardVisualState = "active" | "fresh" | "done";

/** The progress values one deck row renders from its stable snapshot row. */
export interface DeckCardMetrics {
	readonly state: DeckCardVisualState;
	readonly learnedCards: number;
	readonly progressPercent: number;
	readonly isDone: boolean;
}

export function selectDeckVisualState(deck: DeckHomeDeckSnapshot): DeckCardVisualState {
	if (deck.stats.newCards <= 0) return "done";
	if (deck.studyCount === 0 && deck.stats.newCards === deck.stats.totalCards) return "fresh";
	return "active";
}

/**
 * Derives one row's visual metrics. The read model keeps deck rows referentially
 * stable, so this stays a cheap pure derivation with no presentation cache.
 */
export function selectDeckCardMetrics(deck: DeckHomeDeckSnapshot): DeckCardMetrics {
	const totalCards = deck.stats.totalCards;
	const learnedCards = Math.max(0, totalCards - deck.stats.newCards);
	const state = selectDeckVisualState(deck);
	return {
		state,
		learnedCards,
		progressPercent: totalCards > 0 ? Math.min(100, (learnedCards / totalCards) * 100) : 0,
		isDone: state === "done",
	};
}

/**
 * The deck a returning learner should resume: a deck that has been started
 * outranks an untouched one, and the largest backlog wins inside each tier.
 * Ties keep the snapshot's display order.
 */
export function selectContinueDeck(
	decks: readonly DeckHomeDeckSnapshot[],
): DeckHomeDeckSnapshot | null {
	let started: DeckHomeDeckSnapshot | null = null;
	let untouched: DeckHomeDeckSnapshot | null = null;
	for (const deck of decks) {
		if (deck.stats.newCards <= 0) continue;
		if (deck.studyCount > 0) {
			if (!started || deck.stats.newCards > started.stats.newCards) started = deck;
		} else if (!untouched || deck.stats.newCards > untouched.stats.newCards) {
			untouched = deck;
		}
	}
	return started ?? untouched;
}
