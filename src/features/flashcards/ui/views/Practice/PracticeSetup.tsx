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
	PracticeSetupSession,
} from "../../../domain/sessions/practiceSetupSession";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles as styles } from "../../primitives/SetupPage/SetupPage";
import practiceStyles from "./PracticeSetup.module.scss";

interface PracticeSetupProps {
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
							{spellingMode === "smart"
								? renderCountFields(t, {
										count: spellingQuestionCount,
										countInput: spellingQuestionCountInput,
										quickCounts: quickSpellingCounts,
										maxCount: spellingMax,
										isSpelling: true,
										customLabel: t("spelling.customCount"),
										onPickCount: (count) =>
											session.selectQuickSpellingCount(count),
										onChangeCount: (value) =>
											session.setSpellingQuestionCountInput(value),
										onCommitCount: () => session.commitSpellingQuestionCount(),
									})
								: renderRangeFields(t, {
										startInput: spellingRangeStartInput,
										endInput: spellingRangeEndInput,
										count: spellingRangeCount,
										isSpelling: true,
										onChangeStart: (value) =>
											session.setSpellingRangeStartInput(value),
										onChangeEnd: (value) =>
											session.setSpellingRangeEndInput(value),
										onCommitRange: () => session.commitSpellingRange(),
									})}
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
								{selectionMode === "random"
									? renderCountFields(t, {
											count: questionCount,
											countInput: questionCountInput,
											quickCounts: quickQuestionCounts,
											maxCount: maxQuestions,
											isSpelling: false,
											customLabel: t("practice.customCount"),
											onPickCount: (count) =>
												session.selectQuickQuestionCount(count),
											onChangeCount: (value) =>
												session.setQuestionCountInput(value),
											onCommitCount: () => session.commitQuestionCount(),
										})
									: renderRangeFields(t, {
											startInput: rangeStartInput,
											endInput: rangeEndInput,
											count: rangeQuestionCount,
											isSpelling: false,
											onChangeStart: (value) =>
												session.setRangeStartInput(value),
											onChangeEnd: (value) => session.setRangeEndInput(value),
											onCommitRange: () => session.commitRange(),
										})}
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

interface CountFieldsProps {
	count: number;
	countInput: string;
	quickCounts: readonly number[];
	maxCount: number;
	isSpelling: boolean;
	customLabel: string;
	onPickCount: (count: number) => void;
	onChangeCount: (value: string) => void;
	onCommitCount: () => void;
}

type Translate = ReturnType<typeof useFlashcardI18n>["t"];

function renderCountFields(
	t: Translate,
	{
		count,
		countInput,
		quickCounts,
		maxCount,
		isSpelling,
		customLabel,
		onPickCount,
		onChangeCount,
		onCommitCount,
	}: CountFieldsProps,
): React.JSX.Element {
	const chipClass = cls(styles.chip, practiceStyles.chipWithTime);
	const showCustomEstimate = count > 0 && !quickCounts.includes(count) && count !== maxCount;

	return (
		<>
			<div className={styles.quickButtons}>
				{quickCounts.map((preset) => {
					const minutes = estimateMinutes(preset, isSpelling);
					return (
						<FlashcardButton
							key={preset}
							type="button"
							className={chipClass}
							active={count === preset}
							aria-pressed={count === preset}
							aria-label={t("practice.chipAria", { count: preset, minutes })}
							onClick={() => onPickCount(preset)}
						>
							<span>{preset}</span>
							<span className={practiceStyles.chipSub}>~{minutes}m</span>
						</FlashcardButton>
					);
				})}
				<FlashcardButton
					type="button"
					className={chipClass}
					active={count === maxCount}
					aria-pressed={count === maxCount}
					aria-label={t("practice.allCardsAria", {
						count: maxCount,
						minutes: estimateMinutes(maxCount, isSpelling),
					})}
					onClick={() => onPickCount(maxCount)}
				>
					<span>{t("common.all")}</span>
					<span className={practiceStyles.chipSub}>({maxCount})</span>
				</FlashcardButton>
			</div>
			<div className={practiceStyles.customInputRow}>
				<label className={styles.customField}>
					<span className={styles.inputLabel}>{customLabel}</span>
					<FlashcardInput
						type="number"
						className={styles.input}
						value={countInput}
						onChange={(event) => onChangeCount(event.target.value)}
						onBlur={onCommitCount}
						min={1}
						max={maxCount}
					/>
					<span className={styles.inputHint}>1–{maxCount}</span>
				</label>
				{showCustomEstimate && (
					<span className={practiceStyles.customEstimate}>
						{t("practice.estimatedTime", {
							minutes: estimateMinutes(count, isSpelling),
						})}
					</span>
				)}
			</div>
		</>
	);
}

interface RangeFieldsProps {
	startInput: string;
	endInput: string;
	count: number;
	isSpelling: boolean;
	onChangeStart: (value: string) => void;
	onChangeEnd: (value: string) => void;
	onCommitRange: () => void;
}

function renderRangeFields(
	t: Translate,
	{
		startInput,
		endInput,
		count,
		isSpelling,
		onChangeStart,
		onChangeEnd,
		onCommitRange,
	}: RangeFieldsProps,
): React.JSX.Element {
	const fields = [
		{ label: "practice.rangeStart", value: startInput, onChange: onChangeStart },
		{ label: "practice.rangeEnd", value: endInput, onChange: onChangeEnd },
	] as const;

	return (
		<div className={styles.rangeGroup}>
			<div className={styles.rangeInputs}>
				{fields.map(({ label, value, onChange }) => (
					<label key={label} className={styles.rangeField}>
						<span className={styles.inputLabel}>{t(label)}</span>
						<FlashcardInput
							type="number"
							className={styles.input}
							value={value}
							onChange={(event) => onChange(event.target.value)}
							onBlur={onCommitRange}
						/>
					</label>
				))}
			</div>
			<div className={practiceStyles.rangeSelectedNotice}>
				<span className={practiceStyles.rangeCountHighlight}>
					{t("practice.rangeSelectedSummary", { count })}
				</span>
				<span className={practiceStyles.rangeEstimatedTime}>
					（{t("practice.estimatedTime", { minutes: estimateMinutes(count, isSpelling) })}
					）
				</span>
			</div>
		</div>
	);
}
