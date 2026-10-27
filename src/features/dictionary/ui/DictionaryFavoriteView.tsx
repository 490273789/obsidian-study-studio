import React, { useCallback, useSyncExternalStore } from "react";
import { Eraser, ExternalLink, Save, Sparkles } from "lucide-react";
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
}

export function DictionaryFavoriteView(props: DictionaryFavoriteViewProps): React.ReactElement {
	const session = props.session ?? props.controller!;
	const { language, onCreateCategory } = props;
	const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
	const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	const strings = dictionaryStrings(language);
	const saving = state.status === "saving";
	const generating = state.status === "generating";
	const busy = saving || generating;
	const canSave = Boolean(state.word.trim() && state.selectedCategoryId) && !busy;
	const canGenerate = Boolean(state.word.trim()) && !busy;

	const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
		if (event.nativeEvent.isComposing) return;
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
			event.preventDefault();
			if (canSave) void session.save();
		}
	};

	const handleWordKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Enter") {
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				if (canSave) void session.save();
			} else if (!event.shiftKey && !event.altKey) {
				event.preventDefault();
				if (canGenerate) void session.generateAi();
			}
		}
	};

	return (
		<main
			className={cls(
				"flashcard-dictionary-favorite flashcard-dictionary-page fc-page",
				styles.page,
				styles.favorite,
			)}
			aria-busy={busy}
		>
			<header className={cls("flashcard-dictionary-favorite-header", styles.favoriteHeader)}>
				<h2>{strings.favoriteSidebarTitle}</h2>
			</header>

			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Form keyboard shortcut for Ctrl+Enter submission */}
			<form
				className={cls(
					"flashcard-dictionary-favorite-form fc-page__content",
					styles.favoriteForm,
				)}
				onKeyDown={handleFormKeyDown}
				onSubmit={(event) => {
					event.preventDefault();
					if (canSave) void session.save();
				}}
			>
				<label htmlFor="dictionary-favorite-word">
					<span>{strings.favoriteWord}</span>
					<FlashcardInput
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
				</label>

				<label htmlFor="dictionary-favorite-category">
					<span>{strings.favoriteCategory}</span>
					<div className={styles.favoritePathRow}>
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
						<FlashcardButton
							type="button"
							preset="icon"
							icon={ExternalLink}
							title={strings.favoriteOpenSourceFile}
							aria-label={strings.favoriteOpenSourceFile}
							disabled={busy || !state.path.trim()}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void session.openSavedFile(state.path);
							}}
						/>
					</div>
				</label>

				<label htmlFor="dictionary-favorite-meaning">
					<span>{strings.favoriteMeaning}</span>
					<FlashcardTextarea
						id="dictionary-favorite-meaning"
						className={styles.favoriteMeaningInput}
						value={state.meaning}
						placeholder={strings.favoriteMeaningPlaceholder}
						maxLength={8000}
						rows={5}
						disabled={busy}
						onChange={(event) => session.setMeaning(event.target.value)}
					/>
				</label>

				<label htmlFor="dictionary-favorite-note">
					<span>{strings.favoriteNote}</span>
					<FlashcardTextarea
						id="dictionary-favorite-note"
						className={styles.favoriteNoteInput}
						value={state.note}
						placeholder={strings.favoriteNotePlaceholder}
						maxLength={16000}
						rows={10}
						disabled={busy}
						onChange={(event) => session.setNote(event.target.value)}
					/>
				</label>

				<div
					className={cls("flashcard-dictionary-favorite-actions", styles.favoriteActions)}
				>
					<FlashcardButton
						type="button"
						icon={Sparkles}
						disabled={!canGenerate}
						title={`${generating ? strings.favoriteAiGenerating : strings.favoriteAiGenerate} (Enter)`}
						onClick={() => void session.generateAi()}
					>
						{generating ? strings.favoriteAiGenerating : strings.favoriteAiGenerate}
					</FlashcardButton>
					<FlashcardButton
						type="submit"
						variant="primary"
						icon={Save}
						disabled={!canSave}
						title={`${saving ? strings.favoriteSaving : strings.favoriteSave} (Ctrl+Enter)`}
					>
						{saving ? strings.favoriteSaving : strings.favoriteSave}
					</FlashcardButton>
					<FlashcardButton
						type="button"
						icon={Eraser}
						disabled={busy}
						onClick={() => session.clear()}
					>
						{strings.favoriteClear}
					</FlashcardButton>
				</div>

				<output
					className={cls(
						"flashcard-dictionary-favorite-message",
						styles.favoriteMessage,
						state.status === "error" && ["is-error", styles.isError],
					)}
					aria-live="polite"
				>
					{state.message}
				</output>
			</form>
		</main>
	);
}
