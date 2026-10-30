import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bookmark, RotateCcw, Sparkles } from "lucide-react";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import type { SelectionLookupSlotProps } from "../../../core/selectionHelper/domain/types";
import { matchesOpenMainShortcut } from "../../../core/selectionHelper/settings/openMainShortcut";
import { orderSelectionDictionaries } from "../domain/dictionaryOrder";
import type { DictionaryRuntime } from "../domain/dictionaryRuntime";
import type { DictionaryQuerySession } from "../domain/querySession";
import { dictionaryStrings } from "../strings/dictionary";
import { selectionHelperStrings } from "../../../core/selectionHelper/strings/selectionPopup";
import {
	DictionarySectionContent,
	getTabSections,
	getVisibleSections,
} from "./resultPresentation/DictionarySectionContent";
import styles from "./LookupAssistantCard.module.scss";
import resultContentStyles from "./SelectionDictionaryResultContent.module.scss";

export interface LookupAssistantCardProps extends SelectionLookupSlotProps {
	runtime?: DictionaryRuntime | null;
	openFavorite?: (word: string) => Promise<void>;
	openInMainTab?: (word: string) => Promise<void>;
	getLanguage?: () => Language;
	getTheme?: () => "dark" | "light";
}

class SelectionContentBoundary extends React.Component<
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

