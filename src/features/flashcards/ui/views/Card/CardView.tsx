import type { CardMotion } from "../../answerPresentationTransition";
import React, { useMemo } from "react";
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
import { sessionSurfaceFooter } from "../../primitives/SessionSurfaceFooter";
import { SessionTimer } from "../../../../../core/ui/primitives/SessionTimer";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import { useSessionSurface } from "../../hooks/useSessionSurface";
import { useFlashcardI18n } from "../../../strings/context";
import { deriveCardPresentation } from "../../presentation/cardPresentation";
import { CardPresentationBody } from "../../presentation/CardPresentationBody";
import { autoPronunciationControl } from "../../presentation/sessionSurface";
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
	const { answerVisible: showAnswer, pronunciationWord } = cardPresentation;
	const surface = useSessionSurface({
		transition,
		reference: session.reference,
		onOutcome: (outcome) => {
			if (outcome.kind === "applied" && outcome.studyCompleted) onComplete();
		},
	});

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
					void surface.act({ kind: "reveal" });
					break;
				case "rate":
					void surface.act({ kind: "rate", rating: intent.rating });
					break;
				case "previous":
					void surface.act({ kind: "previous" });
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
						() => void surface.act({ kind: "toggle-auto-pronunciation" }),
						t("pronunciation.autoEnable"),
						t("pronunciation.autoDisable"),
					)}
				/>
			}
			footer={sessionSurfaceFooter({
				busy: isTransitioning,
				answerVisible: showAnswer,
				onReveal: () => void surface.act({ kind: "reveal" }),
				revealLabel: t("common.showAnswer"),
				shortcutLabel: t("common.space"),
				children: (
					<div className={cls("flashcard-response-controls", styles.responseControls)}>
						<FlashcardButton
							preset="prev"
							icon={RotateCcw}
							iconSize={24}
							onClick={() => void surface.act({ kind: "previous" })}
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
									className={cls(styles.ratingBtn, RATING_CLASSES[btn.rating])}
									disabled={isTransitioning}
									onClick={() =>
										void surface.act({ kind: "rate", rating: btn.rating })
									}
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
			<CardPresentationBody
				model={model}
				encounterKey={JSON.stringify([currentCard.identity, session.answerEventCount])}
			/>
		</SessionLayout>
	);
});
