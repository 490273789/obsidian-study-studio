import { useMemo } from "react";
import type {
	AnswerPresentationOutcome,
	AnswerPresentationTransition,
} from "../answerPresentationTransition";
import { reportPresentationOutcome } from "../presentation/presentationOutcome";
import {
	createSessionSurface,
	type SessionSurface,
	type SessionSurfaceIntentFor,
	type SessionSurfaceReference,
} from "../presentation/sessionSurface";

/** Binds one session view to its presentation transition; React only connects. */
export function useSessionSurface<R extends SessionSurfaceReference>(options: {
	transition: AnswerPresentationTransition;
	reference: R;
	onOutcome?: (
		outcome: AnswerPresentationOutcome,
		intent: SessionSurfaceIntentFor<R>,
	) => void | Promise<void>;
}): SessionSurface<R> {
	const { transition, reference, onOutcome } = options;
	return useMemo(
		() =>
			createSessionSurface({
				transition,
				reference,
				report: reportPresentationOutcome,
				onOutcome,
			}),
		[transition, reference, onOutcome],
	);
}
