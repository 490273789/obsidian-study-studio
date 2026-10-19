import React, { memo } from "react";
import { cls } from "../../../core/shared/classNames";
import type { SelectionResultContentProps } from "../../../core/selectionHelper/ui/types";
import type { DictionarySelectionResultHandle } from "../selectionAdapter";
import { dictionaryStrings } from "../strings/dictionary";
import {
	DictionarySectionContent,
	getTabSections,
	getVisibleSections,
} from "./resultPresentation/DictionarySectionContent";
import styles from "./SelectionDictionaryResultContent.module.scss";

/**
 * The 词典 feature's rendering of one opaque lookup result. The 选区助手 only
 * hands over the handle and semantic actions; tabs, sections and AI details stay
 * owned here, next to the main dictionary view.
 */
export const SelectionDictionaryResultContent = memo(function SelectionDictionaryResultContent({
	handle,
	language,
	theme,
	onLookup,
	onSelectSection,
	onClose,
	mainTabShortcut,
	onOpenMainTab,
}: SelectionResultContentProps) {
	const { result, activeSectionIndex, word } = handle as DictionarySelectionResultHandle;
	const strings = dictionaryStrings(language);
	const tabs = getTabSections(result.sections);
	const visible = getVisibleSections(result.sections, activeSectionIndex);
	const hasDocument = visible.some(({ section }) => section.content.kind === "document");

	return (
		<div className={cls(styles.result, hasDocument && styles.rich)}>
			{tabs.length > 0 && (
				<div className={styles.detailTabs} role="tablist" aria-label={strings.details}>
					{tabs.map(({ index, section }) => {
						const active = index === activeSectionIndex;
						return (
							<button
								key={`${index}-${section.title}`}
								type="button"
								role="tab"
								aria-selected={active}
								className={cls(styles.tab, active && styles.tabActive)}
								onClick={() => onSelectSection(index)}
							>
								{section.title}
							</button>
						);
					})}
				</div>
			)}
			{visible.map(({ index, section }) => (
				<section
					key={`${index}-${section.title}`}
					className={cls(
						styles.section,
						section.content.kind === "document" && styles.documentSection,
					)}
					aria-label={section.title}
					role={section.presentation === "tab" ? "tabpanel" : undefined}
				>
					<DictionarySectionContent
						content={section.content}
						word={word}
						theme={theme}
						title={`${result.sourceLabel} · ${section.title}`}
						onLookup={onLookup}
						onClose={onClose}
						mainTabShortcut={mainTabShortcut}
						onOpenMainTab={onOpenMainTab}
						fitContent
						strings={strings}
					/>
				</section>
			))}
		</div>
	);
});
