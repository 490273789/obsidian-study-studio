import React, { useMemo } from "react";
import { ChartBar, Clock3, Layers, Sprout } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyHistoryEntry } from "../../../../../core/shared/types";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { StatCards } from "../../../../../core/ui/primitives/StatCards";
import {
	buildStudyHistoryPresentationModel,
	STUDY_HISTORY_MODE_PRESENTATION,
} from "../../../domain/history/studyHistoryPresentationModel";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import styles from "./Stats.module.scss";

const MODE_CLASSES: Record<StudyHistoryEntry["mode"], string> = {
	study: styles.modeStudy,
	practice: styles.modePractice,
	spelling: styles.modeSpelling,
	"word-list": styles.modeList,
};

interface StatsViewProps {
	history: StudyHistoryEntry[];
	onBack: () => void;
}

export const StatsView = React.memo(function StatsView({ history, onBack }: StatsViewProps) {
	const { t, language } = useFlashcardI18n();
	const presentation = useMemo(
		() => buildStudyHistoryPresentationModel(history, { language, t }),
		[history, language, t],
	);
	const { dayGroups, totals } = presentation;

	return (
		<div className="fc-page fc-page--fill">
			<FlashcardHeader icon={ChartBar} title={t("stats.title")} onBack={onBack} />

			<StatCards
				items={[
					{
						key: "duration",
						icon: Clock3,
						value: totals.durationLabel,
						label: t("stats.totalDuration"),
						tone: "purple",
					},
					{
						key: "cards",
						icon: Layers,
						value: totals.cards,
						label: t("stats.totalCards"),
						tone: "green",
					},
				]}
			/>

			{/* Day list */}
			<div className={cls("fc-page__body", styles.body)}>
				{dayGroups.length === 0 ? (
					<div className="flashcard-empty">
						<div className="flashcard-empty-icon">
							<Sprout size={48} />
						</div>
						<p>{t("stats.noRecords")}</p>
						<p className="flashcard-empty-hint">{t("stats.noRecordsHint")}</p>
					</div>
				) : (
					<div>
						{dayGroups.map(
							({ date, displayDate, entries, totalDurationLabel, totalCards }) => (
								<div key={date} className={cls("fc-lift", styles.day)}>
									<div className={styles.dayHeader}>
										<span className={styles.dayDate}>{displayDate}</span>
										<span className={styles.dayMeta}>
											{t("stats.records", {
												count: entries.length,
											})}{" "}
											· {totalDurationLabel}
											{totalCards > 0 &&
												` · ${t("stats.cards", {
													count: totalCards,
												})}`}
										</span>
									</div>

									<div>
										{entries.map((entry) => (
											<div
												key={`${entry.timestamp}-${entry.deckId}-${entry.mode}`}
												className={cls(
													"fc-lift",
													styles.session,
													MODE_CLASSES[entry.mode],
												)}
											>
												<span className={styles.sessionMode}>
													{t(
														STUDY_HISTORY_MODE_PRESENTATION[entry.mode]
															.labelKey,
													)}
												</span>
												<span className={styles.sessionDeck}>
													{entry.deckName}
												</span>
												<div className={styles.sessionRight}>
													{entry.cardCount > 0 && (
														<span className={styles.sessionCards}>
															{t("stats.cards", {
																count: entry.cardCount,
															})}
														</span>
													)}
													<span className={styles.sessionDur}>
														{formatCompactDuration(
															language,
															entry.duration,
														)}
													</span>
												</div>
											</div>
										))}
									</div>
								</div>
							),
						)}
					</div>
				)}
			</div>
		</div>
	);
});
