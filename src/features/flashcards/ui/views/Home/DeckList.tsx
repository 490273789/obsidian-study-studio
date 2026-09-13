import React, { memo, useCallback, useMemo, useState } from "react";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	sortableKeyboardCoordinates,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	BookA,
	BookOpen,
	Brain,
	Calculator,
	ChartNoAxesColumn,
	FileDown,
	FileText,
	Inbox,
	Keyboard,
	Languages,
	List,
	LoaderCircle,
	NotebookPen,
	Plus,
	RefreshCcw,
	Settings,
	Sparkles,
	Target,
	TriangleAlert,
} from "lucide-react";
import type {
	DeckHome,
	DeckHomeDeckSnapshot,
	DeckHomeDestination,
	DeckHomeSnapshot,
} from "../../../domain/decks/deckHome";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardMenu, type FlashcardMenuItem } from "../../../../../core/ui/primitives/Menu";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { DeckSettingsModal } from "../DeckSettings";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./DeckList.module.scss";

interface DeckCardProps {
	deck: DeckHomeDeckSnapshot;
	isReorderDisabled: boolean;
	isRecentlyDropped: boolean;
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
	isReorderDisabled,
	isRecentlyDropped,
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
	} = useSortable({ id: deck.id, disabled: isReorderDisabled });
	const setDragNodeRef = useCallback(
		(node: HTMLElement | null) => {
			setNodeRef(node);
			setActivatorNodeRef(node);
		},
		[setNodeRef, setActivatorNodeRef],
	);
	const totalCards = deck.stats.totalCards;
	const newCards = deck.stats.newCards;
	const [showMoreActions, setShowMoreActions] = useState(false);
	const spellingReady = deck.spelling.ready;
	const moreActions: FlashcardMenuItem[] = [
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
		<article
			ref={setDragNodeRef}
			className={cls(
				"flashcard-deck-item fc-lift",
				styles.deckItem,
				showMoreActions && styles.isActionsOpen,
				isDragging && styles.isDragging,
			)}
			data-deck-id={deck.id}
			style={{
				transform: CSS.Transform.toString(transform),
				transition: getDeckCardTransition(isDragging, isRecentlyDropped, transition),
			}}
			aria-label={t("home.reorderDeck", { deckName: deck.name })}
			{...attributes}
			{...listeners}
		>
			<div className={cls("flashcard-deck-main", styles.deckMain)}>
				<div className={cls("flashcard-deck-headline", styles.deckHeadline)}>
					<div className={cls("flashcard-deck-name-wrapper", styles.deckNameWrapper)}>
						<span className={cls("flashcard-deck-name", styles.deckName)}>
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
							>
								{spellingReady ? (
									<Keyboard size={13} />
								) : (
									<TriangleAlert size={13} />
								)}
								{spellingReady
									? t("home.wordLearningDeck")
									: t("home.wordLearningNeedsRepair")}
							</span>
						)}
					</div>
					<div className={cls("flashcard-deck-stats", styles.deckStats)}>
						<div className={cls("flashcard-deck-stat", styles.deckStat)}>
							<span
								className={cls(
									"flashcard-deck-stat-value blue",
									styles.deckStatValue,
								)}
							>
								{newCards}
							</span>
							/
							<span
								className={cls(
									"flashcard-deck-stat-value orange",
									styles.deckStatValue,
								)}
							>
								{totalCards}
							</span>
						</div>
						<div className={cls("flashcard-deck-stat", styles.deckStat)}>
							<span
								className={cls("flashcard-deck-stat-label", styles.deckStatLabel)}
							>
								{t("home.studyCountValue", {
									count: deck.studyCount,
								})}
							</span>
						</div>
					</div>
				</div>
			</div>

			<div
				className={cls("flashcard-deck-side", styles.deckSide)}
				role="presentation"
				onMouseDown={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
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
						className="flashcard-deck-action-study"
						icon={Brain}
						onClick={(event) => {
							event.stopPropagation();
							onNavigate("study", deck.id);
						}}
						title={t("home.studyModeTitle")}
					>
						<span>{t("home.study")}</span>
					</FlashcardButton>
					<FlashcardButton
						variant="secondary"
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
							variant="secondary"
							className="flashcard-deck-action-spelling"
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
						>
							<span>{t("home.spelling")}</span>
						</FlashcardButton>
					)}
					<FlashcardMenu
						items={moreActions}
						triggerTitle={
							showMoreActions ? t("home.hideMoreActions") : t("home.showMoreActions")
						}
						ariaLabel={t("home.moreActions")}
						triggerClassName={cls("flashcard-deck-action-more", styles.actionMore)}
						menuClassName={cls("flashcard-deck-more-actions", styles.moreActions)}
						onOpenChange={setShowMoreActions}
					/>
				</div>
			</div>
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
	onOpenTranslation?: () => void;
	onOpenDictionary?: () => void;
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
	onOpenTranslation,
	onOpenDictionary,
}: DeckListProps) {
	const { t } = useFlashcardI18n();
	const isLoading = snapshot.mutation.kind === "refreshing";
	const isMutationBusy = snapshot.mutation.kind !== "idle";
	const isMigrating =
		snapshot.mutation.kind === "preparing-migration" ||
		snapshot.mutation.kind === "awaiting-confirmation" ||
		snapshot.mutation.kind === "migrating";
	const draft = snapshot.settingsDraft?.ownerId === ownerId ? snapshot.settingsDraft : null;
	const [previewDeckIds, setPreviewDeckIds] = useState<string[] | null>(null);
	const [isOrderSaving, setIsOrderSaving] = useState(false);
	const [recentlyDroppedDeckId, setRecentlyDroppedDeckId] = useState<string | null>(null);
	const snapshotDeckIds = useMemo(() => snapshot.decks.map((deck) => deck.id), [snapshot.decks]);
	const visibleDeckIds = previewDeckIds ?? snapshotDeckIds;
	const visibleDecks = useMemo(
		() => orderDeckSnapshots(snapshot.decks, visibleDeckIds),
		[snapshot.decks, visibleDeckIds],
	);
	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: { distance: 6 },
		}),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 1000, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const persistDeckOrder = useCallback(
		async (deckIds: string[]) => {
			setIsOrderSaving(true);
			try {
				await home.act({ kind: "reorder", deckIds });
			} finally {
				setPreviewDeckIds(null);
				setIsOrderSaving(false);
			}
		},
		[home],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
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
		[persistDeckOrder, visibleDeckIds],
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

	return (
		<>
			<div className="flashcard-home fc-page fc-page--fill">
				<FlashcardHeader
					icon={BookOpen}
					title={t("home.title")}
					stats={[
						{
							key: "total",
							icon: Calculator,
							value: snapshot.totals.totalCards,
							label: t("home.totalCards"),
							tone: "purple",
						},
						{
							key: "studies",
							icon: NotebookPen,
							value: snapshot.totals.studyCount,
							label: t("home.studyCount"),
							tone: "orange",
						},
					]}
					right={
						<div className="flashcard-header-actions">
							{onOpenTranslation && (
								<FlashcardButton
									preset="icon"
									icon={Languages}
									onClick={onOpenTranslation}
									title={t("home.aiTranslationTitle")}
								/>
							)}
							{onOpenDictionary && (
								<FlashcardButton
									preset="icon"
									icon={BookA}
									onClick={onOpenDictionary}
									title={t("home.dictionaryTitle")}
								/>
							)}
							<FlashcardButton
								preset="icon"
								icon={ChartNoAxesColumn}
								onClick={onOpenStats}
								title={t("home.statsTitle")}
							/>
							<FlashcardButton
								preset="icon"
								icon={RefreshCcw}
								onClick={() => void home.act({ kind: "refresh" })}
								disabled={isMutationBusy}
								title={t("home.refreshTitle")}
								iconClassName={isLoading ? "spinning" : ""}
							/>
							<FlashcardButton
								preset="icon"
								icon={Settings}
								onClick={onOpenSettings}
								title={t("home.pluginSettingsTitle")}
							/>
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

				{snapshot.decks.length === 0 ? (
					<div className={cls("flashcard-empty", styles.empty)}>
						<div className={cls("flashcard-empty-icon", styles.emptyIcon)}>
							<Inbox size={48} />
						</div>
						<p>{t("home.emptyTitle")}</p>
						<p className={cls("flashcard-empty-hint", styles.emptyHint)}>
							{t("home.emptyHint", { tag: "#wordTag" })}
						</p>
						<FlashcardButton variant="primary" icon={Plus} onClick={onOpenAddCard}>
							{t("cardEditor.addCardTitle")}
						</FlashcardButton>
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
								<span
									className={cls(
										"flashcard-deck-index-desktop-title",
										styles.desktopTitle,
									)}
								>
									{t("home.deckIndex")}
								</span>
								<span
									className={cls(
										"flashcard-deck-index-mobile-title",
										styles.mobileTitle,
									)}
								>
									{t("home.otherDecks")}
								</span>
							</div>
							<DndContext
								sensors={sensors}
								collisionDetection={closestCenter}
								onDragEnd={handleDragEnd}
							>
								<SortableContext
									items={visibleDeckIds}
									strategy={rectSortingStrategy}
								>
									<div className={cls("flashcard-deck-list", styles.deckList)}>
										{visibleDecks.map((deck) => (
											<DeckCard
												key={deck.id}
												deck={deck}
												isReorderDisabled={isOrderSaving}
												isRecentlyDropped={
													recentlyDroppedDeckId === deck.id
												}
												onNavigate={onNavigate}
												onExportDeck={handleExportDeck}
												onOpenSourceFile={onOpenSourceFile}
												onOpenSettings={handleOpenDeckSettings}
												isExporting={
													snapshot.export.kind === "exporting" &&
													snapshot.export.deckId === deck.id
												}
												isExportBusy={snapshot.export.kind === "exporting"}
												isSettingsLocked={
													snapshot.settingsDraft !== null &&
													snapshot.settingsDraft.ownerId !== ownerId &&
													(snapshot.settingsDraft.ownerId !== "" ||
														snapshot.settingsDraft.deckId !== deck.id)
												}
											/>
										))}
									</div>
								</SortableContext>
							</DndContext>
						</section>
						<FlashcardButton
							variant="secondary"
							className={cls("flashcard-home-add-card", styles.addCardBtn)}
							icon={Plus}
							onClick={onOpenAddCard}
						>
							{t("cardEditor.addCardTitle")}
						</FlashcardButton>
					</div>
				)}
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
