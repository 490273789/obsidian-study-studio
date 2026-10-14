import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
	LearningFootprintDay,
	LearningFootprintSnapshot,
	LearningFootprintWeek,
} from "../../../domain/history/dailyLearningActivity";
import { cls } from "../../../../../core/shared/classNames";
import { formatCompactDuration } from "../../../strings";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./LearningFootprint.module.scss";

interface LearningFootprintProps {
	footprint: LearningFootprintSnapshot;
}

const DAYS_PER_WEEK = 7;
/** Weeks shown before the learner asks for the full year. */
const RECENT_WEEKS = 14;

/**
 * The year grid is ~40% of the first screen and, for a new learner, it is 53
 * columns of empty cells. Collapsing to the recent window keeps the panel's
 * height in proportion to how much there is to say; expanding restores the full
 * grid from the same data.
 *
 * Streaks are not rendered here: the home hero owns that number already.
 */
export const LearningFootprint = React.memo(function LearningFootprint({
	footprint,
}: LearningFootprintProps) {
	const { t, language } = useFlashcardI18n();
	const titleId = useId();
	const panelBodyId = useId();
	const heatmapId = useId();
	const [isPanelOpen, setIsPanelOpen] = useState(true);
	const [isExpanded, setIsExpanded] = useState(false);
	const scrollerRef = useRef<HTMLDivElement>(null);

	const visibleWeeks = useMemo(
		() =>
			isExpanded
				? footprint.weeks
				: footprint.weeks.slice(Math.max(0, footprint.weeks.length - RECENT_WEEKS)),
		[footprint.weeks, isExpanded],
	);

	const days = useMemo(() => visibleWeeks.flatMap((week) => week.days), [visibleWeeks]);
	const todayIndex = Math.max(
		0,
		days.findIndex((day) => day.date === footprint.today.date),
	);
	const [activeDate, setActiveDate] = useState(footprint.today.date);
	const selectedIndex = days.findIndex((day) => day.date === activeDate);
	const activeIndex = selectedIndex >= 0 ? selectedIndex : todayIndex;
	const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const activeDay = days[activeIndex] ?? days[todayIndex];

	// The window always opens on today, which is the last column.
	useEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller && isPanelOpen) scroller.scrollLeft = scroller.scrollWidth;
	}, [isExpanded, isPanelOpen]);

	const moveFocus = (nextIndex: number) => {
		const bounded = Math.max(0, Math.min(todayIndex, nextIndex));
		setActiveDate(days[bounded]?.date ?? footprint.today.date);
		cellRefs.current[bounded]?.focus();
	};

	/** Answer counts and duration read as one line of text, not five tiles. */
	const summaryItems = [
		{ key: "study", label: t("footprint.studyAnswers"), value: footprint.today.answers.study },
		{
			key: "practice",
			label: t("footprint.practiceAnswers"),
			value: footprint.today.answers.practice,
		},
		{
			key: "spelling",
			label: t("footprint.spellingAnswers"),
			value: footprint.today.answers.spelling,
		},
		{
			key: "challenge",
			label: t("challenge.title"),
			value: footprint.today.answers.challenge,
		},
	];

	const activeDayCount = useMemo(() => days.filter((day) => day.hasActivity).length, [days]);

	const monthLabels = useMemo(
		() => calculateHeatmapMonthLabels(visibleWeeks, language),
		[visibleWeeks, language],
	);

	return (
		<section className={styles.panel} aria-labelledby={titleId}>
			<header className={styles.header}>
				<h2 id={titleId} className={styles.title}>
					<button
						type="button"
						className={styles.panelToggle}
						aria-label={t("footprint.title")}
						aria-expanded={isPanelOpen}
						aria-controls={panelBodyId}
						title={
							isPanelOpen ? t("footprint.collapsePanel") : t("footprint.expandPanel")
						}
						onClick={() => setIsPanelOpen((current) => !current)}
					>
						{t("footprint.title")}
						<ChevronDown size={14} aria-hidden="true" />
					</button>
				</h2>
				<div className={styles.summary}>
					{summaryItems.map((item) => (
						<span key={item.key} className={styles.summaryItem}>
							<span className={styles.summaryLabel}>{item.label}</span>
							<b className={styles.summaryValue}>{item.value}</b>
							<span className={styles.summaryLabel}>{t("footprint.times")}</span>
						</span>
					))}
					<span className={styles.summaryItem}>
						<span className={styles.summaryLabel}>{t("footprint.totalDuration")}</span>
						<b className={styles.summaryValue}>
							{formatCompactDuration(language, footprint.todayTotalSeconds)}
						</b>
					</span>
					<span className={styles.summaryItem}>
						<span className={styles.summaryLabel}>
							{t("footprint.wordListDuration", {
								duration: formatCompactDuration(
									language,
									footprint.today.seconds["word-list"],
								),
							})}
						</span>
					</span>
				</div>
			</header>

			<div id={panelBodyId} className={styles.heatmapSection} hidden={!isPanelOpen}>
				<div className={styles.heatmapHeading}>
					<div className={styles.rangeControls}>
						<span>
							{isExpanded
								? t("footprint.pastYear")
								: t("footprint.recentWindow", {
										weeks: visibleWeeks.length,
										days: activeDayCount,
									})}
						</span>
						<button
							type="button"
							className={styles.toggle}
							aria-expanded={isExpanded}
							aria-controls={heatmapId}
							onClick={() => setIsExpanded((current) => !current)}
						>
							{isExpanded ? t("footprint.collapseYear") : t("footprint.expandYear")}
							<ChevronDown size={13} aria-hidden="true" />
						</button>
					</div>
					<div className={styles.legend} aria-label={t("footprint.legendLabel")}>
						<span>{t("footprint.less")}</span>
						{[0, 1, 2, 3, 4].map((level) => (
							<span
								key={level}
								className={cls(styles.cell, styles[`level${level}`])}
								aria-hidden="true"
							/>
						))}
						<span>{t("footprint.more")}</span>
					</div>
				</div>

				<div id={heatmapId} className={styles.heatmapLayout}>
					<div className={styles.weekdays} aria-hidden="true">
						<span>{t("footprint.mondayShort")}</span>
						<span />
						<span>{t("footprint.wednesdayShort")}</span>
						<span />
						<span>{t("footprint.fridayShort")}</span>
						<span />
						<span />
					</div>
					<div ref={scrollerRef} className={styles.scroller}>
						<div
							className={styles.heatmapContent}
							style={
								{
									"--fc-heatmap-weeks": visibleWeeks.length,
								} as React.CSSProperties
							}
						>
							<div className={styles.months} aria-hidden="true">
								{monthLabels.map((label, index) => (
									<span key={index}>{label}</span>
								))}
							</div>
							<div className={styles.grid} aria-label={t("footprint.gridLabel")}>
								{visibleWeeks.map((week, weekIndex) => (
									<div
										key={week.days[0]?.date ?? weekIndex}
										className={styles.week}
									>
										{week.days.map((day, dayIndex) => {
											const index = weekIndex * DAYS_PER_WEEK + dayIndex;
											return (
												<button
													key={day.date}
													ref={(node) => {
														cellRefs.current[index] = node;
													}}
													type="button"
													tabIndex={index === activeIndex ? 0 : -1}
													disabled={day.future}
													data-heatmap-day={day.date}
													className={cls(
														styles.cell,
														styles[`level${day.level}`],
														index === activeIndex && styles.activeCell,
													)}
													aria-label={getDayAriaLabel(day, language, t)}
													onFocus={() => setActiveDate(day.date)}
													onMouseEnter={() =>
														!day.future && setActiveDate(day.date)
													}
													onClick={() => setActiveDate(day.date)}
													onKeyDown={(event) => {
														if (event.key === "ArrowLeft")
															moveFocus(index - DAYS_PER_WEEK);
														else if (event.key === "ArrowRight")
															moveFocus(index + DAYS_PER_WEEK);
														else if (event.key === "ArrowUp")
															moveFocus(index - 1);
														else if (event.key === "ArrowDown")
															moveFocus(index + 1);
														else return;
														event.preventDefault();
													}}
												/>
											);
										})}
									</div>
								))}
							</div>
						</div>
					</div>
				</div>

				{activeDay && <DayDetails day={activeDay} />}
			</div>
		</section>
	);
});

