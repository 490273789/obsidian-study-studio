import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	Bookmark,
	Check,
	ChevronDown,
	ChevronUp,
	Copy,
	ListPlus,
	Play,
	RotateCcw,
	Search,
	Settings2,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import type { DictionaryQuerySession } from "../domain/querySession";
import type { DictionarySourceState } from "../domain/types";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";
import {
	DictionarySectionContent as DictionarySectionContentView,
	getTabSections,
} from "./resultPresentation/DictionarySectionContent";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../core/ui/primitives/Input";
import { FlashcardMenu } from "../../../core/ui/primitives/Menu";
import { canPlayDictionaryAudio } from "./audio";
import { cls } from "../../../core/shared/classNames";
import styles from "./Dictionary.module.scss";

export interface DictionaryViewProps {
	query: DictionaryQuerySession;
	searchInputRef?: React.Ref<HTMLInputElement>;
	language: Language;
	onOpenFavorite: (word: string) => Promise<void>;
	onOpenBatchFavorite: () => void;
	onOpenSettings: () => void;
	onPlayAudio: (url: string) => Promise<void>;
	/** Obsidian theme, seeded before the sandbox document loads. */
	theme: "dark" | "light";
}

const RECENT_HISTORY_COUNT = 3;
const dictionarySectionTitles = dictionaryStrings("zh").sections;
const primaryDetailTitles = [
	dictionarySectionTitles.englishDefinitions,
	dictionarySectionTitles.wordForms,
	dictionarySectionTitles.phrases,
];

function sourceTabId(sourceId: string): string {
	return `dictionary-source-tab-${sourceId}`;
}

function sourcePanelId(sourceId: string): string {
	return `dictionary-source-panel-${sourceId}`;
}

function sectionTabId(sourceId: string, sectionIndex: number): string {
	return `dictionary-section-tab-${sourceId}-${sectionIndex}`;
}

function sectionPanelId(sourceId: string, sectionIndex: number): string {
	return `dictionary-section-panel-${sourceId}-${sectionIndex}`;
}

function sourceStatusLabel(source: DictionarySourceState, strings: DictionaryStrings): string {
	if (source.status === "loading") return strings.loading;
	if (source.status === "success") return strings.sourceReady;
	if (source.status === "empty") return strings.sourceEmpty;
	if (source.status === "error") return strings.sourceFailed;
	return strings.sourceIdle;
}

/** Arrow/Home/End roving focus shared by the source and detail tab strips. */
function moveTabFocus(
	event: React.KeyboardEvent<HTMLElement>,
	container: HTMLElement | null,
	currentIndex: number,
	count: number,
	select: (index: number) => void,
): void {
	if (count === 0) return;
	const forward = event.key === "ArrowRight";
	const backward = event.key === "ArrowLeft";
	if (event.key !== "Home" && event.key !== "End" && !forward && !backward) return;
	event.preventDefault();
	const nextIndex =
		event.key === "Home"
			? 0
			: event.key === "End"
				? count - 1
				: (currentIndex + (forward ? 1 : -1) + count) % count;
	select(nextIndex);
	container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
}

