import type { Deck, StudySettings } from "../../../core/shared/types";
import type { DeckHomeSnapshot } from "../domain/decks/deckHome";
import type { PracticeSelection, SpellingSelection } from "../domain/sessions/sessionLifecycle";
import {
	getPracticeSetupPlan,
	getSpellingSetupPlan,
	getStudySetupPlan,
	type PracticeSetupPlan,
	type SpellingSetupPlan,
	type StudySetupPlan,
} from "../domain/sessions/sessionPlanner";

/**
 * Setup plans cross the deck-home snapshot seam exactly once: the snapshot owns
 * the committed facts (effective study settings, spelling progress, evaluated
 * time), the planners stay pure, and React only selects the plan for its route.
 */
function findEffectiveStudySettings(
	snapshot: DeckHomeSnapshot,
	deckId: string,
): StudySettings | null {
	const deck = snapshot.decks.find((candidate) => candidate.id === deckId);
	return deck ? deck.effectiveStudySettings : null;
}

export function selectStudySetupPlan(
	snapshot: DeckHomeSnapshot,
	deck: Deck,
	initialStudyOrder?: StudySettings["studyOrder"],
): StudySetupPlan | null {
	const settings = findEffectiveStudySettings(snapshot, deck.id);
	if (!settings) return null;
	return getStudySetupPlan(deck, settings, new Date(snapshot.evaluatedAt), initialStudyOrder);
}

export function selectPracticeSetupPlan(
	deck: Deck,
	initialSelection?: PracticeSelection,
): PracticeSetupPlan {
	return getPracticeSetupPlan(deck, initialSelection);
}

export function selectSpellingSetupPlan(
	snapshot: DeckHomeSnapshot,
	deck: Deck,
	initialSelection?: SpellingSelection,
): SpellingSetupPlan {
	return getSpellingSetupPlan(deck, snapshot.spellingProgress, initialSelection);
}
