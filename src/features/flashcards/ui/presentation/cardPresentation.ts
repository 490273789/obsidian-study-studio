import type { CardDirection, FlashCard } from "../../../../core/shared/types";
import { getDisplayCardContent } from "../../domain/cards/cardDisplay";
import type { TranslationKey } from "../../strings";
import type { CardPresentationSnapshot } from "../answerPresentationTransition";

/**
 * One card presentation derived from what the view already knows. The model is
 * deliberately mode-agnostic: each view supplies its card, direction, visibility
 * and labels, and keeps its mode-specific controls outside this module.
 */
interface CardPresentationInput {
	readonly card: Pick<FlashCard, "front" | "back" | "explanation"> | null;
	readonly direction: CardDirection;
	readonly answerVisible: boolean;
	readonly questionLabel?: TranslationKey;
	/** Raw explanation override for views that render the source text unchanged. */
	readonly explanation?: string | null;
	readonly pronunciationWord?: string | null;
}

export interface CardPresentationBlock {
	readonly label: TranslationKey;
	readonly content: string;
	readonly pronunciationWord: string | null;
}

interface CardPresentationModel {
	readonly question: CardPresentationBlock;
	readonly answer: CardPresentationBlock | null;
	readonly explanation: CardPresentationBlock | null;
}

/** Derives the question/answer/explanation blocks for one presented card. */
export function deriveCardPresentation(input: CardPresentationInput): CardPresentationModel {
	const questionLabel = input.questionLabel ?? "common.question";
	const card = input.card;
	if (!card) {
		return {
			question: { label: questionLabel, content: "", pronunciationWord: null },
			answer: null,
			explanation: null,
		};
	}

	const content = getDisplayCardContent(card, input.direction);
	const word = input.pronunciationWord ? input.pronunciationWord : null;
	const explanation =
		input.explanation === undefined ? content.explanation : (input.explanation ?? "");

	return {
		question: {
			label: questionLabel,
			content: content.prompt,
			pronunciationWord: input.direction === "normal" ? word : null,
		},
		answer: input.answerVisible
			? {
					label: "common.answer",
					content: content.answer,
					pronunciationWord: input.direction === "reversed" ? word : null,
				}
			: null,
		explanation:
			input.answerVisible && explanation
				? { label: "common.explanation", content: explanation, pronunciationWord: null }
				: null,
	};
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
