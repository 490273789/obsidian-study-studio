import React, {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	ArrowLeftRight,
	BookmarkPlus,
	Check,
	Copy,
	FileDiff,
	FileText,
	Languages,
	RotateCcw,
	Settings2,
	Trash2,
	Volume2,
	VolumeX,
} from "lucide-react";
import { aiErrorText } from "../../../core/i18n/ai";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../core/ui/primitives/Header";
import { FlashcardTextarea } from "../../../core/ui/primitives/Input";
import type { TranslationRuntime } from "../domain/translationRuntime";
import type { TranslationResultState } from "../domain/types";
import { formatTranslationString, translationStrings } from "../strings/translation";
import type { TranslatorFocusController } from "./translatorFocusController";
import styles from "./Translator.module.scss";

export interface TranslatorViewProps {
	runtime: TranslationRuntime;
	language: Language;
	focusController?: TranslatorFocusController;
	onOpenSettings: () => void;
	onInsertNote?: (text: string, sourceText: string) => Promise<boolean> | boolean;
	onCreateCard?: (sourceText: string, targetText: string) => Promise<boolean> | boolean | void;
}

interface ActionFeedback {
	id: string;
	type: "copied" | "inserted" | "card" | "error";
	message: string;
}

function resultUsage(result: TranslationResultState, usage: string): string | null {
	if (!result.usage) return null;
	return formatTranslationString(usage, {
		input: result.usage.inputTokens ?? "—",
		output: result.usage.outputTokens ?? "—",
	});
}

function providerLabel(provider: string, strings: ReturnType<typeof translationStrings>): string {
	if (provider === "deepseek") return strings.deepseek;
	if (provider === "bailian") return strings.bailian;
	if (provider === "youdao") return strings.youdao;
	return strings.unavailable;
}

function cleanProfileSubtitle(
	name: string,
	provider: string,
	model: string | undefined,
	strings: ReturnType<typeof translationStrings>,
): string | null {
	const providerName = providerLabel(provider, strings);
	if (!model) {
		if (name.trim().toLowerCase() === providerName.trim().toLowerCase()) {
			return null;
		}
		return providerName;
	}
	if (name.trim().toLowerCase() === providerName.trim().toLowerCase()) {
		return model;
	}
	return `${providerName} · ${model}`;
}

