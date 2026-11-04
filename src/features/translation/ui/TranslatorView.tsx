import React, {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Check, Copy, FileText, Layers, Languages, Settings2, Trash2 } from "lucide-react";
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
	onCreateCard?: (sourceText: string, targetText: string) => void;
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
): string {
	const providerName = providerLabel(provider, strings);
	if (!model) return providerName;
	if (name.trim().toLowerCase() === providerName.trim().toLowerCase()) {
		return model;
	}
	return `${providerName} · ${model}`;
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
	const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
	const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
		if (feedbackTimeoutRef.current) {
			clearTimeout(feedbackTimeoutRef.current);
		}
		setFeedback(newFeedback);
		feedbackTimeoutRef.current = setTimeout(() => {
			setFeedback(null);
			feedbackTimeoutRef.current = null;
		}, 1800);
	}, []);

	useEffect(() => {
		return () => {
			if (feedbackTimeoutRef.current) {
				clearTimeout(feedbackTimeoutRef.current);
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
			onCreateCard(snapshot.input, result.text);
			showFeedback({ id: result.id, type: "card", message: strings.cardCopied });
			return;
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

	const renderCard = (result: TranslationResultState) => {
		const usage = resultUsage(result, strings.usage);
		const error = result.error ? aiErrorText(language, result.error) : null;
		const isCopied = feedback?.id === result.id && feedback.type === "copied";
		const isInserted = feedback?.id === result.id && feedback.type === "inserted";
		const isCard = feedback?.id === result.id && feedback.type === "card";
		const subtitle = cleanProfileSubtitle(result.name, result.provider, result.model, strings);

		return (
			<article
				key={result.id}
				className={cls("fc-panel", styles.resultPanel)}
				aria-busy={result.status === "loading"}
			>
				<header>
					<div className={styles.resultTitle}>
						<strong>{result.name}</strong>
						<span>{subtitle}</span>
					</div>
					<div className={styles.cardActions}>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isCard ? Check : Layers}
							title={isCard ? feedback.message : strings.makeCard}
							aria-label={isCard ? feedback.message : strings.makeCard}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void makeCard(result)}
						/>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isInserted ? Check : FileText}
							title={isInserted ? feedback.message : strings.insertNote}
							aria-label={isInserted ? feedback.message : strings.insertNote}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void insertToNote(result)}
						/>
						<FlashcardButton
							size="sm"
							variant="ghost"
							preset="icon"
							icon={isCopied ? Check : Copy}
							title={isCopied ? feedback.message : strings.copied}
							aria-label={isCopied ? feedback.message : strings.copied}
							disabled={!result.text || result.status === "loading"}
							onClick={() => void copyResult(result)}
						/>
					</div>
				</header>
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
				<footer>
					{error ? (
						<p className={cls(styles.statusMessage, styles.isError)} role="alert">
							{error}
						</p>
					) : feedback?.id === result.id ? (
						<span className={styles.feedbackTag}>
							<Check size={12} aria-hidden="true" />
							{feedback.message}
						</span>
					) : (
						<span className={styles.statusMessage}>
							{result.status === "loading" ? strings.translating : ""}
						</span>
					)}
					{usage && <p className={styles.usage}>{usage}</p>}
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

			<section className={styles.direction} aria-label={strings.direction}>
				<strong>{sourceLanguage}</strong>
				<FlashcardButton
					preset="icon"
					variant="secondary"
					icon={Languages}
					title={strings.swapDirection}
					aria-label={strings.swapDirection}
					disabled={isLoading || snapshot.saving}
					onClick={() => void runtime.swapDirection()}
				/>
				<strong>{targetLanguage}</strong>
			</section>

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
						<label htmlFor={`${viewId}-translator-input`}>{strings.inputLabel}</label>
						<span>
							{formatTranslationString(strings.characterCount, {
								count: snapshot.input.length,
							})}
						</span>
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
								onClick={() => runtime.clear()}
							/>
						</div>
						<span className={styles.shortcutHint}>{strings.shortcutHint}</span>
					</footer>
				</article>

				<section className={styles.outputSection} aria-label={strings.outputLabel}>
					{configuredProfiles.length > 0 && (
						<div className={styles.segmentedHeader}>
							<div
								className={styles.segmented}
								role="tablist"
								aria-label={strings.outputLabel}
							>
								{configuredProfiles.map((profile) => (
									<button
										key={profile.id}
										role="tab"
										type="button"
										aria-selected={effectiveTab === profile.id}
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
										role="tab"
										type="button"
										aria-selected={effectiveTab === "all"}
										className={cls(
											styles.segmentButton,
											effectiveTab === "all" && styles.active,
										)}
										onClick={() => setActiveTab("all")}
									>
										{strings.compareAll}
									</button>
								)}
							</div>
						</div>
					)}

					{effectiveTab === "all" ? (
						<div className={styles.compareGrid}>
							{snapshot.results.map((result) => renderCard(result))}
						</div>
					) : (
						singleResult && renderCard(singleResult)
					)}
				</section>
			</section>
		</main>
	);
});
