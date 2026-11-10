import React, { useState } from "react";
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
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles as styles } from "../../primitives/SetupPage/SetupPage";
import practiceStyles from "./PracticeSetup.module.scss";

const QUICK_QUESTION_COUNTS = [20, 50, 100];
const QUICK_SPELLING_COUNTS = [10, 20, 50];
const STORAGE_KEY_PREFIX = "study-studio:practice-kind:";

export type PracticeKind = "flip" | "spelling";
type PracticeSelectionMode = "random" | "range";
type SpellingSelectionMode = "smart" | "range";

export interface PracticeSetupProps {
	deck: Deck;
	plan: PracticeSetupPlan;
	spellingPlan?: SpellingSetupPlan | null;
	spellingSnapshot?: DeckSpellingSnapshot;
	defaultDirection?: CardDirection;
	initialDirection?: CardDirection;
	initialKind?: PracticeKind;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

const lastPracticeKindByDeck = new Map<string, PracticeKind>();

function getPersistedPracticeKind(deckId: string): PracticeKind | null {
	const inMem = lastPracticeKindByDeck.get(deckId);
	if (inMem) return inMem;
	try {
		const saved = window.localStorage?.getItem(`${STORAGE_KEY_PREFIX}${deckId}`);
		if (saved === "spelling" || saved === "flip") return saved;
	} catch {
		// safe fallback
	}
	return null;
}

function persistPracticeKind(deckId: string, kind: PracticeKind): void {
	lastPracticeKindByDeck.set(deckId, kind);
	try {
		window.localStorage?.setItem(`${STORAGE_KEY_PREFIX}${deckId}`, kind);
	} catch {
		// safe fallback
	}
}

/**
 * In flashcard retrieval, each card takes ~7.5 seconds on average (flip + recall).
 * For spelling, each word takes ~12 seconds (typing + recall).
 */
function estimateMinutes(count: number, isSpelling = false): number {
	if (count <= 0) return 0;
	const secondsPerCard = isSpelling ? 12 : 7.5;
	return Math.max(1, Math.round((count * secondsPerCard) / 60));
}

export const PracticeSetup = React.memo(function PracticeSetup({
	deck,
	plan,
	spellingPlan,
	spellingSnapshot,
	defaultDirection = "normal",
	initialDirection,
	initialKind,
	onStartSession,
	onBack,
}: PracticeSetupProps) {
	const { t } = useFlashcardI18n();

	// Flip practice configuration
	const maxQuestions = plan.maxQuestions;
	const maxRangeStart = plan.maxRangeStart;
	const quickQuestionCounts = Array.from(
		new Set(
			QUICK_QUESTION_COUNTS.map((count) => Math.min(count, maxQuestions)).filter(
				(count) => count > 0 && count < maxQuestions,
			),
		),
	);
	const [selectionMode, setSelectionMode] = useState<PracticeSelectionMode>(
		plan.initialSelectionMode,
	);
	const [questionCount, setQuestionCount] = useState(plan.initialQuestionCount);
	const [inputValue, setInputValue] = useState(plan.initialQuestionCount.toString());
	const [rangeStart, setRangeStart] = useState(plan.initialRangeStart);
	const [rangeEnd, setRangeEnd] = useState(plan.initialRangeEnd);
	const [rangeStartInput, setRangeStartInput] = useState(plan.initialRangeStart.toString());
	const [rangeEndInput, setRangeEndInput] = useState(plan.initialRangeEnd.toString());
	const [direction, setDirection] = useState<CardDirection>(initialDirection ?? defaultDirection);

	// Spelling configuration
	const spellingEligible = Boolean(
		spellingPlan &&
		(spellingSnapshot
			? spellingSnapshot.enabled && spellingSnapshot.ready
			: spellingPlan.maxQuestions > 0),
	);
	const spellingUnavailableReason =
		spellingSnapshot && !spellingSnapshot.enabled
			? t("practice.spellingUnavailable")
			: spellingSnapshot && !spellingSnapshot.ready
				? t("home.spellingUnavailableTitle", { count: spellingSnapshot.issueCount })
				: undefined;

	const spellingMax = spellingPlan?.maxQuestions ?? 0;
	const spellingStats = spellingPlan?.stats ?? { total: spellingMax, unpracticed: 0 };
	const quickSpellingCounts = Array.from(
		new Set(
			QUICK_SPELLING_COUNTS.map((count) => Math.min(count, spellingMax)).filter(
				(count) => count > 0 && count < spellingMax,
			),
		),
	);
	const [spellingMode, setSpellingMode] = useState<SpellingSelectionMode>(
		spellingPlan?.initialSelectionMode ?? "smart",
	);
	const [spellingQuestionCount, setSpellingQuestionCount] = useState(
		spellingPlan?.initialQuestionCount ?? Math.min(20, spellingMax),
	);
	const [spellingInputValue, setSpellingInputValue] = useState(
		(spellingPlan?.initialQuestionCount ?? Math.min(20, spellingMax)).toString(),
	);
	const [spellingRangeStart, setSpellingRangeStart] = useState(
		spellingPlan?.initialRangeStart ?? 1,
	);
	const [spellingRangeEnd, setSpellingRangeEnd] = useState(
		spellingPlan?.initialRangeEnd ?? Math.min(20, spellingMax),
	);
	const [spellingRangeStartInput, setSpellingRangeStartInput] = useState(
		(spellingPlan?.initialRangeStart ?? 1).toString(),
	);
	const [spellingRangeEndInput, setSpellingRangeEndInput] = useState(
		(spellingPlan?.initialRangeEnd ?? Math.min(20, spellingMax)).toString(),
	);

	// Mode selection: "flip" vs "spelling"
	const showModeSelector = spellingPlan !== undefined;
	const resolveInitialKind = (): PracticeKind => {
		if (initialKind === "spelling") return "spelling";
		if (initialKind === "flip") return "flip";
		const saved = getPersistedPracticeKind(deck.id);
		if (saved === "spelling" && spellingEligible) return "spelling";
		return "flip";
	};
	const [practiceKind, setPracticeKind] = useState<PracticeKind>(resolveInitialKind);

	const handlePracticeKindChange = (kind: PracticeKind) => {
		setPracticeKind(kind);
		persistPracticeKind(deck.id, kind);
	};

	// Flip handlers
	const rangeQuestionCount = Math.max(0, rangeEnd - rangeStart + 1);
	const currentQuestionCount = selectionMode === "range" ? rangeQuestionCount : questionCount;

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setInputValue(value);

		const num = parseInt(value, 10);
		if (!isNaN(num) && num >= 1) {
			setQuestionCount(Math.min(num, maxQuestions));
		}
	};

	const handleInputBlur = () => {
		const num = parseInt(inputValue, 10);
		if (isNaN(num) || num < 1) {
			setQuestionCount(1);
			setInputValue("1");
		} else {
			const normalized = Math.min(num, maxQuestions);
			setQuestionCount(normalized);
			setInputValue(normalized.toString());
		}
	};

	const getNormalizedRange = () => {
		const parsedStart = parseInt(rangeStartInput, 10);
		const parsedEnd = parseInt(rangeEndInput, 10);
		const start =
			isNaN(parsedStart) || parsedStart < 1
				? rangeStart
				: Math.min(parsedStart, maxRangeStart);
		const end =
			isNaN(parsedEnd) || parsedEnd < start ? start : Math.min(parsedEnd, maxQuestions);

		return { start, end };
	};

	const syncRange = (start: number, end: number) => {
		setRangeStart(start);
		setRangeEnd(end);
		setRangeStartInput(start.toString());
		setRangeEndInput(end.toString());
	};

	const handleQuickSelect = (count: number) => {
		const actualCount = Math.min(count, maxQuestions);
		setQuestionCount(actualCount);
		setInputValue(actualCount.toString());
	};

	const handleRangeStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setRangeStartInput(e.target.value);
	};