function highlightDifferences(
	text: string,
	otherTexts: string[],
	isTargetEnglish: boolean,
): React.ReactNode {
	if (!text.trim() || otherTexts.length === 0) return text;

	if (isTargetEnglish) {
		const chunks = text.split(/(\s+|[.,!?;:"'()[\]{}]+)/);
		const otherWordSets = otherTexts.map(
			(t) => new Set(t.toLowerCase().match(/[a-z0-9'-]+/g) ?? []),
		);
		return chunks.map((chunk, i) => {
			const clean = chunk.toLowerCase().trim();
			if (clean && /^[a-z0-9'-]+$/.test(clean)) {
				const isUnique = otherWordSets.some((set) => !set.has(clean));
				if (isUnique) {
					return (
						<mark key={i} className={styles.diffMark}>
							{chunk}
						</mark>
					);
				}
			}
			return chunk;
		});
	} else {
		const segments = text.split(/([，。！？；：“”（）\s]+)/);
		return segments.map((seg, sIdx) => {
			if (/^[，。！？；：“”（）\s]+$/.test(seg)) return seg;
			const chars = Array.from(seg);
			return (
				<span key={sIdx}>
					{chars.map((char, cIdx) => {
						const common = otherTexts.every((t) => t.includes(char));
						if (!common) {
							return (
								<mark key={cIdx} className={styles.diffMark}>
									{char}
								</mark>
							);
						}
						return char;
					})}
				</span>
			);
		});
	}
}

export const TranslatorView = React.memo(function TranslatorView({
	runtime,
	language,
	focusController,
	onOpenSettings,
	onInsertNote,
	onCreateCard,
}: TranslatorViewProps) {
	const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
	const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot);
	const [activeTab, setActiveTab] = useState<string | null>(null);
	const [feedbackMap, setFeedbackMap] = useState<Record<string, ActionFeedback>>({});
	const feedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	const [speakingId, setSpeakingId] = useState<string | null>(null);
	const [showDiff, setShowDiff] = useState<boolean>(false);
	const [appliedMap, setAppliedMap] = useState<
		Record<string, { kind: "inserted" | "card"; key: string }>
	>({});
	const focusAfterClear = useRef(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const viewId = useId();
	const shortcutId = `${viewId}-translate-shortcut`;

	useLayoutEffect(() => {
		if (!focusAfterClear.current) return;
		focusAfterClear.current = false;
		inputRef.current?.focus();
	}, [snapshot]);

	useEffect(() => {
		if (!focusController) return;
		return focusController.register(() => {
			const element = inputRef.current;
			if (!element || element.disabled) return;
			const win = element.ownerDocument.defaultView;
			const focus = () => {
				if (!inputRef.current || inputRef.current.disabled) return;
				inputRef.current.focus();
				inputRef.current.select();
			};
			if (win?.requestAnimationFrame) {
				win.requestAnimationFrame(focus);
			} else {
				focus();
			}
		});
	}, [focusController]);

	const showFeedback = useCallback((newFeedback: ActionFeedback) => {
		const existingTimer = feedbackTimeoutsRef.current[newFeedback.id];
		if (existingTimer) {
			clearTimeout(existingTimer);
		}
		setFeedbackMap((prev) => ({ ...prev, [newFeedback.id]: newFeedback }));
		feedbackTimeoutsRef.current[newFeedback.id] = setTimeout(() => {
			setFeedbackMap((prev) => {
				const next = { ...prev };
				delete next[newFeedback.id];
				return next;
			});
			delete feedbackTimeoutsRef.current[newFeedback.id];
		}, 2000);
	}, []);

	useEffect(() => {
		const timers = feedbackTimeoutsRef.current;
		return () => {
			for (const id in timers) {
				clearTimeout(timers[id]);
			}
			if (typeof window !== "undefined" && "speechSynthesis" in window) {
				window.speechSynthesis.cancel();
			}
		};
	}, []);

	const strings = translationStrings(language);
	const isLoading = snapshot.status === "loading";
	const results = snapshot.results;
	const readyCount = results.filter((result) => !result.setupIssue).length;
	const loadingCount = results.filter((result) => result.status === "loading").length;
	const hasResults = results.some(
		(result) => result.status === "success" || result.status === "error",
	);
	const resultsDirection = hasResults
		? snapshot.translatedDirection
		: snapshot.settings.direction;
	const stale = snapshot.stale;
	const hasCurrentResults = hasResults && !stale;
	const visibleResults = results.filter(
		(result) => result.setupIssue || result.status !== "idle",
	);
	const isWaitingForResults = visibleResults.length === 0;
	const showTabs = results.length > 1 && !isWaitingForResults;
	const activeIndex = showTabs ? results.findIndex((result) => result.id === activeTab) + 1 : 0;
	const setupHint = !snapshot.settings.enabled
		? strings.disabled
		: results.length === 0
			? strings.noProfiles
			: readyCount === 0
				? strings.noReadyProfiles
				: null;
	const canTranslate =
		snapshot.settings.enabled &&
		readyCount > 0 &&
		Boolean(snapshot.input.trim()) &&
		!isLoading &&
		!snapshot.saving;
	const canClear =
		Boolean(snapshot.input) ||
		snapshot.results.some((result) => Boolean(result.text || result.error)) ||
		isLoading;
	const sourceLanguage =
		snapshot.settings.direction === "zh-en" ? strings.chinese : strings.english;
	const targetLanguage = resultsDirection === "zh-en" ? strings.english : strings.chinese;
	const translatedSource = snapshot.translatedInput || snapshot.input;
	const translationStamp = JSON.stringify([snapshot.translatedInput, snapshot.clearUndoId]);
	const translateVariant = isLoading
		? "primary"
		: hasCurrentResults
			? "secondary"
			: canTranslate
				? "primary"
				: "neutral";
	const succeeded = snapshot.results.filter((result) => result.status === "success").length;
	const failed = snapshot.results.filter((result) => result.status === "error").length;
	const memorySuffix = hasResults ? ` · ${strings.memoryOnly}` : "";
	const statusText = isLoading
		? formatTranslationString(strings.loadingProfiles, { count: loadingCount })
		: snapshot.error
			? aiErrorText(language, snapshot.error)
			: snapshot.status === "success" && failed > 0
				? formatTranslationString(strings.partialProfiles, {
						success: succeeded,
						total: succeeded + failed,
						failed,
					}) + memorySuffix
				: snapshot.status === "success"
					? formatTranslationString(strings.completedProfiles, { count: succeeded }) +
						memorySuffix
					: snapshot.status === "error" && failed > 0
						? strings.failedProfiles
						: null;

	const speechUnavailable = strings.speechUnavailable;
	const speechFailed = strings.speechFailed;
	const speak = (id: string, text: string, lang: "en" | "zh") => {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) {
			showFeedback({ id, type: "error", message: speechUnavailable });
			return;
		}
		if (speakingId === id) {
			window.speechSynthesis.cancel();
			setSpeakingId(null);
			return;
		}
		try {
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = lang === "en" ? "en-US" : "zh-CN";
			utterance.onend = () => setSpeakingId((curr) => (curr === id ? null : curr));
			utterance.onerror = () => {
				setSpeakingId((curr) => (curr === id ? null : curr));
				showFeedback({ id, type: "error", message: speechFailed });
			};
			setSpeakingId(id);
			window.speechSynthesis.speak(utterance);
		} catch {
			setSpeakingId(null);
			showFeedback({ id, type: "error", message: speechUnavailable });
		}
	};

	const handleClear = () => {
		focusAfterClear.current = true;
		if (!runtime.clear({ undoable: true })) focusAfterClear.current = false;
	};

	const handleUndo = () => {
		if (snapshot.clearUndoId !== null && runtime.undoClear(snapshot.clearUndoId)) {
			inputRef.current?.focus();
		}
	};

	const copyResult = async (result: TranslationResultState): Promise<void> => {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(result.text);
			showFeedback({ id: result.id, type: "copied", message: strings.copied });
		} catch {
			showFeedback({ id: result.id, type: "error", message: strings.copyFailed });
		}
	};

	const insertToNote = async (result: TranslationResultState): Promise<void> => {
		if (onInsertNote) {
			const success = await onInsertNote(result.text, translatedSource);
			if (success) {
				setAppliedMap((prev) => ({
					...prev,
					[result.id]: {
						kind: "inserted",
						key: JSON.stringify([translationStamp, result.text]),
					},
				}));
				showFeedback({ id: result.id, type: "inserted", message: strings.insertedNotice });
				return;
			}
		}
		const callout = `> [!quote] 翻译 · ${result.name}\n> ${translatedSource.split("\n").join("\n> ")}\n>\n> ${result.text.split("\n").join("\n> ")}\n\n`;
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(callout);
			showFeedback({ id: result.id, type: "inserted", message: strings.noActiveNote });
		} catch {
			showFeedback({ id: result.id, type: "error", message: strings.copyFailed });
		}
	};

	const makeCard = async (result: TranslationResultState): Promise<void> => {
		if (onCreateCard) {
			const success = await onCreateCard(translatedSource, result.text);
			if (success === true) {
				setAppliedMap((prev) => ({
					...prev,
					[result.id]: {
						kind: "card",
						key: JSON.stringify([translationStamp, result.text]),
					},
				}));
				showFeedback({ id: result.id, type: "card", message: strings.cardCreated });
				return;
			}
		}
		const cardFormat = `#flashcards\n\nQ: ${translatedSource}\nA: ${result.text}\n\n`;
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(cardFormat);
			showFeedback({ id: result.id, type: "card", message: strings.cardCopied });
		} catch {
			showFeedback({ id: result.id, type: "error", message: strings.copyFailed });
		}
	};

	const otherSuccessResults = results.filter(
		(r) => r.status === "success" && r.text.trim().length > 0,
	);
	const canHighlight = otherSuccessResults.length > 1;
	const renderCard = (result: TranslationResultState, isParallel: boolean) => {
		const usage = resultUsage(result, strings.usage);
		const error = result.error ? aiErrorText(language, result.error) : null;
		const hasText = result.status === "success" && Boolean(result.text.trim());
		const cardFeedback = hasText ? feedbackMap[result.id] : undefined;
		const isCopied = cardFeedback?.type === "copied";
		const isInserted = cardFeedback?.type === "inserted";
		const isCard = cardFeedback?.type === "card";
		const subtitle = result.setupIssue
			? strings.unavailable
			: cleanProfileSubtitle(result.name, result.provider, result.model, strings);
		const targetLang = resultsDirection === "zh-en" ? "en" : "zh";
		const appliedEntry = appliedMap[result.id];
		const applied =
			appliedEntry?.key === JSON.stringify([translationStamp, result.text])
				? appliedEntry.kind
				: undefined;

		return (
			<article
				key={result.id}
				aria-label={formatTranslationString(strings.resultLabel, { name: result.name })}
				className={styles.resultPanel}
			>
				<header>
					<div className={styles.resultTitle}>
						<strong>{result.name}</strong>
						{subtitle && <span className={styles.subtitle}>{subtitle}</span>}
					</div>
				</header>
				{result.setupIssue ? (
					<div className={styles.setupMessage}>
						<p>{strings[result.setupIssue]}</p>
						{!setupHint && (
							<FlashcardButton size="sm" variant="ghost" onClick={onOpenSettings}>
								{strings.configureProfiles}
							</FlashcardButton>
						)}
					</div>
				) : result.status === "loading" ? (
					<p className={styles.resultMessage}>{strings.translating}</p>
				) : (
					hasText && (
						<div className={styles.cardBody}>
							{showDiff &&
							isParallel &&
							result.status === "success" &&
							canHighlight ? (
								<div className={styles.diffContent} lang={targetLang}>
									{highlightDifferences(
										result.text,
										otherSuccessResults
											.filter((r) => r.id !== result.id)
											.map((r) => r.text),
										resultsDirection === "zh-en",
									)}
								</div>
							) : (
								<FlashcardTextarea
									variant="unstyled"
									aria-label={formatTranslationString(strings.resultLabel, {
										name: result.name,
									})}
									value={result.text}
									lang={targetLang}
									readOnly
								/>
							)}
						</div>
					)
				)}
				{(hasText || error) && (
					<footer>
						<div className={styles.resultMeta}>
							{error ? (
								<p
									className={cls(styles.statusMessage, styles.isError)}
									role="alert"
								>
									{error}
								</p>
							) : cardFeedback ? (
								<span
									className={cls(
										styles.statusMessage,
										cardFeedback.type === "error" && styles.isError,
									)}
									aria-hidden="true"
								>
									{cardFeedback.message}
								</span>
							) : applied ? (
								<span className={styles.appliedBadge}>
									<Check size={12} aria-hidden="true" />
									{applied === "inserted"
										? strings.appliedInserted
										: strings.appliedCard}
								</span>
							) : null}
							{usage && (
								<span className={styles.usage} title={usage}>
									{usage}
								</span>
							)}
						</div>
						<div className={styles.cardActions}>
							{hasText && (
								<>
									<FlashcardButton
										size="sm"
										variant="ghost"
										preset="icon"
										icon={speakingId === result.id ? VolumeX : Volume2}
										title={strings.speak}
										aria-label={strings.speak}
										aria-pressed={speakingId === result.id}
										onClick={() => speak(result.id, result.text, targetLang)}
									/>
									<FlashcardButton
										size="sm"
										variant="ghost"
										preset="icon"
										icon={isCopied ? Check : Copy}
										title={isCopied ? strings.copied : strings.copy}
										aria-label={isCopied ? strings.copied : strings.copy}
										onClick={() => void copyResult(result)}
									/>
									<span className={styles.actionDivider} aria-hidden="true" />
									<FlashcardButton
										size="sm"
										variant="ghost"
										icon={isInserted ? Check : FileText}
										onClick={() => void insertToNote(result)}
									>
										{strings.insertNote}
									</FlashcardButton>
									<FlashcardButton
										size="sm"
										variant="secondary"
										icon={isCard ? Check : BookmarkPlus}
										onClick={() => void makeCard(result)}
									>
										{strings.makeCard}
									</FlashcardButton>
								</>
							)}
							{error && (
								<FlashcardButton
									size="sm"
									variant="secondary"
									icon={RotateCcw}
									disabled={isLoading || snapshot.saving}
									onClick={() => void runtime.retryResult(result.id)}
								>
									{strings.retry}
								</FlashcardButton>
							)}
						</div>
					</footer>
				)}
				{hasText && (
					<output className={styles.srOnly}>
						{cardFeedback?.message ??
							(applied
								? applied === "inserted"
									? strings.appliedInserted
									: strings.appliedCard
								: "")}
					</output>
				)}
			</article>
		);
	};

	const renderResults = (shown: readonly TranslationResultState[], isParallel: boolean) => (
		<>
			{(shown.length === 0 ||
				(isParallel && snapshot.status === "idle" && readyCount > 0)) && (
				<p className={styles.resultMessage}>{strings.outputPlaceholder}</p>
			)}
			{shown.map((result) => renderCard(result, isParallel))}
		</>
	);
	const tabLabels = [strings.compareTable, ...results.map((result) => result.name)];
	const selectTab = (index: number) => setActiveTab(results[index - 1]?.id ?? null);
	const submitTranslation = () => {
		if (isWaitingForResults) setActiveTab(null);
		void runtime.translate();
	};
	const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		let next: number;
		switch (event.key) {
			case "ArrowRight":
				next = (activeIndex + 1) % tabLabels.length;
				break;
			case "ArrowLeft":
				next = (activeIndex - 1 + tabLabels.length) % tabLabels.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = tabLabels.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		selectTab(next);
		event.currentTarget.parentElement
			?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
			[next]?.focus();
	};

	return (
		<main className={cls("fc-page", styles.page)}>
			<h1 className={styles.srOnly}>{strings.title}</h1>
			<FlashcardHeader
				icon={Languages}
				title={strings.title}
				right={
					<>
						{snapshot.settings.enabled && readyCount < results.length && (
							<span className={styles.modelCount}>
								{formatTranslationString(strings.modelCount, {
									ready: readyCount,
									enabled: results.length,
								})}
							</span>
						)}
						<FlashcardButton
							preset="icon"
							icon={Settings2}
							title={strings.openSettings}
							aria-label={strings.openSettings}
							onClick={onOpenSettings}
						/>
					</>
				}
			/>

			<section className={cls("fc-page__content", styles.workspace)}>
				<article className={styles.inputPanel} aria-label={strings.inputLabel}>
					<header>
						<div className={styles.inputHeaderTitle}>
							<label htmlFor={`${viewId}-translator-input`}>
								{strings.inputLabel}
							</label>
							<span className={styles.langPill}>{sourceLanguage}</span>
							<FlashcardButton
								preset="icon"
								variant="ghost"
								size="sm"
								icon={ArrowLeftRight}
								title={strings.swapDirection}
								aria-label={strings.swapDirection}
								disabled={isLoading || snapshot.saving}
								onClick={() => void runtime.swapDirection()}
							/>
						</div>
						<div className={styles.inputHeaderActions}>
							{!setupHint && (
								<span id={shortcutId} className={styles.shortcutHint}>
									{strings.shortcutHint}
								</span>
							)}
							<FlashcardButton
								preset="icon"
								variant="ghost"
								size="sm"
								icon={speakingId === "source" ? VolumeX : Volume2}
								title={strings.speak}
								aria-label={strings.speak}
								aria-pressed={speakingId === "source"}
								disabled={!snapshot.input.trim()}
								onClick={() =>
									speak(
										"source",
										snapshot.input,
										snapshot.settings.direction === "zh-en" ? "zh" : "en",
									)
								}
							/>
						</div>
					</header>
					<FlashcardTextarea
						ref={inputRef}
						id={`${viewId}-translator-input`}
						variant="unstyled"
						value={snapshot.input}
						lang={snapshot.settings.direction === "zh-en" ? "zh" : "en"}
						placeholder={strings.inputPlaceholder}
						aria-describedby={setupHint ? undefined : shortcutId}
						disabled={!snapshot.settings.enabled}
						spellCheck
						rows={5}
						onChange={(event) => runtime.setInput(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.nativeEvent.isComposing &&
								(event.ctrlKey || event.metaKey) &&
								canTranslate
							) {
								event.preventDefault();
								submitTranslation();
							}
						}}
					/>
					<footer>
						<div className={styles.inputMeta}>
							{snapshot.clearUndoId !== null ? (
								<div className={styles.undoBar}>
									<span aria-hidden="true">{strings.clearedNotice}</span>
									<button
										type="button"
										className={styles.undoBtn}
										aria-label={strings.undoClear}
										onClick={handleUndo}
									>
										{strings.undo}
									</button>
								</div>
							) : (
								<span>
									{setupHint ??
										formatTranslationString(strings.characterCount, {
											count: snapshot.input.length,
										})}
								</span>
							)}
							<output className={styles.srOnly}>
								{snapshot.clearUndoId !== null ? strings.clearedNotice : ""}
							</output>
						</div>
						<div className={styles.inputActions}>
							<FlashcardButton
								preset="icon"
								variant="ghost"
								icon={Trash2}
								title={isLoading ? strings.stopClear : strings.clear}
								aria-label={isLoading ? strings.stopClear : strings.clear}
								disabled={!canClear}
								onClick={handleClear}
							/>
							{setupHint ? (
								<FlashcardButton variant="primary" onClick={onOpenSettings}>
									{strings.configureProfiles}
								</FlashcardButton>
							) : (
								<FlashcardButton
									variant={translateVariant}
									disabled={!canTranslate}
									onClick={submitTranslation}
									aria-keyshortcuts="Control+Enter Meta+Enter"
								>
									{isLoading
										? strings.translating
										: hasCurrentResults
											? strings.translateAgain
											: formatTranslationString(strings.translate, {
													count: readyCount,
												})}
								</FlashcardButton>
							)}
						</div>
					</footer>
				</article>

				<section
					className={styles.outputSection}
					aria-label={strings.outputLabel}
					aria-busy={isLoading}
				>
					<header>
						<div className={styles.outputHeading}>
							<span className={styles.outputLabelText}>{strings.outputLabel}</span>
							<span className={styles.langPill}>{targetLanguage}</span>
						</div>
						{showTabs && activeIndex === 0 && canHighlight && (
							<FlashcardButton
								size="sm"
								variant={showDiff ? "secondary" : "ghost"}
								icon={FileDiff}
								aria-pressed={showDiff}
								onClick={() => setShowDiff((prev) => !prev)}
							>
								{strings.diffToggle}
							</FlashcardButton>
						)}
					</header>
					{stale && hasResults && (
						<output className={styles.staleNotice}>{strings.staleNotice}</output>
					)}
					{isWaitingForResults ? (
						<div className={styles.outputEmpty}>
							<p className={styles.outputEmptyTitle}>{strings.outputPlaceholder}</p>
							{readyCount > 0 && (
								<p className={styles.outputEmptyHint}>
									{formatTranslationString(strings.profilesReady, {
										count: readyCount,
									})}
								</p>
							)}
							<p className={styles.outputEmptyMeta}>{strings.memoryNote}</p>
						</div>
					) : showTabs ? (
						<>
							<div
								className={styles.segmented}
								role="tablist"
								aria-label={strings.outputLabel}
							>
								{tabLabels.map((label, index) => (
									<button
										key={
											index === 0
												? "all"
												: `profile:${results[index - 1]?.id}`
										}
										id={`${viewId}-tab-${index}`}
										role="tab"
										type="button"
										aria-selected={index === activeIndex}
										aria-controls={`${viewId}-panel-${index}`}
										tabIndex={index === activeIndex ? 0 : -1}
										className={styles.segmentButton}
										onKeyDown={handleTabKey}
										onClick={() => selectTab(index)}
									>
										{label}
									</button>
								))}
							</div>
							{tabLabels.map((_, index) => (
								<div
									key={index === 0 ? "all" : `profile:${results[index - 1]?.id}`}
									id={`${viewId}-panel-${index}`}
									role="tabpanel"
									aria-labelledby={`${viewId}-tab-${index}`}
									tabIndex={0}
									hidden={index !== activeIndex}
									className={styles.resultStack}
								>
									{index === 0 && showDiff && canHighlight && (
										<p className={styles.diffLegend}>
											<mark className={styles.diffMark}>
												{strings.diffLegendSample}
											</mark>
											<span>{strings.diffLegend}</span>
										</p>
									)}
									{index === activeIndex &&
										renderResults(
											index === 0
												? visibleResults
												: visibleResults.filter(
														(r) => r === results[index - 1],
													),
											index === 0,
										)}
								</div>
							))}
						</>
					) : (
						<div className={styles.resultStack}>
							{renderResults(visibleResults, false)}
						</div>
					)}
					<footer>
						<output>{statusText}</output>
					</footer>
				</section>
			</section>
		</main>
	);
});
