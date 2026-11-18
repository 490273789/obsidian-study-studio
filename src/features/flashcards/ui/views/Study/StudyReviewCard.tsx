import { memo, useId, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import type { SessionCardSnapshot } from "../../../domain/sessions/sessionLifecycle";
import { useFlashcardI18n } from "../../../strings/context";
import { MarkdownContent } from "../../primitives/Markdown/MarkdownContent";
import styles from "./StudySummary.module.scss";

interface StudyReviewCardProps {
	card: Readonly<SessionCardSnapshot>;
	index: number;
	markdownRenderer?: (content: string, el: HTMLElement) => Promise<void>;
	onOpenSourceFile?: (filePath: string) => void;
}

export const StudyReviewCard = memo(function StudyReviewCard({
	card,
	index,
	markdownRenderer,
	onOpenSourceFile,
}: StudyReviewCardProps) {
	const { t } = useFlashcardI18n();
	const detailsId = useId();
	// A replacement result may reuse an identity; it must start collapsed.
	const [expandedCard, setExpandedCard] = useState<Readonly<SessionCardSnapshot> | null>(null);
	const expanded = expandedCard === card;
	const fileName = card.sourceFile.split("/").pop() ?? card.sourceFile;
	const renderContent = (content: string, className: string) =>
		markdownRenderer ? (
			<MarkdownContent
				content={content}
				className={className}
				markdownRenderer={markdownRenderer}
			/>
		) : (
			<div className={className}>{content}</div>
		);

	return (
		<article className={styles.cardItem} data-expanded={expanded}>
			<div className={styles.cardRow}>
				<div className={styles.cardContent} onFocusCapture={() => setExpandedCard(card)}>
					{renderContent(card.front, cls(styles.markdownWrapper, styles.frontPreview))}
					{renderContent(card.back, cls(styles.markdownWrapper, styles.backPreview))}
				</div>
				<div className={styles.cardActions}>
					{onOpenSourceFile && (
						<FlashcardButton
							variant="ghost"
							size="sm"
							icon={FileText}
							className={styles.openNoteBtn}
							onClick={() => onOpenSourceFile(card.sourceFile)}
							title={`${t("study.openNote")}: ${card.sourceFile}`}
							aria-label={`${t("study.openNote")}: ${card.sourceFile}`}
						>
							{fileName}
						</FlashcardButton>
					)}
					<FlashcardButton
						variant="ghost"
						size="sm"
						icon={ChevronDown}
						iconClassName={expanded ? styles.expandedChevron : undefined}
						aria-expanded={expanded}
						aria-controls={detailsId}
						aria-label={t(expanded ? "study.collapseCard" : "study.expandCard", {
							index,
						})}
						onClick={() => setExpandedCard(expanded ? null : card)}
					>
						{t(expanded ? "study.hideDetails" : "study.showDetails")}
					</FlashcardButton>
				</div>
			</div>
			<div id={detailsId} hidden={!expanded}>
				{expanded && card.explanation && (
					<div className={styles.cardExplanation}>
						<span className={styles.fieldLabel}>{t("common.explanation")}</span>
						{renderContent(card.explanation, styles.markdownWrapper)}
					</div>
				)}
			</div>
		</article>
	);
});
