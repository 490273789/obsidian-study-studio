import React, { memo } from "react";
import { CircleCheck, House, RotateCw } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import type { ChallengeResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { formatCompactDuration } from "../../../strings";
import { useFlashcardI18n } from "../../../strings/context";
import { MarkdownContent } from "../../primitives/Markdown";
import styles from "../../primitives/SessionSummary/SessionSummary.module.scss";

interface ChallengeSummaryProps {
	result: ChallengeResultSnapshot;
	onNextLevel: () => void;
	onRestart: () => void;
	onEnd: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const ChallengeSummary = memo(function ChallengeSummary({
	result,
	onNextLevel,
	onRestart,
	onEnd,
	markdownRenderer,
}: ChallengeSummaryProps) {
	const { t, language } = useFlashcardI18n();
	const level = result.roundComplete
		? {
				...result.levelResult,
				...result.roundSummary,
				firstTryAccuracy: result.roundSummary.totalQuestions
					? Math.round(
							(result.roundSummary.firstTryCorrectCount /
								result.roundSummary.totalQuestions) *
								100,
						)
					: 0,
			}
		: result.levelResult;
	const roundComplete = result.roundComplete;
	const title = roundComplete
		? t("challenge.roundCompletedTitle")
		: t("challenge.completedTitle");
	return (
		<SessionSummary
			mode={t("challenge.title")}
			icon={CircleCheck}
			title={title}
			description={
				<>
					{t("challenge.level", { current: result.levelResult.levelIndex + 1 })} ·{" "}
					{result.roundSummary.completedLevels}/{result.roundSummary.totalLevels}
					<br />
					{t("challenge.completedSubtitle")}
				</>
			}
			metric={{
				label: t("challenge.firstTryAccuracy"),
				value: `${Math.round(level.firstTryAccuracy)}%`,
			}}
			stats={[
				{
					label: t("challenge.firstTryCorrect"),
					value: `${level.firstTryCorrectCount}/${level.totalQuestions}`,
				},
				{ label: t("challenge.retries"), value: level.retryCount },
				{
					label: t("challenge.timeSpent"),
					value: formatCompactDuration(language, level.timeSpent),
				},
			]}
			onHome={onEnd}
			actions={[
				{
					label: t("challenge.end"),
					icon: House,
					onClick: onEnd,
					primary: roundComplete || !result.canContinue,
				},
				...(!roundComplete && result.canContinue
					? [{ label: t("challenge.nextLevel"), onClick: onNextLevel, primary: true }]
					: [{ label: t("challenge.restart"), icon: RotateCw, onClick: onRestart }]),
			]}
		>
			{result.removedCardCount > 0 && (
				<p className={styles.removed}>
					{t("challenge.removedCards", { count: result.removedCardCount })}
				</p>
			)}
			{result.incorrectCards.length > 0 && (
				<section className={cls("fc-panel", styles.incorrectSection)}>
					<h2 className={styles.incorrectTitle}>
						{t("challenge.missedCards", { count: result.incorrectCards.length })}
					</h2>
					<ul className={styles.incorrectList}>
						{result.incorrectCards.map((card) => (
							<li className={styles.incorrectItem} key={card.identity}>
								<div className={styles.incorrectContent}>
									<MarkdownContent
										content={card.front}
										className={styles.incorrectText}
										markdownRenderer={markdownRenderer}
									/>
									<span className={styles.source}>
										{t("challenge.source", {
											deckName: card.currentDeckName ?? card.sourceFile,
										})}
									</span>
									<MarkdownContent
										content={card.back}
										className={styles.incorrectText}
										markdownRenderer={markdownRenderer}
									/>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
		</SessionSummary>
	);
});
