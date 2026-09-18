import React, { memo, useMemo } from "react";
import { FileText, Check, X, Timer, CircleCheck, CircleX, RotateCw, House } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type {
	PracticeResultSnapshot,
	SessionCardSnapshot,
} from "../../../domain/sessions/sessionLifecycle";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { Confetti } from "../../../../../core/ui/primitives/Confetti";
import { MarkdownContent } from "../../primitives/Markdown";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import { getDisplayCardContent } from "../../../domain/cards/cardDisplay";
import styles from "./Practice.module.scss";

interface PracticeSummaryProps {
	result: PracticeResultSnapshot;
	onRestart: () => void;
	onPracticeIncorrect: () => void;
	onHome: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

function getAccuracyColor(accuracy: number): string {
	if (accuracy >= 90) return "var(--color-green)";
	if (accuracy >= 70) return "var(--color-blue)";
	if (accuracy >= 50) return "var(--color-orange)";
	return "var(--color-red)";
}

export const PracticeSummary = React.memo(function PracticeSummary({
	result,
	onRestart,
	onPracticeIncorrect,
	onHome,
	markdownRenderer,
}: PracticeSummaryProps) {
	const { t, language } = useFlashcardI18n();
	const completionMessage = useMemo(() => {
		if (result.incorrectCount === 0) {
			return t("practice.completePerfect");
		}

		return t("practice.completeWithErrors");
	}, [result.incorrectCount, t]);

	const incorrectCards = result.incorrectCards;

	return (
		<div className={cls("flashcard-practice-summary fc-page fc-page--fill", styles.summary)}>
			<Confetti />
			<FlashcardHeader icon={CircleCheck} title={t("practice.title")} onBack={onHome} />

			<div
				className={cls(
					"flashcard-practice-summary-scroll fc-page__body",
					styles.summaryScroll,
				)}
			>
				<div className={cls("flashcard-practice-summary-header", styles.summaryHeader)}>
					<div className={styles.summaryTitle}>{completionMessage}</div>
					<div className={styles.summaryDeck}>
						{t("practice.summaryDeck", {
							deckName: result.originDeck.name,
							totalQuestions: result.totalQuestions,
							time: formatCompactDuration(language, result.timeSpent),
						})}
					</div>
				</div>

				<div className={cls("flashcard-practice-summary-stats", styles.summaryStats)}>
					<div className={cls("flashcard-practice-stat-card", styles.statCard)}>
						<div
							className={styles.statValue}
							style={{ color: getAccuracyColor(result.accuracy) }}
						>
							{result.accuracy.toFixed(1)}%
						</div>
						<div className={styles.statLabel}>{t("practice.accuracy")}</div>
					</div>

					<div className={cls("flashcard-practice-stat-row", styles.statRow)}>
						<div
							className={cls("flashcard-practice-stat-item fc-lift", styles.statItem)}
						>
							<span className={styles.statIcon}>
								<FileText size={14} />
							</span>
							<span className={styles.statText}>
								{t("practice.totalQuestions")}
								<strong>{result.totalQuestions}</strong>
							</span>
						</div>
						<div
							className={cls(
								"flashcard-practice-stat-item flashcard-practice-stat-correct fc-lift",
								styles.statItem,
								styles.statCorrect,
							)}
						>
							<span className={styles.statIcon}>
								<Check size={14} />
							</span>
							<span className={styles.statText}>
								{t("practice.correct")}
								<strong>{result.correctCount}</strong>
							</span>
						</div>
						<div
							className={cls(
								"flashcard-practice-stat-item flashcard-practice-stat-wrong fc-lift",
								styles.statItem,
								styles.statWrong,
							)}
						>
							<span className={styles.statIcon}>
								<X size={14} />
							</span>
							<span className={styles.statText}>
								{t("practice.incorrect")}
								<strong>{result.incorrectCount}</strong>
							</span>
						</div>
						<div
							className={cls("flashcard-practice-stat-item fc-lift", styles.statItem)}
						>
							<span className={styles.statIcon}>
								<Timer size={14} />
							</span>
							<span className={styles.statText}>
								{t("practice.timeSpent")}
								<strong>{formatCompactDuration(language, result.timeSpent)}</strong>
							</span>
						</div>
					</div>
				</div>

				{incorrectCards.length > 0 && (
					<div
						className={cls(
							"flashcard-practice-incorrect-section",
							styles.incorrectSection,
						)}
					>
						<h3 className={styles.incorrectTitle}>
							<CircleX size={16} />{" "}
							{t("practice.incorrectList", {
								count: incorrectCards.length,
							})}
						</h3>
						<div className={styles.incorrectList}>
							{incorrectCards.map((card, index) => (
								<IncorrectCardItem
									key={card.identity}
									card={card}
									index={index + 1}
									direction={result.direction}
									markdownRenderer={markdownRenderer}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			<div className={cls("flashcard-practice-summary-actions", styles.summaryActions)}>
				<FlashcardButton
					variant="primary"
					icon={RotateCw}
					iconSize={14}
					onClick={onRestart}
				>
					{t("practice.restart")}
				</FlashcardButton>
				{result.incorrectCount > 0 && (
					<FlashcardButton
						variant="danger"
						icon={CircleX}
						iconSize={14}
						onClick={onPracticeIncorrect}
					>
						{t("practice.failed", {
							count: result.incorrectCount,
						})}
					</FlashcardButton>
				)}
				<FlashcardButton variant="secondary" icon={House} iconSize={14} onClick={onHome}>
					{t("practice.home")}
				</FlashcardButton>
			</div>
		</div>
	);
});

interface IncorrectCardItemProps {
	card: SessionCardSnapshot;
	index: number;
	direction: PracticeResultSnapshot["direction"];
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

const IncorrectCardItem = memo(function IncorrectCardItem({
	card,
	index,
	direction,
	markdownRenderer,
}: IncorrectCardItemProps) {
	const { t } = useFlashcardI18n();
	const displayContent = getDisplayCardContent(card, direction);

	return (
		<div className={cls("flashcard-practice-incorrect-item fc-lift", styles.incorrectItem)}>
			<div className={styles.incorrectIndex}>{index}</div>
			<div className={styles.incorrectContent}>
				<div className={styles.incorrectQuestion}>
					<span className={styles.incorrectLabel}>{t("practice.questionLabel")}</span>
					<MarkdownContent
						content={displayContent.prompt}
						className={styles.incorrectText}
						markdownRenderer={markdownRenderer}
					/>
				</div>
				<div className={styles.incorrectAnswer}>
					<span className={styles.incorrectLabel}>{t("practice.answerLabel")}</span>
					<MarkdownContent
						content={displayContent.answer}
						className={styles.incorrectText}
						markdownRenderer={markdownRenderer}
					/>
				</div>
				{displayContent.explanation && (
					<div className={styles.incorrectExplanation}>
						<span className={styles.incorrectLabel}>{t("common.explanation")}:</span>
						<MarkdownContent
							content={displayContent.explanation}
							className={styles.incorrectText}
							markdownRenderer={markdownRenderer}
						/>
					</div>
				)}
			</div>
		</div>
	);
});