function DayDetails({ day }: { day: LearningFootprintDay }) {
	const { t, language } = useFlashcardI18n();
	const date = formatActivityDate(day.date, language);
	const totalSeconds = Object.values(day.activity.seconds).reduce((sum, value) => sum + value, 0);
	return (
		<div className={styles.details} aria-live="polite">
			<strong>{date}</strong>
			<span>
				{day.completedAnswerCount > 0
					? t("footprint.completedBreakdown", {
							count: day.completedAnswerCount,
							study: day.activity.completedAnswers.study,
							practice: day.activity.completedAnswers.practice,
							spelling: day.activity.completedAnswers.spelling,
							challenge: day.activity.completedAnswers.challenge,
						})
					: day.hasActivity
						? t("footprint.activeNotCompleted")
						: t("footprint.noActivity")}
			</span>
			{day.hasActivity && (
				<span>
					{t("footprint.dayDuration", {
						duration: formatCompactDuration(language, totalSeconds),
						wordList: formatCompactDuration(
							language,
							day.activity.seconds["word-list"],
						),
					})}
				</span>
			)}
		</div>
	);
}

/**
 * Formatters are cached per language: the heatmap asks for one per cell on every
 * render, and constructing an `Intl.DateTimeFormat` is far more expensive than
 * formatting with an existing one. Date keys are calendar dates, so parse and
 * format in UTC to keep them independent of the host time zone.
 */
