import type { CardMotion } from "../../answerPresentationTransition";
import React, { useCallback, useMemo } from "react";
import { RotateCcw, X, Check } from "lucide-react";
import { Notice } from "obsidian";
import { cls } from "../../../../../core/shared/classNames";
import { getDisplayCardContent } from "../../../domain/cards/cardDisplay";
import type { ActivePracticeSnapshot } from "../../../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardPresentationSnapshot,
} from "../../answerPresentationTransition";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { MarkdownContent, PronounceableMarkdown } from "../../primitives/Markdown";
import styles from "./Practice.module.scss";
import { SessionLayout } from "../../primitives/SessionLayout/SessionLayout";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { useCardPresentationShortcuts } from "../../hooks/useCardPresentationShortcuts";
import { useFlashcardI18n } from "../../../strings/context";
import { useCardContextMenu } from "../../hooks/useCardContextMenu";
import type { PronunciationRuntime } from "../../../domain/pronunciation";

interface PracticeViewProps {
	session: ActivePracticeSnapshot;
	transition: AnswerPresentationTransition;
	isTransitioning: boolean;
	cardMotion?: CardMotion;
	onEditCard: (deckId: string, cardId: string) => void;
	onDeleteCard: (deckId: string, cardId: string) => void;
	onClose: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
	pronunciationRuntime: PronunciationRuntime;
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
	markdownRenderer,
	pronunciationRuntime,
	cardPresentation,
}: PracticeViewProps) {
	const { t } = useFlashcardI18n();
	const handleContextMenu = useCardContextMenu();
	const {
		answerVisible: showAnswer,
		autoPronunciationEnabled,
		pronunciationEnabled,
		pronunciationWord,
	} = cardPresentation;

	const currentCard = session.currentCard;
	const displayContent = useMemo(
		() => (currentCard ? getDisplayCardContent(currentCard, session.direction) : null),
		[currentCard, session.direction],
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
			if (outcome.kind === "failed") new Notice(outcome.message);
		},
		[currentCard, isTransitioning, session.reference, transition],
	);

	const handlePrevious = useCallback(async () => {
		if (!session.canPrevious || isTransitioning) return;
		const outcome = await transition.act({
			kind: "practice-previous",
			reference: session.reference,
		});
		if (outcome.kind === "failed") new Notice(outcome.message);
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
			<div
				className="flashcard-card-stack"
				key={JSON.stringify([currentCard.identity, session.answerEventCount])}
				onContextMenu={handleContextMenu}
			>
				<div className="flashcard-question fc-panel">
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
						<div className="flashcard-answer fc-panel">
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
							<div className="flashcard-explanation fc-panel">
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
		</SessionLayout>
	);
});
