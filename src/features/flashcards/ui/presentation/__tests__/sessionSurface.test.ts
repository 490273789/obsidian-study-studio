import { describe, expect, it, vi } from "vite-plus/test";
import type {
	AnswerPresentationAction,
	AnswerPresentationOutcome,
} from "../../answerPresentationTransition";
import type {
	ActiveChallengeReference,
	ActivePracticeReference,
	ActiveSpellingReference,
	ActiveStudyReference,
} from "../../../domain/sessions/sessionLifecycle";
import { createSessionSurface } from "../sessionSurface";

function reference<M extends "study" | "practice" | "spelling" | "challenge">(mode: M) {
	return { kind: "active", mode, revision: 1, key: "presented" } as never;
}

const study = reference("study") as ActiveStudyReference;
const practice = reference("practice") as ActivePracticeReference;
const spelling = reference("spelling") as ActiveSpellingReference;
const challenge = reference("challenge") as ActiveChallengeReference;

const applied: AnswerPresentationOutcome = { kind: "applied", studyCompleted: false };

function transitionReturning(outcome: AnswerPresentationOutcome = applied) {
	const act = vi.fn(async (_action: AnswerPresentationAction) => outcome);
	return { act };
}

describe("session surface dispatch", () => {
	it("maps study intents to the presented reference", async () => {
		const transition = transitionReturning();
		const surface = createSessionSurface({ transition, reference: study });

		await surface.act({ kind: "reveal" });
		await surface.act({ kind: "toggle-auto-pronunciation" });
		await surface.act({ kind: "previous" });
		await surface.act({ kind: "rate", rating: 3 });

		expect(transition.act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "card-reveal", reference: study },
			{ kind: "card-toggle-auto-pronunciation", reference: study },
			{ kind: "study-previous", reference: study },
			{ kind: "study-answer", reference: study, rating: 3 },
		]);
	});

	it("maps practice intents to the presented reference", async () => {
		const transition = transitionReturning();
		const surface = createSessionSurface({ transition, reference: practice });

		await surface.act({ kind: "reveal" });
		await surface.act({ kind: "previous" });
		await surface.act({ kind: "practice-answer", correct: true });

		expect(transition.act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "card-reveal", reference: practice },
			{ kind: "practice-previous", reference: practice },
			{ kind: "practice-answer", reference: practice, correct: true },
		]);
	});

	it("maps spelling and challenge intents, including answer payloads", async () => {
		const spellingTransition = transitionReturning();
		const spellingSurface = createSessionSurface({
			transition: spellingTransition,
			reference: spelling,
		});
		await spellingSurface.act({ kind: "spelling-answer", input: "science" });

		const challengeTransition = transitionReturning();
		const challengeSurface = createSessionSurface({
			transition: challengeTransition,
			reference: challenge,
		});
		await challengeSurface.act({ kind: "challenge-answer", correct: true });
		await challengeSurface.act({ kind: "challenge-answer", input: "apple" });
		await challengeSurface.act({ kind: "challenge-reveal" });
		await challengeSurface.act({ kind: "challenge-continue" });

		expect(spellingTransition.act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "spelling-answer", reference: spelling, input: "science" },
		]);
		expect(challengeTransition.act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "challenge-answer", reference: challenge, correct: true },
			{ kind: "challenge-answer", reference: challenge, input: "apple" },
			{ kind: "challenge-reveal", reference: challenge },
			{ kind: "challenge-continue", reference: challenge },
		]);
	});

	it("reports terminal failures but not rejections or applied outcomes", async () => {
		const report = vi.fn();
		const failed: AnswerPresentationOutcome = {
			kind: "failed",
			message: "disk unavailable",
			retryable: true,
		};
		const transition = transitionReturning(failed);
		const surface = createSessionSurface({ transition, reference: study, report });

		await surface.act({ kind: "rate", rating: 2 });
		expect(report).toHaveBeenCalledWith(failed);

		const rejected = transitionReturning({
			kind: "rejected",
			reason: "busy",
		} as AnswerPresentationOutcome);
		const quiet = createSessionSurface({
			transition: rejected,
			reference: study,
			report,
		});
		await quiet.act({ kind: "reveal" });
		expect(report).toHaveBeenCalledTimes(1);
	});

	it("hands the outcome and intent to mode-specific handling", async () => {
		const outcome: AnswerPresentationOutcome = { kind: "applied", studyCompleted: true };
		const onOutcome = vi.fn();
		const surface = createSessionSurface({
			transition: transitionReturning(outcome),
			reference: study,
			onOutcome,
		});

		await surface.act({ kind: "rate", rating: 5 });
		expect(onOutcome).toHaveBeenCalledWith(outcome, { kind: "rate", rating: 5 });
	});
});
