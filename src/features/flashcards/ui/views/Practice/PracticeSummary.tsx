import React, { memo, useState } from "react";
import { CircleCheck, CircleX, House, RotateCw } from "lucide-react";
import type {
	PracticeResultSnapshot,
	SessionCardSnapshot,
} from "../../../domain/sessions/sessionLifecycle";
import { MarkdownContent } from "../../primitives/Markdown";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import { getDisplayCardContent } from "../../../domain/cards/cardDisplay";
import styles from "../../primitives/SessionSummary/SessionSummary.module.scss";

/**
 * Each incorrect row mounts up to three Obsidian Markdown renders, so a long
 * list would parse on a single result-screen commit. Mount one screenful first
 * and let the learner reveal the rest on demand.
 */
const INITIAL_INCORRECT_VISIBLE_COUNT = 10;

interface PracticeSummaryProps {
	result: PracticeResultSnapshot;
	onRestart: () => void;
	onPracticeIncorrect: () => void;
	onHome: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const PracticeSummary = memo(function PracticeSummary({
	result,
	onRestart,
	onPracticeIncorrect,
	onHome,
	markdownRenderer,
}: PracticeSummaryProps) {
	const { t, language } = useFlashcardI18n();
	const incorrectCards = result.incorrectCards;
	const hasIncorrect = result.incorrectCount > 0;
	// Remember which result was expanded: a replacement result starts collapsed.
	const [expandedResult, setExpandedResult] = useState<PracticeResultSnapshot | null>(null);
	const isExpanded = expandedResult === result;
	const visibleCards = isExpanded
		? incorrectCards
		: incorrectCards.slice(0, INITIAL_INCORRECT_VISIBLE_COUNT);
	const hiddenCardCount = incorrectCards.length - visibleCards.length;
	return (
		<SessionSummary
			mode={t("practice.title")}
			icon={CircleCheck}
			title={t(
				result.incorrectCount === 0
					? "practice.completePerfect"
					: "practice.completeWithErrors",
			)}
			description={t("practice.summaryDeck", {
				deckName: result.originDeck.name,
				totalQuestions: result.totalQuestions,
				time: formatCompactDuration(language, result.timeSpent),
			})}
			metric={{ label: t("practice.accuracy"), value: `${result.accuracy.toFixed(1)}%` }}
			stats={[
				{ label: t("practice.correct"), value: result.correctCount },
				{ label: t("practice.incorrect"), value: result.incorrectCount },
				{ label: t("practice.totalQuestions"), value: result.totalQuestions },
				{
					label: t("practice.timeSpent"),
					value: formatCompactDuration(language, result.timeSpent),
				},
			]}
			onHome={onHome}
			actions={[
				{ label: t("practice.home"), icon: House, onClick: onHome, primary: !hasIncorrect },
				{ label: t("practice.restart"), icon: RotateCw, onClick: onRestart },
				...(hasIncorrect
					? [
							{
								label: t("practice.failed", { count: result.incorrectCount }),
								icon: RotateCw,
								onClick: onPracticeIncorrect,
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
						{t("practice.incorrectList", { count: incorrectCards.length })}
					</h2>
					<div className={styles.incorrectList}>
						{visibleCards.map((card, index) => (
							<IncorrectCardItem
								key={card.identity}
								card={card}
								index={index + 1}
								direction={result.direction}
								markdownRenderer={markdownRenderer}
							/>
						))}
					</div>
					{hiddenCardCount > 0 && (
						<div className={styles.incorrectMore}>
							<FlashcardButton
								variant="secondary"
								size="md"
								onClick={() => setExpandedResult(result)}
							>
								{t("practice.showMoreIncorrect", { count: hiddenCardCount })}
							</FlashcardButton>
						</div>
					)}
				</section>
			)}
		</SessionSummary>
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
		<div className={cls("flashcard-summary-incorrect-item", styles.incorrectItem)}>
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
