import React, { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	Brain,
	Check,
	FileDown,
	FileText,
	Keyboard,
	List,
	LoaderCircle,
	RefreshCcw,
	Settings,
	Target,
	TriangleAlert,
} from "lucide-react";
import { cls } from "../../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../../core/ui/primitives/Button";
import { FlashcardMenu, type FlashcardMenuItem } from "../../../../../../core/ui/primitives/Menu";
import { useFlashcardI18n } from "../../../../strings/context";
import type { DeckHomeDestination } from "../../../../domain/decks/deckHome";
import type { DeckCardPresentation } from "../../../deckCardPresentation";
import styles from "../DeckList.module.scss";
import { formatDeckCount } from "../deckCountFormat";

export interface DeckCardProps {
	presentation: DeckCardPresentation;
	language: "zh" | "en";
	isRecentlyDropped: boolean;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onExport: (deckId: string) => Promise<void>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenSettings: (deckId: string) => void;
	onMenuOpenChange: (deckId: string, open: boolean) => void;
}

/** One deck row: owns its drag surface, progress presentation and action menu. */
export const DeckCard = memo(function DeckCard({
	presentation,
	language,
	isRecentlyDropped,
	onNavigate,
	onExport,
	onOpenSourceFile,
	onOpenSettings,
	onMenuOpenChange,
}: DeckCardProps) {
	const { t } = useFlashcardI18n();
	const {
		attributes,
		isDragging,
		listeners,
		setActivatorNodeRef,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id: presentation.deck.id });
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
	const setDragNodeRef = useCallback(
		(node: HTMLElement | null) => {
			setNodeRef(node);
			setActivatorNodeRef(node);
		},
		[setNodeRef, setActivatorNodeRef],
	);

	const { deck, state, learnedCards, progressPercent, isDone } = presentation;
	const { totalCards, newCards } = deck.stats;
	const spellingReady = deck.spelling.ready;

	const moreActions: FlashcardMenuItem[] = [
		{
			key: "export",
			label: t("home.exportPdfTitle"),
			icon: presentation.isExporting ? LoaderCircle : FileDown,
			iconClassName: presentation.isExporting ? "spinning" : undefined,
			onSelect: () => void onExport(deck.id),
			disabled: presentation.isExportBusy,
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
			disabled: presentation.isSettingsLocked,
		},
	];

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- dnd-kit owns the keyboard contract here: it supplies role="button", tabIndex and Space/Enter drag handling via `attributes`/`listeners`, and the 学习 button is the keyboard route to the same destination.
		<article
			ref={setDragNodeRef}
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
			/* dnd-kit supplies `role="button"`, `tabIndex` and its drag keyboard
			   handling here; spreading last would clobber `onClick`, so spread
			   first and keep only the additions below. */
			{...attributes}
			{...listeners}
			aria-label={t("home.openDeck", { deckName: deck.name })}
		>
			<div className={cls("flashcard-deck-main fc-rail-row__main", styles.deckMain)}>
				<div className={cls("flashcard-deck-headline", styles.deckHeadline)}>
					<div className={cls("flashcard-deck-name-wrapper", styles.deckNameWrapper)}>
						<span
							className={cls(
								"flashcard-deck-name fc-rail-row__title",
								styles.deckName,
							)}
						>
							{deck.name}
						</span>
						<span className={cls("flashcard-deck-tag", styles.deckTag)}>
							{deck.tag}
						</span>
						{deck.spelling.enabled && (
							<span
								className={cls(
									"flashcard-word-learning-badge",
									styles.wordLearningBadge,
									!spellingReady && styles.isInvalid,
								)}
								title={
									spellingReady
										? t("home.wordLearningDeck")
										: t("home.wordLearningNeedsRepair")
								}
							>
								{spellingReady ? (
									<Keyboard size={12} />
								) : (
									<TriangleAlert size={12} />
								)}
								{spellingReady
									? t("home.supportsSpelling")
									: t("home.wordLearningNeedsRepair")}
							</span>
						)}
					</div>

					<div className={cls("flashcard-deck-meta fc-meta", styles.deckMeta)}>
						{state === "active" && (
							<>
								<span
									className={cls("fc-meter", styles.deckBar)}
									aria-hidden="true"
								>
									<i style={{ width: `${progressPercent}%` }} />
								</span>
								<span className={cls("fc-meta__text", styles.deckMetaText)}>
									{t("home.deckLearnedProgress", {
										learned: formatDeckCount(language, learnedCards),
										total: formatDeckCount(language, totalCards),
									})}
								</span>
								{deck.studyCount > 0 && (
									<>
										<span
											className={cls("fc-meta__dot", styles.dot)}
											aria-hidden="true"
										/>
										<span className={cls("fc-meta__text", styles.deckMetaText)}>
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
								<span className={cls("fc-meta__text", styles.deckMetaText)}>
									{t("home.deckNotStarted")}
								</span>
								<span
									className={cls("fc-meta__dot", styles.dot)}
									aria-hidden="true"
								/>
								<span className={cls("fc-meta__text", styles.deckMetaText)}>
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
								<span className={cls("fc-meta__text", styles.deckMetaText)}>
									{t("home.deckLearnedProgress", {
										learned: formatDeckCount(language, totalCards),
										total: formatDeckCount(language, totalCards),
									})}
								</span>
								{deck.studyCount > 0 && (
									<>
										<span
											className={cls("fc-meta__dot", styles.dot)}
											aria-hidden="true"
										/>
										<span className={cls("fc-meta__text", styles.deckMetaText)}>
											{t("home.studyCountValue", {
												count: deck.studyCount,
											})}
										</span>
									</>
								)}
							</>
						)}
					</div>
				</div>
			</div>

			<div className={cls("flashcard-deck-count fc-rail-row__count", styles.deckCount)}>
				{isDone ? (
					<span
						className={cls("flashcard-deck-done fc-rail-row__badge", styles.deckDone)}
					>
						<Check size={13} aria-hidden="true" />
						{t("home.deckCompleted")}
					</span>
				) : (
					<>
						<b className={styles.deckCountValue}>
							{formatDeckCount(language, newCards)}
						</b>
						<span className={styles.deckCountLabel}>{t("home.deckPending")}</span>
					</>
				)}
			</div>

			<div
				className={cls("flashcard-deck-side fc-rail-row__actions", styles.deckSide)}
				role="presentation"
				onMouseDown={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
			>
				<div
					className={cls(
						"flashcard-deck-actions2",
						styles.deckActions,
						deck.spelling.enabled && "has-spelling",
						deck.spelling.enabled && styles.hasSpelling,
					)}
				>
					<FlashcardButton
						variant="primary"
						size="md"
						className="flashcard-deck-action-study"
						icon={isDone ? RefreshCcw : Brain}
						onClick={(event) => {
							event.stopPropagation();
							onNavigate("study", deck.id);
						}}
						title={isDone ? t("home.review") : t("home.studyModeTitle")}
					>
						<span>{isDone ? t("home.review") : t("home.study")}</span>
					</FlashcardButton>
					<FlashcardButton
						variant="secondary"
						size="md"
						className="flashcard-deck-action-practice"
						icon={Target}
						onClick={(event) => {
							event.stopPropagation();
							onNavigate("practice", deck.id);
						}}
						title={t("home.practiceModeTitle")}
					>
						<span>{t("home.practice")}</span>
					</FlashcardButton>
					{deck.spelling.enabled && (
						<FlashcardButton
							preset="icon"
							variant="neutral"
							className={cls("flashcard-deck-action-spelling", styles.actionSpelling)}
							icon={Keyboard}
							onClick={(event) => {
								event.stopPropagation();
								onNavigate("spelling", deck.id);
							}}
							disabled={!spellingReady}
							title={
								spellingReady
									? deck.spelling.ignoredCardCount > 0
										? t("home.spellingModeIgnoredTitle", {
												count: deck.spelling.ignoredCardCount,
											})
										: t("home.spellingModeTitle")
									: t("home.spellingUnavailableTitle", {
											count: deck.spelling.issueCount,
										})
							}
							aria-label={t("home.spelling")}
						/>
					)}
					<FlashcardMenu
						items={moreActions}
						triggerTitle={t("home.showMoreActions")}
						ariaLabel={t("home.moreActions")}
						triggerClassName={cls("flashcard-deck-action-more", styles.actionMore)}
						align="end"
						onOpenChange={(open) => onMenuOpenChange(deck.id, open)}
					/>
				</div>
			</div>
		</article>
	);
});
