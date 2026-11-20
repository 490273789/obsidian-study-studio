import React from "react";
import type { PronunciationRuntime } from "../../../domain/pronunciation";
import { MarkdownContent, type MarkdownRendererFn } from "./MarkdownContent";
import { PronunciationButton } from "../PronunciationButton";

interface PronounceableMarkdownProps {
	content: string;
	word: string | null;
	runtime: PronunciationRuntime;
	markdownRenderer: MarkdownRendererFn;
	sourcePath: string;
}

export const PronounceableMarkdown: React.FC<PronounceableMarkdownProps> = ({
	content,
	word,
	runtime,
	markdownRenderer,
	sourcePath,
}) => (
	<div className={`flashcard-pronunciation-row${word ? " has-pronunciation" : ""}`}>
		<MarkdownContent
			content={content}
			className="flashcard-markdown"
			markdownRenderer={markdownRenderer}
			sourcePath={sourcePath}
		/>
		{word && <PronunciationButton text={word} runtime={runtime} />}
	</div>
);
