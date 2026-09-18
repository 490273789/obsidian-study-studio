import React, { memo } from "react";
import { Check, CircleX, House, Keyboard, RotateCw, Target, Timer } from "lucide-react";
import type {
	SpellingIncorrectCardSnapshot,
	SpellingResultSnapshot,
} from "../../../domain/sessions/sessionLifecycle";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { Confetti } from "../../../../../core/ui/primitives/Confetti";
import { MarkdownContent } from "../../primitives/Markdown";
import { cls } from "../../../../../core/shared/classNames";
import { useFlashcardI18n } from "../../../strings/context";
import { formatCompactDuration } from "../../../strings/index";
import spellingStyles from "./Spelling.module.scss";
import practiceStyles from "../Practice/Practice.module.scss";

interface SpellingSummaryProps {
	result: SpellingResultSnapshot;
	onRetryIncorrect: () => void;
	onRestart: () => void;
	onHome: () => void;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}

export const SpellingSummary = React.memo(function SpellingSummary({
	result,
	onRetryIncorrect,
	onRestart,
	onHome,
	markdownRenderer,
}: SpellingSummaryProps) {
	const { t, language } = useFlashcardI18n();
	const incorrectCards = result.incorrectCards;

	return (
		<div
			className={cls(
				"flashcard-practice-summary flashcard-spelling-summary fc-page fc-page--fill",
				practiceStyles.summary,
			)}
		>
			<Confetti />
			<FlashcardHeader icon={Keyboard} title={t("spelling.title")} onBack={onHome} />
			<div className={cls("flashcard-practice-summary-scroll", practiceStyles.summaryScroll)}>
				<div
					className={cls(
						"flashcard-practice-summary-header",
						practiceStyles.summaryHeader,
					)}
				>
					<div className={practiceStyles.summaryTitle}>
						{result.firstTryIncorrectCount === 0
							? t("spelling.completePerfect")
							: t("spelling.completeWithErrors")}
					</div>
					<div className={practiceStyles.summaryDeck}>
						{t("spelling.summaryDeck", {
							deckName: result.originDeck.name,
							totalWords: result.totalWords,
							time: formatCompactDuration(language, result.timeSpent),
						})}
					</div>
				</div>

				<div
					className={cls("flashcard-practice-summary-stats", practiceStyles.summaryStats)}
				>
					<div
						className={cls(
							"flashcard-practice-stat-card flashcard-practice-stat-accuracy",
							practiceStyles.statCard,
						)}
					>
						<div className={practiceStyles.statValue}>
							{result.firstTryAccuracy.toFixed(1)}%
						</div>
						<div className={practiceStyles.statLabel}>
							{t("spelling.firstTryAccuracy")}
						</div>
					</div>
					<div className={cls("flashcard-practice-stat-row", practiceStyles.statRow)}>
						<SummaryStat
							icon={Check}
							label={t("spelling.firstTryCorrect")}
							value={result.firstTryCorrectCount}
						/>
						<SummaryStat
							icon={CircleX}
							label={t("spelling.firstTryIncorrect")}
							value={result.firstTryIncorrectCount}
						/>
						<SummaryStat
							icon={Target}
							label={t("spelling.totalAttempts")}
							value={result.totalRetrievalAttempts}
						/>
						<SummaryStat
							icon={Timer}
							label={t("practice.timeSpent")}
							value={formatCompactDuration(language, result.timeSpent)}
						/>
					</div>
				</div>

				{incorrectCards.length > 0 && (
					<div
						className={cls(
							"flashcard-practice-incorrect-section",
							practiceStyles.incorrectSection,
						)}
					>
						<h3 className={practiceStyles.incorrectTitle}>
							<CircleX size={16} />{" "}
							{t("spelling.incorrectList", {
								count: incorrectCards.length,
							})}
						</h3>
						<div className={practiceStyles.incorrectList}>
							{incorrectCards.map((card, index) => (
								<IncorrectSpellingItem
									key={card.identity}
									card={card}
									index={index + 1}
									markdownRenderer={markdownRenderer}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			<div
				className={cls("flashcard-practice-summary-actions", practiceStyles.summaryActions)}
			>
				{incorrectCards.length > 0 && (
					<FlashcardButton variant="danger" icon={CircleX} onClick={onRetryIncorrect}>
						{t("spelling.retryIncorrect", {
							count: incorrectCards.length,
						})}
					</FlashcardButton>
				)}
				<FlashcardButton variant="primary" icon={RotateCw} onClick={onRestart}>
					{t("spelling.chooseAgain")}
				</FlashcardButton>
				<FlashcardButton variant="secondary" icon={House} onClick={onHome}>
					{t("practice.home")}
				</FlashcardButton>
			</div>
		</div>
	);
});

function SummaryStat({
	icon: Icon,
	label,
	value,
}: {
	icon: typeof Check;
	label: string;
	value: string | number;
}) {
	return (
		<div className={cls("flashcard-practice-stat-item fc-lift", practiceStyles.statItem)}>
			<span className={practiceStyles.statIcon}>
				<Icon size={14} />
			</span>
			<span className={practiceStyles.statText}>
				{label}
				<strong>{value}</strong>
			</span>
		</div>
	);
}

const IncorrectSpellingItem = memo(function IncorrectSpellingItem({
	card,
	index,
	markdownRenderer,
}: {
	card: SpellingIncorrectCardSnapshot;
	index: number;
	markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
}) {
	const { t } = useFlashcardI18n();
	return (
		<div
			className={cls(
				"flashcard-practice-incorrect-item fc-lift",
				practiceStyles.incorrectItem,
			)}
		>
			<div className={practiceStyles.incorrectIndex}>{index}</div>
			<div className={practiceStyles.incorrectContent}>
				<div className={practiceStyles.incorrectQuestion}>
					<span className={practiceStyles.incorrectLabel}>
						{t("spelling.meaningPrompt")}
					</span>
					<MarkdownContent
						content={card.back}
						className={practiceStyles.incorrectText}
						markdownRenderer={markdownRenderer}
					/>
				</div>
				<div className={spellingStyles.summaryAnswerRow}>
					<span>
						{t("spelling.firstInput")}: <strong>{card.firstInput || "—"}</strong>
					</span>
					<span>
						{t("spelling.correctAnswer")}: <strong>{card.expectedAnswer}</strong>
					</span>
				</div>
			</div>
		</div>
	);
});
