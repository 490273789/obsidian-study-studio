import React from "react";
import { MarkdownContent, PronounceableMarkdown } from "../primitives/Markdown";
import { useFlashcardI18n } from "../../strings/context";
import type { CardPresentationBlock } from "./cardPresentation";
import { useCardPresentationDependencies } from "./context";

interface CardPanelProps {
	block: CardPresentationBlock;
	sourcePath: string;
}

/** The question panel shared by every session view. */
export const CardQuestionPanel: React.FC<CardPanelProps> = ({ block, sourcePath }) => {
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
					sourcePath={sourcePath}
				/>
			) : (
				<MarkdownContent
					content={block.content}
					className="flashcard-markdown"
					markdownRenderer={markdownRenderer}
					sourcePath={sourcePath}
				/>
			)}
		</div>
	);
};

/** The answer panel; pronunciation belongs to whichever side exposes the word. */
export const CardAnswerPanel: React.FC<CardPanelProps> = ({ block, sourcePath }) => {
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
					sourcePath={sourcePath}
				/>
			) : (
				<MarkdownContent
					content={block.content}
					className="flashcard-markdown"
					markdownRenderer={markdownRenderer}
					sourcePath={sourcePath}
				/>
			)}
		</div>
	);
};

/** The explanation panel, rendered wherever the view places it. */
export const CardExplanationPanel: React.FC<CardPanelProps> = ({ block, sourcePath }) => {
	const { t } = useFlashcardI18n();
	const { markdownRenderer } = useCardPresentationDependencies();
	return (
		<div className="flashcard-explanation fc-panel">
			<div className="flashcard-label flashcard-label-explanation">{t(block.label)}</div>
			<MarkdownContent
				content={block.content}
				className="flashcard-markdown"
				markdownRenderer={markdownRenderer}
				sourcePath={sourcePath}
			/>
		</div>
	);
};

/** Answer side of one encounter: divider, answer, optional explanation. */
export const CardAnswerSection: React.FC<{
	answer: CardPresentationBlock;
	explanation: CardPresentationBlock | null;
	sourcePath: string;
}> = ({ answer, explanation, sourcePath }) => {
	const sourceName = sourcePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
	return (
		<div className="flashcard-answer-section" aria-live="polite">
			<div className="flashcard-divider" />
			<CardAnswerPanel block={answer} sourcePath={sourcePath} />
			{explanation ? (
				<CardExplanationPanel block={explanation} sourcePath={sourcePath} />
			) : null}
			{sourceName ? (
				<div className="flashcard-source-anchor" title={sourcePath}>
					{sourceName}
				</div>
			) : null}
		</div>
	);
};
