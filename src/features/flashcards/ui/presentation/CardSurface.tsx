import React from "react";
import type { PresentedCard } from "../answerPresentationTransition";
import type { TranslationKey } from "../../strings";
import { CardAnswerSection, CardQuestionPanel } from "./CardPanels";
import { CardPresentationStack } from "./CardPresentationStack";
import { deriveCardPresentation } from "./cardPresentation";

interface CardSurfaceProps {
	/** The encounter resolved by `AnswerPresentationTransition`. */
	readonly presented: PresentedCard;
	/** Answer visibility is owned per mode: transition for study/practice, view for challenge/spelling. */
	readonly answerVisible: boolean;
	readonly pronunciationWord?: string | null;
	/** Mode-specific feedback, input, or extra panels rendered inside the encounter stack. */
	readonly children?: React.ReactNode;
}

/** The only assembly of a presented card: question, answer, explanation + mode children. */
export const CardSurface: React.FC<CardSurfaceProps> = ({
	presented,
	answerVisible,
	pronunciationWord,
	children,
}) => {
	const spelled = presented.kind === "spelling";
	const model = deriveCardPresentation({
		card: presented.card,
		direction: presented.direction,
		answerVisible: spelled ? false : answerVisible,
		questionLabel: questionLabelFor(presented),
		pronunciationWord: pronunciationWord ?? null,
	});

	return (
		<CardPresentationStack key={presented.presentationKey}>
			<CardQuestionPanel block={model.question} />
			{model.answer ? (
				<CardAnswerSection answer={model.answer} explanation={model.explanation} />
			) : null}
			{children}
		</CardPresentationStack>
	);
};

/** Spelling shows the meaning and spells the word; challenge spelling labels its prompt. */
function questionLabelFor(presented: PresentedCard): TranslationKey {
	if (presented.kind === "spelling") return "spelling.meaningPrompt";
	if (presented.kind === "challenge" && presented.questionMode === "spelling") {
		return "challenge.spellingPrompt";
	}
	return "common.question";
}
