import { memo, useMemo } from "react";
import { BarChart3, GraduationCap, House, RotateCw } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import type { StudyResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration, getLocalizedRatingButtons } from "../../../strings/index";
import styles from "./StudySummary.module.scss";

interface StudySummaryProps {
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
		<SessionSummary
			mode={t("study.title")}
			icon={GraduationCap}
			title={t("study.completeTitle")}
			description={deckSummary}
			metric={{ label: t("study.cardCount"), value: result.cardCount }}
			stats={[
				{ label: t("study.totalReviews"), value: result.totalReviews },
				{
					label: t("study.timeSpent"),
					value: formatCompactDuration(language, result.timeSpent),
				},
			]}
			onHome={onHome}
			actions={[
				...(onRestart
					? [{ label: t("study.studyAgain"), icon: RotateCw, onClick: onRestart }]
					: []),
				{ label: t("study.backHome"), icon: House, onClick: onHome, primary: true },
			]}
		>
			<div className={cls("fc-panel", styles.ratingSection)}>
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
								className={cls(styles.ratingItem, RATING_CLASSES[btn.rating])}
							>
								<span className={styles.ratingItemCount}>{count}</span>
								<span className={styles.ratingItemLabel}>{btn.label}</span>
							</div>
						);
					})}
				</div>
			</div>
		</SessionSummary>
	);
});
