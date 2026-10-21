import { memo, useCallback, useEffect, useId, useRef } from "react";
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
	Ellipsis,
	RefreshCcw,
	Settings,
	Target,
	TriangleAlert,
} from "lucide-react";
import { cls } from "../../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../../core/ui/primitives/Button";
import type { FlashcardMenuItem } from "../../../../../../core/ui/primitives/Menu";
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
	const overlayId = useId();
	const rowRef = useRef<HTMLElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const firstActionRef = useRef<HTMLButtonElement>(null);
	const restoreFocusRef = useRef(false);
	const {
		attributes,
		isDragging,
		listeners,
		setActivatorNodeRef,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id: deck.id });
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
			rowRef.current = node;
			setNodeRef(node);
			setActivatorNodeRef(node);
		},
		[setNodeRef, setActivatorNodeRef],
	);

	const { state, learnedCards, progressPercent, isDone } = selectDeckCardMetrics(deck);
	const { totalCards, newCards } = deck.stats;
	const spellingReady = deck.spelling.ready;

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
	const firstEnabledAction = moreActions.findIndex((action) => !action.disabled);
	useEffect(() => {
		if (!isMenuOpen) {
			if (restoreFocusRef.current) {
				restoreFocusRef.current = false;
				triggerRef.current?.focus();
			}
			return;
		}
		firstActionRef.current?.focus();
		const ownerDocument = rowRef.current?.ownerDocument;
		if (!ownerDocument) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (!rowRef.current?.contains(event.target as Node | null)) {
				onMenuOpenChange(deck.id, false);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			restoreFocusRef.current = true;
			onMenuOpenChange(deck.id, false);
		};
		ownerDocument.addEventListener("pointerdown", handlePointerDown);
		ownerDocument.addEventListener("keydown", handleKeyDown);
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointerDown);
			ownerDocument.removeEventListener("keydown", handleKeyDown);
		};
	}, [deck.id, isMenuOpen, onMenuOpenChange]);

	const closeOverlay = () => {
		restoreFocusRef.current = true;
		onMenuOpenChange(deck.id, false);
	};

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
			tabIndex={isMenuOpen ? -1 : attributes.tabIndex}
			aria-label={t("home.openDeck", { deckName: deck.name })}
		>
			<div className="flashcard-deck-main fc-rail-row__main" inert={isMenuOpen}>
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

					<div className="flashcard-deck-meta fc-meta">
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
					</div>
				</div>
			</div>

			<div className="flashcard-deck-count fc-rail-row__count" inert={isMenuOpen}>
				{isDone ? (
					<span className="flashcard-deck-done fc-rail-row__badge">
						<Check size={13} aria-hidden="true" />
						{t("home.deckCompleted")}
					</span>
				) : (
					<>
						<b>{formatDeckCount(language, newCards)}</b>
						<span>{t("home.deckPending")}</span>
					</>
				)}
			</div>

			<div
				className="flashcard-deck-side fc-rail-row__actions"
				inert={isMenuOpen}
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
						ref={triggerRef}
						preset="icon"
						icon={Ellipsis}
						className={cls("flashcard-deck-action-more", styles.actionMore)}
						title={t("home.showMoreActions")}
						aria-label={t("home.showMoreActions")}
						aria-expanded={isMenuOpen}
						aria-controls={overlayId}
						onClick={() => onMenuOpenChange(deck.id, !isMenuOpen)}
					/>
				</div>
			</div>
			{isMenuOpen && (
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Fence pointer starts inside the fieldset so the row's dnd-kit listeners cannot begin a drag.
				<fieldset
					id={overlayId}
					className={styles.actionOverlay}
					aria-label={t("home.moreActions")}
					onPointerDown={(event) => event.stopPropagation()}
					onMouseDown={(event) => event.stopPropagation()}
					onTouchStart={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") event.stopPropagation();
					}}
				>
					<button
						type="button"
						className={styles.overlayBackdrop}
						tabIndex={-1}
						aria-label={t("home.hideMoreActions")}
						onClick={(event) => {
							event.stopPropagation();
							closeOverlay();
						}}
					/>
					<div className={styles.overlayActions}>
						{moreActions.map((action, index) => (
							<FlashcardButton
								key={action.key}
								ref={index === firstEnabledAction ? firstActionRef : undefined}
								variant="neutral"
								size="sm"
								icon={action.icon}
								iconClassName={action.iconClassName}
								className={styles.overlayAction}
								disabled={action.disabled}
								title={action.title}
								onClick={(event) => {
									event.stopPropagation();
									onMenuOpenChange(deck.id, false);
									action.onSelect();
								}}
							>
								{action.label}
							</FlashcardButton>
						))}
					</div>
					<FlashcardButton
						preset="icon"
						icon={Ellipsis}
						className={styles.overlayClose}
						title={t("home.hideMoreActions")}
						aria-label={t("home.hideMoreActions")}
						onClick={(event) => {
							event.stopPropagation();
							closeOverlay();
						}}
					/>
				</fieldset>
			)}
		</article>
	);
});
