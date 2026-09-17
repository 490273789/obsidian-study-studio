import React, {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Copy, Languages, Settings2, Trash2 } from "lucide-react";
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

interface TranslatorViewProps {
	runtime: TranslationRuntime;
	language: Language;
	focusController?: TranslatorFocusController;
	onOpenSettings: () => void;
}

interface CopyFeedback {
	result: TranslationResultState;
	message: string;
	isError: boolean;
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

export const TranslatorView = React.memo(function TranslatorView({
	runtime,
	language,
	focusController,
	onOpenSettings,
}: TranslatorViewProps) {
	const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
	const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot);
	const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
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
	const strings = translationStrings(language);
	const isLoading = snapshot.status === "loading";
	const configuredProfiles = snapshot.settings.profiles.filter((profile) => profile.enabled);
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
	const isStatusError = snapshot.status === "error";

	const copyResult = async (result: TranslationResultState): Promise<void> => {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(result.text);
			setCopyFeedback({ result, message: strings.copied, isError: false });
		} catch {
			setCopyFeedback({ result, message: strings.copyFailed, isError: true });
		}
	};

	return (
		<main className={cls("fc-page fc-page--column", styles.page)} aria-busy={isLoading}>
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
				<section className={styles.notice}>
					<span>{strings.disabled}</span>
					<FlashcardButton variant="secondary" size="sm" onClick={onOpenSettings}>
						{strings.openSettings}
					</FlashcardButton>
				</section>
			) : configuredProfiles.length === 0 ? (
				<section className={styles.notice}>
					<span>{strings.noProfiles}</span>
					<FlashcardButton variant="secondary" size="sm" onClick={onOpenSettings}>
						{strings.openSettings}
					</FlashcardButton>
				</section>
			) : null}

			<section className={styles.workspace}>
				<article className={cls("fc-panel", styles.panel)}>
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
				</article>

				<section className={styles.results} aria-label={strings.outputLabel}>
					{snapshot.results.map((result) => {
						const usage = resultUsage(result, strings.usage);
						const feedback = copyFeedback?.result === result ? copyFeedback : null;
						const error = result.error ? aiErrorText(language, result.error) : null;
						return (
							<article
								key={result.id}
								className={cls("fc-panel", styles.panel)}
								aria-busy={result.status === "loading"}
							>
								<header>
									<div className={styles.resultTitle}>
										<strong>{result.name}</strong>
										<span>
											{result.model
												? `${providerLabel(result.provider, strings)} · ${result.model}`
												: providerLabel(result.provider, strings)}
										</span>
									</div>
									<FlashcardButton
										size="sm"
										variant="ghost"
										icon={Copy}
										disabled={!result.text || result.status === "loading"}
										onClick={() => void copyResult(result)}
									></FlashcardButton>
								</header>
								<FlashcardTextarea
									id={`${viewId}-translator-output-${result.id}`}
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
								{(error || usage || feedback) && (
									<footer>
										{error && (
											<p className={styles.isError} role="alert">
												{error}
											</p>
										)}
										{feedback && (
											<p
												className={
													feedback.isError ? styles.isError : undefined
												}
												role={feedback.isError ? "alert" : "status"}
											>
												{feedback.message}
											</p>
										)}
										{usage && <p className={styles.usage}>{usage}</p>}
									</footer>
								)}
							</article>
						);
					})}
				</section>
			</section>

			<footer className={styles.footer}>
				<div className={styles.actions}>
					<FlashcardButton
						variant="primary"
						disabled={!canTranslate}
						onClick={() => void runtime.translate()}
					>
						{isLoading ? strings.translating : strings.translate}
					</FlashcardButton>
					<FlashcardButton
						icon={Trash2}
						disabled={!canClear}
						onClick={() => runtime.clear()}
					>
						{strings.clear}
					</FlashcardButton>
					<span>{strings.shortcutHint}</span>
				</div>
				{statusText && (
					<p
						className={cls(styles.status, isStatusError && styles.isError)}
						role={isStatusError ? "alert" : "status"}
					>
						{statusText}
					</p>
				)}
			</footer>
		</main>
	);
});