export function allowsMainTabShortcut(
	event: KeyboardEvent,
	card: HTMLElement | null,
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

export function LookupAssistantCardView(props: LookupAssistantCardProps) {
	const {
		runtime,
		word,
		onClose,
		onHeaderPointerDown,
		openMainShortcut = "",
		openInMainTab,
		openFavorite,
	} = props;
	const [activeWord, setActiveWord] = useState(word);
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const language = props.getLanguage?.() ?? "zh";
	const theme = props.getTheme?.() ?? "dark";
	const dictStrings = dictionaryStrings(language);
	const strings = selectionHelperStrings(language);

	// Compute filtered and ordered source IDs
	const dictSettings = runtime?.settings?.getDictionarySettings();
	const availableSources = dictSettings?.sources.filter((s) => s.enabled) ?? [];
	const orderedSources = orderSelectionDictionaries(
		availableSources,
		props.dictionaryOrder ?? [],
	);
	const selected = props.selectedDictionaries ?? [];
	const activeSourceIds = (
		selected.length === 0
			? orderedSources
			: orderedSources.filter((s) => selected.includes(s.id))
	).map((s) => s.id);

	// Dedicated query session for this card instance
	const [session, setSession] = useState<DictionaryQuerySession | null>(() => {
		if (!runtime || activeSourceIds.length === 0) return null;
		return runtime.createSelectionLookupSession(activeWord, activeSourceIds);
	});

	useEffect(() => {
		return () => {
			session?.dispose();
		};
	}, [session]);

	const snapshot = useSyncExternalStore(
		useCallback(
			(listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
			[session],
		),
		useCallback(() => session?.getSnapshot() ?? null, [session]),
	);

	const displayedWord = snapshot?.query || activeWord;
	const activeSource =
		snapshot?.sources.find((source) => source.id === snapshot.activeSourceId) ??
		snapshot?.sources[0];

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	useEffect(() => {
		if (inputRef.current) inputRef.current.value = displayedWord;
	}, [displayedWord]);

	useEffect(() => {
		const ownerWindow = cardRef.current?.ownerDocument.defaultView;
		if (!ownerWindow) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			} else if (allowsMainTabShortcut(event, cardRef.current, openMainShortcut)) {
				event.preventDefault();
				event.stopPropagation();
				if (openInMainTab) {
					void openInMainTab(displayedWord);
					onClose();
				}
			}
		};
		ownerWindow.addEventListener("keydown", handleKeyDown, true);
		return () => ownerWindow.removeEventListener("keydown", handleKeyDown, true);
	}, [displayedWord, onClose, openInMainTab, openMainShortcut]);

	const executeLookup = (query: string) => {
		const normalized = query.trim().replace(/\s+/g, " ");
		if (!normalized) return;
		setActiveWord(normalized);
		if (session) {
			void session.send({ type: "lookup", query: normalized });
		} else if (runtime && activeSourceIds.length > 0) {
			const newSession = runtime.createSelectionLookupSession(normalized, activeSourceIds);
			setSession(newSession);
		}
	};

	const submitDraft: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
		if (
			event.key !== "Enter" ||
			event.nativeEvent?.isComposing ||
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
		executeLookup(normalized);
	};

	const retry = () => {
		if (!activeSource || !session) return;
		void session.send(
			activeSource.kind === "ai"
				? { type: "generate-ai" }
				: { type: "retry-source", sourceId: activeSource.id },
		);
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

	const pronunciations = activeSource?.result?.pronunciations ?? [];
	const result = activeSource?.result;
	const detailTabs = result ? getTabSections(result.sections) : [];
	const visibleSections = result
		? getVisibleSections(result.sections, activeSource?.activeSectionIndex ?? null)
		: [];
	const hasDocument = visibleSections.some(({ section }) => section.content.kind === "document");

	return (
		<dialog
			ref={cardRef}
			open
			className={styles.card}
			aria-label={displayedWord || strings.lookupInputLabel}
			tabIndex={-1}
		>
			<header className={styles.header}>
				<div className={styles.dragHandle} onPointerDown={onHeaderPointerDown}>
					<div className={styles.titleRow}>
						<input
							ref={inputRef}
							type="text"
							className={styles.word}
							defaultValue={displayedWord}
							onKeyDown={submitDraft}
							aria-label={strings.lookupInputLabel}
							autoComplete="off"
							spellCheck={false}
						/>
						<div className={styles.headerActions}>
							{openFavorite && (
								<button
									type="button"
									className={styles.favoriteButton}
									onClick={() => void openFavorite(displayedWord)}
									aria-label={strings.favorite}
									title={strings.favorite}
									disabled={!displayedWord}
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
					{pronunciations.length > 0 && (
						<div className={styles.phonetics}>
							{pronunciations.map((p, idx) => (
								<span key={`${idx}-${p.label}-${p.phonetic}`}>
									{p.label ? `[${p.label}] ` : ""}
									{p.phonetic ? `/${p.phonetic}/` : ""}
								</span>
							))}
						</div>
					)}
				</div>
				{snapshot && snapshot.sources.length > 1 && (
					<div className={styles.tabs} role="tablist" aria-label={strings.lookup}>
						{snapshot.sources.map((source) => (
							<button
								key={source.id}
								type="button"
								role="tab"
								aria-selected={source.id === activeSource?.id}
								className={cls(
									styles.tab,
									source.id === activeSource?.id && styles.tabActive,
								)}
								onClick={() =>
									void session?.send({
										type: "select-source",
										sourceId: source.id,
									})
								}
							>
								{source.label}
							</button>
						))}
					</div>
				)}
			</header>
			<main
				key={`${displayedWord}-${activeSource?.id}`}
				className={cls(styles.body, activeSource?.result && styles.resultBody)}
			>
				{!snapshot || snapshot.sources.length === 0 ? (
					<output className={styles.status}>{strings.noDictionariesAvailable}</output>
				) : activeSource?.kind === "ai" && activeSource.status === "idle" ? (
					<div className={styles.aiAction}>
						<button
							type="button"
							className={styles.aiGenerateBtn}
							onClick={() => void session?.send({ type: "generate-ai" })}
						>
							<Sparkles size={14} aria-hidden="true" />
							<span>{strings.aiGenerate}</span>
						</button>
						{snapshot.aiEngineName && (
							<span className={styles.aiEngineHint}>{snapshot.aiEngineName}</span>
						)}
					</div>
				) : activeSource?.status === "loading" ||
				  (activeSource?.status === "idle" && snapshot.status === "loading") ? (
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
				) : result ? (
					<SelectionContentBoundary fallback={failure}>
						<div
							className={cls(
								resultContentStyles.result,
								hasDocument && resultContentStyles.rich,
							)}
						>
							{detailTabs.length > 0 && (
								<div
									className={resultContentStyles.detailTabs}
									role="tablist"
									aria-label={dictStrings.details}
								>
									{detailTabs.map(({ index, section }) => {
										const active =
											index === (activeSource?.activeSectionIndex ?? null);
										return (
											<button
												key={`${index}-${section.title}`}
												type="button"
												role="tab"
												aria-selected={active}
												className={cls(
													resultContentStyles.tab,
													active && resultContentStyles.tabActive,
												)}
												onClick={() =>
													void session?.send({
														type: "select-section",
														sourceId: activeSource.id,
														sectionIndex: index,
													})
												}
											>
												{section.title}
											</button>
										);
									})}
								</div>
							)}
							{visibleSections.map(({ index, section }) => (
								<section
									key={`${index}-${section.title}`}
									className={cls(
										resultContentStyles.section,
										section.content.kind === "document" &&
											resultContentStyles.documentSection,
									)}
								>
									<DictionarySectionContent
										content={section.content}
										word={displayedWord}
										theme={theme}
										title={`${activeSource?.label ?? ""} · ${section.title}`}
										onLookup={executeLookup}
										onClose={onClose}
										mainTabShortcut={openMainShortcut}
										onOpenMainTab={() => {
											if (openInMainTab) {
												void openInMainTab(displayedWord);
												onClose();
											}
										}}
										fitContent
										strings={dictStrings}
									/>
								</section>
							))}
						</div>
					</SelectionContentBoundary>
				) : (
					<output className={styles.status}>
						{snapshot.status === "loading" ? strings.loading : strings.emptyDefinition}
					</output>
				)}
			</main>
			<footer className={styles.footer}>
				<button
					type="button"
					className={styles.openButton}
					onClick={() => {
						if (openInMainTab) {
							void openInMainTab(displayedWord);
							onClose();
						}
					}}
					title={strings.openInMainTabHint(openMainShortcut)}
					disabled={!displayedWord}
				>
					{strings.openInMainTab} <kbd>{openMainShortcut}</kbd>
				</button>
			</footer>
		</dialog>
	);
}

export const LookupAssistantCard = React.memo(LookupAssistantCardView);
