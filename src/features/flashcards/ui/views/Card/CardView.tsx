import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PartyPopper, RotateCcw } from "lucide-react";
import { Notice } from "obsidian";
import { cls } from "../../../../../core/shared/classNames";
import type { StudyRating } from "../../../../../core/shared/types";
import { getRatingButtons } from "../../../domain/sessions/scheduler";
import { getDisplayCardContent } from "../../../domain/cards/cardDisplay";
import type { ActiveStudySnapshot } from "../../../domain/sessions/sessionLifecycle";
import type { AnswerPresentationTransition } from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { MarkdownContent, PronounceableMarkdown } from "../../primitives/Markdown";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { SessionTimer } from "../../../../../core/ui/primitives/SessionTimer";
import { useWindowKeyDown } from "../../../../../core/ui/hooks/hooks";
import { useFlashcardI18n } from "../../../strings/context";
import {
	shouldAutoPronounceSessionCard,
	type PronunciationRuntime,
} from "../../../domain/pronunciation";
import { extractSpellingWord } from "../../../domain/cards/spellingWord";
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
	onComplete: () => void;
	onEditCard: (deckId: string, cardId: string) => void;
	onDeleteCard: (deckId: string, cardId: string) => void;
	onClose: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
	pronunciationRuntime: PronunciationRuntime;
	pronunciationEnabled: boolean;
}

