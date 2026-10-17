import type { CardMotion } from "../../answerPresentationTransition";
import React, { useCallback, useMemo } from "react";
import { PartyPopper, RotateCcw } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import { getRatingButtons } from "../../../domain/sessions/scheduler";
import type { ActiveStudySnapshot } from "../../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardPresentationSnapshot,
} from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { SessionTimer } from "../../../../../core/ui/primitives/SessionTimer";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import { useFlashcardI18n } from "../../../strings/context";
import { deriveCardPresentation } from "../../presentation/cardPresentation";
import { CardPresentationBody } from "../../presentation/CardPresentationBody";
import { reportPresentationOutcome } from "../../presentation/presentationOutcome";
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
}: CardViewProps) {
	const { t, language } = useFlashcardI18n();
	const {
		answerVisible: showAnswer,
		autoPronunciationEnabled,
		pronunciationEnabled,
		pronunciationWord,
	} = cardPresentation;

	const currentCard = session.currentCard;
	const ratingButtons = useMemo(() => getRatingButtons(language), [language]);
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

	const handleRating = useCallback(
		async (rating: StudyRating) => {
			if (!currentCard || isTransitioning) return;
			const outcome = await transition.act({
				kind: "study-answer",
				reference: session.reference,
				rating,
			});
			reportPresentationOutcome(outcome);
			if (outcome.kind === "applied" && outcome.studyCompleted) onComplete();
		},
		[currentCard, isTransitioning, onComplete, session.reference, transition],
	);

	const handlePrevious = useCallback(async () => {
		if (!session.canPrevious || isTransitioning) return;
		const outcome = await transition.act({
			kind: "study-previous",
			reference: session.reference,
		});
		reportPresentationOutcome(outcome);
	}, [isTransitioning, session.canPrevious, session.reference, transition]);

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
					handleShowAnswer();
					break;
				case "rate":
					void handleRating(intent.rating);
					break;
				case "previous":
					void handlePrevious();
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
							className={cls("flashcard-response-controls", styles.responseControls)}
						>
							<FlashcardButton
								preset="prev"
								icon={RotateCcw}
								iconSize={24}
								onClick={handlePrevious}
								disabled={!session.canPrevious || isTransitioning}
								title={`${t("common.undo")} (6)`}
							/>
							<div className={cls("flashcard-rating-grid", styles.ratingGrid)}>
								{ratingButtons.map((btn) => (
									<FlashcardButton
										key={btn.rating}
										size="lg"
										preset="rating"
										rating={btn.rating}
										className={cls(
											styles.ratingBtn,
											RATING_CLASSES[btn.rating],
										)}
										disabled={isTransitioning}
										onClick={() => void handleRating(btn.rating)}
										aria-label={`${btn.label}，${btn.intervalDesc}，${btn.shortcut}`}
									>
										<span
											className={cls(
												"flashcard-rating-meta",
												styles.ratingMeta,
											)}
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
