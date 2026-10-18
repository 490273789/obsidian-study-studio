import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
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
	Flame,
	Inbox,
	Plus,
	RefreshCcw,
	Settings,
	Sparkles,
	Target,
	Trophy,
} from "lucide-react";
import type {
	DeckHome,
	DeckHomeDestination,
	DeckHomeSnapshot,
} from "../../../domain/decks/deckHome";
import type { WorkbenchFeatureShortcut } from "../../../../../core/host/workbench";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { DeckSettingsModal } from "../DeckSettings";
import { useFlashcardI18n } from "../../../strings/context";
import { selectDeckCardPresentations, type DeckCardPresentation } from "../../deckCardPresentation";
import { DeckCard } from "./DeckCard/DeckCard";
import { formatDeckCount } from "./deckCountFormat";
import styles from "./DeckList.module.scss";
import { LearningFootprint } from "./LearningFootprint";

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
	shortcuts: readonly WorkbenchFeatureShortcut[];
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
	shortcuts,
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

	const handleHeaderKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setIsHeaderCollapsed((current) => !current);
		}
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
	const deckPresentations = useMemo(
		() => selectDeckCardPresentations(snapshot.decks, snapshot, ownerId),
		[snapshot, ownerId],
	);
	const { sortableRows, completedRows } = useMemo(() => {
		const sortable: DeckCardPresentation[] = [];
		const completed: DeckCardPresentation[] = [];
		for (const presentation of deckPresentations) {
			if (presentation.isDone) completed.push(presentation);
			else sortable.push(presentation);
		}
		return { sortableRows: sortable, completedRows: completed };
	}, [deckPresentations]);
	const visibleOpenMenuDeckId = deckPresentations.some((row) => row.deck.id === openMenuDeckId)
		? openMenuDeckId
		: null;

	const sortableDeckIds = useMemo(() => sortableRows.map((row) => row.deck.id), [sortableRows]);
	const completedDeckIds = useMemo(
		() => completedRows.map((row) => row.deck.id),
		[completedRows],
	);
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
		let started: DeckCardPresentation | null = null;
		let untouched: DeckCardPresentation | null = null;
		for (const row of sortableRows) {
			if (row.deck.stats.newCards <= 0) continue;
			if (row.deck.studyCount > 0) {
				if (!started || row.deck.stats.newCards > started.deck.stats.newCards) {
					started = row;
				}
			} else if (!untouched || row.deck.stats.newCards > untouched.deck.stats.newCards) {
				untouched = row;
			}
		}
		return (started ?? untouched)?.deck ?? null;
	}, [sortableRows]);

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
									<b>{formatDeckCount(language, snapshot.totals.newCards)}</b>
									<span>{t("home.heroUnit")}</span>
								</div>
								<div className={cls("fc-hero__summary", styles.heroSummary)}>
									{nextDeck
										? t("home.heroSummary", {
												decks: snapshot.totals.deckCount,
												learned: formatDeckCount(language, learnedCards),
												deck: nextDeck.name,
											})
										: t("home.heroSummaryNoTarget", {
												decks: snapshot.totals.deckCount,
												learned: formatDeckCount(language, learnedCards),
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

								<ReorderableList
									interaction={sorting}
									language={language}
									strategy={rectSortingStrategy}
								>
									<div className={cls("flashcard-deck-list", styles.deckList)}>
										{visibleRows.map((presentation) => (
											<DeckCard
												key={presentation.deck.id}
												presentation={presentation}
												language={language}
												isRecentlyDropped={
													recentlyDroppedDeckId === presentation.deck.id
												}
												isMenuOpen={
													visibleOpenMenuDeckId === presentation.deck.id
												}
												onNavigate={onNavigate}
												onExport={handleExportDeck}
												onOpenSourceFile={onOpenSourceFile}
												onOpenSettings={handleOpenDeckSettings}
												onMenuOpenChange={handleMenuOpenChange}
											/>
										))}

										{completedRows.length > 0 && (
											<div className={cls("fc-group", styles.completedGroup)}>
												<button
													type="button"
													className={cls(
														"flashcard-completed-group-toggle fc-disclosure",
														styles.completedGroupHead,
													)}
													aria-expanded={isCompletedGroupOpen}
													aria-controls={completedGroupId}
													aria-label={t("home.completedGroup", {
														count: completedRows.length,
													})}
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
													<span
														className={styles.completedCount}
														aria-hidden="true"
													>
														{formatDeckCount(
															language,
															completedRows.length,
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
														completedRows.map((presentation) => (
															<DeckCard
																key={presentation.deck.id}
																presentation={presentation}
																language={language}
																isRecentlyDropped={false}
																isMenuOpen={
																	visibleOpenMenuDeckId ===
																	presentation.deck.id
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

function orderDeckRows(
	rows: readonly DeckCardPresentation[],
	deckIds: readonly string[],
): DeckCardPresentation[] {
	const rowsById = new Map(rows.map((row) => [row.deck.id, row]));
	const orderedRows = deckIds
		.map((deckId) => rowsById.get(deckId))
		.filter((row): row is DeckCardPresentation => row !== undefined);
	const seen = new Set(orderedRows.map((row) => row.deck.id));
	return [...orderedRows, ...rows.filter((row) => !seen.has(row.deck.id))];
}
