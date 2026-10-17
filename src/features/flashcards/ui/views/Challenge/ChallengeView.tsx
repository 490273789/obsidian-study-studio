import type { CardMotion } from "../../answerPresentationTransition";
import React, { memo, useCallback, useRef, useState } from "react";
import { Check, CornerDownLeft, Lightbulb, X } from "lucide-react";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import type { ActiveChallengeSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { useFlashcardI18n } from "../../../strings/context";
import type { AnswerPresentationTransition } from "../../answerPresentationTransition";
import { useSessionInputVisibility } from "../../hooks/useSessionInputVisibility";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { deriveCardPresentation } from "../../presentation/cardPresentation";
import { CardAnswerSection, CardQuestionPanel } from "../../presentation/CardPanels";
import { CardPresentationStack } from "../../presentation/CardPresentationStack";
import { reportPresentationOutcome } from "../../presentation/presentationOutcome";
import styles from "./Challenge.module.scss";

interface ChallengeViewProps {
	session: ActiveChallengeSnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	cardMotion?: CardMotion;
	onClose: () => void;
}

export const ChallengeView = memo(function ChallengeView(props: ChallengeViewProps) {
	const { session } = props;
	const question = JSON.stringify([
		session.reference.key,
		session.currentCard.identity,
		session.currentCard.front,
		session.currentCard.back,
		session.phase,
	]);
	return <ChallengeQuestion key={question} question={question} {...props} />;
});

const ChallengeQuestion = memo(function ChallengeQuestion({
	question,
	session,
	transition,
	isTransitioning,
	cardMotion,
	onClose,
}: ChallengeViewProps & { question: string }) {
	const { t } = useFlashcardI18n();
	const [answerVisible, setAnswerVisible] = useState(false);
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const viewRef = useRef<HTMLDivElement>(null);
	const currentCard = session.currentCard;
	const isSpelling = session.questionMode === "spelling";
	const feedback = session.feedback;
	const isFeedback = session.phase === "feedback";
	const showAnswer = isFeedback || (!isSpelling && answerVisible);
	const model = deriveCardPresentation({
		card: currentCard,
		direction: session.questionMode === "normal" ? "normal" : "reversed",
		answerVisible: showAnswer,
		questionLabel: isSpelling ? "challenge.spellingPrompt" : "common.question",
		explanation: currentCard.explanation ?? "",
	});

	const { keepInputVisible, handleInputBlur } = useSessionInputVisibility(
		inputRef,
		viewRef,
		question,
		isSpelling && !isFeedback,
	);

	const answer = useCallback(
		async (correct: boolean) => {
			if (isTransitioning || isFeedback) return;
			reportPresentationOutcome(
				await transition.act({
					kind: "challenge-answer",
					reference: session.reference,
					correct,
				}),
			);
		},
		[isFeedback, isTransitioning, session.reference, transition],
	);

	const submitSpelling = useCallback(
		async (value: string, reveal = false) => {
			if (isTransitioning || isFeedback || (!reveal && !value.trim())) return;
			reportPresentationOutcome(
				await transition.act(
					reveal
						? { kind: "challenge-reveal", reference: session.reference }
						: { kind: "challenge-answer", reference: session.reference, input: value },
				),
			);
		},
		[isFeedback, isTransitioning, session.reference, transition],
	);

	const continueAfterFeedback = useCallback(async () => {
		if (isTransitioning || !isFeedback) return;
		reportPresentationOutcome(
			await transition.act({ kind: "challenge-continue", reference: session.reference }),
		);
	}, [isFeedback, isTransitioning, session.reference, transition]);

	const shortcutRootRef = useCardPresentationShortcuts(
		{
			mode: "challenge",
			phase: isFeedback ? "feedback" : "question",
			questionMode: session.questionMode,
			answerVisible: showAnswer,
			busy: isTransitioning,
		},
		(intent) => {
			switch (intent.kind) {
				case "reveal":
					if (!isTransitioning) setAnswerVisible(true);
					break;
				case "answer":
					void answer(intent.correct);
					break;
				case "continue":
					void continueAfterFeedback();
					break;
			}
		},
	);

	const attachRoot = useCallback(
		(node: HTMLDivElement | null) => {
			viewRef.current = node;
			shortcutRootRef(node);
		},
		[shortcutRootRef],
	);

	return (
		<SessionLayout
			rootRef={attachRoot}
			busy={isTransitioning}
			className={styles.view}
			motion={cardMotion}
			header={
				<SessionToolbar
					mode={t("challenge.level", { current: session.roundProgress.level })}
					deckName={t("challenge.title")}
					progress={t("challenge.levelProgress", {
						passed: session.roundProgress.passedInLevel,
						total: session.roundProgress.currentLevelTotal,
					})}
					progressPercent={
						session.roundProgress.currentLevelTotal > 0
							? (session.roundProgress.passedInLevel /
									session.roundProgress.currentLevelTotal) *
								100
							: 0
					}
					startTime={session.startTime}
					busy={isTransitioning}
					onClose={onClose}
					closeTitle={t("challenge.exitTitle")}
					metrics={
						<>
							<span>
								{t("challenge.roundProgress", {
									passed: session.roundProgress.completedAcrossRound,
									total: session.roundProgress.totalAcrossRound,
								})}
							</span>
							<span>
								{t("challenge.source", { deckName: session.sourceDeck.name })}
							</span>
							{session.removedCardCount > 0 && (
								<output>
									{t("challenge.removedCards", {
										count: session.removedCardCount,
									})}
								</output>
							)}
						</>
					}
				/>
			}
			footer={
				<>
					{isFeedback ? (
						<FlashcardButton
							variant="primary"
							size="lg"
							onClick={() => void continueAfterFeedback()}
							data-session-input-action=""
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
								data-session-input-action=""
								disabled={isTransitioning}
							>
								{t("challenge.dontKnow")}
							</FlashcardButton>
							<FlashcardButton
								variant="primary"
								size="lg"
								icon={CornerDownLeft}
								onClick={() => void submitSpelling(input)}
								data-session-input-action=""
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
							onClick={() => {
								if (!isTransitioning) setAnswerVisible(true);
							}}
						>
							{t("challenge.showAnswer")}{" "}
							<span className="flashcard-shortcut">({t("common.space")})</span>
						</FlashcardButton>
					) : (
						<div className={styles.answerButtons}>
							<FlashcardButton
								preset="practice-wrong"
								className={styles.btnWrong}
								size="lg"
								disabled={isTransitioning}
								onClick={() => void answer(false)}
							>
								<span className={styles.btnIcon}>
									<X size={18} />
								</span>
								<span className="flashcard-practice-btn-label">
									{t("challenge.wrong")}
								</span>
								<span className="flashcard-shortcut">
									{t("challenge.wrongShortcut")}
								</span>
							</FlashcardButton>
							<FlashcardButton
								preset="practice-correct"
								className={styles.btnCorrect}
								size="lg"
								disabled={isTransitioning}
								onClick={() => void answer(true)}
							>
								<span className={styles.btnIcon}>
									<Check size={18} />
								</span>
								<span className="flashcard-practice-btn-label">
									{t("challenge.correct")}
								</span>
								<span className="flashcard-shortcut">
									{t("challenge.correctShortcut")}
								</span>
							</FlashcardButton>
						</div>
					)}
				</>
			}
		>
			<CardPresentationStack key={currentCard.identity}>
				<CardQuestionPanel block={model.question} />
				{model.answer ? (
					<CardAnswerSection answer={model.answer} explanation={model.explanation} />
				) : null}
				{isFeedback && feedback && (
					<output className={styles.feedback}>
						<X size={18} />
						{t("challenge.queuedAgain")}
					</output>
				)}
				{isSpelling && !isFeedback && (
					<label className={styles.inputGroup}>
						<span>{t("spelling.inputInstruction")}</span>
						<FlashcardInput
							ref={inputRef}
							variant="quiz"
							value={input}
							onFocus={keepInputVisible}
							onBlur={handleInputBlur}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.nativeEvent.isComposing &&
									!event.repeat
								) {
									event.preventDefault();
									void submitSpelling(input);
								}
							}}
							disabled={isTransitioning}
							spellCheck={false}
							autoComplete="off"
							autoCapitalize="none"
							autoCorrect="off"
							aria-label={t("spelling.inputInstruction")}
							enterKeyHint="done"
						/>
					</label>
				)}
			</CardPresentationStack>
		</SessionLayout>
	);
});
