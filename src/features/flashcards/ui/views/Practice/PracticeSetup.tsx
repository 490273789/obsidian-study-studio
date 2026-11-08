import React, { useState } from "react";
import {
	BrainCircuit,
	Keyboard,
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

const QUICK_QUESTION_COUNTS = [20, 50, 100, 150, 200];
const QUICK_SPELLING_COUNTS = [10, 20, 50];

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
		const saved = lastPracticeKindByDeck.get(deck.id);
		if (saved === "spelling" && spellingEligible) return "spelling";
		return "flip";
	};
	const [practiceKind, setPracticeKind] = useState<PracticeKind>(resolveInitialKind);

	const handlePracticeKindChange = (kind: PracticeKind) => {
		setPracticeKind(kind);
		lastPracticeKindByDeck.set(deck.id, kind);
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

	return (
		<SetupPage
			icon={practiceKind === "spelling" ? Keyboard : Target}
			title={practiceKind === "spelling" ? t("spelling.title") : t("practice.title")}
			deck={deck}
			count={practiceKind === "spelling" ? currentSpellingCount : currentQuestionCount}
			countLabel={practiceKind === "spelling" ? t("setup.words") : t("setup.questions")}
			meta={
				practiceKind === "spelling" ? (
					<>
						<span>{t("setup.totalWords", { count: spellingStats.total })}</span>
						<span>
							{t("setup.unpracticedWords", { count: spellingStats.unpracticed })}
						</span>
					</>
				) : (
					<span>{t("setup.availableCards", { count: maxQuestions })}</span>
				)
			}
			summary={
				practiceKind === "spelling" ? (
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
					</>
				) : (
					<>
						{t(
							selectionMode === "range"
								? "practice.modeRange"
								: "practice.modeRandomCount",
						)}{" "}
						· {t(direction === "normal" ? "mode.normal" : "mode.reversed")}
						{selectionMode === "range" && (
							<>
								{" "}
								· {rangeStart}–{rangeEnd}
							</>
						)}
					</>
				)
			}
			startLabel={
				practiceKind === "spelling"
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
						icon={Target}
						title={t("practice.type")}
						note={
							practiceKind === "spelling"
								? t("practice.typeSpellingNote")
								: t("practice.typeCardNote")
						}
					>
						<SetupSelector
							value={practiceKind}
							ariaLabel={t("practice.type")}
							options={[
								{
									value: "flip",
									label: t("practice.typeCard"),
									icon: Target,
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

				{practiceKind === "spelling" ? (
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
										{quickSpellingCounts.map((count) => (
											<FlashcardButton
												key={count}
												type="button"
												className={styles.chip}
												active={spellingQuestionCount === count}
												aria-pressed={spellingQuestionCount === count}
												onClick={() => handleSpellingQuickSelect(count)}
											>
												{count}
											</FlashcardButton>
										))}
										<FlashcardButton
											type="button"
											className={styles.chip}
											active={spellingQuestionCount === spellingMax}
											aria-pressed={spellingQuestionCount === spellingMax}
											onClick={() => handleSpellingQuickSelect(spellingMax)}
										>
											{t("common.all")}
										</FlashcardButton>
									</div>

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
										<span className={styles.inputHint}>1–{spellingMax}</span>
									</label>
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
								</div>
							)}
						</div>
					</SetupControlGroup>
				) : (
					<>
						<SetupControlGroup
							icon={SlidersHorizontal}
							title={t("practice.chooseCount")}
							note={t("practice.chooseCountNote")}
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
											{quickQuestionCounts.map((count) => (
												<FlashcardButton
													key={count}
													type="button"
													className={styles.chip}
													active={questionCount === count}
													aria-pressed={questionCount === count}
													onClick={() => handleQuickSelect(count)}
												>
													{count}
												</FlashcardButton>
											))}
											<FlashcardButton
												type="button"
												className={styles.chip}
												active={questionCount === maxQuestions}
												aria-pressed={questionCount === maxQuestions}
												onClick={() => handleQuickSelect(maxQuestions)}
											>
												{t("common.all")}
											</FlashcardButton>
										</div>

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
									</div>
								)}
							</div>
						</SetupControlGroup>

						<SetupControlGroup
							icon={Repeat2}
							title={t("mode.direction")}
							note={
								direction === "normal"
									? t("mode.normalNote")
									: t("mode.reversedNote")
							}
						>
							<SetupSelector
								value={direction}
								ariaLabel={t("mode.direction")}
								options={[
									{
										value: "normal",
										label: t("mode.normal"),
										icon: Target,
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
					</>
				)}
			</div>
		</SetupPage>
	);
});
