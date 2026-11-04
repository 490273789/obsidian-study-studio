import React, {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { rectSortingStrategy } from "@dnd-kit/sortable";
import {
	ReorderableList,
	useSortableInteraction,
} from "../../../../../core/ui/primitives/Sortable/Sortable";
import {
	BookOpen,
	Brain,
	ChartNoAxesColumn,
	ChevronDown,
	ChevronRight,
	Inbox,
	Plus,
	RefreshCcw,
	Settings,
	Sparkles,
	Trophy,
} from "lucide-react";
import type {
	DeckHome,
	DeckHomeDeckSnapshot,
	DeckHomeDestination,
	DeckHomeSnapshot,
} from "../../../domain/decks/deckHome";
import { getStudyPlanSummary } from "../../../domain/sessions/studyPlanSummary";
import type { DeckSettingsDraftSession } from "../../../domain/decks/deckSettingsDraftSession";
import type { WorkbenchFeatureShortcut } from "../../../../../core/host/workbench";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { DeckSettingsModal } from "../DeckSettings";
import { useFlashcardI18n } from "../../../strings/context";
import { selectContinueDeck, selectDeckVisualState } from "../../homePresentation";
import { DeckCard } from "./DeckCard/DeckCard";
import { formatDeckCount } from "./deckCountFormat";
import styles from "./DeckList.module.scss";
import { LearningFootprint } from "./LearningFootprint";

// ── DeckList ─────────────────────────────────────────────────────────────────

interface DeckListProps {
	snapshot: DeckHomeSnapshot;
	home: DeckHome;
	ownerId: string;
	settingsDraftSession?: DeckSettingsDraftSession;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onRequestMigration: (deckId?: string) => Promise<boolean>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenStats: () => void;
	onOpenSettings: () => void;
	onOpenAddCard: () => void;
	onOpenChallenge?: () => void;
	shortcuts: readonly WorkbenchFeatureShortcut[];
}

export const DeckList = React.memo(function DeckList({
	snapshot,
	home,
	ownerId,
	settingsDraftSession,
	onNavigate,
	onRequestMigration,
	onOpenSourceFile,
	onOpenStats,
	onOpenSettings,
	onOpenAddCard,
	onOpenChallenge,
	shortcuts,
}: DeckListProps) {
	const { t, language } = useFlashcardI18n();
	const isLoading = snapshot.mutation.kind === "refreshing";
	const completedGroupId = useId();
	const headerActionsId = `${completedGroupId}-header-actions`;
	const isMutationBusy = snapshot.mutation.kind !== "idle";
	const isMigrating =
		snapshot.mutation.kind === "preparing-migration" ||
		snapshot.mutation.kind === "awaiting-confirmation" ||
		snapshot.mutation.kind === "migrating";
	const subscribeDraft = useCallback(
		(listener: () => void) => settingsDraftSession?.subscribe(listener) ?? (() => {}),
		[settingsDraftSession],
	);
	const readDraft = useCallback(
		() => settingsDraftSession?.getSnapshot() ?? null,
		[settingsDraftSession],
	);
	const draftSnapshot = useSyncExternalStore(subscribeDraft, readDraft, readDraft);
	const draft = draftSnapshot?.ownerId === ownerId ? draftSnapshot : null;
	const [recentlyDroppedDeckId, setRecentlyDroppedDeckId] = useState<string | null>(null);
	const [openMenuDeckId, setOpenMenuDeckId] = useState<string | null>(null);
	const [isCompletedGroupOpen, setIsCompletedGroupOpen] = useState(false);
	const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);
	useEffect(() => {
		if (recentlyDroppedDeckId === null) return;
		const frame = requestAnimationFrame(() => setRecentlyDroppedDeckId(null));
		return () => cancelAnimationFrame(frame);
	}, [recentlyDroppedDeckId]);

	const handleToggleHeader = useCallback(() => {
		setIsHeaderCollapsed((current) => !current);
	}, []);

	const handleMenuOpenChange = useCallback((deckId: string, open: boolean) => {
		setOpenMenuDeckId((current) => (open ? deckId : current === deckId ? null : current));
	}, []);

	/**
	 * Finished decks leave the sortable list so the working set stays readable.
	 * The split is presentation only: `deckOrder` still holds every deck id, and
	 * the reorder action writes the working set back with the finished
	 * decks appended in their existing order.
	 */
	const { sortableRows, completedRows, completedDueCards } = useMemo(() => {
		const sortable: DeckHomeDeckSnapshot[] = [];
		const completed: DeckHomeDeckSnapshot[] = [];
		let dueCards = 0;
		for (const deck of snapshot.decks) {
			if (selectDeckVisualState(deck) === "done") {
				completed.push(deck);
				dueCards += deck.stats.dueCards;
			} else {
				sortable.push(deck);
			}
		}
		return { sortableRows: sortable, completedRows: completed, completedDueCards: dueCards };
	}, [snapshot.decks]);
	const visibleOpenMenuDeckId = snapshot.decks.some((deck) => deck.id === openMenuDeckId)
		? openMenuDeckId
		: null;

	const sortableDeckIds = useMemo(() => sortableRows.map((deck) => deck.id), [sortableRows]);
	const completedDeckIds = useMemo(() => completedRows.map((deck) => deck.id), [completedRows]);
	const { interaction: sorting, snapshot: sortingSnapshot } = useSortableInteraction({
		items: sortableDeckIds,
		disabled: visibleOpenMenuDeckId !== null,
		optimistic: true,
		onMove: async ({ activeId, items }) => {
			setRecentlyDroppedDeckId(activeId);
			await home.act({ kind: "reorder", deckIds: [...items, ...completedDeckIds] });
		},
	});
	const visibleDeckIds = sortingSnapshot.items;
	const visibleRows = useMemo(
		() => orderDeckRows(sortableRows, visibleDeckIds),
		[sortableRows, visibleDeckIds],
	);
	const handleCloseModal = useCallback(() => {
		settingsDraftSession?.cancel(ownerId);
	}, [settingsDraftSession, ownerId]);

	const handleExportDeck = useCallback(
		async (deckId: string) => {
			await home.act({ kind: "export", deckId });
		},
		[home],
	);

	const handleOpenDeckSettings = useCallback(
		(deckId: string) => {
			settingsDraftSession?.open(deckId, ownerId);
		},
		[settingsDraftSession, ownerId],
	);

	const nextDeck = useMemo(() => selectContinueDeck(snapshot.decks), [snapshot.decks]);
	const todayPlan = nextDeck
		? getStudyPlanSummary(nextDeck.stats, nextDeck.effectiveStudySettings)
		: null;
	const shouldReview = todayPlan !== null && todayPlan.todayReviewCount > 0;
	const isFresh = nextDeck !== null && selectDeckVisualState(nextDeck) === "fresh";
	const allNewCardsLearned = snapshot.totals.newCards === 0;

	/** Another view's settings draft blocks a row unless that draft targets it. */
	const isSettingsLocked = (deckId: string): boolean => {
		if (settingsDraftSession) {
			return settingsDraftSession.isLocked(deckId, ownerId);
		}
		return false;
	};

	return (
		<>
			<div className="flashcard-home fc-page fc-page--fill">
				<FlashcardHeader
					className={cls(styles.homeHeader, isHeaderCollapsed && styles.isCollapsed)}
					icon={BookOpen}
					title={t("home.title")}
					badge={
						<button
							type="button"
							className={styles.headerToggle}
							aria-label={t(
								isHeaderCollapsed ? "home.expandTools" : "home.collapseTools",
							)}
							aria-expanded={!isHeaderCollapsed}
							aria-controls={headerActionsId}
							onClick={(event) => {
								event.stopPropagation();
								handleToggleHeader();
							}}
						>
							<ChevronDown
								size={16}
								className={cls(
									styles.collapseIcon,
									!isHeaderCollapsed && styles.isExpanded,
								)}
								aria-hidden="true"
							/>
						</button>
					}
					onClick={handleToggleHeader}
					right={
						// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Header actions stop click propagation so clicking action buttons does not toggle header collapse.
						<div
							id={headerActionsId}
							className="flashcard-header-actions"
							onClick={(event) => event.stopPropagation()}
						>
							{shortcuts.length > 0 && (
								<div className={styles.headerGroup}>
									{shortcuts.map((shortcut) => (
										<FlashcardButton
											key={shortcut.id}
											preset="icon"
											icon={shortcut.icon}
											onClick={shortcut.open}
											title={shortcut.title}
											aria-label={shortcut.title}
										/>
									))}
								</div>
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
						className={cls(
							"flashcard-identity-migration-card fc-page__content",
							styles.migrationCard,
						)}
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
						<div className={styles.overview}>
							<section className={cls("flashcard-home-hero fc-hero", styles.hero)}>
								<div className={styles.heroMain}>
									<h2 className={styles.resumeTitle}>
										{nextDeck
											? t(
													shouldReview
														? "home.reviewHeading"
														: isFresh
															? "home.startHeading"
															: "home.resumeHeading",
													{ deck: nextDeck.name },
												)
											: t(
													allNewCardsLearned
														? "home.allDoneHeading"
														: "home.noPlanHeading",
												)}
									</h2>
									<p className={styles.resumeDetail}>
										{todayPlan
											? t("home.todayPlan", {
													total: formatDeckCount(
														language,
														todayPlan.todayTotal,
													),
													newCards: formatDeckCount(
														language,
														todayPlan.todayNewCount,
													),
													reviews: formatDeckCount(
														language,
														todayPlan.todayReviewCount,
													),
												})
											: t("home.noPlanHint")}
									</p>
								</div>
								{nextDeck && (
									<div className="fc-hero__side">
										<FlashcardButton
											variant="primary"
											size="md"
											className={styles.resumeButton}
											icon={shouldReview ? RefreshCcw : Brain}
											onClick={() => onNavigate("study", nextDeck.id)}
										>
											{t(
												shouldReview
													? "home.openStudyPlan"
													: isFresh
														? "home.startStudy"
														: "home.continueStudy",
											)}
										</FlashcardButton>
									</div>
								)}
							</section>
							<LearningFootprint
								key={snapshot.learningFootprint.today.date}
								footprint={snapshot.learningFootprint}
								className={styles.overviewFootprint}
							/>
						</div>
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
									icon={Trophy}
									onClick={onOpenChallenge}
									title={t("home.challengeGuide")}
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
									<span className={styles.deckIndexPending}>
										{t("home.deckPendingSummary", {
											count: formatDeckCount(
												language,
												snapshot.totals.newCards,
											),
										})}
									</span>
								</div>
								<div className={styles.modeGuide}>
									<span>{t("home.studyGuide")}</span>
									<span>{t("home.practiceGuide")}</span>
									<span>{t("home.challengeGuide")}</span>
								</div>

								<ReorderableList
									interaction={sorting}
									language={language}
									strategy={rectSortingStrategy}
								>
									<div className={cls("flashcard-deck-list", styles.deckList)}>
										{visibleRows.map((deck) => (
											<DeckCard
												key={deck.id}
												deck={deck}
												isSettingsLocked={isSettingsLocked(deck.id)}
												isExporting={
													snapshot.export.kind === "exporting" &&
													snapshot.export.deckId === deck.id
												}
												isExportBusy={snapshot.export.kind === "exporting"}
												language={language}
												isRecentlyDropped={
													recentlyDroppedDeckId === deck.id
												}
												isMenuOpen={visibleOpenMenuDeckId === deck.id}
												onNavigate={onNavigate}
												onExport={handleExportDeck}
												onOpenSourceFile={onOpenSourceFile}
												onOpenSettings={handleOpenDeckSettings}
												onMenuOpenChange={handleMenuOpenChange}
											/>
										))}

										{completedRows.length > 0 && (
											<div className="fc-group">
												<button
													type="button"
													className={cls(
														"flashcard-completed-group-toggle fc-disclosure",
														styles.completedGroupHead,
													)}
													aria-expanded={isCompletedGroupOpen}
													aria-controls={completedGroupId}
													onClick={() => {
														setIsCompletedGroupOpen(
															(current) => !current,
														);
														setOpenMenuDeckId(null);
													}}
												>
													{isCompletedGroupOpen ? (
														<ChevronDown size={13} aria-hidden="true" />
													) : (
														<ChevronRight
															size={13}
															aria-hidden="true"
														/>
													)}
													<span>{t("home.completedGroupTitle")}</span>
													<span className={styles.completedCount}>
														{t("home.deckCountValue", {
															count: formatDeckCount(
																language,
																completedRows.length,
															),
														})}
													</span>
													{completedDueCards > 0 && (
														<span className={styles.completedDue}>
															{t("home.dueReviewCount", {
																count: formatDeckCount(
																	language,
																	completedDueCards,
																),
															})}
														</span>
													)}
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
														completedRows.map((deck) => (
															<DeckCard
																key={deck.id}
																deck={deck}
																isSettingsLocked={isSettingsLocked(
																	deck.id,
																)}
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
																language={language}
																isRecentlyDropped={false}
																isMenuOpen={
																	visibleOpenMenuDeckId ===
																	deck.id
																}
																onNavigate={onNavigate}
																onExport={handleExportDeck}
																onOpenSourceFile={onOpenSourceFile}
																onOpenSettings={
																	handleOpenDeckSettings
																}
																onMenuOpenChange={
																	handleMenuOpenChange
																}
															/>
														))}
												</div>
											</div>
										)}
									</div>
								</ReorderableList>
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
									icon={Trophy}
									onClick={onOpenChallenge}
									title={t("home.challengeGuide")}
								>
									{t("challenge.title")}
								</FlashcardButton>
							</div>
						</div>
					)}
					{snapshot.decks.length === 0 && (
						<LearningFootprint
							key={snapshot.learningFootprint.today.date}
							footprint={snapshot.learningFootprint}
						/>
					)}
				</div>
			</div>

			{draft && (
				<DeckSettingsModal
					draft={draft}
					isSaving={draft.isSaving}
					isMigratingIdentity={isMigrating}
					onChange={(change) => {
						settingsDraftSession?.change(ownerId, change);
					}}
					onSave={async () => {
						await settingsDraftSession?.save(ownerId);
					}}
					onOpenSourceFile={() => onOpenSourceFile(draft.filePath)}
					onMigrateIdentity={() => onRequestMigration(draft.deckId)}
					onClose={handleCloseModal}
				/>
			)}
		</>
	);
});

function orderDeckRows(
	rows: readonly DeckHomeDeckSnapshot[],
	deckIds: readonly string[],
): readonly DeckHomeDeckSnapshot[] {
	if (rows.length === 0 || deckIds.length === 0) return rows;
	if (rows.length === deckIds.length) {
		let matches = true;
		for (let i = 0; i < rows.length; i++) {
			if (rows[i]!.id !== deckIds[i]) {
				matches = false;
				break;
			}
		}
		if (matches) return rows;
	}
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	const orderedRows = deckIds
		.map((deckId) => rowsById.get(deckId))
		.filter((row): row is DeckHomeDeckSnapshot => row !== undefined);
	const seen = new Set(orderedRows.map((row) => row.id));
	return [...orderedRows, ...rows.filter((row) => !seen.has(row.id))];
}
