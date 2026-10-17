import type { CardMotion } from "../../answerPresentationTransition";
import React, { useCallback, useMemo } from "react";
import { RotateCcw, X, Check } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { ActivePracticeSnapshot } from "../../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardPresentationSnapshot,
} from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { deriveCardPresentation } from "../../presentation/cardPresentation";
import { CardPresentationBody } from "../../presentation/CardPresentationBody";
import { reportPresentationOutcome } from "../../presentation/presentationOutcome";
import styles from "./Practice.module.scss";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import { useFlashcardI18n } from "../../../strings/context";

interface PracticeViewProps {
	session: ActivePracticeSnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	cardMotion?: CardMotion;
	onEditCard: (deckId: string, cardId: string) => void;
	onDeleteCard: (deckId: string, cardId: string) => void;
	onClose: () => void;
	cardPresentation: CardPresentationSnapshot;
}

export const PracticeView = React.memo(function PracticeView({
	session,
	transition,
	isTransitioning,
	cardMotion,
	onEditCard,
	onDeleteCard,
	onClose,
	cardPresentation,
}: PracticeViewProps) {
	const { t } = useFlashcardI18n();
	const {
		answerVisible: showAnswer,
		autoPronunciationEnabled,
		pronunciationEnabled,
		pronunciationWord,
	} = cardPresentation;

	const currentCard = session.currentCard;
	const model = useMemo(
		() =>
			deriveCardPresentation({
				card: currentCard ?? null,
				direction: session.direction,
				answerVisible: showAnswer,
				pronunciationWord,
			}),
		[currentCard, session.direction, showAnswer, pronunciationWord],
	);

	const handleShowAnswer = useCallback(() => {
		if (isTransitioning) return;
		void transition.act({ kind: "card-reveal", reference: session.reference });
	}, [isTransitioning, session.reference, transition]);

	const handleToggleAutoPronunciation = useCallback(() => {
		if (isTransitioning) return;
		void transition.act({
			kind: "card-toggle-auto-pronunciation",
			reference: session.reference,
		});
	}, [isTransitioning, session.reference, transition]);

	const handleAnswer = useCallback(
		async (isCorrect: boolean) => {
			if (!currentCard || isTransitioning) return;
			const outcome = await transition.act({
				kind: "practice-answer",
				reference: session.reference,
				correct: isCorrect,
			});
			reportPresentationOutcome(outcome);
		},
		[currentCard, isTransitioning, session.reference, transition],
	);

	const handlePrevious = useCallback(async () => {
		if (!session.canPrevious || isTransitioning) return;
		const outcome = await transition.act({
			kind: "practice-previous",
			reference: session.reference,
		});
		reportPresentationOutcome(outcome);
	}, [isTransitioning, session.canPrevious, session.reference, transition]);

	const shortcutRootRef = useCardPresentationShortcuts(
		{
			mode: "practice",
			answerVisible: showAnswer,
			canPrevious: session.canPrevious,
			busy: isTransitioning,
		},
		(intent) => {
			switch (intent.kind) {
				case "reveal":
					handleShowAnswer();
					break;
				case "answer":
					void handleAnswer(intent.correct);
					break;
				case "previous":
					void handlePrevious();
					break;
			}
		},
	);

	if (!currentCard) {
		return (
			<div className="flashcard-complete">
				<div className="flashcard-complete-icon">⏳</div>
				<div>{t("common.loading")}</div>
			</div>
		);
	}

	const progress = session.progress.label;
	const progressPercent = session.progress.percent;
	return (
		<SessionLayout
			rootRef={shortcutRootRef}
			busy={isTransitioning}
			motion={cardMotion}
			header={
				<SessionToolbar
					mode={t("practice.title")}
					busy={isTransitioning}
					deckName={session.originDeck.name}
					progress={progress}
					progressPercent={progressPercent}
					startTime={session.startTime}
					onEdit={() => onEditCard(currentCard.currentDeckId, currentCard.identity)}
					onDelete={() => onDeleteCard(currentCard.currentDeckId, currentCard.identity)}
					onClose={onClose}
					editTitle={t("cardEditor.editCurrentTitle")}
					deleteTitle={t("cardEditor.deleteCurrentTitle")}
					closeTitle={t("practice.exitTitle")}
					autoPronunciation={
						pronunciationEnabled
							? {
									enabled: autoPronunciationEnabled,
									onToggle: handleToggleAutoPronunciation,
									enableTitle: t("pronunciation.autoEnable"),
									disableTitle: t("pronunciation.autoDisable"),
								}
							: undefined
					}
				/>
			}
			footer={
				<>
					{!showAnswer ? (
						<FlashcardButton
							preset="show"
							variant="primary"
							size="lg"
							onClick={handleShowAnswer}
							disabled={isTransitioning}
						>
							{t("common.showAnswer")}
							<span className="flashcard-shortcut">({t("common.space")})</span>
						</FlashcardButton>
					) : (
						<div
							className={cls(
								"flashcard-practice-response-controls",
								styles.responseControls,
							)}
						>
							<FlashcardButton
								preset="prev"
								icon={RotateCcw}
								iconSize={24}
								onClick={handlePrevious}
								disabled={!session.canPrevious || isTransitioning}
								title={`${t("common.undo")} (6)`}
							/>
							<div
								className={cls(
									"flashcard-practice-answer-buttons",
									styles.answerButtons,
								)}
							>
								<FlashcardButton
									preset="practice-wrong"
									className={styles.btnWrong}
									size="lg"
									disabled={isTransitioning}
									onClick={() => void handleAnswer(false)}
								>
									<span className={styles.btnIcon}>
										<X size={18} />
									</span>
									<span className="flashcard-practice-btn-label">
										{t("practice.bad")}
									</span>
									<span className="flashcard-shortcut">
										{t("practice.badShortcut")}
									</span>
								</FlashcardButton>
								<FlashcardButton
									preset="practice-correct"
									className={styles.btnCorrect}
									size="lg"
									disabled={isTransitioning}
									onClick={() => void handleAnswer(true)}
								>
									<span className={styles.btnIcon}>
										<Check size={18} />
									</span>
									<span className="flashcard-practice-btn-label">
										{t("practice.good")}
									</span>
									<span className="flashcard-shortcut">
										{t("practice.goodShortcut")}
									</span>
								</FlashcardButton>
							</div>
						</div>
					)}
				</>
			}
		>
			<CardPresentationBody
				model={model}
				encounterKey={JSON.stringify([currentCard.identity, session.answerEventCount])}
			/>
		</SessionLayout>
	);
});
