import React, { useState } from "react";
import { BrainCircuit, Keyboard, ListOrdered, SlidersHorizontal } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { Deck } from "../../../../../core/shared/types";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { SpellingSetupPlan } from "../../../domain/sessions/sessionPlanner";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles as styles } from "../../primitives/SetupPage/SetupPage";

const QUICK_COUNTS = [10, 20, 50];

interface SpellingSetupProps {
	deck: Deck;
	plan: SpellingSetupPlan;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

export const SpellingSetup = React.memo(function SpellingSetup({
	deck,
	plan,
	onStartSession,
	onBack,
}: SpellingSetupProps) {
	const { t } = useFlashcardI18n();
	const maxQuestions = plan.maxQuestions;
	const quickCounts = Array.from(
		new Set(
			QUICK_COUNTS.map((count) => Math.min(count, maxQuestions)).filter(
				(count) => count > 0 && count < maxQuestions,
			),
		),
	);
	const stats = plan.stats;
	const [mode, setMode] = useState<"smart" | "range">(plan.initialSelectionMode);
	const [questionCount, setQuestionCount] = useState(plan.initialQuestionCount);
	const [inputValue, setInputValue] = useState(plan.initialQuestionCount.toString());
	const [rangeStart, setRangeStart] = useState(plan.initialRangeStart);
	const [rangeEnd, setRangeEnd] = useState(plan.initialRangeEnd);
	const [rangeStartInput, setRangeStartInput] = useState(plan.initialRangeStart.toString());
	const [rangeEndInput, setRangeEndInput] = useState(plan.initialRangeEnd.toString());
	const rangeCount = Math.max(0, rangeEnd - rangeStart + 1);
	const currentCount = mode === "smart" ? questionCount : rangeCount;
	const isStartDisabled = currentCount < 1;

	const handleQuickSelect = (count: number) => {
		setQuestionCount(count);
		setInputValue(count.toString());
	};

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

	const handleRangeStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setRangeStartInput(value);

		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			const clamped = Math.max(1, Math.min(num, rangeEnd));
			setRangeStart(clamped);
		}
	};

	const handleRangeEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setRangeEndInput(value);

		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			const clamped = Math.max(rangeStart, Math.min(num, maxQuestions));
			setRangeEnd(clamped);
		}
	};

	const handleRangeBlur = () => {
		const parsedStart = parseInt(rangeStartInput, 10);
		const parsedEnd = parseInt(rangeEndInput, 10);
		const start =
			isNaN(parsedStart) || parsedStart < 1
				? rangeStart
				: Math.min(parsedStart, maxQuestions);
		const end =
			isNaN(parsedEnd) || parsedEnd < start ? start : Math.min(parsedEnd, maxQuestions);

		setRangeStart(start);
		setRangeEnd(end);
		setRangeStartInput(start.toString());
		setRangeEndInput(end.toString());
	};

	const handleStart = () => {
		if (isStartDisabled) return;
		if (mode === "range") {
			onStartSession({
				mode: "spelling",
				deckId: deck.id,
				selection: {
					kind: "range",
					startIndex: rangeStart,
					endIndex: rangeEnd,
				},
			});
			return;
		}
		onStartSession({
			mode: "spelling",
			deckId: deck.id,
			selection: {
				kind: "smart",
				questionCount,
			},
		});
	};

	return (
		<SetupPage
			icon={Keyboard}
			title={t("spelling.title")}
			deck={deck}
			count={currentCount}
			countLabel={t("setup.words")}
			meta={
				<>
					<span>{t("setup.totalWords", { count: stats.total })}</span>
					<span>{t("setup.unpracticedWords", { count: stats.unpracticed })}</span>
				</>
			}
			summary={
				<>
					{t(mode === "smart" ? "spelling.smartSelection" : "spelling.rangeSelection")}
					{mode === "range" && (
						<>
							{" "}
							· {rangeStart}–{rangeEnd}
						</>
					)}
				</>
			}
			startLabel={t("spelling.start", { count: currentCount })}
			disabled={isStartDisabled}
			onStart={handleStart}
			onBack={onBack}
		>
			<div className={cls("fc-panel", styles.setupPanel)}>
				<SetupControlGroup
					icon={SlidersHorizontal}
					title={t("spelling.chooseWords")}
					note={t(
						mode === "smart"
							? "spelling.chooseWordsNote"
							: "spelling.rangeSelectionNote",
					)}
				>
					<SetupSelector
						value={mode}
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
						onChange={setMode}
					/>

					<div className={styles.controlDetail}>
						{mode === "smart" ? (
							<>
								<div className={styles.quickButtons}>
									{quickCounts.map((count) => (
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
										{t("spelling.customCount")}
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
											min={1}
											max={maxQuestions}
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
											min={rangeStart}
											max={maxQuestions}
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
			</div>
		</SetupPage>
	);
});
