import { memo, useCallback } from "react";
import { Platform } from "obsidian";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	Brain,
	Check,
	FileDown,
	FileText,
	GripVertical,
	List,
	LoaderCircle,
	RefreshCcw,
	Settings,
	Target,
	TriangleAlert,
	X,
} from "lucide-react";
import { cls } from "../../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../../core/ui/primitives/Button";
import { FlashcardMenu, type FlashcardMenuItem } from "../../../../../../core/ui/primitives/Menu";
import { useFlashcardI18n } from "../../../../strings/context";
import type { DeckHomeDeckSnapshot, DeckHomeDestination } from "../../../../domain/decks/deckHome";
import { selectDeckCardMetrics } from "../../../homePresentation";
import styles from "../DeckList.module.scss";
import { formatDeckCount } from "../deckCountFormat";

interface DeckCardProps {
	deck: DeckHomeDeckSnapshot;
	isSettingsLocked: boolean;
	isExporting: boolean;
	isExportBusy: boolean;
	language: "zh" | "en";
	isRecentlyDropped: boolean;
	isMenuOpen: boolean;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onExport: (deckId: string) => Promise<void>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenSettings: (deckId: string) => void;
	onMenuOpenChange: (deckId: string, open: boolean) => void;
}

/** One deck row: owns its drag surface, progress presentation and action menu. */
export const DeckCard = memo(function DeckCard({
	deck,
	isSettingsLocked,
	isExporting,
	isExportBusy,
	language,
	isRecentlyDropped,
	isMenuOpen,
	onNavigate,
	onExport,
	onOpenSourceFile,
	onOpenSettings,
	onMenuOpenChange,
}: DeckCardProps) {
	const { t } = useFlashcardI18n();
	const { state, learnedCards, progressPercent, isDone } = selectDeckCardMetrics(deck);
	const handleMenuOpenChange = useCallback(
		(open: boolean) => onMenuOpenChange(deck.id, open),
		[deck.id, onMenuOpenChange],
	);
	const {
		attributes,
		isDragging,
		listeners,
		setActivatorNodeRef,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id: deck.id, disabled: { draggable: isDone, droppable: isDone } });
	// Keep pickup scale in the same transform as translation: dnd-kit can then
	// exclude it from measurements. Never inherit another slot's size ratio.
	const cardTransform =
		transform || isDragging
			? {
					x: transform?.x ?? 0,
					y: transform?.y ?? 0,
					scaleX: isDragging ? 0.95 : 1,
					scaleY: isDragging ? 0.95 : 1,
				}
			: null;
	const { totalCards, newCards, dueCards } = deck.stats;
	const spellingReady = deck.spelling.ready;
	const mobile = Platform.isMobile;
	const showInlineActions = mobile && isMenuOpen;
	const moreActionsLabel = t("home.deckActions", { deckName: deck.name });

	const moreActions: FlashcardMenuItem[] = [
		{
			key: "export",
			label: t("home.exportPdfTitle"),
			icon: isExporting ? LoaderCircle : FileDown,
			iconClassName: isExporting ? "spinning" : undefined,
			onSelect: () => void onExport(deck.id),
			disabled: isExportBusy,
			title: t("home.exportPdfTitle"),
		},
		{
			key: "list",
			label: t("home.list"),
			icon: List,
			onSelect: () => onNavigate("word-list", deck.id),
		},
		{
			key: "source",
			label: t("home.source"),
			icon: FileText,
			onSelect: () => onOpenSourceFile(deck.filePath),
		},
		{
			key: "settings",
			label: t("home.setting"),
			icon: Settings,
			onSelect: () => onOpenSettings(deck.id),
			disabled: isSettingsLocked,
		},
	];
	return (
		<article
			ref={isDone ? undefined : setNodeRef}
			className={cls(
				"flashcard-deck-item fc-rail-row",
				styles.deckItem,
				isDragging && styles.isDragging,
			)}
			data-deck-id={deck.id}
			data-state={state}
			style={{
				transform: CSS.Transform.toString(cardTransform),
				transition: isDragging || isRecentlyDropped ? "none" : transition,
			}}
		>
			<div className={cls("flashcard-deck-main fc-rail-row__main", styles.deckMain)}>
				{!isDone && (
					<button
						type="button"
						ref={setActivatorNodeRef}
						className={cls("fc-sortable-handle fc-focus-ring", styles.deckSortHandle)}
						{...attributes}
						{...listeners}
						aria-label={t("home.reorderDeck", { deckName: deck.name })}
						title={t("home.reorderDeck", { deckName: deck.name })}
					>
						<GripVertical size={16} aria-hidden="true" />
					</button>
				)}
				<div className={cls("flashcard-deck-headline", styles.deckHeadline)}>
					<span
						className={cls("flashcard-deck-name fc-rail-row__title", styles.deckName)}
					>
						{deck.name}
					</span>

					<div className={cls("flashcard-deck-meta fc-meta", styles.deckMeta)}>
						{state === "active" && (
							<>
								<span
									className={cls("fc-meter", styles.deckBar)}
									aria-hidden="true"
								>
									<i style={{ width: `${progressPercent}%` }} />
								</span>
								<span className="fc-meta__text">
									{t("home.deckLearnedProgress", {
										learned: formatDeckCount(language, learnedCards),
										total: formatDeckCount(language, totalCards),
									})}
								</span>
								{deck.studyCount > 0 && (
									<>
										<span className="fc-meta__dot" aria-hidden="true" />
										<span className="fc-meta__text">
											{t("home.studyCountValue", {
												count: deck.studyCount,
											})}
										</span>
									</>
								)}
							</>
						)}
						{state === "fresh" && (
							<>
								<span className="fc-meta__text">{t("home.deckNotStarted")}</span>
								<span className="fc-meta__dot" aria-hidden="true" />
								<span className="fc-meta__text">
									{t("home.deckTotalCards", {
										count: formatDeckCount(language, totalCards),
									})}
								</span>
							</>
						)}
						{state === "done" && (
							<>
								<span
									className={cls("fc-meter", styles.deckBar)}
									data-tone="done"
									aria-hidden="true"
								>
									<i style={{ width: "100%" }} />
								</span>
								<span className="fc-meta__text">
									{t("home.deckLearnedProgress", {
										learned: formatDeckCount(language, totalCards),
										total: formatDeckCount(language, totalCards),
									})}
								</span>
								{deck.studyCount > 0 && (
									<>
										<span className="fc-meta__dot" aria-hidden="true" />
										<span className="fc-meta__text">
											{t("home.studyCountValue", {
												count: deck.studyCount,
											})}
										</span>
									</>
								)}
							</>
						)}
						{deck.spelling.enabled && !spellingReady && (
							<span className={styles.spellingIssue}>
								<TriangleAlert size={12} aria-hidden="true" />
								{t("home.wordLearningNeedsRepair")}
							</span>
						)}
					</div>
				</div>
			</div>

			<div className="flashcard-deck-count fc-rail-row__count">
				{dueCards > 0 && (
					<span className={styles.dueCount}>
						{t("home.dueReviewCount", { count: formatDeckCount(language, dueCards) })}
					</span>
				)}
				{isDone ? (
					<span className="flashcard-deck-done fc-rail-row__badge">
						<Check size={13} aria-hidden="true" />
						{t("home.deckCompleted")}
					</span>
				) : (
					<span className={styles.newCount}>
						{t("home.remainingNewCount", {
							count: formatDeckCount(language, newCards),
						})}
					</span>
				)}
			</div>

			<div
				className={cls(
					"flashcard-deck-side fc-rail-row__actions",
					showInlineActions && styles.inlineActions,
				)}
			>
				<div className={cls("flashcard-deck-actions2", styles.deckActions)}>
					{!showInlineActions && (
						<>
							<FlashcardButton
								variant="secondary"
								size="md"
								className="flashcard-deck-action-study"
								icon={isDone ? RefreshCcw : Brain}
								onClick={() => onNavigate("study", deck.id)}
								title={isDone ? t("home.review") : t("home.studyModeTitle")}
							>
								<span>{isDone ? t("home.review") : t("home.study")}</span>
							</FlashcardButton>
							<FlashcardButton
								variant="outline"
								size="md"
								className="flashcard-deck-action-practice"
								icon={Target}
								onClick={() => onNavigate("practice", deck.id)}
								title={t("home.practiceModeTitle")}
							>
								<span>{t("home.practice")}</span>
							</FlashcardButton>
						</>
					)}
					<FlashcardMenu
						items={moreActions}
						triggerTitle={
							showInlineActions
								? t("home.closeDeckActions", { deckName: deck.name })
								: moreActionsLabel
						}
						triggerIcon={showInlineActions ? X : undefined}
						ariaLabel={moreActionsLabel}
						triggerClassName={cls("flashcard-deck-action-more", styles.actionMore)}
						open={isMenuOpen}
						onOpenChange={handleMenuOpenChange}
						presentation={mobile ? "inline" : "floating"}
					/>
				</div>
			</div>
		</article>
	);
});
