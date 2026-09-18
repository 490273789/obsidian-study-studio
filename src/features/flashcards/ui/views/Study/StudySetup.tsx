import React, { memo, useCallback, useState } from "react";
import { CircleCheck, Target, Lock, Brain, Dices, AudioWaveform, Repeat2 } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { CardDirection, Deck, StudyDayInfo } from "../../../../../core/shared/types";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { StudySetupPlan } from "../../../domain/sessions/sessionPlanner";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { StatCards } from "../../../../../core/ui/primitives/StatCards";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { useWindowKeyDown } from "../../../../../core/ui/hooks/hooks";
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

const StudyDayRow = memo(function StudyDayRow({
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

	return (
		<div
			className={cls(
				styles.dayItem,
				"fc-lift",
				day.isCompleted && styles.completed,
				day.isCurrent && styles.current,
				!day.isCompleted && !day.isCurrent && styles.locked,
			)}
		>
			<div className={styles.dayInfo}>
				<span className={styles.dayBadge}>
					{day.isCompleted ? (
						<CircleCheck size={16} />
					) : day.isCurrent ? (
						<Target size={16} />
					) : (
						<Lock size={16} />
					)}
				</span>
				<span className={styles.dayName}>
					{t("study.day", { day: day.dayIndex + 1 })}
					{day.isCurrent && <span className={styles.todayBadge}>{t("study.today")}</span>}
				</span>
			</div>
			<div className={styles.dayProgress}>
				{day.isCompleted && (
					<>
						<FlashcardButton variant="secondary" onClick={handleReview}>
							{t("study.review")}
						</FlashcardButton>
						{spellingEnabled && (
							<FlashcardButton
								variant="secondary"
								onClick={handleSpelling}
								title={t("home.spellingModeTitle")}
							>
								{t("home.spelling")}
							</FlashcardButton>
						)}
					</>
				)}
				<span className={styles.dayCount}>
					{day.studiedCards}/{day.totalCards}
				</span>
			</div>
		</div>
	);
});

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
		completedDays,
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

	useWindowKeyDown((e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}
		if (e.code === "Space") {
			e.preventDefault();
			handleMainStart();
		}
	});

	return (
		<div className="flashcard-practice-setup fc-page fc-page--fill">
			<FlashcardHeader icon={Brain} title={t("study.title")} onBack={onBack} />

			<div className="flashcard-setup-content fc-page__body fc-page__body--narrow">
				<div className={styles.studyHero}>
					<div className={styles.deckNameWrapper}>
						<div className={styles.deckName}>{deck.name}</div>
						<div className={styles.deckTag}>{deck.tag}</div>
					</div>
				</div>

				<StatCards
					items={[
						{
							key: "new",
							value: todayNewCount,
							label: t("study.todayNew"),
							tone: "green",
						},
						{
							key: "due",
							value: todayReviewCount,
							label: t("study.dueReview"),
							tone: "purple",
						},
					]}
				/>

				{/* Study preferences */}
				<div className={cls(styles.studyPanel, styles.setupControls)}>
					<SetupControlGroup
						icon={AudioWaveform}
						title={t("study.studyOrder")}
						note={
							studyOrder === "random"
								? t("study.randomNote")
								: t("study.sequentialNote")
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
						note={
							direction === "normal" ? t("mode.normalNote") : t("mode.reversedNote")
						}
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

				{/* Day list */}
				{dayList.length > 0 && (
					<div className={cls(styles.studyPanel, styles.studyDaySection, "fc-lift")}>
						<div className={styles.panelHeading}>
							<div className={styles.daySectionTitle}>{t("study.studyPlan")}</div>
							<div className={styles.panelNote}>
								{t("study.completedDaysProgress", {
									completed: completedDays,
									total: dayList.length,
								})}
							</div>
						</div>
						<div className={styles.dayList}>
							{dayList.map((day) => (
								<StudyDayRow
									key={day.dayIndex}
									deckId={deck.id}
									day={day}
									direction={direction}
									spellingEnabled={spellingEnabled}
									onStartSession={onStartSession}
								/>
							))}
						</div>
					</div>
				)}

				<div className={styles.actionBar}>
					<FlashcardButton
						variant="primary"
						preset="show"
						size="lg"
						onClick={handleMainStart}
						disabled={isStartDisabled}
					>
						{allCompleted
							? t("study.startReview")
							: hasAnythingToStudy
								? t("study.startCards", {
										count: todayTotal,
									})
								: t("study.tasksCompletedButton")}
						{!isStartDisabled && (
							<span className="flashcard-shortcut">({t("common.space")})</span>
						)}
					</FlashcardButton>
				</div>
			</div>
		</div>
	);
});
