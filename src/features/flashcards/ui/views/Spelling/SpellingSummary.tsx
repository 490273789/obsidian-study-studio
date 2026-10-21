import { memo } from "react";
import { CircleX, House, Keyboard, RotateCw } from "lucide-react";
import type {
	SpellingIncorrectCardSnapshot,
	SpellingResultSnapshot,
} from "../../../domain/sessions/sessionLifecycle";
import { MarkdownContent } from "../../primitives/Markdown";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import { cls } from "../../../../../core/shared/classNames";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import styles from "../../primitives/SessionSummary/SessionSummary.module.scss";

interface SpellingSummaryProps {
	result: SpellingResultSnapshot;
	onRestart: () => void;
	onRetryIncorrect: () => void;
	onHome: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const SpellingSummary = memo(function SpellingSummary({
	result,
	onRestart,
	onRetryIncorrect,
	onHome,
	markdownRenderer,
}: SpellingSummaryProps) {
	const { t, language } = useFlashcardI18n();
	const incorrectCards = result.incorrectCards;
	const hasIncorrect = incorrectCards.length > 0;
	return (
		<SessionSummary
			mode={t("spelling.title")}
			icon={Keyboard}
			title={t(
				result.firstTryIncorrectCount === 0
					? "spelling.completePerfect"
					: "spelling.completeWithErrors",
			)}
			description={t("spelling.summaryDeck", {
				deckName: result.originDeck.name,
				totalWords: result.totalWords,
				time: formatCompactDuration(language, result.timeSpent),
			})}
			metric={{
				label: t("spelling.firstTryAccuracy"),
				value: `${result.firstTryAccuracy.toFixed(1)}%`,
			}}
			stats={[
				{ label: t("spelling.firstTryCorrect"), value: result.firstTryCorrectCount },
				{ label: t("spelling.firstTryIncorrect"), value: result.firstTryIncorrectCount },
				{ label: t("spelling.totalAttempts"), value: result.totalRetrievalAttempts },
				{
					label: t("practice.timeSpent"),
					value: formatCompactDuration(language, result.timeSpent),
				},
			]}
			onHome={onHome}
			actions={[
				{ label: t("practice.home"), icon: House, onClick: onHome, primary: !hasIncorrect },
				{ label: t("spelling.chooseAgain"), icon: RotateCw, onClick: onRestart },
				...(hasIncorrect
					? [
							{
								label: t("spelling.retryIncorrect", {
									count: incorrectCards.length,
								}),
								icon: RotateCw,
								onClick: onRetryIncorrect,
								primary: true,
							},
						]
					: []),
			]}
		>
			{incorrectCards.length > 0 && (
				<section className={cls("fc-panel", styles.incorrectSection)}>
					<h2 className={styles.incorrectTitle}>
						<CircleX size={16} aria-hidden="true" />
						{t("spelling.incorrectList", { count: incorrectCards.length })}
					</h2>
					<div className={styles.incorrectList}>
						{incorrectCards.map((card, index) => (
							<IncorrectSpellingItem
								key={card.identity}
								card={card}
								index={index + 1}
								markdownRenderer={markdownRenderer}
							/>
						))}
					</div>
				</section>
			)}
		</SessionSummary>
	);
});

const IncorrectSpellingItem = memo(function IncorrectSpellingItem({
	card,
	index,
	markdownRenderer,
}: {
	card: SpellingIncorrectCardSnapshot;
	index: number;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}) {
	const { t } = useFlashcardI18n();
	return (
		<div className={cls(styles.incorrectItem)}>
			<div className={styles.incorrectIndex}>{index}</div>
			<div className={styles.incorrectContent}>
				<div>
					<span className={styles.incorrectLabel}>{t("spelling.meaningPrompt")}</span>
					<MarkdownContent
						content={card.back}
						className={styles.incorrectText}
						markdownRenderer={markdownRenderer}
					/>
				</div>
				<div className={styles.summaryAnswerRow}>
					<span>
						{t("spelling.firstInput")}: <strong>{card.firstInput || "—"}</strong>
					</span>
					<span>
						{t("spelling.correctAnswer")}: <strong>{card.expectedAnswer}</strong>
					</span>
				</div>
			</div>
		</div>
	);
});
