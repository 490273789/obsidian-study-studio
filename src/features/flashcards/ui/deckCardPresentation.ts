import type {
	DeckHomeDeckSnapshot,
	DeckHomeExportActivity,
	DeckHomeSnapshot,
} from "../domain/decks/deckHome";

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

interface CachedDeckCardRow {
	/**
	 * Latest deck snapshot this row was compared against. Deck home rebuilds every
	 * deck wrapper on each publish, so the row compares content instead of relying
	 * on this reference.
	 */
	deck: DeckHomeDeckSnapshot;
	readonly ownerId: string;
	readonly draftOwnerId: string | null;
	readonly draftDeckId: string | null;
	readonly exportKind: DeckHomeExportActivity["kind"];
	readonly exportDeckId: string | null;
	readonly presentation: DeckCardPresentation;
}

/**
 * Row models are cached so every publish keeps the rows whose deck and
 * draft/export inputs did not change referentially stable; `DeckCard` is
 * memoized on the row model, and deck home publishes on several triggers
 * (refresh, due timer, settings, export, reorder…). The cache is bounded by the
 * deck count: list rendering prunes rows for decks that no longer exist.
 */
const deckCardRowCache = new Map<string, CachedDeckCardRow>();

/**
 * Derives one row per deck while keeping unchanged rows referentially stable.
 * `DeckList` uses this list form so removed decks leave the row cache.
 */
export function selectDeckCardPresentations(
	decks: readonly DeckHomeDeckSnapshot[],
	snapshot: Pick<DeckHomeSnapshot, "settingsDraft" | "export">,
	ownerId: string,
): DeckCardPresentation[] {
	const presentations = decks.map((deck) => selectDeckCardPresentation(deck, snapshot, ownerId));
	if (deckCardRowCache.size > decks.length) {
		const liveDeckIds = new Set(decks.map((deck) => deck.id));
		for (const deckId of deckCardRowCache.keys()) {
			if (!liveDeckIds.has(deckId)) deckCardRowCache.delete(deckId);
		}
	}
	return presentations;
}

/**
 * Derives one row from the committed deck snapshot. Readiness, progress and lock
 * rules live here so the row and the list grouping cannot disagree.
 *
 * The inputs that can change a row without changing its deck are compared too
 * (owner, settings draft ownership/target, export target), so a cache hit never
 * shows stale lock or export state.
 */
export function selectDeckCardPresentation(
	deck: DeckHomeDeckSnapshot,
	snapshot: Pick<DeckHomeSnapshot, "settingsDraft" | "export">,
	ownerId: string,
): DeckCardPresentation {
	const draft = snapshot.settingsDraft;
	const exportKind = snapshot.export.kind;
	const exportDeckId = exportKind === "exporting" ? snapshot.export.deckId : null;
	const cached = deckCardRowCache.get(deck.id);
	if (
		cached !== undefined &&
		cached.ownerId === ownerId &&
		cached.draftOwnerId === (draft?.ownerId ?? null) &&
		cached.draftDeckId === (draft?.deckId ?? null) &&
		cached.exportKind === exportKind &&
		cached.exportDeckId === exportDeckId &&
		hasSameDeckRowContent(cached.deck, deck)
	) {
		if (cached.deck !== deck) cached.deck = deck;
		return cached.presentation;
	}

	const presentation = deriveDeckCardPresentation(deck, snapshot, ownerId);
	deckCardRowCache.set(deck.id, {
		deck,
		ownerId,
		draftOwnerId: draft?.ownerId ?? null,
		draftDeckId: draft?.deckId ?? null,
		exportKind,
		exportDeckId,
		presentation,
	});
	return presentation;
}

function deriveDeckCardPresentation(
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

/**
 * A row renders every field of its deck snapshot, so reuse is only safe while
 * the whole wrapper is content-equal. Keep this in sync with
 * `DeckHomeDeckSnapshot` when that read model gains a field.
 */
function hasSameDeckRowContent(
	previous: DeckHomeDeckSnapshot,
	next: DeckHomeDeckSnapshot,
): boolean {
	if (previous === next) return true;
	const previousStats = previous.stats;
	const nextStats = next.stats;
	const previousSettings = previous.effectiveStudySettings;
	const nextSettings = next.effectiveStudySettings;
	const previousSpelling = previous.spelling;
	const nextSpelling = next.spelling;
	return (
		previous.id === next.id &&
		previous.name === next.name &&
		previous.filePath === next.filePath &&
		previous.tag === next.tag &&
		previous.studyCount === next.studyCount &&
		previousStats.totalCards === nextStats.totalCards &&
		previousStats.newCards === nextStats.newCards &&
		previousStats.dueCards === nextStats.dueCards &&
		previousStats.learningCards === nextStats.learningCards &&
		previousStats.reviewCards === nextStats.reviewCards &&
		previousStats.relearningCards === nextStats.relearningCards &&
		previousSettings.dailyNewCards === nextSettings.dailyNewCards &&
		previousSettings.dailyReviewCards === nextSettings.dailyReviewCards &&
		previousSettings.studyOrder === nextSettings.studyOrder &&
		previousSettings.fsrsParameters.requestRetention ===
			nextSettings.fsrsParameters.requestRetention &&
		previousSettings.fsrsParameters.maximumInterval ===
			nextSettings.fsrsParameters.maximumInterval &&
		previousSpelling.enabled === nextSpelling.enabled &&
		previousSpelling.ready === nextSpelling.ready &&
		previousSpelling.valid === nextSpelling.valid &&
		previousSpelling.canStart === nextSpelling.canStart &&
		previousSpelling.hasStableIdentities === nextSpelling.hasStableIdentities &&
		previousSpelling.issueCount === nextSpelling.issueCount &&
		previousSpelling.ignoredCardCount === nextSpelling.ignoredCardCount
	);
}
