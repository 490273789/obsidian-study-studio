import type { CardMotion } from "../../answerPresentationTransition";
import React, { useMemo } from "react";
import { PartyPopper, RotateCcw } from "lucide-react";
import { Notice } from "obsidian";
import { cls } from "../../../../../core/shared/classNames";
import type { RatingButton, StudyRating } from "../../../../../core/shared/types";
import { getLocalizedRatingButtons } from "../../../strings";
import type { ActiveStudySnapshot } from "../../../domain/sessions/sessionLifecycle";
import { normalizePronunciationText } from "../../../domain/pronunciation";
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
import { useCardPresentationDependencies } from "../../presentation/context";
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
	const { pronunciationRuntime } = useCardPresentationDependencies();
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

	const handlePronounce = () => {
		if (!pronunciationWord) return;
		const normalized = normalizePronunciationText(pronunciationWord);
		if (!normalized) return;
		void pronunciationRuntime.speak(normalized, "manual");
	};

	const handlePrevious = async () => {
		const outcome = await transition.act({
			kind: "study-previous",
			reference: session.reference,
		});
		if (outcome.kind === "applied") {
			new Notice(t("study.undone"));
		}
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
					void handlePrevious();
					break;
				case "pronounce":
					handlePronounce();
					break;
				case "close":
					onClose();
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

	const renderRatingButton = (btn: RatingButton) => (
		<FlashcardButton
			key={btn.rating}
			size="lg"
			preset="rating"
			rating={btn.rating}
			className={cls(styles.ratingBtn, RATING_CLASSES[btn.rating])}
			disabled={isTransitioning}
			onClick={() => void handleRate(btn.rating)}
			title={
				btn.rating === 3
					? `${btn.label} (${t("common.space")} / 3)`
					: `${btn.label} (${btn.shortcut})`
			}
			aria-label={[
				btn.label,
				btn.intervalDesc,
				btn.rating === 3 ? `${t("common.space")} / 3` : btn.shortcut,
			]
				.filter(Boolean)
				.join(", ")}
		>
			<span className={cls("flashcard-rating-meta", styles.ratingMeta)}>
				<span className={styles.ratingDot} aria-hidden="true" />
				<span className={cls("flashcard-rating-label", styles.ratingLabel)}>
					{btn.label}
				</span>
				<span className={cls("flashcard-rating-interval", styles.ratingInterval)}>
					{btn.rating === 3 ? t("common.space") : btn.shortcut}
				</span>
			</span>
			{btn.intervalDesc && (
				<span className={cls("flashcard-rating-duration", styles.ratingDuration)}>
					{btn.intervalDesc}
				</span>
			)}
		</FlashcardButton>
	);

	const undoButton = (
		<FlashcardButton
			preset="prev"
			icon={RotateCcw}
			iconSize={18}
			className={styles.undoBtn}
			onClick={handlePrevious}
			disabled={!session.canPrevious || isTransitioning}
			title={`${t("common.undo")} (Z / Backspace)`}
			aria-label={`${t("common.undo")} (Z / Backspace)`}
		>
			<span className={styles.undoShortcut} aria-hidden="true">
				Z
			</span>
		</FlashcardButton>
	);

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
					closeTitle={`${t("common.close")} (Esc)`}
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
				leadingAction: session.canPrevious ? undoButton : undefined,
				children: (
					<div className={cls(styles.responseControls)}>
						{undoButton}
						<div className={cls(styles.ratingGrid)}>
							{ratingButtons.map(renderRatingButton)}
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
