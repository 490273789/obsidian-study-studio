import React, {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	BookmarkPlus,
	Check,
	Copy,
	FileDiff,
	FileText,
	Languages,
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
	type: "copied" | "inserted" | "card";
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
	const [activeTab, setActiveTab] = useState<string>("all");
	const [feedbackMap, setFeedbackMap] = useState<Record<string, ActionFeedback>>({});
	const feedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	const [speakingId, setSpeakingId] = useState<string | null>(null);
	const [showDiff, setShowDiff] = useState<boolean>(false);
	const [showUndo, setShowUndo] = useState<boolean>(false);
	const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearedStateRef = useRef<{
		input: string;
		results: readonly TranslationResultState[];
	} | null>(null);

	const inputRef = useRef<HTMLTextAreaElement>(null);
	const viewId = useId();

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
			if (undoTimeoutRef.current) {
				clearTimeout(undoTimeoutRef.current);
			}
			if (typeof window !== "undefined" && "speechSynthesis" in window) {
				window.speechSynthesis.cancel();
			}
		};
	}, []);

	const strings = translationStrings(language);
	const isLoading = snapshot.status === "loading";
	const configuredProfiles = snapshot.settings.profiles.filter((profile) => profile.enabled);

	// Select the first profile by default if activeTab is unset or invalid
	const effectiveTab =
		activeTab === "all"
			? "all"
			: configuredProfiles.some((p) => p.id === activeTab)
				? activeTab
				: (configuredProfiles[0]?.id ?? "all");

	const canTranslate =
		snapshot.settings.enabled &&
		configuredProfiles.length > 0 &&
		Boolean(snapshot.input.trim()) &&
		!isLoading &&
		!snapshot.saving;
	const canClear =
		Boolean(snapshot.input) ||
		snapshot.results.some((result) => Boolean(result.text || result.error)) ||
		isLoading;
	const sourceLanguage =
		snapshot.settings.direction === "zh-en" ? strings.chinese : strings.english;
	const targetLanguage =
		snapshot.settings.direction === "zh-en" ? strings.english : strings.chinese;
	const succeeded = snapshot.results.filter((result) => result.status === "success").length;
	const failed = snapshot.results.filter((result) => result.status === "error").length;
	const statusText = isLoading
		? formatTranslationString(strings.loadingProfiles, { count: configuredProfiles.length })
		: snapshot.status === "success" && failed > 0
			? formatTranslationString(strings.partialProfiles, {
					success: succeeded,
					total: snapshot.results.length,
					failed,
				})
			: snapshot.status === "success"
				? formatTranslationString(strings.completedProfiles, { count: succeeded })
				: snapshot.status === "error" && failed > 0
					? strings.failedProfiles
					: snapshot.error
						? aiErrorText(language, snapshot.error)
						: null;

	const speechUnavailable = strings.speechUnavailable;
	const speak = useCallback(
		(id: string, text: string, lang: "en" | "zh") => {
			if (typeof window === "undefined" || !("speechSynthesis" in window)) {
				showFeedback({ id, type: "copied", message: speechUnavailable });
				return;
			}
			if (speakingId === id) {
				window.speechSynthesis.cancel();
				setSpeakingId(null);
				return;
			}
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = lang === "en" ? "en-US" : "zh-CN";
			utterance.onend = () => setSpeakingId((curr) => (curr === id ? null : curr));
			utterance.onerror = () => setSpeakingId((curr) => (curr === id ? null : curr));
			setSpeakingId(id);
			window.speechSynthesis.speak(utterance);
		},
		[showFeedback, speakingId, speechUnavailable],
	);

	const handleClear = useCallback(() => {
		if (!snapshot.input && !snapshot.results.some((r) => r.text || r.error)) {
			return;
		}
		clearedStateRef.current = {
			input: snapshot.input,
			results: snapshot.results,
		};
		runtime.clear();
		setShowUndo(true);
		if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
		undoTimeoutRef.current = setTimeout(() => {
			setShowUndo(false);
			clearedStateRef.current = null;
			undoTimeoutRef.current = null;
		}, 6000);
	}, [runtime, snapshot.input, snapshot.results]);

	const handleUndo = useCallback(() => {
		if (!clearedStateRef.current) return;
		runtime.restore(clearedStateRef.current.input, clearedStateRef.current.results);
		setShowUndo(false);
		clearedStateRef.current = null;
		if (undoTimeoutRef.current) {
			clearTimeout(undoTimeoutRef.current);
			undoTimeoutRef.current = null;
		}
	}, [runtime]);

	const copyResult = async (result: TranslationResultState): Promise<void> => {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(result.text);
			showFeedback({ id: result.id, type: "copied", message: strings.copied });
		} catch {
			showFeedback({ id: result.id, type: "copied", message: strings.copyFailed });
		}
	};

	const insertToNote = async (result: TranslationResultState): Promise<void> => {
		if (onInsertNote) {
			const success = await onInsertNote(result.text, snapshot.input);
			if (success) {
				showFeedback({ id: result.id, type: "inserted", message: strings.insertedNotice });
				return;
			}
		}
		const callout = `> [!quote] 翻译 · ${result.name}\n> ${snapshot.input.split("\n").join("\n> ")}\n>\n> ${result.text.split("\n").join("\n> ")}\n\n`;
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(callout);
			showFeedback({ id: result.id, type: "inserted", message: strings.noActiveNote });
		} catch {
			showFeedback({ id: result.id, type: "inserted", message: strings.copyFailed });
		}
	};

	const makeCard = async (result: TranslationResultState): Promise<void> => {
		if (onCreateCard) {
			const success = await onCreateCard(snapshot.input, result.text);
			if (success !== false) {
				showFeedback({ id: result.id, type: "card", message: strings.cardCreated });
				return;
			}
		}
		const cardFormat = `#flashcards\n\nQ: ${snapshot.input}\nA: ${result.text}\n\n`;
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(cardFormat);
			showFeedback({ id: result.id, type: "card", message: strings.cardCopied });
		} catch {
			showFeedback({ id: result.id, type: "card", message: strings.copyFailed });
		}
	};

	const otherSuccessResults = snapshot.results.filter(
		(r) => r.status === "success" && r.text.trim().length > 0,
	);
	const otherSuccessTexts = otherSuccessResults.map((r) => r.text);

	const renderCard = (result: TranslationResultState, isParallel: boolean) => {
		const usage = resultUsage(result, strings.usage);
		const error = result.error ? aiErrorText(language, result.error) : null;
		const cardFeedback = feedbackMap[result.id];
		const isCopied = cardFeedback?.type === "copied";
		const isInserted = cardFeedback?.type === "inserted";
		const isCard = cardFeedback?.type === "card";
		const subtitle = cleanProfileSubtitle(result.name, result.provider, result.model, strings);
		const targetLang = snapshot.settings.direction === "zh-en" ? "en" : "zh";

		return (
			<article
				key={result.id}
				id={`${viewId}-panel-${result.id}`}
				role="tabpanel"
				aria-labelledby={`${viewId}-tab-${result.id}`}
				className={cls("fc-panel", styles.resultPanel, isParallel && styles.parallelCard)}
				aria-busy={result.status === "loading"}
			>
				<header>
					<div className={styles.resultTitle}>
						<strong>{result.name}</strong>
						{subtitle && <span className={styles.subtitle}>{subtitle}</span>}
					</div>
					<div className={styles.cardActions}>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={speakingId === result.id ? VolumeX : Volume2}
							title={strings.speak}
							aria-label={strings.speak}
							disabled={!result.text || result.status === "loading"}
							onClick={() => speak(result.id, result.text, targetLang)}
						/>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isCard ? Check : BookmarkPlus}
							title={isCard ? cardFeedback.message : strings.makeCard}
							aria-label={isCard ? cardFeedback.message : strings.makeCard}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void makeCard(result)}
						/>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isInserted ? Check : FileText}
							title={isInserted ? cardFeedback.message : strings.insertNote}
							aria-label={isInserted ? cardFeedback.message : strings.insertNote}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void insertToNote(result)}
						/>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isCopied ? Check : Copy}
							title={isCopied ? cardFeedback.message : strings.copied}
							aria-label={isCopied ? cardFeedback.message : strings.copied}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void copyResult(result)}
						/>
					</div>
				</header>
				<div className={styles.cardBody}>
					{showDiff &&
					isParallel &&
					result.status === "success" &&
					otherSuccessTexts.length > 1 ? (
						<div className={styles.diffContent}>
							{highlightDifferences(
								result.text,
								otherSuccessResults
									.filter((r) => r.id !== result.id)
									.map((r) => r.text),
								snapshot.settings.direction === "zh-en",
							)}
						</div>
					) : (
						<FlashcardTextarea
							id={`${viewId}-translator-output-${result.id}`}
							variant="unstyled"
							aria-label={formatTranslationString(strings.resultLabel, {
								name: result.name,
							})}
							value={result.text}
							placeholder={
								result.status === "loading"
									? strings.translating
									: strings.outputPlaceholder
							}
							readOnly
						/>
					)}
				</div>
				<footer>
					{error ? (
						<p className={cls(styles.statusMessage, styles.isError)} role="alert">
							{error}
						</p>
					) : cardFeedback ? (
						<span className={styles.feedbackTag}>
							<Check size={12} aria-hidden="true" />
							{cardFeedback.message}
						</span>
					) : (
						<span className={styles.statusMessage}>
							{result.status === "loading" ? strings.translating : ""}
						</span>
					)}
					{usage && (
						<span className={styles.usage} title={usage}>
							{usage}
						</span>
					)}
				</footer>
			</article>
		);
	};

	const singleResult = snapshot.results.find((r) => r.id === effectiveTab);

	return (
		<main className={cls("fc-page", styles.page)} aria-busy={isLoading}>
			<FlashcardHeader
				icon={Languages}
				title={strings.title}
				badge={statusText ?? undefined}
				right={
					<>
						<span className={styles.modelCount}>
							{formatTranslationString(strings.modelCount, {
								count: configuredProfiles.length,
							})}
						</span>
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

			{!snapshot.settings.enabled ? (
				<section className={cls("fc-page__content", styles.notice)}>
					<span>{strings.disabled}</span>
					<FlashcardButton variant="secondary" size="sm" onClick={onOpenSettings}>
						{strings.openSettings}
					</FlashcardButton>
				</section>
			) : configuredProfiles.length === 0 ? (
				<section className={cls("fc-page__content", styles.notice)}>
					<span>{strings.noProfiles}</span>
					<FlashcardButton variant="secondary" size="sm" onClick={onOpenSettings}>
						{strings.openSettings}
					</FlashcardButton>
				</section>
			) : null}

			<section className={cls("fc-page__content", styles.workspace)}>
				<article className={cls("fc-panel", styles.inputPanel)}>
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
								icon={Languages}
								title={strings.swapDirection}
								aria-label={strings.swapDirection}
								disabled={isLoading || snapshot.saving}
								onClick={() => void runtime.swapDirection()}
							/>
						</div>
						<div className={styles.inputHeaderActions}>
							<FlashcardButton
								preset="icon"
								variant="ghost"
								size="sm"
								icon={speakingId === "source" ? VolumeX : Volume2}
								title={strings.speak}
								aria-label={strings.speak}
								disabled={!snapshot.input.trim()}
								onClick={() =>
									speak(
										"source",
										snapshot.input,
										snapshot.settings.direction === "zh-en" ? "zh" : "en",
									)
								}
							/>
							<span className={styles.charCount}>
								{formatTranslationString(strings.characterCount, {
									count: snapshot.input.length,
								})}
							</span>
						</div>
					</header>
					<FlashcardTextarea
						ref={inputRef}
						id={`${viewId}-translator-input`}
						variant="unstyled"
						value={snapshot.input}
						placeholder={strings.inputPlaceholder}
						disabled={isLoading || !snapshot.settings.enabled}
						spellCheck
						onChange={(event) => runtime.setInput(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								(event.ctrlKey || event.metaKey) &&
								canTranslate
							) {
								event.preventDefault();
								void runtime.translate();
							}
						}}
					/>
					<footer>
						<div className={styles.inputActions}>
							<FlashcardButton
								variant="primary"
								disabled={!canTranslate}
								onClick={() => void runtime.translate()}
							>
								{isLoading ? strings.translating : strings.translate}
							</FlashcardButton>
							<FlashcardButton
								preset="icon"
								variant="secondary"
								icon={Trash2}
								title={strings.clear}
								aria-label={strings.clear}
								disabled={!canClear}
								onClick={handleClear}
							/>
							{showUndo && (
								<output className={styles.undoBar}>
									<span>{strings.clearedNotice}</span>
									<button
										type="button"
										className={styles.undoBtn}
										onClick={handleUndo}
									>
										{strings.undo}
									</button>
								</output>
							)}
						</div>
						<span className={styles.shortcutHint}>{strings.shortcutHint}</span>
					</footer>
				</article>

				<section className={styles.outputSection} aria-label={strings.outputLabel}>
					<div className={styles.outputHeader}>
						<div className={styles.outputHeading}>
							<span className={styles.outputLabelText}>{strings.outputLabel}</span>
							<span className={styles.langPill}>{targetLanguage}</span>
						</div>
						<div className={styles.outputControls}>
							{configuredProfiles.length > 0 && (
								<div
									className={styles.segmented}
									role="tablist"
									aria-label={strings.outputLabel}
								>
									{configuredProfiles.map((profile) => (
										<button
											key={profile.id}
											id={`${viewId}-tab-${profile.id}`}
											role="tab"
											type="button"
											aria-selected={effectiveTab === profile.id}
											aria-controls={`${viewId}-panel-${profile.id}`}
											className={cls(
												styles.segmentButton,
												effectiveTab === profile.id && styles.active,
											)}
											onClick={() => setActiveTab(profile.id)}
										>
											{profile.name}
										</button>
									))}
									{configuredProfiles.length > 1 && (
										<button
											id={`${viewId}-tab-all`}
											role="tab"
											type="button"
											aria-selected={effectiveTab === "all"}
											aria-controls={`${viewId}-panel-all`}
											className={cls(
												styles.segmentButton,
												effectiveTab === "all" && styles.active,
											)}
											onClick={() => setActiveTab("all")}
										>
											{strings.compareTable}
										</button>
									)}
								</div>
							)}
							{effectiveTab === "all" && configuredProfiles.length > 1 && (
								<FlashcardButton
									size="sm"
									variant={showDiff ? "secondary" : "ghost"}
									preset="icon"
									icon={FileDiff}
									title={strings.diffToggle}
									aria-label={strings.diffToggle}
									className={cls(
										styles.diffButton,
										showDiff && styles.diffActive,
									)}
									onClick={() => setShowDiff((prev) => !prev)}
								/>
							)}
						</div>
					</div>

					{effectiveTab === "all" ? (
						<div
							id={`${viewId}-panel-all`}
							role="tabpanel"
							aria-labelledby={`${viewId}-tab-all`}
							className={styles.compareStack}
						>
							{snapshot.results.map((result) => renderCard(result, true))}
						</div>
					) : (
						singleResult && (
							<div
								id={`${viewId}-panel-${singleResult.id}`}
								role="tabpanel"
								aria-labelledby={`${viewId}-tab-${singleResult.id}`}
								className={styles.singleContainer}
							>
								{renderCard(singleResult, false)}
							</div>
						)
					)}
				</section>
			</section>
		</main>
	);
});
