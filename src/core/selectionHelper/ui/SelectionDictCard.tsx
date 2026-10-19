import React, { useEffect, useRef } from "react";
import { Bookmark, RotateCcw, Sparkles } from "lucide-react";
import { cls } from "../../shared/classNames";
import type { SelectionLookupSession, SelectionLookupSnapshot } from "../domain/types";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import type { Language } from "../../shared/types";
import type { SelectionResultContentRenderer } from "./types";
import styles from "./SelectionPopup.module.scss";

export interface SelectionDictCardProps {
	query: string;
	lookup: SelectionLookupSnapshot;
	session: SelectionLookupSession;
	strings: SelectionHelperStrings;
	language: Language;
	theme: "dark" | "light";
	renderResultContent?: SelectionResultContentRenderer;
	onOpenInMainTab: (word: string) => void;
	onFavorite?: (word: string) => void;
	onClose: () => void;
	onHeaderPointerDown?: React.PointerEventHandler<HTMLElement>;
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
	const { query, lookup, session, strings, onOpenInMainTab, onFavorite, onClose } = props;
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const activeWord = lookup.query || query;
	const activeSource =
		lookup.sources.find((source) => source.id === lookup.activeSourceId) ?? lookup.sources[0];
	const ResultContent = props.renderResultContent;
	const retry = () =>
		activeSource &&
		void (activeSource.kind === "ai" ? session.generateAi() : session.retry(activeSource.id));

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
				<div className={styles.dragHandle} onPointerDown={props.onHeaderPointerDown}>
					<div className={styles.titleRow}>
						<h3 className={styles.word}>{activeWord}</h3>
						<div className={styles.headerActions}>
							{onFavorite && (
								<button
									type="button"
									className={styles.favoriteButton}
									onClick={() => onFavorite(activeWord)}
									aria-label={strings.favorite}
									title={strings.favorite}
								>
									<Bookmark size={14} aria-hidden="true" />
									<span>{strings.favorite}</span>
								</button>
							)}
							<button
								type="button"
								className={styles.closeButton}
								onClick={onClose}
								aria-label={strings.close}
							>
								{strings.close} <kbd>Esc</kbd>
							</button>
						</div>
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
				</div>
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
								onClick={() => session.selectSource(source.id)}
							>
								{source.label}
							</button>
						))}
					</div>
				)}
			</header>
			<main
				key={`${activeWord}-${activeSource?.id}`}
				className={cls(styles.body, activeSource?.result && styles.resultBody)}
			>
				{activeSource?.kind === "ai" && activeSource.status === "idle" ? (
					<div className={styles.aiAction}>
						<button
							type="button"
							className={styles.aiGenerateBtn}
							onClick={() => void session.generateAi()}
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
				) : activeSource?.result ? (
					<SelectionContentBoundary fallback={failure}>
						{ResultContent ? (
							<ResultContent
								handle={activeSource.result}
								language={props.language}
								theme={props.theme}
								onLookup={(word) => void session.lookup(word)}
								onSelectSection={(sectionIndex) =>
									activeSource &&
									session.selectSection(activeSource.id, sectionIndex)
								}
								onClose={onClose}
							/>
						) : (
							failure
						)}
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
