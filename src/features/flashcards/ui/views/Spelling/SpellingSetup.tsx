import React, { useState } from "react";
import { BrainCircuit, Keyboard, ListOrdered, SlidersHorizontal } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { Deck } from "../../../../../core/shared/types";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { SpellingSetupPlan } from "../../../domain/sessions/sessionPlanner";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { StatCards } from "../../../../../core/ui/primitives/StatCards";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { useWindowKeyDown } from "../../../../../core/ui/hooks/hooks";
import styles from "../Practice/Practice.module.scss";

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
	const [rangeStart, setRangeStart] = useState(plan.initialRangeStart);
	const [rangeEnd, setRangeEnd] = useState(plan.initialRangeEnd);
	const rangeCount = Math.max(0, rangeEnd - rangeStart + 1);
	const currentCount = mode === "smart" ? questionCount : rangeCount;
	const isStartDisabled = currentCount < 1;

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

	useWindowKeyDown((e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}
		if (e.code === "Space") {
			e.preventDefault();
			handleStart();
		}
	});

	return (
		<div className="flashcard-practice-setup flashcard-spelling-setup fc-page fc-page--fill">
			<FlashcardHeader icon={Keyboard} title={t("spelling.title")} onBack={onBack} />

			<div className="flashcard-setup-content fc-page__body fc-page__body--narrow">
				<div className={styles.hero}>
					<div className={styles.deckNameWrapper}>
						<div className={styles.deckName}>{deck.name}</div>
						<div className={styles.deckTag}>{deck.tag}</div>
					</div>
				</div>

				<StatCards
					items={[
						{
							key: "total",
							value: stats.total,
							label: t("spelling.totalWords"),
							tone: "blue",
						},
						{
							key: "unpracticed",
							value: stats.unpracticed,
							label: t("spelling.unpracticed"),
							tone: "orange",
						},
					]}
				/>

				<div className={styles.setupPanel}>
					<SetupControlGroup
						icon={SlidersHorizontal}
						title={t("spelling.chooseWords")}
						note={t("spelling.chooseWordsNote")}
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
								<div className={styles.quickButtons}>
									{quickCounts.map((count) => (
										<FlashcardButton
											key={count}
											type="button"
											className={cls(
												styles.chip,
												questionCount === count && styles.active,
											)}
											active={questionCount === count}
											onClick={() => setQuestionCount(count)}
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
										onClick={() => setQuestionCount(maxQuestions)}
									>
										{t("common.all")}
									</FlashcardButton>
								</div>
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
												value={rangeStart}
												onChange={(event) => {
													const next = Math.max(
														1,
														Math.min(
															Number(event.target.value),
															rangeEnd,
														),
													);
													setRangeStart(next);
												}}
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
												value={rangeEnd}
												onChange={(event) => {
													const next = Math.max(
														rangeStart,
														Math.min(
															Number(event.target.value),
															maxQuestions,
														),
													);
													setRangeEnd(next);
												}}
											/>
										</label>
									</div>
								</div>
							)}
						</div>
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
						{t("spelling.start", { count: currentCount })}
						{!isStartDisabled && (
							<span className="flashcard-shortcut">({t("common.space")})</span>
						)}
					</FlashcardButton>
				</div>
			</div>
		</div>
	);
});
