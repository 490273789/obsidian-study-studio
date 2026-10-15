import React, { memo, useCallback, useState, useId } from "react";
import {
	CircleCheck,
	Target,
	Lock,
	Brain,
	Dices,
	AudioWaveform,
	Repeat2,
	ChevronDown,
	ChevronRight,
} from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { CardDirection, Deck, StudyDayInfo } from "../../../../../core/shared/types";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { StudySetupPlan } from "../../../domain/sessions/sessionPlanner";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles } from "../../primitives/SetupPage/SetupPage";
import styles from "./StudySetup.module.scss";

interface StudySetupProps {
	deck: Deck;
	plan: StudySetupPlan;
	defaultDirection?: CardDirection;
	spellingEnabled: boolean;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

interface StudyDayRowProps {
	deckId: string;
	day: StudyDayInfo;
	direction: CardDirection;
	spellingEnabled: boolean;
	onStartSession: (request: SessionStartRequest) => void;
}

export const StudyDayRow = memo(function StudyDayRow({
	deckId,
	day,
	direction,
	spellingEnabled,
	onStartSession,
}: StudyDayRowProps) {
	const { t } = useFlashcardI18n();
	const handleReview = useCallback(() => {
		onStartSession({
			mode: "practice",
			deckId,
			direction,
			selection: {
				kind: "study-day",
				dayIndex: day.dayIndex,
				studyOrder: "random",
			},
		});
	}, [day.dayIndex, deckId, direction, onStartSession]);

	const handleSpelling = useCallback(() => {
		onStartSession({
			mode: "spelling",
			deckId,
			selection: {
				kind: "study-day",
				dayIndex: day.dayIndex,
			},
		});
	}, [day.dayIndex, deckId, onStartSession]);

	const state = day.isCompleted ? "done" : day.isCurrent ? "active" : "fresh";
	const progress =
		day.totalCards > 0 ? Math.min(100, (day.studiedCards / day.totalCards) * 100) : 0;
	return (
		<div className={cls("fc-rail-row", styles.dayItem)} data-state={state}>
			<div className="fc-rail-row__main">
				<div className={styles.dayInfo}>
					<span className={styles.dayBadge} aria-hidden="true">
						{day.isCompleted ? (
							<CircleCheck size={16} />
						) : day.isCurrent ? (
							<Target size={16} />
						) : (
							<Lock size={16} />
						)}
					</span>
					<span className="fc-rail-row__title">
						{t("study.day", { day: day.dayIndex + 1 })}
					</span>
					<span className={styles.dayStatus}>
						{t(
							day.isCompleted
								? "setup.dayCompleted"
								: day.isCurrent
									? "study.today"
									: "setup.dayLocked",
						)}
					</span>
				</div>
			</div>
			<div className={styles.dayProgress}>
				<span
					className="fc-meter"
					aria-hidden="true"
					data-tone={day.isCompleted ? "done" : undefined}
				>
					<i style={{ width: `${progress}%` }} />
				</span>
				<span className={styles.dayCount}>
					{day.studiedCards}
					<span> / {day.totalCards}</span>
				</span>
			</div>
			{day.isCompleted && (
				<div className="fc-rail-row__actions">
					<FlashcardButton variant="neutral" size="sm" onClick={handleReview}>
						{t("study.review")}
					</FlashcardButton>
					{spellingEnabled && (
						<FlashcardButton
							variant="ghost"
							size="sm"
							onClick={handleSpelling}
							title={t("home.spellingModeTitle")}
						>
							{t("home.spelling")}
						</FlashcardButton>
					)}
				</div>
			)}
		</div>
	);
});

interface StudyPlanProps {
	deckId: string;
	plan: StudySetupPlan;
	direction: CardDirection;
	spellingEnabled: boolean;
	onStartSession: (request: SessionStartRequest) => void;
}

export function StudyPlan({
	deckId,
	plan,
	direction,
	spellingEnabled,
	onStartSession,
}: StudyPlanProps) {
	const { t } = useFlashcardI18n();
	const id = useId();
	const [completedOpen, setCompletedOpen] = useState(false);
	const [upcomingOpen, setUpcomingOpen] = useState(false);
	const completed = plan.dayList.filter((day) => day.isCompleted);
	const upcoming = plan.dayList.filter((day) => !day.isCompleted && !day.isCurrent);
	const renderDay = (day: StudyDayInfo) => (
		<StudyDayRow
			key={day.dayIndex}
			deckId={deckId}
			day={day}
			direction={direction}
			spellingEnabled={spellingEnabled}
			onStartSession={onStartSession}
		/>
	);
	if (plan.dayList.length === 0) return null;
	return (
		<section className={styles.plan} aria-labelledby={`${id}-title`}>
			<div className={styles.panelHeading}>
				<h2 id={`${id}-title`}>{t("study.studyPlan")}</h2>
				<span>
					{t("study.completedDaysProgress", {
						completed: plan.completedDays,
						total: plan.dayList.length,
					})}
				</span>
			</div>
			<div className={styles.dayList}>
				{plan.dayList.filter((day) => day.isCurrent).map(renderDay)}
			</div>
			{completed.length > 0 && (
				<div className="fc-group">
					<button
						type="button"
						className="fc-disclosure"
						aria-expanded={completedOpen}
						aria-controls={`${id}-completed`}
						onClick={() => setCompletedOpen((open) => !open)}
					>
						{completedOpen ? (
							<ChevronDown size={15} aria-hidden="true" />
						) : (
							<ChevronRight size={15} aria-hidden="true" />
						)}
						{t("setup.completedDays", { count: completed.length })}
					</button>
					<div
						id={`${id}-completed`}
						hidden={!completedOpen}
						className={completedOpen ? "fc-group__body" : undefined}
					>
						{completedOpen && completed.map(renderDay)}
					</div>
				</div>
			)}
			{upcoming.length > 0 && (
				<div className="fc-group">
					<button
						type="button"
						className="fc-disclosure"
						aria-expanded={upcomingOpen}
						aria-controls={`${id}-upcoming`}
						onClick={() => setUpcomingOpen((open) => !open)}
					>
						{upcomingOpen ? (
							<ChevronDown size={15} aria-hidden="true" />
						) : (
							<ChevronRight size={15} aria-hidden="true" />
						)}
						{t("setup.upcomingDays", { count: upcoming.length })}
					</button>
					<div
						id={`${id}-upcoming`}
						hidden={!upcomingOpen}
						className={upcomingOpen ? "fc-group__body" : undefined}
					>
						{upcomingOpen && upcoming.map(renderDay)}
					</div>
				</div>
			)}
		</section>
	);
}

export const StudySetup = React.memo(function StudySetup({
	deck,
	plan,
	defaultDirection = "normal",
	spellingEnabled,
	onStartSession,
	onBack,
}: StudySetupProps) {
	const { t } = useFlashcardI18n();
	const [studyOrder, setStudyOrder] = useState<"sequential" | "random">(plan.defaultStudyOrder);
	const [direction, setDirection] = useState<CardDirection>(defaultDirection);

	const {
		dayList,
		todayNewCount,
		todayReviewCount,
		allCompleted,
		hasAnythingToStudy,
		todayTotal,
	} = plan;

	const isStartDisabled = !hasAnythingToStudy && !allCompleted;

	const handleMainStart = useCallback(() => {
		if (isStartDisabled) return;
		onStartSession({
			mode: "study",
			deckId: deck.id,
			studyOrder: allCompleted ? "random" : studyOrder,
			direction,
		});
	}, [allCompleted, deck.id, direction, isStartDisabled, onStartSession, studyOrder]);

	return (
		<SetupPage
			icon={Brain}
			title={t("study.title")}
			deck={deck}
			count={todayTotal}
			countLabel={t("setup.todayCards")}
			meta={
				<>
					<span>{t("setup.newCards", { count: todayNewCount })}</span>
					<span>{t("setup.reviewCards", { count: todayReviewCount })}</span>
				</>
			}
			summary={
				<>
					{t(
						allCompleted || studyOrder === "random"
							? "study.randomOrder"
							: "study.sequentialOrder",
					)}{" "}
					· {t(direction === "normal" ? "mode.normal" : "mode.reversed")}
				</>
			}
			startLabel={
				allCompleted
					? t("study.startReview")
					: hasAnythingToStudy
						? t("study.startCards", { count: todayTotal })
						: t("study.tasksCompletedButton")
			}
			disabled={isStartDisabled}
			onStart={handleMainStart}
			onBack={onBack}
			afterAction={
				dayList.length > 0 ? (
					<StudyPlan
						deckId={deck.id}
						plan={plan}
						direction={direction}
						spellingEnabled={spellingEnabled}
						onStartSession={onStartSession}
					/>
				) : undefined
			}
		>
			<div className={cls("fc-panel", setupStyles.setupPanel)}>
				<SetupControlGroup
					icon={AudioWaveform}
					title={t("study.studyOrder")}
					note={
						studyOrder === "random" ? t("study.randomNote") : t("study.sequentialNote")
					}
				>
					<SetupSelector
						value={studyOrder}
						ariaLabel={t("study.studyOrder")}
						options={[
							{
								value: "sequential",
								label: t("study.sequentialOrder"),
								icon: AudioWaveform,
							},
							{
								value: "random",
								label: t("study.randomOrder"),
								icon: Dices,
							},
						]}
						onChange={setStudyOrder}
					/>
				</SetupControlGroup>

				<SetupControlGroup
					icon={Repeat2}
					title={t("mode.direction")}
					note={direction === "normal" ? t("mode.normalNote") : t("mode.reversedNote")}
				>
					<SetupSelector
						value={direction}
						ariaLabel={t("mode.direction")}
						options={[
							{
								value: "normal",
								label: t("mode.normal"),
								icon: Brain,
							},
							{
								value: "reversed",
								label: t("mode.reversed"),
								icon: Repeat2,
							},
						]}
						onChange={setDirection}
					/>
				</SetupControlGroup>
			</div>
		</SetupPage>
	);
});
