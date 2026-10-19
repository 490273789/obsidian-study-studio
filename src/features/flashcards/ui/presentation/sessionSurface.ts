import type { StudyRating } from "../../../../core/shared/types";
import type {
	ActiveChallengeReference,
	ActivePracticeReference,
	ActiveSpellingReference,
	ActiveStudyReference,
} from "../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationAction,
	AnswerPresentationOutcome,
	AnswerPresentationTransition,
	CardPresentationSnapshot,
} from "../answerPresentationTransition";

/** The presented snapshot reference a session surface is bound to. */
export type SessionSurfaceReference =
	| ActiveStudyReference
	| ActivePracticeReference
	| ActiveSpellingReference
	| ActiveChallengeReference;

export type StudySurfaceIntent =
	| { readonly kind: "reveal" }
	| { readonly kind: "toggle-auto-pronunciation" }
	| { readonly kind: "previous" }
	| { readonly kind: "rate"; readonly rating: StudyRating };

export type PracticeSurfaceIntent =
	| { readonly kind: "reveal" }
	| { readonly kind: "toggle-auto-pronunciation" }
	| { readonly kind: "previous" }
	| { readonly kind: "practice-answer"; readonly correct: boolean };

export type SpellingSurfaceIntent = { readonly kind: "spelling-answer"; readonly input: string };

export type ChallengeSurfaceIntent =
	| {
			readonly kind: "challenge-answer";
			readonly correct?: boolean;
			readonly input?: string;
	  }
	| { readonly kind: "challenge-reveal" }
	| { readonly kind: "challenge-continue" };

/** Narrows the intent vocabulary to the reference the surface was created with. */
export type SessionSurfaceIntentFor<R extends SessionSurfaceReference> =
	R extends ActiveStudyReference
		? StudySurfaceIntent
		: R extends ActivePracticeReference
			? PracticeSurfaceIntent
			: R extends ActiveSpellingReference
				? SpellingSurfaceIntent
				: R extends ActiveChallengeReference
					? ChallengeSurfaceIntent
					: never;

export interface SessionSurface<R extends SessionSurfaceReference> {
	act(intent: SessionSurfaceIntentFor<R>): Promise<AnswerPresentationOutcome>;
}

type AnySurfaceIntent =
	| StudySurfaceIntent
	| PracticeSurfaceIntent
	| SpellingSurfaceIntent
	| ChallengeSurfaceIntent;

/**
 * Pure dispatch from one session view's semantic intent to the presentation
 * transition. Busy/rejection rules stay in the transition; this binding only
 * attaches the presented reference, reports terminal failures, and hands the
 * outcome back to mode-specific handling.
 */
export function createSessionSurface<R extends SessionSurfaceReference>(options: {
	transition: Pick<AnswerPresentationTransition, "act">;
	reference: R;
	report?: (outcome: AnswerPresentationOutcome) => void;
	onOutcome?: (
		outcome: AnswerPresentationOutcome,
		intent: SessionSurfaceIntentFor<R>,
	) => void | Promise<void>;
}): SessionSurface<R> {
	const { transition, reference, report, onOutcome } = options;
	return {
		async act(intent) {
			const outcome = await transition.act(
				toAnswerPresentationAction(intent as AnySurfaceIntent, reference),
			);
			if (outcome.kind === "failed") report?.(outcome);
			const completion = onOutcome?.(outcome, intent);
			if (completion) await completion;
			return outcome;
		},
	};
}

function toAnswerPresentationAction(
	intent: AnySurfaceIntent,
	reference: SessionSurfaceReference,
): AnswerPresentationAction {
	switch (intent.kind) {
		case "reveal":
			return {
				kind: "card-reveal",
				reference: reference as ActiveStudyReference | ActivePracticeReference,
			};
		case "toggle-auto-pronunciation":
			return {
				kind: "card-toggle-auto-pronunciation",
				reference: reference as ActiveStudyReference | ActivePracticeReference,
			};
		case "previous": {
			const previousReference = reference as ActiveStudyReference | ActivePracticeReference;
			return previousReference.mode === "study"
				? { kind: "study-previous", reference: previousReference }
				: { kind: "practice-previous", reference: previousReference };
		}
		case "rate":
			return {
				kind: "study-answer",
				reference: reference as ActiveStudyReference,
				rating: intent.rating,
			};
		case "practice-answer":
			return {
				kind: "practice-answer",
				reference: reference as ActivePracticeReference,
				correct: intent.correct,
			};
		case "spelling-answer":
			return {
				kind: "spelling-answer",
				reference: reference as ActiveSpellingReference,
				input: intent.input,
			};
		case "challenge-answer": {
			const challengeReference = reference as ActiveChallengeReference;
			if (intent.input !== undefined)
				return {
					kind: "challenge-answer",
					reference: challengeReference,
					input: intent.input,
				};
			if (intent.correct !== undefined)
				return {
					kind: "challenge-answer",
					reference: challengeReference,
					correct: intent.correct,
				};
			return { kind: "challenge-answer", reference: challengeReference };
		}
		case "challenge-reveal":
			return { kind: "challenge-reveal", reference: reference as ActiveChallengeReference };
		case "challenge-continue":
			return { kind: "challenge-continue", reference: reference as ActiveChallengeReference };
	}
}

/** Shared toolbar control for the study/practice auto-pronunciation toggle. */
export function autoPronunciationControl(
	cardPresentation: CardPresentationSnapshot,
	onToggle: () => void,
	enableTitle: string,
	disableTitle: string,
) {
	return cardPresentation.pronunciationEnabled
		? {
				enabled: cardPresentation.autoPronunciationEnabled,
				onToggle,
				enableTitle,
				disableTitle,
			}
		: undefined;
}
