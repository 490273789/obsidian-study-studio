import React, {
	memo,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { BookOpenText, X } from "lucide-react";
import type { Deck } from "../../../../../core/shared/types";
import { shuffleArray } from "../../../../../core/shared/utils";
import {
	buildWordListItems,
	type VisibleWordColumnKey,
	VISIBLE_WORD_COLUMNS,
	type WordListItem,
} from "../../../domain/wordList/wordListPresentationModel";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { ModalSurface } from "../../../../../core/ui/primitives/Modal";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./WordList.module.scss";
import { WordListViewport } from "./wordListViewport";

const COLUMN_STYLES = {
	front: {
		cell: styles.cellFirst,
		text: styles.wordFront,
		button: styles.columnFront,
	},
	back: {
		cell: styles.cellSecond,
		text: styles.wordBack,
		button: styles.columnBack,
	},
};

interface WordListViewProps {
	deck: Deck;
	onBack: () => void;
	onRecordVisit?: (startTimeMs: number, endTimeMs: number) => void;
}

interface WordRowProps {
	item: WordListItem;
	maskedColumns: ReadonlySet<VisibleWordColumnKey>;
	revealedIdsByColumn: Record<VisibleWordColumnKey, ReadonlySet<string>>;
	onReveal: (columnKey: VisibleWordColumnKey, itemId: string) => void;
	onShowExplanation: (item: WordListItem) => void;
}

const WordRow = memo(function WordRow({
	item,
	maskedColumns,
	revealedIdsByColumn,
	onReveal,
	onShowExplanation,
}: WordRowProps) {
	const { t } = useFlashcardI18n();
	const revealTimerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (revealTimerRef.current !== null) {
				window.clearTimeout(revealTimerRef.current);
			}
		};
	}, []);

	return (
		<div className={styles.row}>
			{VISIBLE_WORD_COLUMNS.map((column) => {
				const isMasked = maskedColumns.has(column.key);
				const isRevealed = revealedIdsByColumn[column.key].has(item.id);
				const showContent = !isMasked || isRevealed;
				const value = item[column.key];
				const columnStyle = COLUMN_STYLES[column.key];
				const handleReveal = (e: React.MouseEvent<HTMLButtonElement>) => {
					if (e.detail > 1) return;
					if (revealTimerRef.current !== null) {
						window.clearTimeout(revealTimerRef.current);
					}
					revealTimerRef.current = window.setTimeout(() => {
						revealTimerRef.current = null;
						onReveal(column.key, item.id);
					}, 160);
				};
				const handleShowExplanation = () => {
					if (revealTimerRef.current !== null) {
						window.clearTimeout(revealTimerRef.current);
						revealTimerRef.current = null;
					}
					onShowExplanation(item);
				};

				return (
					<button
						type="button"
						key={column.key}
						className={cls(
							styles.cell,
							columnStyle.cell,
							!showContent && styles.masked,
						)}
						onClick={handleReveal}
						onDoubleClick={handleShowExplanation}
						title={
							isMasked
								? `${t(column.toggleKey)} · ${t("wordList.openThirdColumnHint")}`
								: `${t(column.labelKey)} · ${t("wordList.openThirdColumnHint")}`
						}
					>
						{showContent ? (
							<span className={value ? columnStyle.text : styles.wordEmpty}>
								{value || t("wordList.emptyColumn")}
							</span>
						) : (
							<span className={styles.maskText}>{t("wordList.clickToShow")}</span>
						)}
					</button>
				);
			})}
		</div>
	);
});

interface WordExplanationModalProps {
	item: WordListItem;
	onClose: () => void;
}

const WordExplanationModal = memo(function WordExplanationModal({
	item,
	onClose,
}: WordExplanationModalProps) {
	const { t } = useFlashcardI18n();
	const titleId = useId();
	const subtitleId = useId();

	return (
		<ModalSurface
			className={styles.modal}
			labelledBy={titleId}
			describedBy={subtitleId}
			onRequestClose={onClose}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-modal-header">
						<div className="flashcard-modal-heading">
							<div className="flashcard-modal-kicker fc-kicker">
								<BookOpenText size={14} /> {t("wordList.thirdColumn")}
							</div>
							<span id={titleId} className="flashcard-modal-title">
								{item.front}
							</span>
							<span id={subtitleId} className="flashcard-modal-subtitle">
								{item.back}
							</span>
						</div>
						<FlashcardButton
							preset="icon"
							icon={X}
							onClick={requestClose}
							title={t("common.close")}
							aria-label={t("common.close")}
							{...initialFocusProps}
						/>
					</div>

					<div className="flashcard-modal-body">
						<div className={styles.explanationContent}>
							{item.explanation || t("wordList.emptyColumn")}
						</div>
					</div>
				</>
			)}
		</ModalSurface>
	);
});

