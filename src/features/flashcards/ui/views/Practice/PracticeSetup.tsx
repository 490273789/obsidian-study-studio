import React, { useState } from "react";
import { Target, Shuffle, SlidersHorizontal, Repeat2, ListOrdered } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { CardDirection, Deck } from "../../../../../core/shared/types";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { PracticeSetupPlan } from "../../../domain/sessions/sessionPlanner";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { useWindowKeyDown } from "../../../../../core/ui/hooks/hooks";
import styles from "./Practice.module.scss";

const QUICK_QUESTION_COUNTS = [20, 50, 100, 150, 200];

type PracticeSelectionMode = "random" | "range";

interface PracticeSetupProps {
	deck: Deck;
	plan: PracticeSetupPlan;
	defaultDirection?: CardDirection;
	initialDirection?: CardDirection;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

export const PracticeSetup = React.memo(function PracticeSetup({
	deck,
	plan,
	defaultDirection = "normal",
	initialDirection,
	onStartSession,
	onBack,
}: PracticeSetupProps) {
	const { t } = useFlashcardI18n();
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
		// Normalize the value on blur
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

	const isStartDisabled = maxQuestions === 0 || currentQuestionCount < 1;

	const handleStart = () => {
		if (isStartDisabled) return;
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

	useWindowKeyDown((e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}
		if (e.code === "Space") {
			e.preventDefault();
			handleStart();
		}
	});

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

	return (
		<div className="flashcard-practice-setup fc-page fc-page--fill">
			<FlashcardHeader icon={Target} title={t("practice.title")} onBack={onBack} />

			<div className="flashcard-setup-content fc-page__body fc-page__body--narrow">
				<div className={styles.hero}>
					<div className={styles.deckNameWrapper}>
						<div className={styles.deckName}>{deck.name}</div>
						<div className={styles.deckTag}>{deck.tag}</div>
					</div>
				</div>

				<div className={styles.setupPanel}>
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
												className={cls(
													styles.chip,
													questionCount === count && styles.active,
												)}
												active={questionCount === count}
												onClick={() => handleQuickSelect(count)}
											>
												{count}
											</FlashcardButton>
										))}
										<FlashcardButton
											type="button"
											className={cls(
												styles.chip,
												questionCount === maxQuestions && styles.active,
											)}
											active={questionCount === maxQuestions}
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
										<span className={styles.inputHint}>1–{maxQuestions}</span>
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
				</div>

				<div className={styles.actionBar}>
					<FlashcardButton
						variant="primary"
						preset="show"
						size="lg"
						onClick={handleStart}
						disabled={isStartDisabled}
					>
						{t("practice.startQuestions", {
							count: currentQuestionCount,
						})}
						{!isStartDisabled && (
							<span className="flashcard-shortcut">({t("common.space")})</span>
						)}
					</FlashcardButton>
				</div>
			</div>
		</div>
	);
});
