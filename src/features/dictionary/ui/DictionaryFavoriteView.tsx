import React, { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AlertCircle, Check, Eraser, FileText, Save, Sparkles } from "lucide-react";
import type { DictionaryFavoriteSession } from "../domain/favoriteSession";
import { dictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardInput, FlashcardTextarea } from "../../../core/ui/primitives/Input";
import { FlashcardSelect } from "../../../core/ui/primitives/Select";
import { cls } from "../../../core/shared/classNames";
import styles from "./Dictionary.module.scss";

export interface DictionaryFavoriteViewProps {
	session?: DictionaryFavoriteSession;
	controller?: DictionaryFavoriteSession;
	language: Language;
	onCreateCategory?: () => void;
	wordInputRef?: React.RefObject<HTMLInputElement | null>;
	meaningInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function isSaveShortcut(event: { ctrlKey: boolean; metaKey: boolean; key: string }): boolean {
	return (
		(event.ctrlKey || event.metaKey) &&
		(event.key === "Enter" || event.key === "s" || event.key === "S")
	);
}

/**
 * Determines whether keyboard focus is currently within the favorite view or its hosting context.
 */
export function isFavoritePageFocused(mainEl: HTMLElement): boolean {
	if (!mainEl.isConnected) return false;
	const doc = mainEl.ownerDocument;
	const active = doc.activeElement;
	if (!active) return false;

	if (mainEl.closest('[hidden], [inert], [aria-hidden="true"]')) return false;

	const modalEl = mainEl.closest(".modal");
	if (modalEl) {
		return modalEl.contains(active);
	}

	// When a modal dialog is open in the workspace, background views should not respond.
	if (doc.querySelector(".modal-container")) return false;

	// 1. Direct focus within the favorite page component (input, textarea, select, button, main itself)
	if (mainEl.contains(active)) return true;

	// 2. Focus is within the Obsidian workspace leaf containing this view
	const leafEl = mainEl.closest(".workspace-leaf");
	if (leafEl) {
		if (leafEl.contains(active)) return true;
		const activeTabHeader = doc.querySelector(".workspace-tab-header.is-active");
		if (
			activeTabHeader &&
			activeTabHeader.contains(active) &&
			leafEl.classList.contains("is-active")
		) {
			return true;
		}
	}

	return false;
}

export function DictionaryFavoriteView(props: DictionaryFavoriteViewProps): React.ReactElement {
	const session = props.session ?? props.controller!;
	const { language, onCreateCategory } = props;
	const mainRef = useRef<HTMLElement | null>(null);
	const internalWordRef = useRef<HTMLInputElement | null>(null);
	const wordInputRef = props.wordInputRef ?? internalWordRef;
	const internalMeaningRef = useRef<HTMLTextAreaElement | null>(null);
	const meaningInputRef = props.meaningInputRef ?? internalMeaningRef;
	const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
	const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	const prevStatusRef = useRef(state.status);
	const strings = dictionaryStrings(language);
	const saving = state.status === "saving";
	const generating = state.status === "generating";
	const busy = saving || generating;
	const canSave = Boolean(state.word.trim() && state.selectedCategoryId) && !busy;
	const canGenerate = Boolean(state.word.trim()) && !busy;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		if (event.defaultPrevented || event.nativeEvent.isComposing) return;
		if (isSaveShortcut(event)) {
			event.preventDefault();
			if (canSave) void session.save();
		}
	};

