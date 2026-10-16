import React, { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type SensorDescriptor,
	type SensorOptions,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	useSortableSensors,
	sortableAccessibility,
} from "../../../../../core/ui/primitives/Sortable/Sortable";
import {
	BookA,
	BookOpen,
	Brain,
	ChartNoAxesColumn,
	Check,
	ChevronDown,
	ChevronRight,
	CirclePlay,
	Ellipsis,
	FileDown,
	FileText,
	Flame,
	Inbox,
	Keyboard,
	Languages,
	List,
	LoaderCircle,
	Plus,
	RefreshCcw,
	Settings,
	Sparkles,
	Target,
	Trophy,
	TriangleAlert,
	X,
	type LucideIcon,
} from "lucide-react";
import type {
	DeckHome,
	DeckHomeDeckSnapshot,
	DeckHomeDestination,
	DeckHomeSnapshot,
} from "../../../domain/decks/deckHome";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { DeckSettingsModal } from "../DeckSettings";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./DeckList.module.scss";
import { LearningFootprint } from "./LearningFootprint";

interface DeckActionItem {
	key: string;
	label: string;
	icon: LucideIcon;
	iconClassName?: string;
	onSelect: () => void;
	disabled?: boolean;
	title?: string;
}

/** Stable identity so `DndContext` sees the same sensor list across renders. */
const NO_SENSORS: SensorDescriptor<SensorOptions>[] = [];

/**
 * A deck's presentation state, derived only from the shared snapshot:
 * - `done`   — nothing left to learn; the deck keeps its reviews.
 * - `fresh`  — untouched, so progress is not worth rendering as a bar.
 * - `active` — partly learned; the row leads with progress.
 */
type DeckVisualState = "active" | "fresh" | "done";

function getDeckVisualState(deck: DeckHomeDeckSnapshot): DeckVisualState {
	if (deck.stats.newCards <= 0) return "done";
	if (deck.studyCount === 0 && deck.stats.newCards === deck.stats.totalCards) return "fresh";
	return "active";
}

/** Counts are rendered in every row; cache the formatter the way the heatmap does. */
const COUNT_FORMATTERS: Partial<Record<"zh" | "en", Intl.NumberFormat>> = {};

function formatCount(language: "zh" | "en", value: number): string {
	return (COUNT_FORMATTERS[language] ??= new Intl.NumberFormat(
		language === "zh" ? "zh-CN" : "en-US",
	)).format(value);
}

interface DeckCardProps {
	deck: DeckHomeDeckSnapshot;
	state: DeckVisualState;
	language: "zh" | "en";
	isRecentlyDropped: boolean;
	isOverlayOpen: boolean;
	onToggleOverlay: (deckId: string) => void;
	onCloseOverlay: () => void;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onExportDeck: (deckId: string) => Promise<void>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenSettings: (deckId: string) => void;
	isExporting: boolean;
	isExportBusy: boolean;
	isSettingsLocked: boolean;
}

