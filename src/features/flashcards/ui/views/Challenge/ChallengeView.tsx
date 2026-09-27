import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, Lightbulb, X } from "lucide-react";
import { Notice } from "obsidian";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useWindowKeyDown } from "../../../../../core/ui/hooks/hooks";
import { getDisplayCardContent } from "../../../domain/cards/cardDisplay";
import type { ActiveChallengeSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { useFlashcardI18n } from "../../../strings/context";
import type { AnswerPresentationTransition } from "../../answerPresentationTransition";
import { MarkdownContent } from "../../primitives/Markdown";
import styles from "./Challenge.module.scss";

interface ChallengeViewProps {
	session: ActiveChallengeSnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	onClose: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const ChallengeView = memo(function ChallengeView(props: ChallengeViewProps) {
	const { session } = props;
	return (
		<ChallengeQuestion
			key={JSON.stringify([
				session.reference.key,
				session.currentCard.identity,
				session.currentCard.front,
				session.currentCard.back,
				session.phase,
			])}
			{...props}
		/>
	);
});

const ChallengeQuestion = memo(function ChallengeQuestion({
	session,
	transition,
	isTransitioning,
	onClose,
	markdownRenderer,
}: ChallengeViewProps) {
	const { t } = useFlashcardI18n();
	const [answerVisible, setAnswerVisible] = useState(false);
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const currentCard = session.currentCard;
	const isSpelling = session.questionMode === "spelling";
	const feedback = session.feedback;
	const isFeedback = session.phase === "feedback";
	const display = getDisplayCardContent(
		currentCard,
		session.questionMode === "normal" ? "normal" : "reversed",
	);
	const showAnswer = isFeedback || (!isSpelling && answerVisible);

	useEffect(() => {
		if (isSpelling && !isFeedback) inputRef.current?.focus();
	}, [currentCard.identity, currentCard.front, currentCard.back, isFeedback, isSpelling]);

	const report = useCallback(
		(outcome: Awaited<ReturnType<AnswerPresentationTransition["act"]>>) => {
			if (outcome.kind === "failed") new Notice(outcome.message);
		},
		[],
	);

	const answer = useCallback(
		async (correct: boolean) => {
			if (isTransitioning || isFeedback) return;
			report(
				await transition.act({
					kind: "challenge-answer",
					reference: session.reference,
					correct,
				}),
			);
		},
		[isFeedback, isTransitioning, report, session.reference, transition],
	);

	const submitSpelling = useCallback(
		async (value: string, reveal = false) => {
			if (isTransitioning || isFeedback || (!reveal && !value.trim())) return;
			report(
				await transition.act(
					reveal
						? { kind: "challenge-reveal", reference: session.reference }
						: { kind: "challenge-answer", reference: session.reference, input: value },
				),
			);
		},
		[isFeedback, isTransitioning, report, session.reference, transition],
	);

	const continueAfterFeedback = useCallback(async () => {
		if (isTransitioning || !isFeedback) return;
		report(await transition.act({ kind: "challenge-continue", reference: session.reference }));
	}, [isFeedback, isTransitioning, report, session.reference, transition]);

	useWindowKeyDown((event) => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
			return;
		if (isTransitioning) return;
		if (isFeedback && (event.code === "Space" || event.code === "Enter")) {
			event.preventDefault();
			void continueAfterFeedback();
			return;
		}
		if (isSpelling || isFeedback) return;
		if (!showAnswer && event.code === "Space") {
			event.preventDefault();
			setAnswerVisible(true);
			return;
		}
		if (!showAnswer) return;
		if (event.code === "Digit1" || event.code === "Numpad1" || event.code === "KeyX") {
			event.preventDefault();
			void answer(false);
		} else if (
			event.code === "Digit2" ||
			event.code === "Numpad2" ||
			event.code === "KeyO" ||
			event.code === "Space"
		) {
			event.preventDefault();
			void answer(true);
		}
	});

	return (
		<div className={cls("flashcard-study fc-page fc-page--fill", styles.view)}>
			<header className={styles.header}>
				<FlashcardButton
					preset="icon"
					icon={X}
					onClick={onClose}
					title={t("challenge.exitTitle")}
					aria-label={t("challenge.exitTitle")}
				/>
				<div className={styles.progress}>
					<strong>
						{t("challenge.level", { current: session.roundProgress.level })}
					</strong>
					<span>
						{t("challenge.levelProgress", {
							passed: session.roundProgress.passedInLevel,
							total: session.roundProgress.currentLevelTotal,
						})}
					</span>
					<span>
						{t("challenge.roundProgress", {
							passed: session.roundProgress.completedAcrossRound,
							total: session.roundProgress.totalAcrossRound,
						})}
					</span>
				</div>
				{session.removedCardCount > 0 && (
					<output className={styles.removed}>
						{t("challenge.removedCards", { count: session.removedCardCount })}
					</output>
				)}
				<span className={styles.source}>
					{t("challenge.source", { deckName: session.sourceDeck.name })}
				</span>
			</header>
			<div
				className={cls(
					"flashcard-content fc-page__body",
					isTransitioning && "animating",
					styles.content,
				)}
			>
				<div className="flashcard-card-stack" key={currentCard.identity}>
					<div className="flashcard-question">
						<div className="flashcard-label flashcard-label-question">
							{isSpelling ? t("challenge.spellingPrompt") : t("common.question")}
						</div>
						<MarkdownContent
							content={display.prompt}
							className="flashcard-markdown"
							markdownRenderer={markdownRenderer}
						/>
					</div>
					{showAnswer && (
						<div className="flashcard-answer-section">
							<div className="flashcard-divider" />
							<div className="flashcard-answer">
								<div className="flashcard-label flashcard-label-answer">
									{t("common.answer")}
								</div>
								<MarkdownContent
									content={display.answer}
									className="flashcard-markdown"
									markdownRenderer={markdownRenderer}
								/>
							</div>
							{currentCard.explanation && (
								<div className="flashcard-explanation">
									<div className="flashcard-label flashcard-label-explanation">
										{t("common.explanation")}
									</div>
									<MarkdownContent
										content={currentCard.explanation}
										className="flashcard-markdown"
										markdownRenderer={markdownRenderer}
									/>
								</div>
							)}
						</div>
					)}
					{isFeedback && feedback && !feedback.correct && (
						<div className={styles.feedback}>{t("challenge.queuedAgain")}</div>
					)}
					{isSpelling && !isFeedback && (
						<label className={styles.inputGroup}>
							<span>{t("spelling.inputInstruction")}</span>
							<FlashcardInput
								ref={inputRef}
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void submitSpelling(input);
									}
								}}
								disabled={isTransitioning}
								spellCheck={false}
								autoComplete="off"
								autoCapitalize="none"
								autoCorrect="off"
							/>
						</label>
					)}
				</div>
			</div>
			<div className={cls("flashcard-footer", styles.footer)}>
				{isFeedback ? (
					<FlashcardButton
						variant="primary"
						size="lg"
						onClick={() => void continueAfterFeedback()}
						disabled={isTransitioning}
					>
						{t("challenge.continueAnswer")}
					</FlashcardButton>
				) : isSpelling ? (
					<>
						<FlashcardButton
							variant="secondary"
							size="lg"
							icon={Lightbulb}
							onClick={() => void submitSpelling("", true)}
							disabled={isTransitioning}
						>
							{t("challenge.dontKnow")}
						</FlashcardButton>
						<FlashcardButton
							variant="primary"
							size="lg"
							icon={CornerDownLeft}
							onClick={() => void submitSpelling(input)}
							disabled={isTransitioning || input.trim().length === 0}
						>
							{t("challenge.submit")}
						</FlashcardButton>
					</>
				) : !showAnswer ? (
					<FlashcardButton
						preset="show"
						variant="primary"
						size="lg"
						disabled={isTransitioning}
						onClick={() => setAnswerVisible(true)}
					>
						{t("challenge.showAnswer")}{" "}
						<span className="flashcard-shortcut">({t("common.space")})</span>
					</FlashcardButton>
				) : (
					<div className={styles.answerButtons}>
						<FlashcardButton
							preset="practice-wrong"
							size="lg"
							disabled={isTransitioning}
							onClick={() => void answer(false)}
						>
							<X size={18} />
							{t("challenge.wrong")}
						</FlashcardButton>
						<FlashcardButton
							preset="practice-correct"
							size="lg"
							disabled={isTransitioning}
							onClick={() => void answer(true)}
						>
							<Check size={18} />
							{t("challenge.correct")}
						</FlashcardButton>
					</div>
				)}
			</div>
		</div>
	);
});
