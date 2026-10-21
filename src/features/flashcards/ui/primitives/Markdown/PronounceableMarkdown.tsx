import React from "react";
import type { PronunciationRuntime } from "../../../domain/pronunciation";
import { MarkdownContent } from "./MarkdownContent";
import { PronunciationButton } from "../PronunciationButton";

interface PronounceableMarkdownProps {
	content: string;
	word: string | null;
	runtime: PronunciationRuntime;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const PronounceableMarkdown: React.FC<PronounceableMarkdownProps> = ({
	content,
	word,
	runtime,
	markdownRenderer,
}) => (
	<div className={`flashcard-pronunciation-row${word ? " has-pronunciation" : ""}`}>
		{word && <PronunciationButton text={word} runtime={runtime} />}
		<MarkdownContent
			content={content}
			className="flashcard-markdown"
			markdownRenderer={markdownRenderer}
		/>
	</div>
);
