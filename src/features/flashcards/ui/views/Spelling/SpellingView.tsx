import type { CardMotion } from "../../answerPresentationTransition";
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Feedback status regions contain structured block-level diff content. */
import React, { useCallback, useEffect, useRef, useState, useId } from "react";
import { Check, CornerDownLeft, Lightbulb, X } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import type {
	ActiveSpellingSnapshot,
	SpellingLifecycleFeedback,
} from "../../../domain/sessions/sessionLifecycle";
import { useFlashcardI18n } from "../../../strings/context";
import type { AnswerPresentationTransition } from "../../answerPresentationTransition";
import { useSessionInputVisibility } from "../../hooks/useSessionInputVisibility";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { CardExplanationPanel, CardQuestionPanel } from "../../presentation/CardPanels";
import { CardPresentationStack } from "../../presentation/CardPresentationStack";
import { useCardPresentationDependencies } from "../../presentation/context";
import styles from "./Spelling.module.scss";

const DIFF_CLASSES = {
	correct: styles.diffCorrect,
	incorrect: styles.diffIncorrect,
	extra: styles.diffExtra,
	missing: styles.diffMissing,
};

interface SpellingViewProps {
	session: ActiveSpellingSnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	cardMotion?: CardMotion;
	feedback: Readonly<SpellingLifecycleFeedback> | null;
	onEditCard: (deckId: string, cardId: string) => void;
	onDeleteCard: (deckId: string, cardId: string) => void;
	onClose: () => void;
}

export const SpellingView = React.memo(function SpellingView(props: SpellingViewProps) {
	const { session } = props;
	const baseQuestion = JSON.stringify([
		session.reference.key,
		session.currentCard.identity,
		session.currentCard.front,
		session.currentCard.back,
		session.progress.completed,
	]);
	const [encounter, setEncounter] = useState({
		baseQuestion,
		phase: session.phase,
		generation: 0,
	});
	// A repeated failed card can return to retrieval without changing content or progress.
	// Adjust this component's state before committing the next question subtree.
	if (encounter.baseQuestion !== baseQuestion || encounter.phase !== session.phase) {
		setEncounter({
			baseQuestion,
			phase: session.phase,
			generation:
				encounter.baseQuestion !== baseQuestion
					? 0
					: encounter.generation +
						(encounter.phase === "correction" && session.phase === "retrieval" ? 1 : 0),
		});
	}
	const question = JSON.stringify([baseQuestion, encounter.generation]);
	return <SpellingQuestion key={question} question={question} {...props} />;
});

