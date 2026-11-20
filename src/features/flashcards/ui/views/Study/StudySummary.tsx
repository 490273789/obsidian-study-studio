import type { MarkdownRendererFn } from "../../primitives/Markdown";
import { memo, useMemo } from "react";
import { Award, BarChart3, BookmarkCheck, GraduationCap, House, RotateCw } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import type { StudyResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration, getLocalizedRatingButtons } from "../../../strings/index";
import { StudyReviewCard } from "./StudyReviewCard";
import styles from "./StudySummary.module.scss";

interface StudySummaryProps {
	result: StudyResultSnapshot;
	onHome: () => void;
	onRestart?: () => void;
	onPracticeLapses?: () => void;
	isBusy?: boolean;
	markdownRenderer?: MarkdownRendererFn;
	onOpenSourceFile?: (filePath: string) => void;
}

const RATING_CLASSES: Record<StudyRating, string> = {
	1: styles.ratingItem1,
	2: styles.ratingItem2,
	3: styles.ratingItem3,
	4: styles.ratingItem4,
	5: styles.ratingItem5,
};

export const StudySummary = memo(function StudySummary({
	result,
	onHome,
	onRestart,
	onPracticeLapses,
	isBusy = false,
	markdownRenderer,
	onOpenSourceFile,
}: StudySummaryProps) {
	const { t, language } = useFlashcardI18n();

	const ratingButtons = useMemo(() => getLocalizedRatingButtons(language), [language]);

	const deckSummary = useMemo(() => {
		const repeats = result.totalReviews - result.cardCount;
		if (repeats > 0) {
			return t("study.answersWithRepeats", {
				deckName: result.originDeck.name,
				totalReviews: result.totalReviews,
				repeats,
			});
		}
		return t("study.answers", {
			deckName: result.originDeck.name,
			totalReviews: result.totalReviews,
		});
	}, [result.cardCount, result.originDeck.name, result.totalReviews, t]);

	const lapseCards = result.lapseCards ?? [];
	const hasLapseCards = lapseCards.length > 0;

	const stats = useMemo(() => {
		const unflaggedCount = result.cardCount - lapseCards.length;
		const unflaggedPercent = Math.round((unflaggedCount / Math.max(1, result.cardCount)) * 100);
		const avgSeconds = (result.timeSpent / Math.max(1, result.totalReviews)).toFixed(1);

		return [
			{
				label: t("study.unflaggedCards"),
				value: t("study.unflaggedCardsValue", {
					count: unflaggedCount,
					total: result.cardCount,
					percent: unflaggedPercent,
				}),
			},
			{
				label: t("study.timeSpent"),
				value: formatCompactDuration(language, result.timeSpent),
			},
			{
				label: t("study.averageAnswerTime"),
				value: t("study.secondsPerAnswer", { seconds: avgSeconds }),
			},
		];
	}, [lapseCards.length, language, result.cardCount, result.timeSpent, result.totalReviews, t]);

	return (
		<SessionSummary
			mode={t("study.title")}
			icon={GraduationCap}
			title={t("study.completeTitle")}
			description={deckSummary}
			layout="review"
			celebrate={true}
			metric={{ label: t("study.cardCount"), value: result.cardCount }}
			stats={stats}
			onHome={onHome}
			actions={[
				...(onRestart
					? [
							{
								label: t("study.backToStudySetup"),
								icon: RotateCw,
								onClick: onRestart,
								disabled: isBusy,
							},
						]
					: []),
				...(hasLapseCards && onPracticeLapses
					? [
							{
								label: t("study.practiceLapses", { count: lapseCards.length }),
								icon: BookmarkCheck,
								onClick: onPracticeLapses,
								disabled: isBusy,
							},
						]
					: []),
				{
					label: t("study.backHome"),
					icon: House,
					onClick: onHome,
					primary: true,
					disabled: isBusy,
				},
			]}
			overviewExtra={
				<div className={cls("fc-panel", styles.ratingSection)}>
					<h2 className={styles.ratingSectionHeader}>
						<BarChart3 size={16} aria-hidden="true" />
						<span>{t("study.ratingDistribution", { count: result.totalReviews })}</span>
					</h2>
					<div className={styles.ratingGrid}>
						{ratingButtons.map((btn) => {
							const count = result.ratingCounts[btn.rating] ?? 0;
							const isZero = count === 0;
							return (
								<div
									key={btn.rating}
									className={cls(
										styles.ratingItem,
										RATING_CLASSES[btn.rating],
										isZero && styles.ratingItemZero,
									)}
								>
									<span className={styles.ratingItemCount}>{count}</span>
									<span className={styles.ratingItemLabel}>{btn.label}</span>
								</div>
							);
						})}
					</div>
				</div>
			}
		>
			{hasLapseCards ? (
				<section className={cls("fc-panel", styles.reviewSection)}>
					<div className={styles.reviewHeader}>
						<div className={styles.reviewTitleGroup}>
							<BookmarkCheck size={16} aria-hidden="true" />
							<h2 className={styles.reviewTitle}>
								{t("study.weakCardsTitle")} ({lapseCards.length})
							</h2>
						</div>
						<span className={styles.reviewSubtitle}>
							{t("study.weakCardsSubtitle")}
						</span>
					</div>
					{onPracticeLapses && (
						<p className={styles.practiceNote}>{t("study.practiceLapsesNote")}</p>
					)}
					<div className={styles.cardList}>
						{lapseCards.map((card, index) => (
							<StudyReviewCard
								key={card.identity}
								card={card}
								index={index + 1}
								markdownRenderer={markdownRenderer}
								onOpenSourceFile={onOpenSourceFile}
							/>
						))}
					</div>
				</section>
			) : (
				<section className={cls("fc-panel", styles.allMasteredSection)}>
					<div className={styles.masteredIconWrapper}>
						<Award size={36} aria-hidden="true" />
					</div>
					<h2 className={styles.masteredTitle}>{t("study.allMasteredTitle")}</h2>
					<p className={styles.masteredSubtitle}>{t("study.allMasteredSubtitle")}</p>
				</section>
			)}
		</SessionSummary>
	);
});
