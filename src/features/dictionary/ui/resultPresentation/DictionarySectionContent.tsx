import React, { memo } from "react";
import { cls } from "../../../../core/shared/classNames";
import { SandboxDocumentFrame } from "../SandboxDocumentFrame";
import type {
	AiDictionaryDefinition,
	DictionarySection,
	DictionarySectionContent as DictionarySectionContentValue,
} from "../../domain/types";
import type { DictionaryStrings } from "../../strings/dictionary";
import styles from "../Dictionary.module.scss";

interface ExamplePart {
	highlighted: boolean;
	text: string;
}

/**
 * Splits an example sentence around every occurrence of the looked-up word so
 * the view can wrap matches in `<mark>` without touching the source text.
 */
function exampleParts(sentence: string, word: string): ExamplePart[] {
	const query = word.trim();
	if (!query) return [{ highlighted: false, text: sentence }];
	const lowerSentence = sentence.toLocaleLowerCase();
	const lowerQuery = query.toLocaleLowerCase();
	const parts: ExamplePart[] = [];
	let cursor = 0;
	let index = lowerSentence.indexOf(lowerQuery);
	while (index >= 0) {
		if (index > cursor) parts.push({ highlighted: false, text: sentence.slice(cursor, index) });
		const end = index + query.length;
		parts.push({ highlighted: true, text: sentence.slice(index, end) });
		cursor = end;
		index = lowerSentence.indexOf(lowerQuery, cursor);
	}
	if (cursor < sentence.length) parts.push({ highlighted: false, text: sentence.slice(cursor) });
	return parts.length > 0 ? parts : [{ highlighted: false, text: sentence }];
}

function highlightedSentence(sentence: string, word: string): React.ReactNode[] {
	return exampleParts(sentence, word).map((part, index) =>
		part.highlighted ? (
			<mark key={`${index}-${part.text}`}>{part.text}</mark>
		) : (
			<React.Fragment key={`${index}-${part.text}`}>{part.text}</React.Fragment>
		),
	);
}

interface AiSenseProps {
	definition: AiDictionaryDefinition;
	number: number;
	word: string;
	strings: DictionaryStrings;
}

/** One AI definition with every optional detail field, shared by both surfaces. */
export function AiSense({ definition, number, word, strings }: AiSenseProps) {
	return (
		<article className={cls("flashcard-dictionary-ai-sense", styles.aiSense)}>
			<header className={cls("flashcard-dictionary-ai-sense-heading", styles.aiSenseHeading)}>
				<span
					className={cls("flashcard-dictionary-ai-sense-number", styles.aiSenseNumber)}
					aria-hidden="true"
				>
					{number}
				</span>
				{definition.partOfSpeech && (
					<span className={cls("flashcard-dictionary-ai-pos", styles.aiPos)}>
						{definition.partOfSpeech}
					</span>
				)}
				<strong>{definition.meaning}</strong>
			</header>
			<dl className={cls("flashcard-dictionary-ai-sense-details", styles.aiSenseDetails)}>
				{definition.explanation && (
					<div>
						<dt>{strings.sections.explanation}</dt>
						<dd>{definition.explanation}</dd>
					</div>
				)}
				{definition.synonyms.length > 0 && (
					<div>
						<dt>{strings.sections.synonyms}</dt>
						<dd>{definition.synonyms.join("、")}</dd>
					</div>
				)}
				{definition.antonyms.length > 0 && (
					<div>
						<dt>{strings.sections.antonyms}</dt>
						<dd>{definition.antonyms.join("、")}</dd>
					</div>
				)}
				{definition.examples.length > 0 && (
					<div>
						<dt>{strings.sections.examples}</dt>
						<dd className={cls("flashcard-dictionary-ai-examples", styles.aiExamples)}>
							{definition.examples.map((example, index) => (
								<div key={`${index}-${example.sentence}`}>
									<p lang="en">{highlightedSentence(example.sentence, word)}</p>
									<p lang="zh-CN">{example.translation}</p>
								</div>
							))}
						</dd>
					</div>
				)}
			</dl>
		</article>
	);
}

export const DictionarySectionContent = memo(function DictionarySectionContent({
	content,
	word,
	theme,
	title,
	onLookup,
	onClose,
	mainTabShortcut,
	onOpenMainTab,
	fitContent,
	className,
	strings,
}: {
	content: DictionarySectionContentValue;
	word: string;
	theme: "dark" | "light";
	title: string;
	onLookup?: (word: string) => void;
	onClose?: () => void;
	mainTabShortcut?: string;
	onOpenMainTab?: () => void;
	fitContent?: boolean;
	className?: string;
	strings: DictionaryStrings;
}) {
	if (content.kind === "list") {
		return (
			<ol className={cls("flashcard-dictionary-list", styles.list)}>
				{content.items.map((item, index) => (
					<li key={`${index}-${item}`}>{item}</li>
				))}
			</ol>
		);
	}
	if (content.kind === "ai-definitions") {
		return (
			<div className={cls("flashcard-dictionary-ai-senses", styles.aiSenses)}>
				{content.definitions.map((definition, index) => (
					<AiSense
						key={`${index}-${definition.partOfSpeech}-${definition.meaning}`}
						definition={definition}
						number={index + 1}
						word={word}
						strings={strings}
					/>
				))}
			</div>
		);
	}
	return (
		<SandboxDocumentFrame
			document={content.document}
			theme={theme}
			title={title}
			onLookup={onLookup}
			onClose={onClose}
			mainTabShortcut={mainTabShortcut}
			onOpenMainTab={onOpenMainTab}
			fitContent={fitContent}
			className={className}
		/>
	);
});

/** Sections the source presents as detail tabs, with their original indices. */
export function getTabSections(
	sections: readonly DictionarySection[],
): { index: number; section: DictionarySection }[] {
	return sections.flatMap((section, index) =>
		section.presentation === "tab" ? [{ index, section }] : [],
	);
}

/** Sections visible at once: every stacked section plus the active detail tab. */
export function getVisibleSections(
	sections: readonly DictionarySection[],
	activeSectionIndex: number | null,
): { index: number; section: DictionarySection }[] {
	return sections.flatMap((section, index) =>
		section.presentation === "stack" || index === activeSectionIndex
			? [{ index, section }]
			: [],
	);
}
