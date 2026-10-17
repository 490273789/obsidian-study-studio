import { Notice } from "obsidian";
import type { AnswerPresentationOutcome } from "../answerPresentationTransition";

/**
 * The single failure read shared by every session view. Callers keep the
 * transaction and their mode-specific success handling; only the failed branch
 * is common enough to own here.
 */
export function reportPresentationOutcome(outcome: AnswerPresentationOutcome): void {
	if (outcome.kind === "failed") {
		new Notice(outcome.message);
	}
}