export const WordListView = React.memo(function WordListView({
	deck,
	onBack,
	onRecordVisit,
}: WordListViewProps) {
	const { t } = useFlashcardI18n();
	const onRecordVisitRef = useRef(onRecordVisit);
	useEffect(() => {
		onRecordVisitRef.current = onRecordVisit;
	}, [onRecordVisit]);

	useEffect(() => {
		const startTime = Date.now();
		return () => {
			onRecordVisitRef.current?.(startTime, Date.now());
		};
	}, []);
	const sourceItems = useMemo(() => buildWordListItems(deck.cards), [deck.cards]);
	const [maskedColumns, setMaskedColumns] = useState<Set<VisibleWordColumnKey>>(new Set());
	const [shuffledItems, setShuffledItems] = useState<WordListItem[] | null>(null);
	const [revealedIdsByColumn, setRevealedIdsByColumn] = useState<
		Record<VisibleWordColumnKey, Set<string>>
	>({
		front: new Set(),
		back: new Set(),
	});
	const [activeExplanationItem, setActiveExplanationItem] = useState<WordListItem | null>(null);
	const isShuffled = shuffledItems !== null;
	const items = shuffledItems ?? sourceItems;
	const [viewport] = useState(() => new WordListViewport(items));
	useLayoutEffect(() => viewport.setItems(items), [items, viewport]);
	useLayoutEffect(() => viewport.mount(), [viewport]);
	const virtualRows = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot);

	useEffect(() => {
		queueMicrotask(() => {
			setShuffledItems(null);
			setRevealedIdsByColumn({
				front: new Set(),
				back: new Set(),
			});
			setActiveExplanationItem(null);
		});
	}, [sourceItems]);

	const handleShuffleToggle = useCallback(() => {
		setShuffledItems((currentItems) => (currentItems ? null : shuffleArray(sourceItems)));
	}, [sourceItems]);

	const handleReveal = useCallback(
		(columnKey: VisibleWordColumnKey, itemId: string) => {
			if (!maskedColumns.has(columnKey)) return;
			setRevealedIdsByColumn((prev) => {
				const columnIds = new Set(prev[columnKey]);
				if (columnIds.has(itemId)) {
					columnIds.delete(itemId);
				} else {
					columnIds.add(itemId);
				}
				return {
					...prev,
					[columnKey]: columnIds,
				};
			});
		},
		[maskedColumns],
	);

	const handleToggleColumnMask = useCallback((columnKey: VisibleWordColumnKey) => {
		setMaskedColumns((prev) => {
			const next = new Set(prev);
			if (next.has(columnKey)) {
				next.delete(columnKey);
			} else {
				next.add(columnKey);
			}
			return next;
		});
		setRevealedIdsByColumn((prev) => ({
			...prev,
			[columnKey]: new Set(),
		}));
	}, []);

	const handleShowExplanation = useCallback((item: WordListItem) => {
		setActiveExplanationItem(item);
	}, []);

	const handleCloseExplanation = useCallback(() => {
		setActiveExplanationItem(null);
	}, []);

	return (
		<div className="fc-page fc-page--fill">
			<FlashcardHeader
				className={styles.header}
				icon={BookOpenText}
				title={t("wordList.title", {
					deckName: deck.name,
				})}
				right={
					<span className={styles.meta}>
						{t("wordList.subtitle", {
							count: items.length,
							tag: deck.tag,
						})}
					</span>
				}
				onBack={onBack}
			/>

			<div className={styles.toolbar}>
				<FlashcardButton
					variant="primary"
					className={styles.shuffle}
					active={isShuffled}
					onClick={handleShuffleToggle}
				>
					{isShuffled ? t("wordList.restoreOrder") : t("wordList.shuffle")}
				</FlashcardButton>
				{VISIBLE_WORD_COLUMNS.map((column) => {
					const isMasked = maskedColumns.has(column.key);
					return (
						<FlashcardButton
							key={column.key}
							variant={column.variant}
							className={COLUMN_STYLES[column.key].button}
							active={isMasked}
							onClick={() => handleToggleColumnMask(column.key)}
						>
							{isMasked ? t(column.unmaskKey) : t(column.maskKey)}
						</FlashcardButton>
					);
				})}
			</div>

			<div className={styles.scroll} ref={viewport.refs.scroll}>
				<div
					ref={viewport.refs.list}
					className={styles.virtual}
					style={{ height: virtualRows.totalHeight }}
				>
					{virtualRows.rows.map((row) => (
						<div
							key={row.item.id}
							ref={viewport.refs.row(row.item.id)}
							className={styles.rowFrame}
							style={{
								transform: `translateY(${row.top}px)`,
							}}
						>
							<WordRow
								item={row.item}
								maskedColumns={maskedColumns}
								revealedIdsByColumn={revealedIdsByColumn}
								onReveal={handleReveal}
								onShowExplanation={handleShowExplanation}
							/>
						</div>
					))}
				</div>
			</div>
			{activeExplanationItem && (
				<WordExplanationModal
					item={activeExplanationItem}
					onClose={handleCloseExplanation}
				/>
			)}
		</div>
	);
});
