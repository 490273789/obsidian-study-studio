import React, { useEffect, useRef } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import { cls } from "../../shared/classNames";
import type { SelectionLookupSection, SelectionLookupSnapshot } from "../domain/types";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import type { SelectionEmbeddedContentRenderer } from "./types";
import styles from "./SelectionPopup.module.scss";

export interface SelectionDictCardProps {
	query: string;
	lookup: SelectionLookupSnapshot;
	strings: SelectionHelperStrings;
	theme: "dark" | "light";
	renderEmbeddedContent?: SelectionEmbeddedContentRenderer;
	onSelectSource: (sourceId: string) => void;
	onSelectSection: (sourceId: string, sectionIndex: number) => void;
	onLookup: (word: string) => void;
	onRetry: (sourceId: string) => void;
	onGenerateAi: () => void;
	onOpenInMainTab: (word: string) => void;
	onClose: () => void;
}

export class SelectionContentBoundary extends React.Component<
	{ children: React.ReactNode; fallback: React.ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	render(): React.ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function SectionContent({
	section,
	props,
	title,
	fitContent,
}: {
	section: SelectionLookupSection;
	props: SelectionDictCardProps;
	title: string;
	fitContent: boolean;
}): React.ReactNode {
	if (section.kind === "list") {
		return (
			<ol className={styles.list}>
				{section.items.map((item, index) => (
					<li key={`${index}-${item}`}>{item}</li>
				))}
			</ol>
		);
	}
	if (section.kind === "embedded") {
		const Renderer = props.renderEmbeddedContent;
		if (!Renderer) throw new Error("Dictionary content renderer unavailable");
		return (
			<Renderer
				handle={section.handle}
				theme={props.theme}
				title={title}
				className={styles.embedded}
				fitContent={fitContent}
				onLookup={props.onLookup}
				onClose={props.onClose}
			/>
		);
	}
	return (
		<div>
			{section.definitions.map((def, index) => (
				<div key={`${index}-${def.partOfSpeech}`} className={styles.aiSense}>
					{def.partOfSpeech && (
						<span className={styles.sensePos}>{def.partOfSpeech}</span>
					)}
					<span className={styles.senseMeaning}>{def.meaning}</span>
				</div>
			))}
		</div>
	);
}

/** Enter belongs to focused controls and dictionary documents, not the popup shortcut. */
export function allowsMainTabShortcut(event: KeyboardEvent): boolean {
	if (
		event.key !== "Enter" ||
		event.defaultPrevented ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey
	)
		return false;
	const target = event.target as HTMLElement | null;
	return !target?.closest?.(
		"a,button,input,textarea,select,iframe,[contenteditable]:not([contenteditable='false']),[role='button'],[role='tab']",
	);
}

export const SelectionDictCard = React.memo(function SelectionDictCard(
	props: SelectionDictCardProps,
) {
	const {
		query,
		lookup,
		strings,
		onSelectSource,
		onSelectSection,
		onRetry,
		onGenerateAi,
		onOpenInMainTab,
		onClose,
	} = props;
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const activeWord = lookup.query || query;
	const activeSource =
		lookup.sources.find((source) => source.id === lookup.activeSourceId) ?? lookup.sources[0];
	const sections = activeSource?.sections ?? [];
	const tabs = sections
		.map((section, index) => ({ section, index }))
		.filter(({ section }) => section.presentation === "tab");
	const visible = sections
		.map((section, index) => ({ section, index }))
		.filter(
			({ section, index }) =>
				section.presentation === "stack" || index === activeSource?.activeSectionIndex,
		);
	const rich = visible.some(({ section }) => section.kind === "embedded");
	const retry = () =>
		activeSource && (activeSource.kind === "ai" ? onGenerateAi() : onRetry(activeSource.id));

	useEffect(() => {
		const ownerWindow = cardRef.current?.ownerDocument.defaultView;
		if (!ownerWindow) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			} else if (allowsMainTabShortcut(event)) {
				event.preventDefault();
				event.stopPropagation();
				onOpenInMainTab(activeWord);
			}
		};
		ownerWindow.addEventListener("keydown", handleKeyDown, true);
		return () => ownerWindow.removeEventListener("keydown", handleKeyDown, true);
	}, [activeWord, onOpenInMainTab, onClose]);

	const failure = (
		<div className={cls(styles.status, styles.statusError)} role="alert">
			<p>{strings.renderFailed}</p>
			<button type="button" className={styles.aiGenerateBtn} onClick={retry}>
				<RotateCcw size={14} aria-hidden="true" />
				{strings.retry}
			</button>
		</div>
	);

	return (
		<dialog ref={cardRef} open className={styles.card} aria-label={activeWord} tabIndex={-1}>
			<header className={styles.header}>
				<div className={styles.titleRow}>
					<h3 className={styles.word}>{activeWord}</h3>
					<button
						type="button"
						className={styles.closeButton}
						onClick={onClose}
						aria-label={strings.close}
					>
						{strings.close} <kbd>Esc</kbd>
					</button>
				</div>
				{(activeSource?.pronunciations.length ?? 0) > 0 && (
					<div className={styles.phonetics}>
						{activeSource?.pronunciations.map((p, idx) => (
							<span key={`${idx}-${p.label}-${p.phonetic}`}>
								{p.label ? `[${p.label}] ` : ""}
								{p.phonetic ? `/${p.phonetic}/` : ""}
							</span>
						))}
					</div>
				)}
				{lookup.sources.length > 1 && (
					<div className={styles.tabs} role="tablist" aria-label={strings.lookup}>
						{lookup.sources.map((source) => (
							<button
								key={source.id}
								type="button"
								role="tab"
								aria-selected={source.id === activeSource?.id}
								className={cls(
									styles.tab,
									source.id === activeSource?.id && styles.tabActive,
								)}
								onClick={() => onSelectSource(source.id)}
							>
								{source.label}
							</button>
						))}
					</div>
				)}
			</header>
			<main
				key={`${activeWord}-${activeSource?.id}`}
				className={cls(
					styles.body,
					rich && activeSource?.status === "success" && styles.bodyRich,
				)}
			>
				{activeSource?.kind === "ai" && activeSource.status === "idle" ? (
					<div className={styles.aiAction}>
						<button
							type="button"
							className={styles.aiGenerateBtn}
							onClick={onGenerateAi}
						>
							<Sparkles size={14} aria-hidden="true" />
							<span>{strings.aiGenerate}</span>
						</button>
						{lookup.aiEngineName && (
							<span className={styles.aiEngineHint}>{lookup.aiEngineName}</span>
						)}
					</div>
				) : activeSource?.status === "loading" ||
				  (activeSource?.status === "idle" && lookup.status === "loading") ? (
					<output className={styles.status}>
						{activeSource?.kind === "ai" ? strings.aiGenerating : strings.loading}
					</output>
				) : activeSource?.status === "empty" ? (
					<output className={styles.status}>{strings.emptyDefinition}</output>
				) : activeSource?.status === "error" ? (
					<div className={cls(styles.status, styles.statusError)} role="alert">
						<p>{activeSource.error || strings.emptyDefinition}</p>
						<button type="button" className={styles.aiGenerateBtn} onClick={retry}>
							<RotateCcw size={14} aria-hidden="true" />
							<span>{strings.retry}</span>
						</button>
					</div>
				) : visible.length > 0 ? (
					<SelectionContentBoundary fallback={failure}>
						{tabs.length > 0 && (
							<div
								className={styles.sectionTabs}
								role="tablist"
								aria-label={strings.details}
							>
								{tabs.map(({ section, index }) => (
									<button
										key={index}
										type="button"
										role="tab"
										aria-selected={index === activeSource?.activeSectionIndex}
										className={cls(
											styles.tab,
											index === activeSource?.activeSectionIndex &&
												styles.tabActive,
										)}
										onClick={() =>
											activeSource && onSelectSection(activeSource.id, index)
										}
									>
										{section.title}
									</button>
								))}
							</div>
						)}
						{visible.map(({ section, index }) => (
							<section
								key={index}
								className={
									section.kind === "embedded"
										? styles.documentSection
										: styles.plainSection
								}
								aria-label={section.title}
								role={section.presentation === "tab" ? "tabpanel" : undefined}
							>
								<SectionContent
									section={section}
									props={props}
									title={`${activeSource?.label} · ${section.title}`}
									fitContent
								/>
							</section>
						))}
					</SelectionContentBoundary>
				) : (
					<output className={styles.status}>
						{lookup.status === "loading" ? strings.loading : strings.emptyDefinition}
					</output>
				)}
			</main>
			<footer className={styles.footer}>
				<button
					type="button"
					className={styles.openButton}
					onClick={() => onOpenInMainTab(activeWord)}
					title={strings.openInMainTabHint}
				>
					{strings.openInMainTab} <kbd>Enter</kbd>
				</button>
			</footer>
		</dialog>
	);
});
