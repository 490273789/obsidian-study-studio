import React, { memo } from "react";
import { CircleCheck, House, RotateCw, Timer } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { Confetti } from "../../../../../core/ui/primitives/Confetti";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import type { ChallengeResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { formatCompactDuration } from "../../../strings";
import { useFlashcardI18n } from "../../../strings/context";
import { MarkdownContent } from "../../primitives/Markdown";
import styles from "./Challenge.module.scss";

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
	return (
		<div className={cls("fc-page fc-page--fill", styles.summary)}>
			{!result.sourceChanged && <Confetti />}
			<FlashcardHeader
				icon={CircleCheck}
				title={
					roundComplete
						? t("challenge.roundCompletedTitle")
						: result.sourceChanged
							? t("challenge.sourceChangedTitle")
							: t("challenge.completedTitle")
				}
				onBack={onEnd}
			/>
			<div className={cls("fc-page__body", styles.summaryBody)}>
				<p className={styles.summarySubtitle}>
					{t("challenge.level", { current: result.levelResult.levelIndex + 1 })} ·{" "}
					{result.roundSummary.completedLevels}/{result.roundSummary.totalLevels}
				</p>
				<p className={styles.summarySubtitle}>
					{result.sourceChanged
						? t("challenge.sourceChangedNote")
						: t("challenge.completedSubtitle")}
				</p>
				<div className={styles.stats}>
					<Stat
						label={t("challenge.firstTryAccuracy")}
						value={`${Math.round(level.firstTryAccuracy)}%`}
					/>
					<Stat
						label={t("challenge.firstTryCorrect")}
						value={`${level.firstTryCorrectCount}/${level.totalQuestions}`}
					/>
					<Stat label={t("challenge.retries")} value={String(level.retryCount)} />
					<Stat
						label={t("challenge.timeSpent")}
						value={formatCompactDuration(language, level.timeSpent)}
						icon={<Timer size={16} />}
					/>
				</div>
				{result.removedCardCount > 0 && (
					<p className={styles.removed}>
						{t("challenge.removedCards", { count: result.removedCardCount })}
					</p>
				)}
				{result.incorrectCards.length > 0 && (
					<section className={styles.missed}>
						<h2>
							{t("challenge.missedCards", { count: result.incorrectCards.length })}
						</h2>
						<ul>
							{result.incorrectCards.map((card) => (
								<li key={card.identity}>
									<MarkdownContent
										content={card.front}
										className="flashcard-markdown"
										markdownRenderer={markdownRenderer}
									/>
									<span>
										{t("challenge.source", {
											deckName: card.currentDeckName ?? card.sourceFile,
										})}
									</span>
									<MarkdownContent
										content={card.back}
										className="flashcard-markdown"
										markdownRenderer={markdownRenderer}
									/>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
			<div className={cls("flashcard-footer", styles.summaryActions)}>
				<FlashcardButton variant="ghost" icon={House} onClick={onEnd}>
					{t("challenge.end")}
				</FlashcardButton>
				{roundComplete ? (
					<FlashcardButton variant="secondary" icon={RotateCw} onClick={onRestart}>
						{t("challenge.restart")}
					</FlashcardButton>
				) : result.canContinue ? (
					<FlashcardButton variant="primary" onClick={onNextLevel}>
						{t("challenge.nextLevel")}
					</FlashcardButton>
				) : (
					<FlashcardButton variant="secondary" icon={RotateCw} onClick={onRestart}>
						{t("challenge.restart")}
					</FlashcardButton>
				)}
			</div>
		</div>
	);
});

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
	return (
		<div className={styles.stat}>
			{icon}
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}