	const handleRangeEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setRangeEndInput(e.target.value);
	};

	const handleRangeBlur = () => {
		const { start, end } = getNormalizedRange();
		syncRange(start, end);
	};

	// Spelling handlers
	const currentSpellingRangeCount = Math.max(0, spellingRangeEnd - spellingRangeStart + 1);
	const currentSpellingCount =
		spellingMode === "smart" ? spellingQuestionCount : currentSpellingRangeCount;

	const handleSpellingQuickSelect = (count: number) => {
		const actual = Math.min(count, spellingMax);
		setSpellingQuestionCount(actual);
		setSpellingInputValue(actual.toString());
	};

	const handleSpellingInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setSpellingInputValue(value);

		const num = parseInt(value, 10);
		if (!isNaN(num) && num >= 1) {
			setSpellingQuestionCount(Math.min(num, spellingMax));
		}
	};

	const handleSpellingInputBlur = () => {
		const num = parseInt(spellingInputValue, 10);
		if (isNaN(num) || num < 1) {
			setSpellingQuestionCount(1);
			setSpellingInputValue("1");
		} else {
			const normalized = Math.min(num, spellingMax);
			setSpellingQuestionCount(normalized);
			setSpellingInputValue(normalized.toString());
		}
	};

	const handleSpellingRangeStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setSpellingRangeStartInput(value);
		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			const clamped = Math.max(1, Math.min(num, spellingRangeEnd));
			setSpellingRangeStart(clamped);
		}
	};

	const handleSpellingRangeEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setSpellingRangeEndInput(value);
		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			const clamped = Math.max(spellingRangeStart, Math.min(num, spellingMax));
			setSpellingRangeEnd(clamped);
		}
	};

	const handleSpellingRangeBlur = () => {
		const parsedStart = parseInt(spellingRangeStartInput, 10);
		const parsedEnd = parseInt(spellingRangeEndInput, 10);
		const start =
			isNaN(parsedStart) || parsedStart < 1
				? spellingRangeStart
				: Math.min(parsedStart, spellingMax);
		const end =
			isNaN(parsedEnd) || parsedEnd < start ? start : Math.min(parsedEnd, spellingMax);

		setSpellingRangeStart(start);
		setSpellingRangeEnd(end);
		setSpellingRangeStartInput(start.toString());
		setSpellingRangeEndInput(end.toString());
	};

	// Start gating
	const isFlipStartDisabled = maxQuestions === 0 || currentQuestionCount < 1;
	const isSpellingStartDisabled = spellingMax === 0 || currentSpellingCount < 1;
	const isStartDisabled = practiceKind === "flip" ? isFlipStartDisabled : isSpellingStartDisabled;

	const handleStart = () => {
		if (isStartDisabled) return;

		if (practiceKind === "spelling") {
			if (spellingMode === "range") {
				onStartSession({
					mode: "spelling",
					deckId: deck.id,
					selection: {
						kind: "range",
						startIndex: spellingRangeStart,
						endIndex: spellingRangeEnd,
					},
				});
				return;
			}
			onStartSession({
				mode: "spelling",
				deckId: deck.id,
				selection: {
					kind: "smart",
					questionCount: spellingQuestionCount,
				},
			});
			return;
		}

		// Flip practice
		if (selectionMode === "range") {
			const { start, end } = getNormalizedRange();
			syncRange(start, end);

			if (end >= start && end <= maxQuestions) {
				onStartSession({
					mode: "practice",
					deckId: deck.id,
					direction,
					selection: {
						kind: "range",
						startIndex: start,
						endIndex: end,
					},
				});
			}
			return;
		}

		if (questionCount >= 1 && questionCount <= maxQuestions) {
			onStartSession({
				mode: "practice",
				deckId: deck.id,
				direction,
				selection: {
					kind: "random",
					questionCount,
				},
			});
		}
	};

	const isSpelling = practiceKind === "spelling";
	const activeCount = isSpelling ? currentSpellingCount : currentQuestionCount;
	const activeMinutes = estimateMinutes(activeCount, isSpelling);

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
					? t("spelling.start", { count: currentSpellingCount })
					: t("practice.startQuestions", { count: currentQuestionCount })
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
							onChange={setSpellingMode}
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
													onClick={() => handleSpellingQuickSelect(count)}
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
											onClick={() => handleSpellingQuickSelect(spellingMax)}
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
												value={spellingInputValue}
												onChange={handleSpellingInputChange}
												onBlur={handleSpellingInputBlur}
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
												onChange={handleSpellingRangeStartChange}
												onBlur={handleSpellingRangeBlur}
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
												onChange={handleSpellingRangeEndChange}
												onBlur={handleSpellingRangeBlur}
											/>
										</label>
									</div>
									<div className={practiceStyles.rangeSelectedNotice}>
										<span className={practiceStyles.rangeCountHighlight}>
											{t("practice.rangeSelectedSummary", {
												count: currentSpellingRangeCount,
											})}
										</span>
										<span className={practiceStyles.rangeEstimatedTime}>
											（
											{t("practice.estimatedTime", {
												minutes: estimateMinutes(
													currentSpellingRangeCount,
													true,
												),
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
								onChange={setSelectionMode}
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
														onClick={() => handleQuickSelect(count)}
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
												onClick={() => handleQuickSelect(maxQuestions)}
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
													value={inputValue}
													onChange={handleInputChange}
													onBlur={handleInputBlur}
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
													onChange={handleRangeStartChange}
													onBlur={handleRangeBlur}
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
													onChange={handleRangeEndChange}
													onBlur={handleRangeBlur}
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
								onChange={setDirection}
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
