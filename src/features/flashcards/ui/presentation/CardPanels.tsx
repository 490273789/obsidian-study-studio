import React from "react";
import { MarkdownContent, PronounceableMarkdown } from "../primitives/Markdown";
import { useFlashcardI18n } from "../../strings/context";
import type { CardPresentationBlock } from "./cardPresentation";
import { useCardPresentationDependencies } from "./context";

/** The question panel shared by every session view. */
export const CardQuestionPanel: React.FC<{ block: CardPresentationBlock }> = ({ block }) => {
	const { t } = useFlashcardI18n();
	const { markdownRenderer, pronunciationRuntime } = useCardPresentationDependencies();
	return (
		<div className="flashcard-question fc-panel">
			<div className="flashcard-label flashcard-label-question">{t(block.label)}</div>
			{block.pronunciationWord ? (
				<PronounceableMarkdown
					content={block.content}
					word={block.pronunciationWord}
					runtime={pronunciationRuntime}
					markdownRenderer={markdownRenderer}
				/>
			) : (
				<MarkdownContent
					content={block.content}
					className="flashcard-markdown"
					markdownRenderer={markdownRenderer}
				/>
			)}
		</div>
	);
};

/** The answer panel; pronunciation belongs to whichever side exposes the word. */
export const CardAnswerPanel: React.FC<{ block: CardPresentationBlock }> = ({ block }) => {
	const { t } = useFlashcardI18n();
	const { markdownRenderer, pronunciationRuntime } = useCardPresentationDependencies();
	return (
		<div className="flashcard-answer fc-panel">
			<div className="flashcard-label flashcard-label-answer">{t(block.label)}</div>
			{block.pronunciationWord ? (
				<PronounceableMarkdown
					content={block.content}
					word={block.pronunciationWord}
					runtime={pronunciationRuntime}
					markdownRenderer={markdownRenderer}
				/>
			) : (
				<MarkdownContent
					content={block.content}
					className="flashcard-markdown"
					markdownRenderer={markdownRenderer}
				/>
			)}
		</div>
	);
};

/** The explanation panel, rendered wherever the view places it. */
export const CardExplanationPanel: React.FC<{ block: CardPresentationBlock }> = ({ block }) => {
	const { t } = useFlashcardI18n();
	const { markdownRenderer } = useCardPresentationDependencies();
	return (
		<div className="flashcard-explanation fc-panel">
			<div className="flashcard-label flashcard-label-explanation">{t(block.label)}</div>
			<MarkdownContent
				content={block.content}
				className="flashcard-markdown"
				markdownRenderer={markdownRenderer}
			/>
		</div>
	);
};

/** Answer side of one encounter: divider, answer, optional explanation. */
export const CardAnswerSection: React.FC<{
	answer: CardPresentationBlock;
	explanation: CardPresentationBlock | null;
}> = ({ answer, explanation }) => (
	<div className="flashcard-answer-section">
		<div className="flashcard-divider" />
		<CardAnswerPanel block={answer} />
		{explanation ? <CardExplanationPanel block={explanation} /> : null}
	</div>
);