export function DictionaryView({
	query,
	searchInputRef,
	language,
	onOpenFavorite,
	onOpenBatchFavorite,
	onOpenSettings,
	onPlayAudio,
	theme,
}: DictionaryViewProps): React.ReactElement {
	const subscribe = useCallback((listener: () => void) => query.subscribe(listener), [query]);
	const getSnapshot = useCallback(() => query.getSnapshot(), [query]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	const strings = dictionaryStrings(language);
	const [copiedWord, setCopiedWord] = useState<string | null>(null);
	const [historyExpanded, setHistoryExpanded] = useState(false);
	const [expandedDetailSourceId, setExpandedDetailSourceId] = useState<string | null>(null);
	const historyToggleRef = useRef<HTMLButtonElement | null>(null);
	const copyTimeoutRef = useRef<number | null>(null);
	const sourceTablistRef = useRef<HTMLDivElement | null>(null);

	const isLoading = state.status === "loading";
	const canLookup = Boolean(state.input.trim()) && state.status !== "loading";
	const queryWord = state.query;

	useEffect(() => {
		return () => {
			if (copyTimeoutRef.current !== null) {
				window.clearTimeout(copyTimeoutRef.current);
			}
		};
	}, []);

	const copyWord = async (word: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(word);
			setCopiedWord(word);
			if (copyTimeoutRef.current !== null) {
				window.clearTimeout(copyTimeoutRef.current);
			}
			copyTimeoutRef.current = window.setTimeout(() => {
				setCopiedWord(null);
			}, 1500);
		} catch {
			// Clipboard write failure ignored
		}
	};

	const lookupWord = useCallback(
		(word: string): void => {
			setCopiedWord(null);
			void query.send({ type: "lookup", query: word });
		},
		[query],
	);

	return (
		<main
			className={cls(
				"flashcard-dictionary flashcard-dictionary-page fc-page",
				styles.page,
				styles.dictionary,
			)}
			aria-busy={isLoading}
		>
			<h1 className={cls("flashcard-dictionary-visually-hidden", styles.visuallyHidden)}>
				{strings.displayName}
			</h1>

			<div className={cls("flashcard-dictionary-chrome", styles.chrome)}>
				<div className={cls("flashcard-dictionary-search-row", styles.searchRow)}>
					<search className="flashcard-dictionary-search">
						<form
							className="flashcard-dictionary-search-form"
							onSubmit={(event) => {
								event.preventDefault();
								if (canLookup) void query.send({ type: "lookup" });
							}}
						>
							<fieldset
								className={cls(
									"flashcard-dictionary-search-controls",
									styles.searchControls,
								)}
							>
								<legend
									className={cls(
										"flashcard-dictionary-visually-hidden",
										styles.visuallyHidden,
									)}
								>
									{strings.inputLabel}
								</legend>
								<FlashcardInput
									id="dictionary-query"
									ref={searchInputRef}
									variant="unstyled"
									className={cls(
										"flashcard-dictionary-search-input",
										styles.searchInput,
									)}
									value={state.input}
									maxLength={128}
									autoComplete="off"
									spellCheck={false}
									aria-label={strings.inputLabel}
									placeholder={strings.inputPlaceholder}
									onChange={(event) =>
										void query.send({
											type: "change-input",
											value: event.target.value,
										})
									}
								/>
								{state.input && (
									<FlashcardButton
										type="button"
										preset="icon"
										size="sm"
										icon={X}
										title={strings.clearInput}
										aria-label={strings.clearInput}
										onClick={() => {
											void query.send({ type: "change-input", value: "" });
										}}
									/>
								)}
								<FlashcardButton
									type="submit"
									variant="primary"
									icon={Search}
									iconSize={18}
									disabled={!canLookup}
								>
									{strings.query}
								</FlashcardButton>
							</fieldset>
						</form>
					</search>
					<div className={cls("flashcard-dictionary-toolbar", styles.toolbar)}>
						<FlashcardMenu
							triggerTitle={strings.dictionaryActions}
							ariaLabel={strings.dictionaryActions}
							presentation="floating"
							items={[
								{
									key: "batch-favorite",
									icon: ListPlus,
									label: strings.favoriteBatchOpen,
									onSelect: onOpenBatchFavorite,
								},
								{
									key: "settings",
									icon: Settings2,
									label: strings.openSettings,
									onSelect: onOpenSettings,
								},
								{
									key: "clear-query",
									icon: Trash2,
									label: strings.clearQueryAndResults,
									disabled: !state.input && !state.query,
									onSelect: () => void query.send({ type: "clear" }),
								},
							]}
						/>
					</div>
				</div>

				{state.history.length > 0 && (
					<section className="flashcard-dictionary-saved" aria-label={strings.history}>
						<div className={cls("flashcard-dictionary-saved-list", styles.savedList)}>
							<strong>{strings.history}</strong>
							<div className={styles.recentWords}>
								{state.history.slice(0, RECENT_HISTORY_COUNT).map((word) => (
									<FlashcardButton
										key={word}
										size="sm"
										variant="ghost"
										title={word}
										onClick={() => lookupWord(word)}
									>
										{word}
									</FlashcardButton>
								))}
							</div>
							<FlashcardButton
								ref={historyToggleRef}
								variant="ghost"
								size="sm"
								icon={historyExpanded ? ChevronUp : ChevronDown}
								aria-expanded={historyExpanded}
								aria-controls="dictionary-history"
								onClick={() => setHistoryExpanded(!historyExpanded)}
							>
								{historyExpanded
									? strings.collapseHistory
									: state.history.length > RECENT_HISTORY_COUNT
										? strings.moreHistory
										: strings.manageHistory}
							</FlashcardButton>
						</div>
						<ul
							id="dictionary-history"
							className={styles.historyList}
							hidden={!historyExpanded}
						>
							{historyExpanded &&
								state.history.map((word) => (
									<li key={word} className={styles.historyItem}>
										<FlashcardButton
											size="sm"
											variant="ghost"
											onClick={() => {
												setHistoryExpanded(false);
												historyToggleRef.current?.focus();
												lookupWord(word);
											}}
										>
											{word}
										</FlashcardButton>
										<FlashcardButton
											preset="icon"
											size="sm"
											icon={X}
											title={strings.removeHistoryItem(word)}
											aria-label={strings.removeHistoryItem(word)}
											onClick={(event) => {
												if (state.history.length === 1) {
													setHistoryExpanded(false);
													event.currentTarget
														.closest("main")
														?.querySelector<HTMLInputElement>(
															"#dictionary-query",
														)
														?.focus();
												} else {
													historyToggleRef.current?.focus();
												}
												void query.send({ type: "remove-history", word });
											}}
										/>
									</li>
								))}
						</ul>
					</section>
				)}
			</div>

			{!state.query ? (
				<p className={cls("flashcard-dictionary-placeholder", styles.placeholder)}>
					{strings.noQuery}
				</p>
			) : state.sources.length === 0 ? (
				<p className={cls("flashcard-dictionary-placeholder", styles.placeholder)}>
					{strings.noEnabledSources}
				</p>
			) : null}

			{state.sources.length > 0 && (
				<div
					ref={sourceTablistRef}
					className={cls("flashcard-dictionary-tabs", styles.tabs)}
					role="tablist"
					aria-label={strings.sourceMenu}
				>
					{state.sources.map((source, sourceIndex) => {
						const selected = state.activeSourceId === source.id;
						return (
							<button
								key={source.id}
								id={sourceTabId(source.id)}
								type="button"
								role="tab"
								className={cls(
									"flashcard-dictionary-tab",
									`is-${source.status}`,
									styles.tab,
									selected && ["is-active", styles.isActive],
									source.status === "loading" && styles.isLoading,
									source.status === "success" && styles.isSuccess,
									source.status === "empty" && styles.isEmpty,
									source.status === "error" && styles.isError,
								)}
								aria-controls={sourcePanelId(source.id)}
								aria-label={`${source.label} · ${sourceStatusLabel(source, strings)}`}
								aria-selected={selected}
								tabIndex={selected ? 0 : -1}
								onClick={() =>
									void query.send({
										type: "select-source",
										sourceId: source.id,
									})
								}
								onKeyDown={(event) =>
									moveTabFocus(
										event,
										sourceTablistRef.current,
										sourceIndex,
										state.sources.length,
										(nextIndex) => {
											const next = state.sources[nextIndex];
											if (next)
												void query.send({
													type: "select-source",
													sourceId: next.id,
												});
										},
									)
								}
							>
								<span
									className={cls(
										"flashcard-dictionary-tab-status",
										styles.tabStatus,
									)}
									aria-hidden="true"
								/>
								<span>{source.label}</span>
							</button>
						);
					})}
				</div>
			)}

			<section
				className={cls("flashcard-dictionary-results", styles.results)}
				aria-label={strings.results}
			>
				{state.sources.map((source) => {
					const selected = state.activeSourceId === source.id;
					const sections = getTabSections(source.result?.sections ?? []);
					const preferredSections = sections
						.filter(({ section }) => primaryDetailTitles.includes(section.title))
						.slice(0, 3);
					const primarySections =
						preferredSections.length > 0 ? preferredSections : sections.slice(0, 3);
					const hasMoreDetails = sections.length > 3;
					const detailsExpanded = expandedDetailSourceId === source.id;
					const visibleSections =
						hasMoreDetails && !detailsExpanded
							? sections.filter(
									(item) =>
										primarySections.includes(item) ||
										item.index === source.activeSectionIndex,
								)
							: sections;

					const result = source.result;
					const word = result?.word || queryWord;
					return (
						<article
							key={source.id}
							id={sourcePanelId(source.id)}
							data-source-kind={source.kind}
							className={cls("flashcard-dictionary-source fc-panel", styles.source)}
							role="tabpanel"
							aria-labelledby={sourceTabId(source.id)}
							tabIndex={0}
							hidden={!selected}
						>
							<div
								className={cls(
									"flashcard-dictionary-source-body",
									styles.sourceBody,
								)}
							>
								{word && (
									<header className={styles.entryHeader}>
										<h2 dir="auto">{word}</h2>
										<div className={styles.entryActions}>
											<FlashcardButton
												preset="icon"
												size="sm"
												icon={Bookmark}
												title={strings.favoriteAction}
												aria-label={strings.favoriteAction}
												onClick={() => void onOpenFavorite(word)}
											/>
											<FlashcardButton
												preset="icon"
												size="sm"
												icon={copiedWord === word ? Check : Copy}
												title={
													copiedWord === word
														? strings.copied
														: strings.copyWord
												}
												aria-label={
													copiedWord === word
														? strings.copied
														: strings.copyWord
												}
												className={
													copiedWord === word
														? styles.isCopied
														: undefined
												}
												onClick={() => void copyWord(word)}
											/>
										</div>
									</header>
								)}
								{source.kind === "ai" && source.status === "idle" ? (
									<div
										className={cls(
											"flashcard-dictionary-ai-action",
											styles.aiAction,
										)}
									>
										<p>{strings.aiEngineDescription}</p>
										{state.aiEngineName && (
											<p
												className={cls(
													"flashcard-dictionary-ai-engine",
													styles.aiEngine,
												)}
											>
												<span>{strings.aiEngine}</span>
												<span>{state.aiEngineName}</span>
											</p>
										)}
										<FlashcardButton
											variant="primary"
											icon={Sparkles}
											onClick={() => void query.send({ type: "generate-ai" })}
										>
											{strings.aiGenerate}
										</FlashcardButton>
									</div>
								) : source.status === "loading" ? (
									<output
										className={cls(
											"flashcard-dictionary-loading",
											styles.loading,
										)}
									>
										{source.kind === "ai"
											? strings.aiGenerating
											: strings.loading}
									</output>
								) : source.status === "empty" ? (
									<p className={cls("flashcard-dictionary-empty", styles.empty)}>
										{strings.errors.notFound}
									</p>
								) : source.status === "error" ? (
									<div
										className={cls("flashcard-dictionary-error", styles.error)}
										role="alert"
									>
										<p>{source.error}</p>
										<FlashcardButton
											size="sm"
											icon={RotateCcw}
											onClick={() =>
												void query.send({
													type: "retry-source",
													sourceId: source.id,
												})
											}
										>
											{strings.retry}
										</FlashcardButton>
									</div>
								) : null}

								{result && (
									<>
										{result.pronunciations.length > 0 && (
											<div
												className={cls(
													"flashcard-dictionary-pronunciations",
													styles.pronunciations,
												)}
											>
												{result.pronunciations.map((pronunciation) => {
													const audioUrl = pronunciation.audioUrl;
													const playable =
														audioUrl !== null &&
														canPlayDictionaryAudio(audioUrl);
													return (
														<div
															key={`${pronunciation.accent}-${pronunciation.phonetic}`}
														>
															<span>
																{pronunciation.label} /
																{pronunciation.phonetic}/
															</span>
															{playable && (
																<FlashcardButton
																	preset="icon"
																	size="sm"
																	variant="ghost"
																	icon={Play}
																	title={strings.playAudio(
																		pronunciation.label,
																	)}
																	aria-label={strings.playAudio(
																		pronunciation.label,
																	)}
																	onClick={() =>
																		void onPlayAudio(audioUrl)
																	}
																/>
															)}
														</div>
													);
												})}
											</div>
										)}

										{result.sections.map((section, sectionIndex) => {
											if (section.presentation !== "stack") return null;
											const scrollInFrame =
												source.kind === "local" &&
												result.sections.length === 1 &&
												result.suggestions.length === 0 &&
												section.content.kind === "document";
											return (
												<section
													key={`${source.id}-${section.title}-${sectionIndex}`}
													className={cls(
														"flashcard-dictionary-section",
														styles.section,
														section.content.kind === "document" && [
															"is-document",
															styles.isDocument,
														],
													)}
												>
													{source.kind !== "local" && (
														<h3>{section.title}</h3>
													)}
													<DictionarySectionContentView
														content={section.content}
														word={word}
														theme={theme}
														title={`${source.label} · ${section.title}`}
														onLookup={lookupWord}
														strings={strings}
														fitContent={!scrollInFrame}
														className={
															scrollInFrame
																? styles.documentViewport
																: undefined
														}
													/>
												</section>
											);
										})}

										{sections.length > 0 && (
											<div
												className={cls(
													"flashcard-dictionary-details",
													styles.details,
												)}
											>
												<div className={styles.detailNavigation}>
													<div
														id={`dictionary-detail-tabs-${source.id}`}
														className={cls(
															"flashcard-dictionary-detail-tabs",
															styles.detailTabs,
														)}
														role="tablist"
														aria-label={`${source.label} · ${strings.details}`}
													>
														{visibleSections.map((item, tabIndex) => {
															const active =
																source.activeSectionIndex ===
																item.index;
															return (
																<button
																	key={`${source.id}-${item.index}`}
																	id={sectionTabId(
																		source.id,
																		item.index,
																	)}
																	type="button"
																	role="tab"
																	className={cls(
																		active && [
																			"is-active",
																			styles.isActive,
																		],
																	)}
																	aria-controls={sectionPanelId(
																		source.id,
																		item.index,
																	)}
																	aria-selected={active}
																	tabIndex={active ? 0 : -1}
																	onClick={() =>
																		void query.send({
																			type: "select-section",
																			sourceId: source.id,
																			sectionIndex:
																				item.index,
																		})
																	}
																	onKeyDown={(event) =>
																		moveTabFocus(
																			event,
																			event.currentTarget
																				.parentElement,
																			tabIndex,
																			visibleSections.length,
																			(nextIndex) => {
																				const next =
																					visibleSections[
																						nextIndex
																					];
																				if (next)
																					void query.send(
																						{
																							type: "select-section",
																							sourceId:
																								source.id,
																							sectionIndex:
																								next.index,
																						},
																					);
																			},
																		)
																	}
																>
																	{item.section.title}
																</button>
															);
														})}
													</div>
													{hasMoreDetails && (
														<FlashcardButton
															size="sm"
															variant="ghost"
															icon={
																detailsExpanded
																	? ChevronUp
																	: ChevronDown
															}
															aria-expanded={detailsExpanded}
															aria-controls={`dictionary-detail-tabs-${source.id}`}
															onClick={() =>
																setExpandedDetailSourceId(
																	detailsExpanded
																		? null
																		: source.id,
																)
															}
														>
															{detailsExpanded
																? strings.collapseDetails
																: strings.moreDetails}
														</FlashcardButton>
													)}
												</div>
												{sections.map((item) =>
													source.activeSectionIndex === item.index ? (
														<section
															key={`${source.id}-panel-${item.index}`}
															id={sectionPanelId(
																source.id,
																item.index,
															)}
															className={cls(
																"flashcard-dictionary-section flashcard-dictionary-detail-panel",
																styles.section,
																styles.detailPanel,
																item.section.content.kind ===
																	"document" && [
																	"is-document",
																	styles.isDocument,
																],
															)}
															role="tabpanel"
															tabIndex={0}
															aria-labelledby={sectionTabId(
																source.id,
																item.index,
															)}
														>
															<DictionarySectionContentView
																content={item.section.content}
																word={word}
																theme={theme}
																title={`${source.label} · ${item.section.title}`}
																onLookup={lookupWord}
																strings={strings}
															/>
														</section>
													) : null,
												)}
											</div>
										)}

										{result.suggestions.length > 0 && (
											<div
												className={cls(
													"flashcard-dictionary-suggestions",
													styles.suggestions,
												)}
											>
												<strong>{strings.suggestions}</strong>
												{result.suggestions.map((word) => (
													<button
														type="button"
														key={word}
														className={cls(
															"flashcard-dictionary-suggestion-item",
															styles.suggestionItem,
														)}
														onClick={() => lookupWord(word)}
													>
														{word}
													</button>
												))}
											</div>
										)}
									</>
								)}
							</div>
							{result?.attribution ? (
								<footer
									className={cls(
										"flashcard-dictionary-attribution",
										styles.attribution,
									)}
								>
									{result.attribution}
								</footer>
							) : null}
						</article>
					);
				})}
			</section>
		</main>
	);
}
