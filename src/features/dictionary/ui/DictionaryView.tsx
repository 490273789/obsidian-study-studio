import React, { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Bookmark, Copy, Play, RotateCcw, Search, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { DictionaryQuerySession } from "../domain/querySession";
import type {
	AiDictionaryDefinition,
	DictionarySection,
	DictionarySectionContent,
	DictionarySourceState,
} from "../domain/types";
import { dictionaryStrings, type DictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../core/ui/primitives/Input";
import { canPlayDictionaryAudio } from "./audio";
import { SandboxDocumentFrame } from "./SandboxDocumentFrame";
import { cls } from "../../../core/shared/classNames";
import styles from "./Dictionary.module.scss";

export interface DictionaryViewProps {
	query: DictionaryQuerySession;
	language: Language;
	onOpenFavorite: (word: string) => Promise<void>;
	onOpenSettings: () => void;
	onPlayAudio: (url: string) => Promise<void>;
	/** Obsidian theme, seeded before the sandbox document loads. */
	theme: "dark" | "light";
}

interface ExamplePart {
	highlighted: boolean;
	text: string;
}

interface ExampleCopyStatus {
	isError: boolean;
	message: string;
}

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

/** Sections the source presents as detail tabs, with their original indices. */
function tabSections(
	source: DictionarySourceState,
): { index: number; section: DictionarySection }[] {
	return (source.result?.sections ?? []).flatMap((section, index) =>
		section.presentation === "tab" ? [{ index, section }] : [],
	);
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

function AiSense({
	definition,
	number,
	word,
	strings,
}: {
	definition: AiDictionaryDefinition;
	number: number;
	word: string;
	strings: DictionaryStrings;
}) {
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

function SectionContent({
	content,
	word,
	theme,
	title,
	onLookup,
	strings,
}: {
	content: DictionarySectionContent;
	word: string;
	theme: "dark" | "light";
	title: string;
	onLookup: (word: string) => void;
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
		/>
	);
}

export function DictionaryView({
	query,
	language,
	onOpenFavorite,
	onOpenSettings,
	onPlayAudio,
	theme,
}: DictionaryViewProps): React.ReactElement {
	const subscribe = useCallback((listener: () => void) => query.subscribe(listener), [query]);
	const getSnapshot = useCallback(() => query.getSnapshot(), [query]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	const strings = dictionaryStrings(language);
	const [copyStatus, setCopyStatus] = useState<ExampleCopyStatus | null>(null);
	const sourceTablistRef = useRef<HTMLDivElement | null>(null);
	const sectionTablistRef = useRef<HTMLDivElement | null>(null);

	const isLoading = state.status === "loading";
	const canLookup = Boolean(state.input.trim()) && state.status !== "loading";
	const queryWord = state.query;

	const copyQuery = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(state.query);
			setCopyStatus({ isError: false, message: strings.copied });
		} catch {
			setCopyStatus({ isError: true, message: strings.errors.request });
		}
	};

	const lookupWord = (word: string): void => {
		setCopyStatus(null);
		void query.send({ type: "lookup", query: word });
	};

	return (
		<main
			className={cls(
				"flashcard-dictionary flashcard-dictionary-page fc-page fc-page--column",
				styles.page,
				styles.dictionary,
			)}
			aria-busy={isLoading}
		>
			<div className={cls("flashcard-dictionary-chrome", styles.chrome)}>
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
							<FlashcardButton
								preset="icon"
								icon={Settings2}
								title={strings.openSettings}
								aria-label={strings.openSettings}
								onClick={onOpenSettings}
							/>
							<FlashcardButton
								preset="icon"
								icon={Trash2}
								title={strings.clear}
								aria-label={strings.clear}
								disabled={!state.input && !state.query}
								onClick={() => {
									setCopyStatus(null);
									void query.send({ type: "clear" });
								}}
							/>
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

				{state.history.length > 0 && (
					<section className="flashcard-dictionary-saved" aria-label={strings.history}>
						<div className={cls("flashcard-dictionary-saved-list", styles.savedList)}>
							<strong className="flashcard-dictionary-saved-label">
								{strings.history}
							</strong>
							{state.history.slice(0, 12).map((word) => (
								<button
									type="button"
									key={`history-${word}`}
									className={cls(
										"flashcard-dictionary-saved-item",
										styles.savedItem,
									)}
									onClick={() => lookupWord(word)}
								>
									{word}
								</button>
							))}
						</div>
					</section>
				)}

				{state.query && (
					<section
						className={cls("flashcard-dictionary-query-actions", styles.queryActions)}
					>
						<h2>{state.query}</h2>
						<div>
							<FlashcardButton
								preset="icon"
								size="sm"
								icon={Bookmark}
								onClick={() => void onOpenFavorite(state.query)}
							></FlashcardButton>
							<FlashcardButton
								preset="icon"
								size="sm"
								icon={Copy}
								onClick={() => void copyQuery()}
							></FlashcardButton>
						</div>
					</section>
				)}

				{copyStatus && state.query && (
					<p
						className={cls(
							"flashcard-dictionary-copy-status",
							styles.copyStatus,
							copyStatus.isError && ["is-error", styles.isError],
						)}
						role={copyStatus.isError ? "alert" : "status"}
					>
						{copyStatus.message}
					</p>
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
									void query.send({ type: "select-source", sourceId: source.id })
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
					const sections = tabSections(source);
					const result = source.result;
					const word = result?.word || queryWord;
					return (
						<article
							key={source.id}
							id={sourcePanelId(source.id)}
							className={cls(
								"flashcard-dictionary-source fc-panel fc-panel--scroll",
								styles.source,
							)}
							role="tabpanel"
							aria-labelledby={sourceTabId(source.id)}
							tabIndex={0}
							hidden={!selected}
						>
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
									className={cls("flashcard-dictionary-loading", styles.loading)}
								>
									{source.kind === "ai" ? strings.aiGenerating : strings.loading}
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
												<h4>{section.title}</h4>
												<SectionContent
													content={section.content}
													word={word}
													theme={theme}
													title={`${source.label} · ${section.title}`}
													onLookup={lookupWord}
													strings={strings}
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
											<div
												ref={sectionTablistRef}
												className={cls(
													"flashcard-dictionary-detail-tabs",
													styles.detailTabs,
												)}
												role="tablist"
												aria-label={`${source.label} · ${strings.details}`}
											>
												{sections.map((item, tabIndex) => {
													const active =
														source.activeSectionIndex === item.index;
													return (
														<button
															key={`${source.id}-${item.index}`}
															id={sectionTabId(source.id, item.index)}
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
																	sectionIndex: item.index,
																})
															}
															onKeyDown={(event) =>
																moveTabFocus(
																	event,
																	sectionTablistRef.current,
																	tabIndex,
																	sections.length,
																	(nextIndex) => {
																		const next =
																			sections[nextIndex];
																		if (next)
																			void query.send({
																				type: "select-section",
																				sourceId: source.id,
																				sectionIndex:
																					next.index,
																			});
																	},
																)
															}
														>
															{item.section.title}
														</button>
													);
												})}
											</div>
											{sections.map((item) =>
												source.activeSectionIndex === item.index ? (
													<section
														key={`${source.id}-panel-${item.index}`}
														id={sectionPanelId(source.id, item.index)}
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
														aria-labelledby={sectionTabId(
															source.id,
															item.index,
														)}
													>
														<SectionContent
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
									<footer
										className={cls(
											"flashcard-dictionary-attribution",
											styles.attribution,
										)}
									>
										{result.attribution}
									</footer>
								</>
							)}
						</article>
					);
				})}
			</section>
		</main>
	);
}
