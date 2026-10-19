import React, { useEffect, useRef } from "react";
import { Bookmark, RotateCcw, Sparkles } from "lucide-react";
import { cls } from "../../shared/classNames";
import type { SelectionLookupSession, SelectionLookupSnapshot } from "../domain/types";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import type { Language } from "../../shared/types";
import type { SelectionResultContentRenderer } from "./types";
import { matchesOpenMainShortcut } from "../settings/openMainShortcut";
import styles from "./SelectionPopup.module.scss";

export interface SelectionDictCardProps {
	query: string;
	lookup: SelectionLookupSnapshot;
	session: SelectionLookupSession | null;
	onLookup?: (query: string) => void;
	strings: SelectionHelperStrings;
	language: Language;
	theme: "dark" | "light";
	renderResultContent?: SelectionResultContentRenderer;
	onOpenInMainTab: (word: string) => void;
	onFavorite?: (word: string) => void;
	onClose: () => void;
	openMainShortcut: string;
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

/** The handoff shortcut belongs to this popup, including its editable query. */
export function allowsMainTabShortcut(
	event: KeyboardEvent,
	card: HTMLDialogElement | null,
	shortcut: string,
): boolean {
	return (
		!!card &&
		card.contains(event.target as Node) &&
		!event.defaultPrevented &&
		!event.isComposing &&
		matchesOpenMainShortcut(event, shortcut)
	);
}

export const SelectionDictCard = React.memo(function SelectionDictCard(
	props: SelectionDictCardProps,
) {
	const { query, lookup, session, strings, onOpenInMainTab, onFavorite, onClose } = props;
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const activeWord = lookup.query || query;
	const activeSource =
		lookup.sources.find((source) => source.id === lookup.activeSourceId) ?? lookup.sources[0];
	const ResultContent = props.renderResultContent;
	const retry = () =>
		activeSource &&
		void (activeSource.kind === "ai" ? session?.generateAi() : session?.retry(activeSource.id));

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	useEffect(() => {
		if (inputRef.current) inputRef.current.value = activeWord;
	}, [activeWord]);

	useEffect(() => {
		const ownerWindow = cardRef.current?.ownerDocument.defaultView;
		if (!ownerWindow) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			} else if (allowsMainTabShortcut(event, cardRef.current, props.openMainShortcut)) {
				event.preventDefault();
				event.stopPropagation();
				onOpenInMainTab(activeWord);
			}
		};
		ownerWindow.addEventListener("keydown", handleKeyDown, true);
		return () => ownerWindow.removeEventListener("keydown", handleKeyDown, true);
	}, [activeWord, onOpenInMainTab, onClose, props.openMainShortcut]);

	const submitDraft: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
		if (
			event.key !== "Enter" ||
			event.nativeEvent.isComposing ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			event.shiftKey
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		const normalized = event.currentTarget.value.trim().replace(/\s+/g, " ");
		if (!normalized) return;
		event.currentTarget.value = normalized;
		if (props.onLookup) props.onLookup(normalized);
		else void session?.lookup(normalized);
	};

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
		<dialog
			ref={cardRef}
			open
			className={styles.card}
			aria-label={activeWord || strings.lookupInputLabel}
			tabIndex={-1}
		>
			<header className={styles.header}>
				<div className={styles.dragHandle} onPointerDown={props.onHeaderPointerDown}>
					<div className={styles.titleRow}>
						<input
							ref={inputRef}
							type="text"
							className={styles.word}
							defaultValue={activeWord}
							onKeyDown={submitDraft}
							aria-label={strings.lookupInputLabel}
							autoComplete="off"
							spellCheck={false}
						/>
						<div className={styles.headerActions}>
							{onFavorite && (
								<button
									type="button"
									className={styles.favoriteButton}
									onClick={() => onFavorite(activeWord)}
									aria-label={strings.favorite}
									title={strings.favorite}
									disabled={!activeWord}
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
								onClick={() => session?.selectSource(source.id)}
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
				{!session ? (
					<output className={styles.status}>
						{lookup.sources.length
							? strings.lookupPrompt
							: strings.noDictionariesAvailable}
					</output>
				) : activeSource?.kind === "ai" && activeSource.status === "idle" ? (
					<div className={styles.aiAction}>
						<button
							type="button"
							className={styles.aiGenerateBtn}
							onClick={() => void session?.generateAi()}
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
								onLookup={(word) => void session?.lookup(word)}
								onSelectSection={(sectionIndex) =>
									activeSource &&
									session?.selectSection(activeSource.id, sectionIndex)
								}
								onClose={onClose}
								mainTabShortcut={props.openMainShortcut}
								onOpenMainTab={() => onOpenInMainTab(activeWord)}
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
					title={strings.openInMainTabHint(props.openMainShortcut)}
					disabled={!activeWord}
				>
					{strings.openInMainTab} <kbd>{props.openMainShortcut}</kbd>
				</button>
			</footer>
		</dialog>
	);
});