const DeckCard = memo(function DeckCard({
	deck,
	state,
	language,
	isRecentlyDropped,
	isOverlayOpen,
	onToggleOverlay,
	onCloseOverlay,
	onNavigate,
	onExportDeck,
	onOpenSourceFile,
	onOpenSettings,
	isExporting,
	isExportBusy,
	isSettingsLocked,
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
	} = useSortable({
		id: deck.id,
		disabled: isOverlayOpen,
	});
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
	const totalCards = deck.stats.totalCards;
	const newCards = deck.stats.newCards;
	const learnedCards = Math.max(0, totalCards - newCards);
	const progressPercent = totalCards > 0 ? Math.min(100, (learnedCards / totalCards) * 100) : 0;
	const spellingReady = deck.spelling.ready;
	const isDone = state === "done";

	const moreActions: DeckActionItem[] = [
		{
			key: "export",
			label: t("home.exportPdfTitle"),
			icon: isExporting ? LoaderCircle : FileDown,
			iconClassName: isExporting ? "spinning" : undefined,
			onSelect: () => void onExportDeck(deck.id),
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
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- dnd-kit owns the keyboard contract here: it supplies role="button", tabIndex and Space/Enter drag handling via `attributes`/`listeners`, and the 学习 button is the keyboard route to the same destination.
		<article
			ref={setDragNodeRef}
			className={cls(
				"flashcard-deck-item fc-rail-row",
				styles.deckItem,
				isOverlayOpen && styles.isOverlayOpen,
				isDragging && styles.isDragging,
			)}
			data-deck-id={deck.id}
			data-state={state}
			style={{
				transform: CSS.Transform.toString(cardTransform),
				transition: getDeckCardTransition(isDragging, isRecentlyDropped, transition),
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
										learned: formatCount(language, learnedCards),
										total: formatCount(language, totalCards),
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
										count: formatCount(language, totalCards),
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
										learned: formatCount(language, totalCards),
										total: formatCount(language, totalCards),
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
						<b className={styles.deckCountValue}>{formatCount(language, newCards)}</b>
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
					<FlashcardButton
						preset="icon"
						variant="outline"
						className={cls("flashcard-deck-action-more", styles.actionMore)}
						icon={Ellipsis}
						onClick={(event) => {
							event.stopPropagation();
							onToggleOverlay(deck.id);
						}}
						title={t("home.showMoreActions")}
						aria-label={t("home.moreActions")}
					/>
				</div>
			</div>

			{isOverlayOpen && (
				// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- The overlay only stops the row's click from firing underneath it; every action inside is a real button and Escape is handled on the window.
				<div
					className={cls("flashcard-deck-overlay", styles.deckOverlay)}
					onClick={(event) => event.stopPropagation()}
				>
					<div className={cls("flashcard-deck-overlay-actions", styles.overlayActions)}>
						{moreActions.map((action) => (
							<FlashcardButton
								key={action.key}
								variant="neutral"
								size="sm"
								className={cls(
									"flashcard-deck-overlay-action",
									styles.overlayActionBtn,
								)}
								icon={action.icon}
								iconClassName={action.iconClassName}
								disabled={action.disabled}
								onClick={(event) => {
									event.stopPropagation();
									action.onSelect();
									onCloseOverlay();
								}}
								title={action.title}
							>
								<span>{action.label}</span>
							</FlashcardButton>
						))}
					</div>
					<FlashcardButton
						preset="icon"
						variant="ghost"
						className={cls("flashcard-deck-overlay-close", styles.overlayCloseBtn)}
						icon={X}
						onClick={(event) => {
							event.stopPropagation();
							onCloseOverlay();
						}}
						title={t("home.hideMoreActions")}
						aria-label={t("home.hideMoreActions")}
					/>
				</div>
			)}
		</article>
	);
});

function getDeckCardTransition(
	isDragging: boolean,
	isRecentlyDropped: boolean,
	transition: string | undefined,
): string | undefined {
	return isDragging || isRecentlyDropped ? "none" : transition;
}

// ── DeckList ─────────────────────────────────────────────────────────────────

interface DeckListProps {
	snapshot: DeckHomeSnapshot;
	home: DeckHome;
	ownerId: string;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onRequestMigration: (deckId?: string) => Promise<boolean>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenStats: () => void;
	onOpenSettings: () => void;
	onOpenAddCard: () => void;
	onOpenChallenge?: () => void;
	onOpenTranslation?: () => void;
	onOpenDictionary?: () => void;
	onOpenVideoPlayer?: () => void;
}

export const DeckList = React.memo(function DeckList({
	snapshot,
	home,
	ownerId,
	onNavigate,
	onRequestMigration,
	onOpenSourceFile,
	onOpenStats,
	onOpenSettings,
	onOpenAddCard,
	onOpenChallenge,
	onOpenTranslation,
	onOpenDictionary,
	onOpenVideoPlayer,
}: DeckListProps) {
	const { t, language } = useFlashcardI18n();
	const isLoading = snapshot.mutation.kind === "refreshing";
	const completedGroupId = useId();
	const isMutationBusy = snapshot.mutation.kind !== "idle";
	const isMigrating =
		snapshot.mutation.kind === "preparing-migration" ||
		snapshot.mutation.kind === "awaiting-confirmation" ||
		snapshot.mutation.kind === "migrating";
	const draft = snapshot.settingsDraft?.ownerId === ownerId ? snapshot.settingsDraft : null;
	const [previewDeckIds, setPreviewDeckIds] = useState<string[] | null>(null);
	const [isOrderSaving, setIsOrderSaving] = useState(false);
	const [recentlyDroppedDeckId, setRecentlyDroppedDeckId] = useState<string | null>(null);
	const [activeOverlayDeckId, setActiveOverlayDeckId] = useState<string | null>(null);
	const [isCompletedGroupOpen, setIsCompletedGroupOpen] = useState(false);
	const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);

	const handleToggleHeader = useCallback(() => {
		setIsHeaderCollapsed((current) => !current);
	}, []);

	const handleHeaderKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setIsHeaderCollapsed((current) => !current);
		}
	}, []);

	const handleToggleOverlay = useCallback((deckId: string) => {
		setActiveOverlayDeckId((current) => (current === deckId ? null : deckId));
	}, []);

	const handleCloseOverlay = useCallback(() => {
		setActiveOverlayDeckId(null);
	}, []);

	useEffect(() => {
		if (!activeOverlayDeckId) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setActiveOverlayDeckId(null);
			}
		};

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target?.closest(`[data-deck-id="${activeOverlayDeckId}"]`)) {
				setActiveOverlayDeckId(null);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("pointerdown", handlePointerDown, true);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("pointerdown", handlePointerDown, true);
		};
	}, [activeOverlayDeckId]);

	/**
	 * Finished decks leave the sortable list so the working set stays readable.
	 * The split is presentation only: `deckOrder` still holds every deck id, and
	 * `persistDeckOrder` writes the reordered working set back with the finished
	 * decks appended in their existing order.
	 */
	const { sortableDecks, completedDecks } = useMemo(() => {
		const sortable: DeckHomeDeckSnapshot[] = [];
		const completed: DeckHomeDeckSnapshot[] = [];
		for (const deck of snapshot.decks) {
			if (getDeckVisualState(deck) === "done") completed.push(deck);
			else sortable.push(deck);
		}
		return { sortableDecks: sortable, completedDecks: completed };
	}, [snapshot.decks]);

	const sortableDeckIds = useMemo(() => sortableDecks.map((deck) => deck.id), [sortableDecks]);
	const completedDeckIds = useMemo(() => completedDecks.map((deck) => deck.id), [completedDecks]);
	const visibleDeckIds = previewDeckIds ?? sortableDeckIds;
	const visibleDecks = useMemo(
		() => orderDeckSnapshots(sortableDecks, visibleDeckIds),
		[sortableDecks, visibleDeckIds],
	);
	const sensors = useSortableSensors();
	/**
	 * Disabling reordering belongs to the whole list, not to each card: DndContext
	 * accepts no `disabled` prop, so an empty sensor set is what stops every
	 * activator. Keeping it here leaves each memoized DeckCard's props untouched
	 * when an overlay opens, instead of flipping a boolean on all of them.
	 */
	const reorderDisabled = isOrderSaving || activeOverlayDeckId !== null;
	const activeSensors = reorderDisabled ? NO_SENSORS : sensors;

	const persistDeckOrder = useCallback(
		async (deckIds: string[]) => {
			setIsOrderSaving(true);
			try {
				await home.act({
					kind: "reorder",
					deckIds: [...deckIds, ...completedDeckIds],
				});
			} finally {
				setPreviewDeckIds(null);
				setIsOrderSaving(false);
			}
		},
		[home, completedDeckIds],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			// Removing activators does not cancel a sensor that already started.
			if (reorderDisabled) return;
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const activeIndex = visibleDeckIds.indexOf(String(active.id));
			const overIndex = visibleDeckIds.indexOf(String(over.id));
			if (activeIndex < 0 || overIndex < 0) return;
			const nextOrder = arrayMove(visibleDeckIds, activeIndex, overIndex);
			setRecentlyDroppedDeckId(String(active.id));
			setPreviewDeckIds(nextOrder);
			requestAnimationFrame(() => setRecentlyDroppedDeckId(null));
			void persistDeckOrder(nextOrder);
		},
		[persistDeckOrder, reorderDisabled, visibleDeckIds],
	);

	const handleCloseModal = useCallback(() => {
		void home.act({ kind: "cancel-settings", ownerId });
	}, [home, ownerId]);

	const handleExportDeck = useCallback(
		async (deckId: string) => {
			await home.act({ kind: "export", deckId });
		},
		[home],
	);

	const handleOpenDeckSettings = useCallback(
		(deckId: string) => {
			void home.act({ kind: "open-settings", ownerId, deckId });
		},
		[home, ownerId],
	);

	/**
	 * The hero leads with the deck a returning learner should resume: a deck that
	 * has been started outranks an untouched one, and the largest backlog wins
	 * inside each tier.
	 */
	const nextDeck = useMemo(() => {
		let started: DeckHomeDeckSnapshot | null = null;
		let untouched: DeckHomeDeckSnapshot | null = null;
		for (const deck of sortableDecks) {
			if (deck.stats.newCards <= 0) continue;
			if (deck.studyCount > 0) {
				if (!started || deck.stats.newCards > started.stats.newCards) started = deck;
			} else if (!untouched || deck.stats.newCards > untouched.stats.newCards) {
				untouched = deck;
			}
		}
		return started ?? untouched;
	}, [sortableDecks]);

	const learnedCards = snapshot.totals.totalCards - snapshot.totals.newCards;
	const streak = snapshot.learningFootprint;

	return (
		<>
			<div className="flashcard-home fc-page fc-page--fill">
				<FlashcardHeader
					className={cls(styles.homeHeader, isHeaderCollapsed && styles.isCollapsed)}
					icon={BookOpen}
					title={t("home.title")}
					badge={
						<span
							className={cls(
								styles.collapseIcon,
								!isHeaderCollapsed && styles.isExpanded,
							)}
							aria-hidden="true"
						>
							<ChevronDown size={16} />
						</span>
					}
					onClick={handleToggleHeader}
					onKeyDown={handleHeaderKeyDown}
					ariaExpanded={!isHeaderCollapsed}
					right={
						// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Header actions stop click propagation so clicking action buttons does not toggle header collapse.
						<div
							className="flashcard-header-actions"
							onClick={(event) => event.stopPropagation()}
						>
							{(onOpenTranslation || onOpenDictionary || onOpenVideoPlayer) && (
								<>
									<div className={styles.headerGroup}>
										{onOpenTranslation && (
											<FlashcardButton
												preset="icon"
												icon={Languages}
												onClick={onOpenTranslation}
												title={t("home.aiTranslationTitle")}
												aria-label={t("home.aiTranslationTitle")}
											/>
										)}
										{onOpenDictionary && (
											<FlashcardButton
												preset="icon"
												icon={BookA}
												onClick={onOpenDictionary}
												title={t("home.dictionaryTitle")}
												aria-label={t("home.dictionaryTitle")}
											/>
										)}
										{onOpenVideoPlayer && (
											<FlashcardButton
												preset="icon"
												icon={CirclePlay}
												onClick={onOpenVideoPlayer}
												title={t("home.videoPlayerTitle")}
												aria-label={t("home.videoPlayerTitle")}
											/>
										)}
									</div>
								</>
							)}
							<div className={styles.headerGroup}>
								<FlashcardButton
									preset="icon"
									icon={ChartNoAxesColumn}
									onClick={onOpenStats}
									title={t("home.statsTitle")}
									aria-label={t("home.statsTitle")}
								/>
								<FlashcardButton
									preset="icon"
									icon={RefreshCcw}
									onClick={() => void home.act({ kind: "refresh" })}
									disabled={isMutationBusy}
									title={t("home.refreshTitle")}
									aria-label={t("home.refreshTitle")}
									iconClassName={isLoading ? "spinning" : ""}
								/>
								<FlashcardButton
									preset="icon"
									icon={Settings}
									onClick={onOpenSettings}
									title={t("home.pluginSettingsTitle")}
									aria-label={t("home.pluginSettingsTitle")}
								/>
							</div>
						</div>
					}
				/>

				{snapshot.migration && (
					<section
						className={cls("flashcard-identity-migration-card", styles.migrationCard)}
					>
						<div
							className={cls(
								"flashcard-identity-migration-copy",
								styles.migrationCopy,
							)}
						>
							<div
								className={cls(
									"flashcard-identity-migration-icon",
									styles.migrationIcon,
								)}
							>
								<Sparkles size={20} />
							</div>
							<div>
								<strong>{t("identity.oneClickMigrationTitle")}</strong>
								<p>
									{t("identity.oneClickMigrationDescription", {
										sources: snapshot.migration.sourceCount,
										cards: snapshot.migration.cardCount,
									})}
								</p>
							</div>
						</div>
						<FlashcardButton
							variant="primary"
							icon={Sparkles}
							onClick={() => void onRequestMigration()}
							disabled={isMutationBusy}
						>
							{isMigrating ? t("identity.migrating") : t("identity.migrateAllNow")}
						</FlashcardButton>
					</section>
				)}

				<div className="fc-page__body">
					{snapshot.decks.length > 0 && (
						<section className={cls("flashcard-home-hero fc-hero", styles.hero)}>
							<div className={styles.heroMain}>
								<div className="fc-hero__num">
									<div className="fc-hero__label">{t("home.heroLabel")}</div>
									<b>{formatCount(language, snapshot.totals.newCards)}</b>
									<span>{t("home.heroUnit")}</span>
								</div>
								<div className={cls("fc-hero__summary", styles.heroSummary)}>
									{nextDeck
										? t("home.heroSummary", {
												decks: snapshot.totals.deckCount,
												learned: formatCount(language, learnedCards),
												deck: nextDeck.name,
											})
										: t("home.heroSummaryNoTarget", {
												decks: snapshot.totals.deckCount,
												learned: formatCount(language, learnedCards),
											})}
								</div>
							</div>
							<div className={cls("fc-hero__side", styles.heroSide)}>
								<span className={styles.heroStreak}>
									<Flame size={14} aria-hidden="true" />
									<b>
										{t("footprint.currentStreak", {
											count: streak.currentStreak,
										})}
									</b>
									<span
										className={cls("fc-meta__dot", styles.dot)}
										aria-hidden="true"
									/>
									<Trophy size={12} aria-hidden="true" />
									{t("footprint.bestStreak", {
										count: streak.bestStreak,
									})}
								</span>
								<FlashcardButton
									variant="secondary"
									size="md"
									icon={Brain}
									disabled={!nextDeck}
									onClick={() => nextDeck && onNavigate("study", nextDeck.id)}
								>
									{t("home.continueStudy")}
								</FlashcardButton>
							</div>
						</section>
					)}

					<LearningFootprint
						key={snapshot.learningFootprint.today.date}
						footprint={snapshot.learningFootprint}
					/>

					{snapshot.decks.length === 0 ? (
						<div className={cls("flashcard-empty", styles.empty)}>
							<div className={cls("flashcard-empty-icon", styles.emptyIcon)}>
								<Inbox size={48} />
							</div>
							<p>{t("home.emptyTitle")}</p>
							<p className={cls("flashcard-empty-hint", styles.emptyHint)}>
								{t("home.emptyHint", { tag: "#wordTag" })}
							</p>
							<div className={styles.homeActions}>
								<FlashcardButton
									variant="secondary"
									className={cls("flashcard-home-add-card", styles.addCardBtn)}
									icon={Plus}
									onClick={onOpenAddCard}
								>
									{t("cardEditor.addCardTitle")}
								</FlashcardButton>
								<FlashcardButton
									variant="primary"
									icon={Target}
									onClick={onOpenChallenge}
								>
									{t("challenge.title")}
								</FlashcardButton>
							</div>
						</div>
					) : (
						<div className={cls("flashcard-home-workspace", styles.workspace)}>
							<section
								className={cls("flashcard-deck-index", styles.deckIndex)}
								aria-label={t("home.deckIndex")}
							>
								<div
									className={cls(
										"flashcard-deck-index-heading",
										styles.deckIndexHeading,
									)}
								>
									<h2>{t("home.deckSectionTitle")}</h2>
									<span className={styles.deckIndexCount}>
										{t("home.deckCountValue", {
											count: snapshot.totals.deckCount,
										})}
									</span>
								</div>

								<DndContext
									sensors={activeSensors}
									collisionDetection={closestCenter}
									accessibility={sortableAccessibility(language, visibleDeckIds)}
									onDragEnd={handleDragEnd}
								>
									<SortableContext
										items={visibleDeckIds}
										strategy={rectSortingStrategy}
									>
										<div
											className={cls("flashcard-deck-list", styles.deckList)}
										>
											{visibleDecks.map((deck) => (
												<DeckCard
													key={deck.id}
													deck={deck}
													state={getDeckVisualState(deck)}
													language={language}
													isRecentlyDropped={
														recentlyDroppedDeckId === deck.id
													}
													isOverlayOpen={activeOverlayDeckId === deck.id}
													onToggleOverlay={handleToggleOverlay}
													onCloseOverlay={handleCloseOverlay}
													onNavigate={onNavigate}
													onExportDeck={handleExportDeck}
													onOpenSourceFile={onOpenSourceFile}
													onOpenSettings={handleOpenDeckSettings}
													isExporting={
														snapshot.export.kind === "exporting" &&
														snapshot.export.deckId === deck.id
													}
													isExportBusy={
														snapshot.export.kind === "exporting"
													}
													isSettingsLocked={
														snapshot.settingsDraft !== null &&
														snapshot.settingsDraft.ownerId !==
															ownerId &&
														(snapshot.settingsDraft.ownerId !== "" ||
															snapshot.settingsDraft.deckId !==
																deck.id)
													}
												/>
											))}

											{completedDecks.length > 0 && (
												<div
													className={cls(
														"fc-group",
														styles.completedGroup,
													)}
												>
													<button
														type="button"
														className={cls(
															"flashcard-completed-group-toggle fc-disclosure",
															styles.completedGroupHead,
														)}
														aria-expanded={isCompletedGroupOpen}
														aria-controls={completedGroupId}
														aria-label={t("home.completedGroup", {
															count: completedDecks.length,
														})}
														onClick={() =>
															setIsCompletedGroupOpen(
																(current) => !current,
															)
														}
													>
														{isCompletedGroupOpen ? (
															<ChevronDown
																size={13}
																aria-hidden="true"
															/>
														) : (
															<ChevronRight
																size={13}
																aria-hidden="true"
															/>
														)}
														<span>{t("home.completedGroupTitle")}</span>
														<span
															className={styles.completedCount}
															aria-hidden="true"
														>
															{formatCount(
																language,
																completedDecks.length,
															)}
														</span>
													</button>

													<div
														id={completedGroupId}
														hidden={!isCompletedGroupOpen}
														className={cls(
															"fc-group__body",
															styles.completedGroupBody,
														)}
													>
														{isCompletedGroupOpen &&
															completedDecks.map((deck) => (
																<DeckCard
																	key={deck.id}
																	deck={deck}
																	state="done"
																	language={language}
																	isRecentlyDropped={false}
																	isOverlayOpen={
																		activeOverlayDeckId ===
																		deck.id
																	}
																	onToggleOverlay={
																		handleToggleOverlay
																	}
																	onCloseOverlay={
																		handleCloseOverlay
																	}
																	onNavigate={onNavigate}
																	onExportDeck={handleExportDeck}
																	onOpenSourceFile={
																		onOpenSourceFile
																	}
																	onOpenSettings={
																		handleOpenDeckSettings
																	}
																	isExporting={
																		snapshot.export.kind ===
																			"exporting" &&
																		snapshot.export.deckId ===
																			deck.id
																	}
																	isExportBusy={
																		snapshot.export.kind ===
																		"exporting"
																	}
																	isSettingsLocked={
																		snapshot.settingsDraft !==
																			null &&
																		snapshot.settingsDraft
																			.ownerId !== ownerId &&
																		(snapshot.settingsDraft
																			.ownerId !== "" ||
																			snapshot.settingsDraft
																				.deckId !== deck.id)
																	}
																/>
															))}
													</div>
												</div>
											)}
										</div>
									</SortableContext>
								</DndContext>
							</section>

							<div className={styles.homeActions}>
								<FlashcardButton
									variant="secondary"
									className={cls("flashcard-home-add-card", styles.addCardBtn)}
									icon={Plus}
									onClick={onOpenAddCard}
								>
									{t("cardEditor.addCardTitle")}
								</FlashcardButton>
								<FlashcardButton
									variant="primary"
									icon={Target}
									onClick={onOpenChallenge}
								>
									{t("challenge.title")}
								</FlashcardButton>
							</div>
						</div>
					)}
				</div>
			</div>

			{draft && (
				<DeckSettingsModal
					draft={draft}
					isSaving={
						snapshot.mutation.kind === "saving-settings" &&
						snapshot.mutation.deckId === draft.deckId
					}
					isMigratingIdentity={
						snapshot.mutation.kind === "preparing-migration" ||
						snapshot.mutation.kind === "awaiting-confirmation" ||
						snapshot.mutation.kind === "migrating"
					}
					onChange={(change) => {
						void home.act({
							kind: "change-settings",
							ownerId,
							change,
						});
					}}
					onSave={async () => {
						await home.act({ kind: "save-settings", ownerId });
					}}
					onOpenSourceFile={() => onOpenSourceFile(draft.filePath)}
					onMigrateIdentity={() => onRequestMigration(draft.deckId)}
					onClose={handleCloseModal}
				/>
			)}
		</>
	);
});

function orderDeckSnapshots(
	decks: readonly DeckHomeDeckSnapshot[],
	deckIds: readonly string[],
): DeckHomeDeckSnapshot[] {
	const decksById = new Map(decks.map((deck) => [deck.id, deck]));
	const orderedDecks = deckIds
		.map((deckId) => decksById.get(deckId))
		.filter((deck): deck is DeckHomeDeckSnapshot => deck !== undefined);
	const seen = new Set(orderedDecks.map((deck) => deck.id));
	return [...orderedDecks, ...decks.filter((deck) => !seen.has(deck.id))];
}
