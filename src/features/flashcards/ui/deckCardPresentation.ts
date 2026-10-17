import type { DeckHomeDeckSnapshot, DeckHomeSnapshot } from "../domain/decks/deckHome";

/**
 * A deck's presentation state, derived only from the shared snapshot:
 * - `done`   — nothing left to learn; the deck keeps its reviews.
 * - `fresh`  — untouched, so progress is not worth rendering as a bar.
 * - `active` — partly learned; the row leads with progress.
 */
export type DeckCardVisualState = "active" | "fresh" | "done";

/** One deck row's derived presentation, shared by the list and the row module. */
export interface DeckCardPresentation {
	readonly deck: DeckHomeDeckSnapshot;
	readonly state: DeckCardVisualState;
	readonly learnedCards: number;
	readonly progressPercent: number;
	readonly isDone: boolean;
	readonly isExporting: boolean;
	readonly isExportBusy: boolean;
	readonly isSettingsLocked: boolean;
}

export function getDeckVisualState(deck: DeckHomeDeckSnapshot): DeckCardVisualState {
	if (deck.stats.newCards <= 0) return "done";
	if (deck.studyCount === 0 && deck.stats.newCards === deck.stats.totalCards) return "fresh";
	return "active";
}

/**
 * Derives one row from the committed deck snapshot. Readiness, progress and lock
 * rules live here so the row and the list grouping cannot disagree.
 */
export function selectDeckCardPresentation(
	deck: DeckHomeDeckSnapshot,
	snapshot: Pick<DeckHomeSnapshot, "settingsDraft" | "export">,
	ownerId: string,
): DeckCardPresentation {
	const totalCards = deck.stats.totalCards;
	const learnedCards = Math.max(0, totalCards - deck.stats.newCards);
	const state = getDeckVisualState(deck);
	const draft = snapshot.settingsDraft;
	return {
		deck,
		state,
		learnedCards,
		progressPercent: totalCards > 0 ? Math.min(100, (learnedCards / totalCards) * 100) : 0,
		isDone: state === "done",
		isExporting: snapshot.export.kind === "exporting" && snapshot.export.deckId === deck.id,
		isExportBusy: snapshot.export.kind === "exporting",
		isSettingsLocked:
			draft !== null &&
			draft.ownerId !== ownerId &&
			(draft.ownerId !== "" || draft.deckId !== deck.id),
	};
}
