import type { CardMotion } from "../../answerPresentationTransition";
import React from "react";
import { RotateCcw, X, Check } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { ActivePracticeSnapshot } from "../../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardPresentationSnapshot,
	PresentedCard,
} from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { autoPronunciationControl } from "../../presentation/cardPresentation";
import { CardSurface } from "../../presentation/CardSurface";
import styles from "./Practice.module.scss";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { sessionSurfaceFooter } from "../../primitives/SessionSurfaceFooter";
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
	presentedCard: PresentedCard;
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
	presentedCard,
}: PracticeViewProps) {
	const { t } = useFlashcardI18n();
	const { answerVisible: showAnswer, pronunciationWord } = cardPresentation;

	const handleReveal = () => {
		void transition.act({ kind: "card-reveal", reference: session.reference });
	};

	const handleAnswer = (correct: boolean) => {
		void transition.act({
			kind: "practice-answer",
			reference: session.reference,
			correct,
		});
	};

	const handlePrevious = () => {
		void transition.act({ kind: "practice-previous", reference: session.reference });
	};

	const handleToggleAutoPronunciation = () => {
		void transition.act({
			kind: "card-toggle-auto-pronunciation",
			reference: session.reference,
		});
	};

	const currentCard = session.currentCard;

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
					handleReveal();
					break;
				case "answer":
					handleAnswer(intent.correct);
					break;
				case "previous":
					handlePrevious();
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
					autoPronunciation={autoPronunciationControl(
						cardPresentation,
						handleToggleAutoPronunciation,
						t("pronunciation.autoEnable"),
						t("pronunciation.autoDisable"),
					)}
				/>
			}
			footer={sessionSurfaceFooter({
				busy: isTransitioning,
				answerVisible: showAnswer,
				onReveal: handleReveal,
				revealLabel: t("common.showAnswer"),
				shortcutLabel: t("common.space"),
				children: (
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
								onClick={() => handleAnswer(false)}
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
								onClick={() => handleAnswer(true)}
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
				),
			})}
		>
			<CardSurface
				presented={presentedCard}
				answerVisible={showAnswer}
				pronunciationWord={pronunciationWord}
			/>
		</SessionLayout>
	);
});