export const CardView = React.memo(function CardView({
	session,
	transition,
	isTransitioning,
	onComplete,
	onEditCard,
	onDeleteCard,
	onClose,
	markdownRenderer,
	pronunciationRuntime,
	pronunciationEnabled,
}: CardViewProps) {
	const { t, language } = useFlashcardI18n();
	const [answerCardId, setAnswerCardId] = useState<string | null>(null);
	const [autoPronunciationEnabled, setAutoPronunciationEnabled] = useState(false);

	const currentCard = session.currentCard;
	const showAnswer = answerCardId === currentCard.identity;
	const ratingButtons = useMemo(() => getRatingButtons(language), [language]);
	const displayContent = useMemo(
		() => (currentCard ? getDisplayCardContent(currentCard, session.direction) : null),
		[currentCard, session.direction],
	);
	const pronunciationWord =
		pronunciationEnabled && currentCard ? extractSpellingWord(currentCard.front) : null;

	useEffect(() => {
		pronunciationRuntime.stop();
		return () => pronunciationRuntime.stop();
	}, [currentCard.identity, pronunciationRuntime]);

	const shouldAutoPronounce = shouldAutoPronounceSessionCard({
		wordLearningEnabled: pronunciationEnabled,
		autoPlayEnabled: autoPronunciationEnabled,
		direction: session.direction,
		answerVisible: showAnswer,
		word: pronunciationWord,
	});
	const autoPronunciationText = shouldAutoPronounce ? pronunciationWord : null;

	useEffect(() => {
		if (!autoPronunciationText) return;
		void pronunciationRuntime.speak(autoPronunciationText, "auto").catch(() => undefined);
		return () => pronunciationRuntime.stop();
	}, [autoPronunciationText, currentCard.identity, pronunciationRuntime]);

	const handleShowAnswer = useCallback(() => {
		setAnswerCardId(currentCard.identity);
	}, [currentCard.identity]);

	const handleToggleAutoPronunciation = useCallback(() => {
		setAutoPronunciationEnabled((enabled) => !enabled);
	}, []);

	const handleRating = useCallback(
		async (rating: StudyRating) => {
			if (!currentCard || isTransitioning) return;
			const outcome = await transition.act({
				kind: "study-answer",
				reference: session.reference,
				rating,
			});
			if (outcome.kind === "failed") new Notice(outcome.message);
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
		if (outcome.kind === "failed") new Notice(outcome.message);
	}, [isTransitioning, session.canPrevious, session.reference, transition]);

	useWindowKeyDown((e) => {
		// Ignore if in input field
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}

		if (!showAnswer) {
			// Show answer on space
			if (e.code === "Space") {
				e.preventDefault();
				handleShowAnswer();
			}
			return;
		}

		// Rating shortcuts
		switch (e.code) {
			case "Digit1":
			case "Numpad1":
				e.preventDefault();
				void handleRating(1);
				break;
			case "Digit2":
			case "Numpad2":
				e.preventDefault();
				void handleRating(2);
				break;
			case "Digit3":
			case "Numpad3":
			case "Space":
				e.preventDefault();
				void handleRating(3);
				break;
			case "Digit4":
			case "Numpad4":
				e.preventDefault();
				void handleRating(4);
				break;
			case "Digit5":
			case "Numpad5":
				e.preventDefault();
				void handleRating(5);
				break;
			case "Digit6":
			case "Numpad6":
				e.preventDefault();
				void handlePrevious();
				break;
		}
	});

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
		<div className="flashcard-study">
			{/* Header */}
			<SessionToolbar
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

			{/* Content */}
			<div className={`flashcard-content ${isTransitioning ? "animating" : ""}`}>
				<div className="flashcard-card-stack" key={currentCard.identity}>
					<div className="flashcard-question">
						<div className="flashcard-label flashcard-label-question">
							{t("common.question")}
						</div>
						{session.direction === "normal" && pronunciationWord ? (
							<PronounceableMarkdown
								content={displayContent?.prompt ?? ""}
								word={pronunciationWord}
								runtime={pronunciationRuntime}
								markdownRenderer={markdownRenderer}
							/>
						) : (
							<MarkdownContent
								content={displayContent?.prompt ?? ""}
								className="flashcard-markdown"
								markdownRenderer={markdownRenderer}
							/>
						)}
					</div>

					{showAnswer && (
						<div className="flashcard-answer-section">
							<div className="flashcard-divider" />
							<div className="flashcard-answer">
								<div className="flashcard-label flashcard-label-answer">
									{t("common.answer")}
								</div>
								{session.direction === "reversed" && pronunciationWord ? (
									<PronounceableMarkdown
										content={displayContent?.answer ?? ""}
										word={pronunciationWord}
										runtime={pronunciationRuntime}
										markdownRenderer={markdownRenderer}
									/>
								) : (
									<MarkdownContent
										content={displayContent?.answer ?? ""}
										className="flashcard-markdown"
										markdownRenderer={markdownRenderer}
									/>
								)}
							</div>
							{displayContent?.explanation && (
								<div className="flashcard-explanation">
									<div className="flashcard-label flashcard-label-explanation">
										{t("common.explanation")}
									</div>
									<MarkdownContent
										content={displayContent.explanation}
										className="flashcard-markdown"
										markdownRenderer={markdownRenderer}
									/>
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Footer */}
			<div className="flashcard-footer">
				{!showAnswer ? (
					<FlashcardButton
						preset="show"
						variant="primary"
						size="lg"
						onClick={handleShowAnswer}
					>
						{t("common.showAnswer")}
						<span className="flashcard-shortcut">({t("common.space")})</span>
					</FlashcardButton>
				) : (
					<div className={cls("flashcard-response-controls", styles.responseControls)}>
						<FlashcardButton
							preset="prev"
							icon={RotateCcw}
							iconSize={24}
							onClick={handlePrevious}
							disabled={!session.canPrevious}
							title={`${t("common.undo")} (6)`}
						/>
						<div className={cls("flashcard-rating-grid", styles.ratingGrid)}>
							{ratingButtons.map((btn) => (
								<FlashcardButton
									key={btn.rating}
									preset="rating"
									rating={btn.rating}
									className={cls(styles.ratingBtn, RATING_CLASSES[btn.rating])}
									onClick={() => void handleRating(btn.rating)}
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
				)}
			</div>
		</div>
	);
});
