import React, { useCallback, useSyncExternalStore } from "react";
import { Eraser, Save, Sparkles } from "lucide-react";
import type { DictionaryFavoriteController } from "../domain/favorite-controller";
import { dictionaryStrings } from "../strings/dictionary";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardInput, FlashcardTextarea } from "../../../core/ui/primitives/Input";
import { cls } from "../../../core/shared/classNames";
import styles from "./Dictionary.module.scss";

export interface DictionaryFavoriteViewProps {
	controller: DictionaryFavoriteController;
	language: Language;
}

export function DictionaryFavoriteView({
	controller,
	language,
}: DictionaryFavoriteViewProps): React.ReactElement {
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	const strings = dictionaryStrings(language);
	const saving = state.status === "saving";
	const generating = state.status === "generating";
	const busy = saving || generating;
	const canSave = Boolean(state.word.trim() && state.path.trim()) && !busy;
	const canGenerate = Boolean(state.word.trim()) && !busy;

	return (
		<main
			className={cls(
				"flashcard-dictionary-favorite flashcard-dictionary-page fc-page fc-page--column",
				styles.page,
				styles.favorite,
			)}
			aria-busy={busy}
		>
			<header className={cls("flashcard-dictionary-favorite-header", styles.favoriteHeader)}>
				<p className="fc-kicker">{strings.favoriteSidebarEyebrow}</p>
				<h2>{strings.favoriteSidebarTitle}</h2>
			</header>

			<p
				className={cls(
					"flashcard-dictionary-favorite-destination",
					styles.favoriteDestination,
				)}
			>
				<span>{strings.favoritePath}</span>
				<FlashcardButton
					type="button"
					variant="ghost"
					size="sm"
					title={state.savedPath}
					disabled={busy}
					onClick={() => void controller.openSavedFile()}
				>
					{state.savedPath}
				</FlashcardButton>
			</p>

			<form
				className={cls("flashcard-dictionary-favorite-form", styles.favoriteForm)}
				onSubmit={(event) => {
					event.preventDefault();
					if (canSave) void controller.save();
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
						onChange={(event) => controller.setWord(event.target.value)}
					/>
				</label>

				<label htmlFor="dictionary-favorite-path">
					<span>{strings.favoritePath}</span>
					<FlashcardInput
						id="dictionary-favorite-path"
						value={state.path}
						list="dictionary-favorite-path-suggestions"
						placeholder={strings.favoritePathPlaceholder}
						maxLength={500}
						autoComplete="off"
						spellCheck={false}
						disabled={busy}
						onChange={(event) => controller.setPath(event.target.value)}
					/>
				</label>
				<datalist id="dictionary-favorite-path-suggestions">
					{state.pathSuggestions.map((path) => (
						<option key={path} value={path}>
							{path}
						</option>
					))}
				</datalist>

				<label htmlFor="dictionary-favorite-meaning">
					<span>{strings.favoriteMeaning}</span>
					<FlashcardTextarea
						id="dictionary-favorite-meaning"
						value={state.meaning}
						placeholder={strings.favoriteMeaningPlaceholder}
						maxLength={8000}
						rows={3}
						disabled={busy}
						onChange={(event) => controller.setMeaning(event.target.value)}
					/>
				</label>

				<label htmlFor="dictionary-favorite-note">
					<span>{strings.favoriteNote}</span>
					<FlashcardTextarea
						id="dictionary-favorite-note"
						value={state.note}
						placeholder={strings.favoriteNotePlaceholder}
						maxLength={16000}
						rows={5}
						disabled={busy}
						onChange={(event) => controller.setNote(event.target.value)}
					/>
				</label>

				<div
					className={cls("flashcard-dictionary-favorite-actions", styles.favoriteActions)}
				>
					<FlashcardButton
						type="submit"
						variant="primary"
						icon={Save}
						disabled={!canSave}
					>
						{saving ? strings.favoriteSaving : strings.favoriteSave}
					</FlashcardButton>
					<FlashcardButton
						type="button"
						icon={Sparkles}
						disabled={!canGenerate}
						onClick={() => void controller.generateAi()}
					>
						{generating ? strings.favoriteAiGenerating : strings.favoriteAiGenerate}
					</FlashcardButton>
					<FlashcardButton
						type="button"
						icon={Eraser}
						disabled={busy}
						onClick={() => controller.clear()}
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
