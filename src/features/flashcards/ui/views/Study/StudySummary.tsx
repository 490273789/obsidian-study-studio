import { memo, useMemo } from "react";
import {
	Award,
	BarChart3,
	BookmarkCheck,
	ExternalLink,
	FileText,
	GraduationCap,
	House,
	RotateCw,
} from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import type { StudyResultSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { SessionSummary } from "../../primitives/SessionSummary/SessionSummary";
import { MarkdownContent } from "../../primitives/Markdown";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration, getLocalizedRatingButtons } from "../../../strings/index";
import styles from "./StudySummary.module.scss";

interface StudySummaryProps {
	result: StudyResultSnapshot;
	onHome: () => void;
	onRestart?: () => void;
	markdownRenderer?: (content: string, el: HTMLElement) => Promise<void>;
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
	markdownRenderer,
	onOpenSourceFile,
}: StudySummaryProps) {
	const { t, language } = useFlashcardI18n();

	const ratingButtons = useMemo(() => getLocalizedRatingButtons(language), [language]);

	const deckSummary = useMemo(() => {
		const repeats = result.totalReviews - result.cardCount;
		if (repeats > 0) {
			return t("study.justCompletedWithRepeats", {
				deckName: result.originDeck.name,
				repeats,
			});
		}
		return t("study.justCompleted", {
			deckName: result.originDeck.name,
		});
	}, [result.cardCount, result.originDeck.name, result.totalReviews, t]);

	const lapseCards = result.lapseCards ?? [];
	const hasLapseCards = lapseCards.length > 0;

	const stats = useMemo(() => {
		const retentionRate = Math.round(
			((result.cardCount - lapseCards.length) / Math.max(1, result.cardCount)) * 100,
		);
		const avgSeconds = (result.timeSpent / Math.max(1, result.totalReviews)).toFixed(1);

		return [
			{
				label: t("study.retentionRate"),
				value: `${retentionRate}%`,
			},
			{
				label: t("study.timeSpent"),
				value: formatCompactDuration(language, result.timeSpent),
			},
			{
				label: t("study.averageSpeed"),
				value: t("study.secondsPerCard", { seconds: avgSeconds }),
			},
		];
	}, [lapseCards.length, language, result.cardCount, result.timeSpent, result.totalReviews, t]);

	return (
		<SessionSummary
			mode={t("study.title")}
			icon={GraduationCap}
			title={t("study.completeTitle")}
			description={deckSummary}
			layout="split"
			celebrate={true}
			metric={{ label: t("study.cardCount"), value: result.cardCount }}
			stats={stats}
			onHome={onHome}
			actions={[
				...(onRestart
					? [{ label: t("study.studyAgain"), icon: RotateCw, onClick: onRestart }]
					: []),
				{ label: t("study.backHome"), icon: House, onClick: onHome, primary: true },
			]}
			overviewExtra={
				<div className={cls("fc-panel", styles.ratingSection)}>
					<h2 className={styles.ratingSectionHeader}>
						<BarChart3 size={16} aria-hidden="true" />
						<span>{t("study.ratingDistribution")}</span>
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
					<div className={styles.cardList}>
						{lapseCards.map((card, idx) => {
							const fileName = card.sourceFile.split("/").pop() ?? card.sourceFile;
							return (
								<article key={card.identity} className={styles.cardItem}>
									<div className={styles.cardItemHeader}>
										<span className={styles.cardBadge}>#{idx + 1}</span>
										{onOpenSourceFile && (
											<button
												type="button"
												className={styles.openNoteBtn}
												onClick={() => onOpenSourceFile(card.sourceFile)}
												title={`${t("study.openNote")}: ${card.sourceFile}`}
												aria-label={`${t("study.openNote")}: ${card.sourceFile}`}
											>
												<FileText size={13} aria-hidden="true" />
												<span>{fileName}</span>
												<ExternalLink size={11} aria-hidden="true" />
											</button>
										)}
									</div>
									<div className={styles.cardContent}>
										<div className={styles.cardSide}>
											<span className={styles.fieldLabel}>
												{t("common.cardFront")}
											</span>
											{markdownRenderer ? (
												<MarkdownContent
													content={card.front}
													className={styles.markdownWrapper}
													markdownRenderer={markdownRenderer}
												/>
											) : (
												<div className={styles.rawText}>{card.front}</div>
											)}
										</div>
										<div className={styles.cardSide}>
											<span className={styles.fieldLabel}>
												{t("common.cardBack")}
											</span>
											{markdownRenderer ? (
												<MarkdownContent
													content={card.back}
													className={styles.markdownWrapper}
													markdownRenderer={markdownRenderer}
												/>
											) : (
												<div className={styles.rawText}>{card.back}</div>
											)}
										</div>
									</div>
									{card.explanation && (
										<div className={styles.cardExplanation}>
											<span className={styles.fieldLabel}>
												{t("common.explanation")}
											</span>
											{markdownRenderer ? (
												<MarkdownContent
													content={card.explanation}
													className={styles.markdownWrapper}
													markdownRenderer={markdownRenderer}
												/>
											) : (
												<div className={styles.rawText}>
													{card.explanation}
												</div>
											)}
										</div>
									)}
								</article>
							);
						})}
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