const ACTIVITY_DATE_FORMATTERS: Partial<Record<"zh" | "en", Intl.DateTimeFormat>> = {};
const MONTH_LABEL_FORMATTERS: Partial<Record<"zh" | "en", Intl.DateTimeFormat>> = {};

function getActivityDateFormatter(language: "zh" | "en"): Intl.DateTimeFormat {
	return (ACTIVITY_DATE_FORMATTERS[language] ??= new Intl.DateTimeFormat(
		language === "zh" ? "zh-CN" : "en-US",
		{ month: "short", day: "numeric", weekday: "short", timeZone: "UTC" },
	));
}

function getMonthLabelFormatter(language: "zh" | "en"): Intl.DateTimeFormat {
	return (MONTH_LABEL_FORMATTERS[language] ??= new Intl.DateTimeFormat(
		language === "zh" ? "zh-CN" : "en-US",
		{ month: "short", timeZone: "UTC" },
	));
}

function formatActivityDate(dateKey: string, language: "zh" | "en"): string {
	return getActivityDateFormatter(language).format(new Date(`${dateKey}T00:00:00Z`));
}

function getDayAriaLabel(
	day: LearningFootprintDay,
	language: "zh" | "en",
	t: ReturnType<typeof useFlashcardI18n>["t"],
): string {
	return t("footprint.dayLabel", {
		date: formatActivityDate(day.date, language),
		count: day.completedAnswerCount,
	});
}

export function calculateHeatmapMonthLabels(
	weeks: readonly LearningFootprintWeek[],
	language: "zh" | "en",
): string[] {
	const first01WeekIndex = weeks.findIndex((w) =>
		w.days.some((d) => d.date.slice(8, 10) === "01"),
	);

	let lastMonthKey = "";
	let lastWeekWithLabel = -99;

	return weeks.map((week, weekIndex) => {
		const dayWithFirst = week.days.find((day) => day.date.slice(8, 10) === "01");
		let anchorDay = dayWithFirst;
		if (!anchorDay && weekIndex === 0 && first01WeekIndex >= 2) {
			anchorDay = week.days[0];
		}

		if (!anchorDay) return "";

		const monthKey = anchorDay.date.slice(0, 7);
		if (monthKey === lastMonthKey || weekIndex - lastWeekWithLabel < 2 || weekIndex >= 52) {
			return "";
		}

		lastMonthKey = monthKey;
		lastWeekWithLabel = weekIndex;

		const date = new Date(`${anchorDay.date}T00:00:00Z`);
		return getMonthLabelFormatter(language).format(date);
	});
}
