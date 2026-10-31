import type { CardMotion } from "../../answerPresentationTransition";
import React, { useMemo } from "react";
import { PartyPopper, RotateCcw } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import { getLocalizedRatingButtons } from "../../../strings";
import type { ActiveStudySnapshot } from "../../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardPresentationSnapshot,
	PresentedCard,
} from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { sessionSurfaceFooter } from "../../primitives/SessionSurfaceFooter";
import { SessionTimer } from "../../../../../core/ui/primitives/SessionTimer";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import { useFlashcardI18n } from "../../../strings/context";
import { autoPronunciationControl } from "../../presentation/cardPresentation";
import { CardSurface } from "../../presentation/CardSurface";
import styles from "./CardView.module.scss";

const RATING_CLASSES: Record<StudyRating, string> = {
	1: styles.rating1,
	2: styles.rating2,
	3: styles.rating3,
	4: styles.rating4,
	5: styles.rating5,
};

interface CardViewProps {
	session: ActiveStudySnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	cardMotion?: CardMotion;
	onComplete: () => void;
	onEditCard: (deckId: string, cardId: string) => void;
	onDeleteCard: (deckId: string, cardId: string) => void;
	onClose: () => void;
	cardPresentation: CardPresentationSnapshot;
	presentedCard: PresentedCard;
}

export const CardView = React.memo(function CardView({
	session,
	transition,
	isTransitioning,
	cardMotion,
	onComplete,
	onEditCard,
	onDeleteCard,
	onClose,
	cardPresentation,
	presentedCard,
}: CardViewProps) {
	const { t, language } = useFlashcardI18n();
	const { answerVisible: showAnswer, pronunciationWord } = cardPresentation;

	const handleRate = async (rating: StudyRating) => {
		const outcome = await transition.act({
			kind: "study-answer",
			reference: session.reference,
			rating,
		});
		if (outcome.kind === "applied" && outcome.studyCompleted) onComplete();
	};

	const handleReveal = () => {
		void transition.act({ kind: "card-reveal", reference: session.reference });
	};

	const handleToggleAutoPronunciation = () => {
		void transition.act({
			kind: "card-toggle-auto-pronunciation",
			reference: session.reference,
		});
	};

	const handlePrevious = () => {
		void transition.act({ kind: "study-previous", reference: session.reference });
	};

	const currentCard = session.currentCard;
	const ratingButtons = useMemo(() => getLocalizedRatingButtons(language), [language]);

	const shortcutRootRef = useCardPresentationShortcuts(
		{
			mode: "study",
			answerVisible: showAnswer,
			canPrevious: session.canPrevious,
			busy: isTransitioning,
		},
		(intent) => {
			switch (intent.kind) {
				case "reveal":
					handleReveal();
					break;
				case "rate":
					void handleRate(intent.rating);
					break;
				case "previous":
					handlePrevious();
					break;
			}
		},
	);

	// Check if session is complete
	if (!currentCard) {
		return (
			<div className="flashcard-complete">
				<div className="flashcard-complete-icon">
					<PartyPopper size={48} />
				</div>
				<div>{t("study.complete")}</div>
				<p>
					{t("study.duration")}
					<SessionTimer startTime={session.startTime} />
				</p>
				<FlashcardButton variant="primary" onClick={onClose}>
					{t("study.backToDeck")}
				</FlashcardButton>
			</div>
		);
	}

	const progress = session.progress;
	return (
		<SessionLayout
			rootRef={shortcutRootRef}
			busy={isTransitioning}
			motion={cardMotion}
			header={
				<SessionToolbar
					mode={t("study.title")}
					busy={isTransitioning}
					deckName={session.originDeck.name}
					progress={progress.label}
					progressPercent={progress.percent}
					startTime={session.startTime}
					onEdit={() => onEditCard(currentCard.currentDeckId, currentCard.identity)}
					onDelete={() => onDeleteCard(currentCard.currentDeckId, currentCard.identity)}
					onClose={onClose}
					editTitle={t("cardEditor.editCurrentTitle")}
					deleteTitle={t("cardEditor.deleteCurrentTitle")}
					closeTitle={t("common.close")}
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
					<div className={cls(styles.responseControls)}>
						<FlashcardButton
							preset="prev"
							icon={RotateCcw}
							iconSize={24}
							onClick={handlePrevious}
							disabled={!session.canPrevious || isTransitioning}
							title={`${t("common.undo")} (6)`}
							aria-label={`${t("common.undo")} (6)`}
						/>
						<div className={cls(styles.ratingGrid)}>
							{ratingButtons.map((btn) => (
								<FlashcardButton
									key={btn.rating}
									size="lg"
									preset="rating"
									rating={btn.rating}
									className={cls(styles.ratingBtn, RATING_CLASSES[btn.rating])}
									disabled={isTransitioning}
									onClick={() => void handleRate(btn.rating)}
									aria-label={`${btn.label}，${btn.intervalDesc}，${btn.shortcut}`}
								>
									<span
										className={cls("flashcard-rating-meta", styles.ratingMeta)}
									>
										<span
											className={cls(
												"flashcard-rating-label",
												styles.ratingLabel,
											)}
										>
											{btn.label}
										</span>
										<span
											className={cls(
												"flashcard-rating-interval",
												styles.ratingInterval,
											)}
										>
											{btn.shortcut}
										</span>
									</span>
									<span
										className={cls(
											"flashcard-rating-duration",
											styles.ratingDuration,
										)}
									>
										{btn.intervalDesc}
									</span>
								</FlashcardButton>
							))}
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
