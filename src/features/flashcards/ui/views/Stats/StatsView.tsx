import React, { useMemo } from "react";
import {
	BookOpen,
	Calendar,
	CalendarDays,
	ChartNoAxesColumn,
	Clock3,
	GraduationCap,
	Keyboard,
	Layers,
	Sparkles,
	Sprout,
	Target,
	Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { Language, StudyHistoryEntry } from "../../../../../core/shared/types";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { StatCards } from "../../../../../core/ui/primitives/StatCards";
import {
	buildStudyHistoryPresentationModel,
	STUDY_HISTORY_MODE_PRESENTATION,
} from "../../../domain/history/studyHistoryPresentationModel";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import styles from "./Stats.module.scss";

const MODE_ICONS: Record<StudyHistoryEntry["mode"], LucideIcon> = {
	study: GraduationCap,
	practice: Target,
	spelling: Keyboard,
	challenge: Trophy,
	"word-list": BookOpen,
};

const MODE_STYLE_CLASSES: Record<StudyHistoryEntry["mode"], string> = {
	study: styles.modeStudy,
	practice: styles.modePractice,
	spelling: styles.modeSpelling,
	challenge: styles.modeChallenge,
	"word-list": styles.modeList,
};

interface StatsViewProps {
	history: ReadonlyArray<StudyHistoryEntry>;
	onBack: () => void;
}

function parseDisplayDate(displayDate: string): { dateText: string; tag: string | null } {
	const match = displayDate.match(/^(.*?)[（(](.*?)[）)]$/);
	if (match) {
		return {
			dateText: match[1]?.trim() ?? displayDate,
			tag: match[2]?.trim() ?? null,
		};
	}
	return { dateText: displayDate, tag: null };
}

function formatSessionTime(timestamp: number, language: Language): string {
	if (!timestamp || isNaN(timestamp)) return "";
	const date = new Date(timestamp);
	return date.toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function cleanModeLabel(rawLabel: string): string {
	return rawLabel.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

export const StatsView = React.memo(function StatsView({ history, onBack }: StatsViewProps) {
	const { t, language } = useFlashcardI18n();
	const presentation = useMemo(
		() => buildStudyHistoryPresentationModel(history, { language, t }),
		[history, language, t],
	);
	const { dayGroups, totals } = presentation;

	const statCardItems = useMemo(
		() => [
			{
				key: "duration",
				icon: Clock3,
				value: totals.durationLabel,
				label: t("stats.totalDuration"),
				tone: "purple" as const,
			},
			{
				key: "cards",
				icon: Layers,
				value: totals.cards,
				label: t("stats.totalCards"),
				tone: "green" as const,
			},
			{
				key: "days",
				icon: CalendarDays,
				value: `${dayGroups.length}`,
				label: t("stats.totalDays"),
				tone: "blue" as const,
			},
			{
				key: "records",
				icon: Sparkles,
				value: `${history.length}`,
				label: t("stats.totalSessions"),
				tone: "orange" as const,
			},
		],
		[dayGroups.length, history.length, t, totals.cards, totals.durationLabel],
	);

	return (
		<div className="fc-page fc-page--fill">
			<FlashcardHeader icon={ChartNoAxesColumn} title={t("stats.title")} onBack={onBack} />

			<div className={cls("fc-page__body", styles.body)}>
				{/* Top Stats Overview */}
				<section className={styles.summarySection}>
					<StatCards items={statCardItems} columns={4} />
				</section>

				{/* Timeline / Days List */}
				{dayGroups.length === 0 ? (
					<div className={styles.emptyState}>
						<div className={styles.emptyIcon}>
							<Sprout size={32} />
						</div>
						<h3 className={styles.emptyTitle}>{t("stats.noRecords")}</h3>
						<p className={styles.emptyHint}>{t("stats.noRecordsHint")}</p>
					</div>
				) : (
					<div className={styles.timelineSection}>
						{dayGroups.map(
							({ date, displayDate, entries, totalDurationLabel, totalCards }) => {
								const { dateText, tag } = parseDisplayDate(displayDate);
								const isToday = tag === t("stats.today");

								return (
									<section key={date} className={cls("fc-lift", styles.dayCard)}>
										<header className={styles.dayHeader}>
											<div className={styles.dayDateGroup}>
												<Calendar
													size={14}
													className={styles.dayCalendarIcon}
													aria-hidden="true"
												/>
												<span className={styles.dayDateText}>
													{dateText}
												</span>
												{tag && (
													<span
														className={cls(
															styles.dayTag,
															isToday && styles.isToday,
														)}
													>
														{tag}
													</span>
												)}
											</div>
											<div className={cls("fc-meta", styles.dayMeta)}>
												<span className="fc-meta__text">
													{t("stats.records", {
														count: entries.length,
													})}
												</span>
												<span className="fc-meta__dot" aria-hidden="true" />
												<span className="fc-meta__text">
													{totalDurationLabel}
												</span>
												{totalCards > 0 && (
													<>
														<span
															className="fc-meta__dot"
															aria-hidden="true"
														/>
														<span className="fc-meta__text">
															{t("stats.cards", {
																count: totalCards,
															})}
														</span>
													</>
												)}
											</div>
										</header>

										<div className={styles.sessionList}>
											{entries.map((entry) => {
												const ModeIcon =
													MODE_ICONS[entry.mode] ?? GraduationCap;
												const modeStyleClass =
													MODE_STYLE_CLASSES[entry.mode] ??
													styles.modeStudy;
												const rawLabel = t(
													STUDY_HISTORY_MODE_PRESENTATION[entry.mode]
														.labelKey,
												);
												const modeLabel = cleanModeLabel(rawLabel);
												const deckTitle =
													entry.mode === "challenge"
														? t("challenge.title")
														: entry.deckName;
												const sessionTime = formatSessionTime(
													entry.timestamp,
													language,
												);

												return (
													<div
														key={`${entry.timestamp}-${entry.deckId}-${entry.mode}`}
														className={styles.sessionItem}
													>
														<div className={styles.sessionMain}>
															<span
																className={cls(
																	styles.modeBadge,
																	modeStyleClass,
																)}
															>
																<ModeIcon
																	size={12}
																	aria-hidden="true"
																/>
																<span>{modeLabel}</span>
															</span>
															<div className={styles.sessionInfo}>
																<span
																	className={styles.sessionDeck}
																	title={deckTitle}
																>
																	{deckTitle}
																</span>
																{sessionTime && (
																	<span
																		className={
																			styles.sessionTime
																		}
																	>
																		{sessionTime}
																	</span>
																)}
															</div>
														</div>

														<div className={styles.sessionRight}>
															{entry.cardCount > 0 && (
																<span
																	className={styles.sessionCards}
																>
																	<Layers
																		size={12}
																		aria-hidden="true"
																	/>
																	<span>
																		{t("stats.cards", {
																			count: entry.cardCount,
																		})}
																	</span>
																</span>
															)}
															<span
																className={styles.sessionDuration}
															>
																<Clock3
																	size={12}
																	aria-hidden="true"
																/>
																<span>
																	{formatCompactDuration(
																		language,
																		entry.duration,
																	)}
																</span>
															</span>
														</div>
													</div>
												);
											})}
										</div>
									</section>
								);
							},
						)}
					</div>
				)}
			</div>
		</div>
	);
});
