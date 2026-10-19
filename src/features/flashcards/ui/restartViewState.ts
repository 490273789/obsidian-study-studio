import type { ViewState } from "../../../core/shared/types";
import type { SessionRestartOrigin } from "../domain/sessions/sessionLifecycle";

/** Maps domain restart provenance onto the view route vocabulary owned by navigation. */
export function toRestartViewState(origin: SessionRestartOrigin): ViewState {
	if (origin.mode === "challenge") return { type: "challenge-setup" };
	if (origin.mode === "study") {
		return {
			type: "study-setup",
			deckId: origin.deckId,
			initialStudyOrder: origin.studyOrder,
			initialDirection: origin.direction,
		};
	}

	if (origin.selection.kind === "study-day") {
		if (origin.mode === "practice") {
			return {
				type: "study-setup",
				deckId: origin.deckId,
				initialStudyOrder: origin.selection.studyOrder,
				initialDirection: origin.direction,
			};
		}
		return {
			type: "study-setup",
			deckId: origin.deckId,
		};
	}

	if (origin.mode === "practice") {
		return {
			type: "practice-setup",
			deckId: origin.deckId,
			initialSelection: origin.selection,
			initialDirection: origin.direction,
		};
	}

	return {
		type: "spelling-setup",
		deckId: origin.deckId,
		initialSelection: origin.selection,
	};
}