const SpellingQuestion = React.memo(function SpellingQuestion({
	question,
	session,
	transition,
	isTransitioning,
	cardMotion,
	feedback,
	onEditCard,
	onDeleteCard,
	onClose,
}: SpellingViewProps & { question: string }) {
	const { t } = useFlashcardI18n();
	const { pronunciationRuntime } = useCardPresentationDependencies();
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const feedbackId = useId();
	const viewRef = useRef<HTMLDivElement>(null);
	const currentCard = session.currentCard;

	const { keepInputVisible, handleInputBlur, captureReturn } = useSessionInputVisibility(
		inputRef,
		viewRef,
		question,
	);

	useEffect(() => {
		pronunciationRuntime.stop();
		return () => pronunciationRuntime.stop();
	}, [pronunciationRuntime]);

	const submit = useCallback(
		async (submittedInput: string, allowEmpty = false) => {
			if (!currentCard) return;
			if (!allowEmpty && submittedInput.trim().length === 0) return;
			const inputReturn = captureReturn();
			const outcome = await transition.act({
				kind: "spelling-answer",
				reference: session.reference,
				input: submittedInput,
			});
			if (outcome.kind !== "applied" || !outcome.feedback) return;

			if (
				outcome.feedback.kind === "retrieval-incorrect" ||
				outcome.feedback.kind === "correction-incorrect"
			) {
				if (inputReturn.isCurrent()) {
					setInput("");
					inputReturn.focus();
				}
			}
		},
		[captureReturn, currentCard, transition, session.reference],
	);

	if (!currentCard) {
		return <div className="flashcard-complete">{t("common.loading")}</div>;
	}

	const completed = session.progress.completed;
	const total = session.progress.total;
	const progressPercent = session.progress.percent;
	const isCorrection = session.phase === "correction";
	const isCorrectFeedback =
		feedback?.kind === "retrieval-correct" || feedback?.kind === "correction-correct";

	return (
		<SessionLayout
			rootRef={viewRef}
			busy={isTransitioning}
			className={styles.spellingView}
			motion={cardMotion}
			header={
				<SessionToolbar
					mode={t("spelling.title")}
					busy={isTransitioning}
					deckName={session.originDeck.name}
					progress={`${completed}/${total}`}
					progressPercent={progressPercent}
					startTime={session.startTime}
					onEdit={() => onEditCard(currentCard.currentDeckId, currentCard.identity)}
					onDelete={() => onDeleteCard(currentCard.currentDeckId, currentCard.identity)}
					onClose={onClose}
					editTitle={t("cardEditor.editCurrentTitle")}
					deleteTitle={t("cardEditor.deleteCurrentTitle")}
					closeTitle={t("spelling.exitTitle")}
				/>
			}
			footer={
				<>
					{!isCorrection && (
						<FlashcardButton
							data-session-input-action=""
							variant="secondary"
							size="lg"
							icon={Lightbulb}
							onClick={() => void submit("", true)}
							disabled={isTransitioning}
						>
							{t("spelling.dontKnow")}
						</FlashcardButton>
					)}
					<FlashcardButton
						data-session-input-action=""
						variant="primary"
						size="lg"
						icon={CornerDownLeft}
						onClick={() => void submit(input)}
						disabled={isTransitioning || input.trim().length === 0}
					>
						{isCorrection ? t("spelling.confirmCorrection") : t("spelling.submit")}
					</FlashcardButton>
				</>
			}
		>
			<CardPresentationStack key={currentCard.identity}>
				<CardQuestionPanel
					block={{
						label: "spelling.meaningPrompt",
						content: currentCard.back,
						pronunciationWord: null,
					}}
				/>
				{feedback &&
					(feedback.kind === "retrieval-incorrect" ||
						feedback.kind === "correction-incorrect") && (
						<>
							<div
								id={feedbackId}
								role="status"
								className={cls(styles.feedback, styles.isWrong)}
							>
								<div className={styles.feedbackTitle}>
									<X size={18} />
									{feedback.kind === "retrieval-incorrect"
										? t("spelling.incorrect")
										: t("spelling.correctionIncorrect")}
								</div>
								<div className={styles.submittedAnswer}>
									<span>{t("spelling.yourInput")}</span>
									<strong>
										{feedback.submittedInput || t("spelling.noAnswer")}
									</strong>
								</div>
								<div className={styles.diff} aria-label={t("spelling.yourInput")}>
									{feedback.diff.length > 0 ? (
										feedback.diff.map((segment, index) => (
											<span
												key={`${segment.kind}-${index}`}
												className={DIFF_CLASSES[segment.kind]}
												title={segment.expected}
											>
												{segment.value || " "}
											</span>
										))
									) : (
										<span className={styles.emptyAnswer}>
											{t("spelling.noAnswer")}
										</span>
									)}
								</div>
								<div className={styles.correctAnswer}>
									<span>{t("spelling.correctAnswer")}</span>
									<strong>{feedback.expectedAnswer}</strong>
								</div>
							</div>
						</>
					)}

				{isCorrectFeedback && (
					<div
						id={feedbackId}
						role="status"
						className={cls(styles.feedback, styles.isCorrect)}
					>
						<Check size={20} />
						<span>{t("spelling.correct")}</span>
						<strong>{feedback.expectedAnswer}</strong>
					</div>
				)}

				{isCorrection && currentCard.explanation && (
					<CardExplanationPanel
						block={{
							label: "common.explanation",
							content: currentCard.explanation,
							pronunciationWord: null,
						}}
					/>
				)}

				<label className={styles.inputGroup}>
					<span>
						{isCorrection
							? t("spelling.retypeInstruction")
							: t("spelling.inputInstruction")}
					</span>
					<FlashcardInput
						ref={inputRef}
						type="text"
						variant="quiz"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onFocus={keepInputVisible}
						onBlur={handleInputBlur}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.nativeEvent.isComposing &&
								!event.repeat
							) {
								event.preventDefault();
								void submit(input);
							}
						}}
						disabled={isTransitioning}
						spellCheck={false}
						autoComplete="off"
						autoCapitalize="none"
						autoCorrect="off"
						enterKeyHint="done"
						aria-label={t(
							isCorrection
								? "spelling.retypeInstruction"
								: "spelling.inputInstruction",
						)}
						aria-describedby={feedback ? feedbackId : undefined}
						aria-invalid={isCorrection || undefined}
					/>
				</label>
			</CardPresentationStack>
		</SessionLayout>
	);
});