	const handleWordKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (isSaveShortcut(event)) {
			event.preventDefault();
			if (canSave) void session.save();
		} else if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			if (canGenerate) void session.generateAi();
		}
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			!target.closest("input, textarea, select, button, a, label, [contenteditable='true']")
		) {
			event.currentTarget.focus({ preventScroll: true });
		}
	};

	useEffect(() => {
		const mainEl = mainRef.current;
		if (!mainEl) return;
		const doc = mainEl.ownerDocument;

		const handleGlobalKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
			if (!isSaveShortcut(event)) return;
			if (!isFavoritePageFocused(mainEl)) return;

			event.preventDefault();
			if (canSave) {
				void session.save();
			}
		};

		doc.addEventListener("keydown", handleGlobalKeyDown);
		return () => {
			doc.removeEventListener("keydown", handleGlobalKeyDown);
		};
	}, [canSave, session]);

	useEffect(() => {
		const wasBusy =
			prevStatusRef.current === "generating" || prevStatusRef.current === "saving";
		if (wasBusy && state.status === "success") {
			const wordInput = wordInputRef.current;
			if (wordInput) {
				wordInput.focus();
				if (prevStatusRef.current === "saving") {
					wordInput.select?.();
				} else {
					const len = wordInput.value.length;
					wordInput.setSelectionRange?.(len, len);
				}
			}
		}
		prevStatusRef.current = state.status;
	}, [state.status, wordInputRef]);

	const hasContent = Boolean(state.word.trim() || state.meaning.trim() || state.note.trim());

	return (
		/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
		<main
			ref={mainRef}
			tabIndex={-1}
			className={cls(
				"flashcard-dictionary-favorite flashcard-dictionary-page fc-page",
				styles.page,
				styles.favorite,
			)}
			aria-busy={busy}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
		>
			<header className={cls("flashcard-dictionary-favorite-header", styles.favoriteHeader)}>
				<h2>{strings.favoriteSidebarTitle}</h2>
				<div className={styles.favoriteHeaderActions}>
					{hasContent && (
						<FlashcardButton
							type="button"
							preset="icon"
							size="sm"
							variant="ghost"
							icon={Eraser}
							title={strings.favoriteClear}
							aria-label={strings.favoriteClear}
							disabled={busy}
							onClick={() => session.clear()}
						/>
					)}
				</div>
			</header>

			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Form keyboard shortcut for submission */}
			<form
				className={cls(
					"flashcard-dictionary-favorite-form fc-page__content",
					styles.favoriteForm,
				)}
				onKeyDown={handleKeyDown}
				onSubmit={(event) => {
					event.preventDefault();
					if (canSave) void session.save();
				}}
			>
				{/* Card Front: Headword Hero */}
				<div className={styles.cardSection}>
					<div className={styles.cardSectionHeader}>
						<span className={styles.cardSideBadge}>
							{language === "zh" ? "卡片正面 · 词头" : "Card Front · Headword"}
						</span>
					</div>
					<label htmlFor="dictionary-favorite-word" className={styles.favoriteLabel}>
						<span>{strings.favoriteWord}</span>
						<div className={styles.wordHeroRow}>
							<FlashcardInput
								ref={wordInputRef}
								id="dictionary-favorite-word"
								value={state.word}
								placeholder={strings.favoriteWordPlaceholder}
								maxLength={128}
								autoComplete="off"
								spellCheck={false}
								disabled={busy}
								onChange={(event) => session.setWord(event.target.value)}
								onKeyDown={handleWordKeyDown}
							/>
							<FlashcardButton
								type="button"
								variant="ghost"
								className={cls(
									styles.aiInlineBtn,
									generating && styles.isGenerating,
								)}
								disabled={!canGenerate}
								title={`${generating ? strings.favoriteAiGenerating : strings.favoriteAiGenerate} (Enter)`}
								aria-label={`${generating ? strings.favoriteAiGenerating : strings.favoriteAiGenerate} (Enter)`}
								onClick={() => void session.generateAi()}
							>
								<Sparkles size={14} />
								<span>
									{generating
										? strings.favoriteAiGenerating
										: strings.favoriteAiGenerate}
								</span>
								<span className={styles.shortcutKbd}>↵</span>
							</FlashcardButton>
						</div>
					</label>
				</div>

				{/* Card Back: Meaning & Notes */}
				<div className={styles.cardSection}>
					<div className={styles.cardSectionHeader}>
						<span className={styles.cardSideBadge}>
							{language === "zh"
								? "卡片背面 · 释义与笔记"
								: "Card Back · Meaning & Notes"}
						</span>
					</div>
					<label htmlFor="dictionary-favorite-meaning" className={styles.favoriteLabel}>
						<span>{strings.favoriteMeaning}</span>
						<FlashcardTextarea
							ref={meaningInputRef}
							id="dictionary-favorite-meaning"
							className={styles.favoriteMeaningInput}
							value={state.meaning}
							placeholder={strings.favoriteMeaningPlaceholder}
							maxLength={8000}
							rows={3}
							disabled={busy}
							onChange={(event) => session.setMeaning(event.target.value)}
						/>
					</label>

					<label htmlFor="dictionary-favorite-note" className={styles.favoriteLabel}>
						<span>{strings.favoriteNote}</span>
						<FlashcardTextarea
							id="dictionary-favorite-note"
							className={styles.favoriteNoteInput}
							value={state.note}
							placeholder={strings.favoriteNotePlaceholder}
							maxLength={16000}
							rows={4}
							disabled={busy}
							onChange={(event) => session.setNote(event.target.value)}
						/>
					</label>
				</div>

				{/* Destination & Category Row */}
				<div className={styles.metaSection}>
					<div className={styles.fieldLabelRow}>
						<label htmlFor="dictionary-favorite-category">
							{strings.favoriteCategory}
						</label>
						{state.path.trim() && (
							<button
								type="button"
								className={styles.metaPathBtn}
								title={strings.favoriteOpenSourceFile}
								aria-label={`${strings.favoriteOpenSourceFile}: ${state.path}`}
								disabled={busy}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									void session.openSavedFile(state.path);
								}}
							>
								<FileText size={12} aria-hidden="true" />
								<span className={styles.metaPathText}>{state.path}</span>
							</button>
						)}
					</div>
					<FlashcardSelect
						id="dictionary-favorite-category"
						value={state.selectedCategoryId}
						disabled={busy}
						onChange={(event) => {
							if (event.target.value === "__new__") {
								event.currentTarget.value = state.selectedCategoryId;
								onCreateCategory?.();
							} else void session.selectCategory(event.target.value);
						}}
					>
						{state.categories.map((category) => (
							<option key={category.id} value={category.id}>
								{category.name}
							</option>
						))}
						<option value="__new__">{strings.favoriteCategoryCreate}</option>
					</FlashcardSelect>
				</div>

				{/* Bottom Actions and Status */}
				<div
					className={cls("flashcard-dictionary-favorite-actions", styles.favoriteActions)}
				>
					<output
						className={cls(
							"flashcard-dictionary-favorite-message",
							styles.favoriteMessage,
							state.status === "error" && ["is-error", styles.isError],
							state.status === "success" && ["is-success", styles.isSuccess],
						)}
						aria-live="polite"
					>
						{state.status === "error" && <AlertCircle size={14} />}
						{state.status === "success" && <Check size={14} />}
						<span>{state.message}</span>
					</output>

					<div className={styles.primaryActions}>
						<FlashcardButton
							type="submit"
							variant="primary"
							icon={Save}
							disabled={!canSave}
							title={`${saving ? strings.favoriteSaving : strings.favoriteSave} (Ctrl+Enter)`}
						>
							<span>{saving ? strings.favoriteSaving : strings.favoriteSave}</span>
							<span className={styles.shortcutKbd}>Ctrl+↵</span>
						</FlashcardButton>
					</div>
				</div>
			</form>
		</main>
	);
}
