import React, { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
	ArrowRight,
	ArrowRightLeft,
	BrainCircuit,
	Keyboard,
	Layers,
	ListOrdered,
	Repeat2,
	Shuffle,
	SlidersHorizontal,
	Target,
} from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { CardDirection, Deck } from "../../../../../core/shared/types";
import type { DeckSpellingSnapshot } from "../../../domain/decks/deckHome";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { PracticeSetupPlan, SpellingSetupPlan } from "../../../domain/sessions/sessionPlanner";
import {
	estimateMinutes,
	type PracticeKind,
	type PracticePreferenceStore,
	type PracticeSelectionMode,
	PracticeSetupSession,
	type SpellingSelectionMode,
} from "../../../domain/sessions/practiceSetupSession";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles as styles } from "../../primitives/SetupPage/SetupPage";
import practiceStyles from "./PracticeSetup.module.scss";

export type { PracticeKind, PracticePreferenceStore, PracticeSelectionMode, SpellingSelectionMode };

export interface PracticeSetupProps {
	deck: Deck;
	plan: PracticeSetupPlan;
	spellingPlan?: SpellingSetupPlan | null;
	spellingSnapshot?: DeckSpellingSnapshot;
	defaultDirection?: CardDirection;
	initialDirection?: CardDirection;
	initialKind?: PracticeKind;
	preferenceStore?: PracticePreferenceStore;
	session?: PracticeSetupSession;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

export const PracticeSetup = React.memo(function PracticeSetup(props: PracticeSetupProps) {
	const { deck, plan, spellingPlan, spellingSnapshot, onStartSession, onBack } = props;
	const { t } = useFlashcardI18n();

	const [session] = useState(() => props.session ?? new PracticeSetupSession(props));
	const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
	useLayoutEffect(() => {
		if (!props.session) session.updateSource({ deck, plan, spellingPlan, spellingSnapshot });
	}, [session, props.session, deck, plan, spellingPlan, spellingSnapshot]);

	const {
		practiceKind,
		showModeSelector,
		spellingEligible,
		isSpelling,
		activeCount,
		activeMinutes,
		isStartDisabled,
		maxQuestions,
		quickQuestionCounts,
		selectionMode,
		questionCount,
		questionCountInput,
		rangeStart,
		rangeEnd,
		rangeStartInput,
		rangeEndInput,
		rangeQuestionCount,
		direction,
		spellingMax,
		spellingStats,
		quickSpellingCounts,
		spellingMode,
		spellingQuestionCount,
		spellingQuestionCountInput,
		spellingRangeStart,
		spellingRangeEnd,
		spellingRangeStartInput,
		spellingRangeEndInput,
		spellingRangeCount,
	} = snapshot;

	const spellingUnavailableReason =
		snapshot.spellingUnavailableReason?.kind === "disabled"
			? t("practice.spellingUnavailable")
			: snapshot.spellingUnavailableReason?.kind === "not-ready"
				? t("home.spellingUnavailableTitle", {
						count: snapshot.spellingUnavailableReason.issueCount,
					})
				: undefined;

	const handlePracticeKindChange = (kind: PracticeKind) => {
		session.setPracticeKind(kind);
	};

	const handleStart = () => {
		session.startSession(onStartSession);
	};

	return (
		<SetupPage
			icon={isSpelling ? Keyboard : Target}
			title={isSpelling ? t("spelling.title") : t("practice.title")}
			deck={deck}
			count={activeCount}
			countLabel={isSpelling ? t("setup.words") : t("setup.questions")}
			meta={
				isSpelling ? (
					<>
						<span>{t("setup.totalWords", { count: spellingStats.total })}</span>
						<span>
							{t("setup.unpracticedWords", { count: spellingStats.unpracticed })}
						</span>
						{activeMinutes > 0 && (
							<span>{t("practice.estimatedTime", { minutes: activeMinutes })}</span>
						)}
					</>
				) : (
					<>
						<span>{t("setup.availableCards", { count: maxQuestions })}</span>
						{activeMinutes > 0 && (
							<span>{t("practice.estimatedTime", { minutes: activeMinutes })}</span>
						)}
					</>
				)
			}
			summary={
				isSpelling ? (
					<>
						{t(
							spellingMode === "smart"
								? "spelling.smartSelection"
								: "spelling.rangeSelection",
						)}
						{spellingMode === "range" && (
							<>
								{" "}
								· {spellingRangeStart}–{spellingRangeEnd}
							</>
						)}
						{activeMinutes > 0 && (
							<> · {t("practice.estimatedTime", { minutes: activeMinutes })}</>
						)}
					</>
				) : (
					<>
						{t(
							selectionMode === "range"
								? "practice.modeRange"
								: "practice.modeRandomCount",
						)}{" "}
						·{" "}
						{direction === "normal"
							? t("practice.directionNormal")
							: t("practice.directionReversed")}
						{selectionMode === "range" && (
							<>
								{" "}
								· {rangeStart}–{rangeEnd}
							</>
						)}
						{activeMinutes > 0 && (
							<> · {t("practice.estimatedTime", { minutes: activeMinutes })}</>
						)}
					</>
				)
			}
			startLabel={
				isSpelling
					? t("spelling.start", { count: activeCount })
					: t("practice.startQuestions", { count: activeCount })
			}
			disabled={isStartDisabled}
			onStart={handleStart}
			onBack={onBack}
		>
			<div className={cls("fc-panel", styles.setupPanel)}>
				{showModeSelector && (
					<SetupControlGroup
						icon={Layers}
						title={t("practice.type")}
						note={
							isSpelling ? t("practice.typeSpellingNote") : t("practice.typeCardNote")
						}
					>
						<SetupSelector
							value={practiceKind}
							ariaLabel={t("practice.type")}
							options={[
								{
									value: "flip",
									label: t("practice.typeCard"),
									icon: Layers,
								},
								{
									value: "spelling",
									label: t("practice.typeSpelling"),
									icon: Keyboard,
									disabled: !spellingEligible,
									title: !spellingEligible
										? (spellingUnavailableReason ??
											t("practice.spellingUnavailable"))
										: undefined,
								},
							]}
							onChange={handlePracticeKindChange}
						/>
					</SetupControlGroup>
				)}

				{isSpelling ? (
					<SetupControlGroup
						icon={SlidersHorizontal}
						title={t("spelling.chooseWords")}
						note={t(
							spellingMode === "smart"
								? "spelling.chooseWordsNote"
								: "spelling.rangeSelectionNote",
						)}
					>
						<SetupSelector
							value={spellingMode}
							ariaLabel={t("spelling.chooseWords")}
							options={[
								{
									value: "smart",
									label: t("spelling.smartSelection"),
									icon: BrainCircuit,
								},
								{
									value: "range",
									label: t("spelling.rangeSelection"),
									icon: ListOrdered,
								},
							]}
							onChange={(mode) => session.setSpellingMode(mode)}
						/>

						<div className={styles.controlDetail}>
							{spellingMode === "smart" ? (
								<>
									<div className={styles.quickButtons}>
										{quickSpellingCounts.map((count) => {
											const minutes = estimateMinutes(count, true);
											return (
												<FlashcardButton
													key={count}
													type="button"
													className={cls(
														styles.chip,
														practiceStyles.chipWithTime,
													)}
													active={spellingQuestionCount === count}
													aria-pressed={spellingQuestionCount === count}
													aria-label={t("practice.chipAria", {
														count,
														minutes,
													})}
													onClick={() =>
														session.selectQuickSpellingCount(count)
													}
												>
													<span>{count}</span>
													<span className={practiceStyles.chipSub}>
														~{minutes}m
													</span>
												</FlashcardButton>
											);
										})}
										<FlashcardButton
											type="button"
											className={cls(
												styles.chip,
												practiceStyles.chipWithTime,
											)}
											active={spellingQuestionCount === spellingMax}
											aria-pressed={spellingQuestionCount === spellingMax}
											aria-label={t("practice.allCardsAria", {
												count: spellingMax,
												minutes: estimateMinutes(spellingMax, true),
											})}
											onClick={() =>
												session.selectQuickSpellingCount(spellingMax)
											}
										>
											<span>{t("common.all")}</span>
											<span className={practiceStyles.chipSub}>
												({spellingMax})
											</span>
										</FlashcardButton>
									</div>

									<div className={practiceStyles.customInputRow}>
										<label className={styles.customField}>
											<span className={styles.inputLabel}>
												{t("spelling.customCount")}
											</span>
											<FlashcardInput
												type="number"
												className={styles.input}
												value={spellingQuestionCountInput}
												onChange={(e) =>
													session.setSpellingQuestionCountInput(
														e.target.value,
													)
												}
												onBlur={() => session.commitSpellingQuestionCount()}
												min={1}
												max={spellingMax}
											/>
											<span className={styles.inputHint}>
												1–{spellingMax}
											</span>
										</label>
										{spellingQuestionCount > 0 &&
											!quickSpellingCounts.includes(spellingQuestionCount) &&
											spellingQuestionCount !== spellingMax && (
												<span className={practiceStyles.customEstimate}>
													{t("practice.estimatedTime", {
														minutes: estimateMinutes(
															spellingQuestionCount,
															true,
														),
													})}
												</span>
											)}
									</div>
								</>
							) : (
								<div className={styles.rangeGroup}>
									<div className={styles.rangeInputs}>
										<label className={styles.rangeField}>
											<span className={styles.inputLabel}>
												{t("practice.rangeStart")}
											</span>
											<FlashcardInput
												type="number"
												className={styles.input}
												value={spellingRangeStartInput}
												onChange={(e) =>
													session.setSpellingRangeStartInput(
														e.target.value,
													)
												}
												onBlur={() => session.commitSpellingRange()}
											/>
										</label>
										<label className={styles.rangeField}>
											<span className={styles.inputLabel}>
												{t("practice.rangeEnd")}
											</span>
											<FlashcardInput
												type="number"
												className={styles.input}
												value={spellingRangeEndInput}
												onChange={(e) =>
													session.setSpellingRangeEndInput(e.target.value)
												}
												onBlur={() => session.commitSpellingRange()}
											/>
										</label>
									</div>
									<div className={practiceStyles.rangeSelectedNotice}>
										<span className={practiceStyles.rangeCountHighlight}>
											{t("practice.rangeSelectedSummary", {
												count: spellingRangeCount,
											})}
										</span>
										<span className={practiceStyles.rangeEstimatedTime}>
											（
											{t("practice.estimatedTime", {
												minutes: estimateMinutes(spellingRangeCount, true),
											})}
											）
										</span>
									</div>
								</div>
							)}
						</div>
					</SetupControlGroup>
				) : (
					<>
						<SetupControlGroup
							icon={SlidersHorizontal}
							title={t("practice.chooseCount")}
							note={
								selectionMode === "range"
									? t("practice.rangeSelectedSummary", {
											count: rangeQuestionCount,
										})
									: t("practice.chooseCountNote")
							}
						>
							<SetupSelector
								value={selectionMode}
								ariaLabel={t("practice.chooseCount")}
								options={[
									{
										value: "random",
										label: t("practice.modeRandomCount"),
										icon: Shuffle,
									},
									{
										value: "range",
										label: t("practice.modeRange"),
										icon: ListOrdered,
									},
								]}
								onChange={(mode) => session.setSelectionMode(mode)}
							/>

							<div className={styles.controlDetail}>
								{selectionMode === "random" ? (
									<>
										<div className={styles.quickButtons}>
											{quickQuestionCounts.map((count) => {
												const minutes = estimateMinutes(count, false);
												return (
													<FlashcardButton
														key={count}
														type="button"
														className={cls(
															styles.chip,
															practiceStyles.chipWithTime,
														)}
														active={questionCount === count}
														aria-pressed={questionCount === count}
														aria-label={t("practice.chipAria", {
															count,
															minutes,
														})}
														onClick={() =>
															session.selectQuickQuestionCount(count)
														}
													>
														<span>{count}</span>
														<span className={practiceStyles.chipSub}>
															~{minutes}m
														</span>
													</FlashcardButton>
												);
											})}
											<FlashcardButton
												type="button"
												className={cls(
													styles.chip,
													practiceStyles.chipWithTime,
												)}
												active={questionCount === maxQuestions}
												aria-pressed={questionCount === maxQuestions}
												aria-label={t("practice.allCardsAria", {
													count: maxQuestions,
													minutes: estimateMinutes(maxQuestions, false),
												})}
												onClick={() =>
													session.selectQuickQuestionCount(maxQuestions)
												}
											>
												<span>{t("common.all")}</span>
												<span className={practiceStyles.chipSub}>
													({maxQuestions})
												</span>
											</FlashcardButton>
										</div>

										<div className={practiceStyles.customInputRow}>
											<label className={styles.customField}>
												<span className={styles.inputLabel}>
													{t("practice.customCount")}
												</span>
												<FlashcardInput
													type="number"
													className={styles.input}
													value={questionCountInput}
													onChange={(e) =>
														session.setQuestionCountInput(
															e.target.value,
														)
													}
													onBlur={() => session.commitQuestionCount()}
													min={1}
													max={maxQuestions}
												/>
												<span className={styles.inputHint}>
													1–{maxQuestions}
												</span>
											</label>
											{questionCount > 0 &&
												!quickQuestionCounts.includes(questionCount) &&
												questionCount !== maxQuestions && (
													<span className={practiceStyles.customEstimate}>
														{t("practice.estimatedTime", {
															minutes: estimateMinutes(
																questionCount,
																false,
															),
														})}
													</span>
												)}
										</div>
									</>
								) : (
									<div className={styles.rangeGroup}>
										<div className={styles.rangeInputs}>
											<label className={styles.rangeField}>
												<span className={styles.inputLabel}>
													{t("practice.rangeStart")}
												</span>
												<FlashcardInput
													type="number"
													className={styles.input}
													value={rangeStartInput}
													onChange={(e) =>
														session.setRangeStartInput(e.target.value)
													}
													onBlur={() => session.commitRange()}
												/>
											</label>
											<label className={styles.rangeField}>
												<span className={styles.inputLabel}>
													{t("practice.rangeEnd")}
												</span>
												<FlashcardInput
													type="number"
													className={styles.input}
													value={rangeEndInput}
													onChange={(e) =>
														session.setRangeEndInput(e.target.value)
													}
													onBlur={() => session.commitRange()}
												/>
											</label>
										</div>
										<div className={practiceStyles.rangeSelectedNotice}>
											<span className={practiceStyles.rangeCountHighlight}>
												{t("practice.rangeSelectedSummary", {
													count: rangeQuestionCount,
												})}
											</span>
											<span className={practiceStyles.rangeEstimatedTime}>
												（
												{t("practice.estimatedTime", {
													minutes: estimateMinutes(
														rangeQuestionCount,
														false,
													),
												})}
												）
											</span>
										</div>
									</div>
								)}
							</div>
						</SetupControlGroup>

						<SetupControlGroup
							icon={ArrowRightLeft}
							title={t("mode.direction")}
							note={
								direction === "normal"
									? t("practice.directionNormalNote")
									: t("practice.directionReversedNote")
							}
						>
							<SetupSelector
								value={direction}
								ariaLabel={t("mode.direction")}
								options={[
									{
										value: "normal",
										label: t("practice.directionNormal"),
										icon: ArrowRight,
									},
									{
										value: "reversed",
										label: t("practice.directionReversed"),
										icon: Repeat2,
									},
								]}
								onChange={(dir) => session.setDirection(dir)}
							/>

							<div className={practiceStyles.directionFlowCard}>
								<div className={practiceStyles.flowStep}>
									<span className={practiceStyles.flowBadge}>
										{t("practice.flowPrompt")}
									</span>
									<span className={practiceStyles.flowText}>
										{direction === "normal"
											? t("practice.flowFrontPrompt")
											: t("practice.flowBackPrompt")}
									</span>
								</div>
								<div className={practiceStyles.flowArrow} aria-hidden="true">
									<ArrowRight size={14} />
								</div>
								<div className={practiceStyles.flowStep}>
									<span className={practiceStyles.flowBadgeAnswer}>
										{t("practice.flowAnswer")}
									</span>
									<span className={practiceStyles.flowText}>
										{direction === "normal"
											? t("practice.flowBackAnswer")
											: t("practice.flowFrontAnswer")}
									</span>
								</div>
							</div>
						</SetupControlGroup>
					</>
				)}
			</div>
		</SetupPage>
	);
});
