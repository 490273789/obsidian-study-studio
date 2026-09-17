import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { BookOpen, Clock3, Flame, Keyboard, Target, Trophy } from "lucide-react";
import type {
	LearningFootprintDay,
	LearningFootprintSnapshot,
} from "../../../domain/history/dailyLearningActivity";
import { cls } from "../../../../../core/shared/classNames";
import { formatCompactDuration } from "../../../strings";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./LearningFootprint.module.scss";

interface LearningFootprintProps {
	footprint: LearningFootprintSnapshot;
}

const DAYS_PER_WEEK = 7;

export const LearningFootprint = React.memo(function LearningFootprint({
	footprint,
}: LearningFootprintProps) {
	const { t, language } = useFlashcardI18n();
	const titleId = useId();
	const days = useMemo(() => footprint.weeks.flatMap((week) => week.days), [footprint.weeks]);
	const todayIndex = Math.max(
		0,
		days.findIndex((day) => day.date === footprint.today.date),
	);
	const [activeIndex, setActiveIndex] = useState(todayIndex);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const activeDay = days[activeIndex] ?? days[todayIndex];

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller) scroller.scrollLeft = scroller.scrollWidth;
	}, []);

	const moveFocus = (nextIndex: number) => {
		const bounded = Math.max(0, Math.min(todayIndex, nextIndex));
		setActiveIndex(bounded);
		cellRefs.current[bounded]?.focus();
	};

	const todayMetrics = [
		{
			key: "study",
			icon: BookOpen,
			value: footprint.today.answers.study,
			label: t("footprint.studyAnswers"),
		},
		{
			key: "practice",
			icon: Target,
			value: footprint.today.answers.practice,
			label: t("footprint.practiceAnswers"),
		},
		{
			key: "spelling",
			icon: Keyboard,
			value: footprint.today.answers.spelling,
			label: t("footprint.spellingAnswers"),
		},
		{
			key: "duration",
			icon: Clock3,
			value: formatCompactDuration(language, footprint.todayTotalSeconds),
			label: t("footprint.totalDuration"),
			subtitle: t("footprint.wordListDuration", {
				duration: formatCompactDuration(language, footprint.today.seconds["word-list"]),
			}),
		},
	];

	const monthLabels = useMemo(() => {
		let lastMonthKey = "";
		let lastWeekWithLabel = -99;

		return footprint.weeks.map((week, weekIndex) => {
			const dayWithFirst = week.days.find((day) => day.date.slice(8, 10) === "01");
			let anchorDay = dayWithFirst;
			if (!anchorDay && weekIndex === 0) {
				anchorDay = week.days[0];
			}

			if (!anchorDay) return "";

			const monthKey = anchorDay.date.slice(0, 7);
			if (monthKey === lastMonthKey || weekIndex - lastWeekWithLabel < 3) {
				return "";
			}

			lastMonthKey = monthKey;
			lastWeekWithLabel = weekIndex;

			const date = new Date(`${anchorDay.date}T00:00:00`);
			return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
				month: "short",
			}).format(date);
		});
	}, [footprint.weeks, language]);

	return (
		<section className={styles.panel} aria-labelledby={titleId}>
			<header className={styles.header}>
				<h2 id={titleId} className={styles.title}>
					{t("footprint.title")}
				</h2>
				<div className={styles.streaks}>
					<div className={styles.streakPrimary}>
						<Flame size={16} aria-hidden="true" />
						<span>
							{t("footprint.currentStreak", { count: footprint.currentStreak })}
						</span>
					</div>
					<div className={styles.streakBest}>
						<Trophy size={13} aria-hidden="true" />
						<span>{t("footprint.bestStreak", { count: footprint.bestStreak })}</span>
					</div>
				</div>
			</header>

			<div className={styles.metrics}>
				{todayMetrics.map(({ key, icon: Icon, value, label, subtitle }) => (
					<div key={key} className={styles.metric}>
						<Icon size={15} className={styles.metricIcon} aria-hidden="true" />
						<div className={styles.metricBody}>
							<div className={styles.metricValue}>
								{value}
								{key !== "duration" && <span>{t("footprint.times")}</span>}
							</div>
							<div className={styles.metricLabelRow}>
								<span className={styles.metricLabel}>{label}</span>
								{subtitle && (
									<span className={styles.metricSubtitle}>{subtitle}</span>
								)}
							</div>
						</div>
					</div>
				))}
			</div>

			<div className={styles.heatmapSection}>
				<div className={styles.heatmapHeading}>
					<span>{t("footprint.pastYear")}</span>
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

				<div className={styles.heatmapLayout}>
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
						<div className={styles.heatmapContent}>
							<div className={styles.months} aria-hidden="true">
								{monthLabels.map((label, index) => (
									<span key={index}>{label}</span>
								))}
							</div>
							<div className={styles.grid} aria-label={t("footprint.gridLabel")}>
								{footprint.weeks.map((week, weekIndex) => (
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
													className={cls(
														styles.cell,
														styles[`level${day.level}`],
														index === activeIndex && styles.activeCell,
													)}
													aria-label={getDayAriaLabel(day, language, t)}
													onFocus={() => setActiveIndex(index)}
													onMouseEnter={() =>
														!day.future && setActiveIndex(index)
													}
													onClick={() => setActiveIndex(index)}
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

function formatActivityDate(dateKey: string, language: "zh" | "en"): string {
	return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
		month: "short",
		day: "numeric",
		weekday: "short",
	}).format(new Date(`${dateKey}T00:00:00`));
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
