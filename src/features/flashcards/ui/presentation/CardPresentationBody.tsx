import React from "react";
import type { CardPresentationModel } from "./cardPresentation";
import { CardAnswerSection, CardQuestionPanel } from "./CardPanels";
import { CardPresentationStack } from "./CardPresentationStack";

/**
 * Shared assembly for the study/practice presentations. A new encounter mounts a
 * fresh stack, matching the previous key-on-card-stack behaviour.
 */
export const CardPresentationBody: React.FC<{
	model: CardPresentationModel;
	encounterKey: string;
}> = ({ model, encounterKey }) => (
	<CardPresentationStack key={encounterKey}>
		<CardQuestionPanel block={model.question} />
		{model.answer ? (
			<CardAnswerSection answer={model.answer} explanation={model.explanation} />
		) : null}
	</CardPresentationStack>
);
