import React, { memo, useMemo } from "react";
import { BarChart3, BookOpen, GraduationCap, House, RotateCw, Sparkles, Timer } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import type { StudyResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration, getLocalizedRatingButtons } from "../../../strings/index";
import styles from "./StudySummary.module.scss";

export interface StudySummaryProps {
	result: StudyResultSnapshot;
	onHome: () => void;
	onRestart?: () => void;
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
}: StudySummaryProps) {
	const { t, language } = useFlashcardI18n();

	const ratingButtons = useMemo(() => getLocalizedRatingButtons(language), [language]);

	const deckSummary = useMemo(() => {
		const formattedTime = formatCompactDuration(language, result.timeSpent);
		if (result.totalReviews > result.cardCount) {
			return t("study.summaryDeckWithRepeats", {
				deckName: result.originDeck.name,
				cardCount: result.cardCount,
				totalReviews: result.totalReviews,
				time: formattedTime,
			});
		}
		return t("study.summaryDeck", {
			deckName: result.originDeck.name,
			count: result.cardCount,
			time: formattedTime,
		});
	}, [
		language,
		result.cardCount,
		result.originDeck.name,
		result.timeSpent,
		result.totalReviews,
		t,
	]);

	return (
		<div className={cls("flashcard-study-summary fc-page fc-page--fill", styles.summary)}>
			<FlashcardHeader icon={GraduationCap} title={t("study.title")} onBack={onHome} />

			<div
				className={cls(
					"flashcard-study-summary-scroll fc-page__body",
					styles.summaryScroll,
				)}
			>
				<div className={cls("flashcard-study-summary-header", styles.summaryHeader)}>
					<div className={styles.headerIcon}>
						<Sparkles size={28} />
					</div>
					<div className={styles.summaryTitle}>{t("study.completeTitle")}</div>
					<div className={styles.summaryDeck}>{deckSummary}</div>
				</div>

				<div className={cls("flashcard-study-summary-stats", styles.summaryStats)}>
					<div className={cls("flashcard-study-stat-card", styles.statCard)}>
						<div className={styles.statIcon}>
							<BookOpen size={18} />
						</div>
						<div className={styles.statValue}>{result.cardCount}</div>
						<div className={styles.statLabel}>{t("study.cardCount")}</div>
					</div>

					<div className={cls("flashcard-study-stat-card", styles.statCard)}>
						<div className={styles.statIcon}>
							<RotateCw size={18} />
						</div>
						<div className={styles.statValue}>{result.totalReviews}</div>
						<div className={styles.statLabel}>{t("study.totalReviews")}</div>
					</div>

					<div className={cls("flashcard-study-stat-card", styles.statCard)}>
						<div className={styles.statIcon}>
							<Timer size={18} />
						</div>
						<div className={styles.statValue}>
							{formatCompactDuration(language, result.timeSpent)}
						</div>
						<div className={styles.statLabel}>{t("study.timeSpent")}</div>
					</div>
				</div>

				<div className={cls("flashcard-study-rating-section", styles.ratingSection)}>
					<div className={styles.ratingSectionHeader}>
						<BarChart3 size={16} />
						<span>{t("study.ratingDistribution")}</span>
					</div>
					<div className={styles.ratingGrid}>
						{ratingButtons.map((btn) => {
							const count = result.ratingCounts[btn.rating] ?? 0;
							return (
								<div
									key={btn.rating}
									className={cls(
										"flashcard-study-rating-item",
										styles.ratingItem,
										RATING_CLASSES[btn.rating],
									)}
								>
									<span className={styles.ratingItemCount}>{count}</span>
									<span className={styles.ratingItemLabel}>{btn.label}</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			<div className={cls("flashcard-study-summary-actions", styles.summaryActions)}>
				<FlashcardButton variant="primary" icon={House} iconSize={16} onClick={onHome}>
					{t("study.backHome")}
				</FlashcardButton>
				{onRestart && (
					<FlashcardButton
						variant="secondary"
						icon={RotateCw}
						iconSize={16}
						onClick={onRestart}
					>
						{t("study.studyAgain")}
					</FlashcardButton>
				)}
			</div>
		</div>
	);
});
