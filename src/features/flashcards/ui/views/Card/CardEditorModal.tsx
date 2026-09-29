import React, { memo, useCallback, useId, useMemo, useState } from "react";
import { FilePlus2, Pencil, Sparkles, X } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardTextarea } from "../../../../../core/ui/primitives/Input";
import { FlashcardSelect } from "../../../../../core/ui/primitives/Select";
import { useFlashcardI18n } from "../../../strings/context";
import { ModalSurface } from "../../../../../core/ui/primitives/Modal";
import styles from "./CardEditorModal.module.scss";
import type { CardEditorDraft } from "../../cardEditingInteraction";

export type CardEditorMode = "create" | "edit";

export interface CardEditorDeckOption {
	readonly id: string;
	readonly name: string;
	readonly tag: string;
}

export type CardEditorSavePayload = CardEditorDraft;

interface CardEditorModalProps {
	mode: CardEditorMode;
	decks: ReadonlyArray<CardEditorDeckOption>;
	initialDeckId: string | null;
	initialFront: string;
	initialBack: string;
	initialExplanation: string;
	isSaving: boolean;
	error: string | null;
	onSave: (payload: CardEditorSavePayload) => Promise<void>;
	onClose: () => void;
}

export const CardEditorModal = memo(function CardEditorModal({
	mode,
	decks,
	initialDeckId,
	initialFront,
	initialBack,
	initialExplanation,
	isSaving,
	error,
	onSave,
	onClose,
}: CardEditorModalProps) {
	const { t } = useFlashcardI18n();
	const defaultDeckId = initialDeckId ?? decks[0]?.id ?? "";
	const [deckId, setDeckId] = useState(defaultDeckId);
	const [front, setFront] = useState(initialFront);
	const [back, setBack] = useState(initialBack);
	const [explanation, setExplanation] = useState(initialExplanation);
	const titleId = useId();
	const subtitleId = useId();

	const selectedDeck = useMemo(() => decks.find((deck) => deck.id === deckId), [deckId, decks]);

	const title = mode === "edit" ? t("cardEditor.editTitle") : t("cardEditor.createTitle");
	const Icon = mode === "edit" ? Pencil : FilePlus2;

	const handleSave = useCallback(
		() => onSave({ deckId, front, back, explanation }),
		[back, deckId, explanation, front, onSave],
	);

	return (
		<ModalSurface
			className={cls("flashcard-card-editor-modal", styles.modal)}
			labelledBy={titleId}
			describedBy={subtitleId}
			onRequestClose={onClose}
			isDismissible={!isSaving}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-modal-header">
						<div className="flashcard-modal-heading">
							<div className="flashcard-modal-kicker fc-kicker">
								<Sparkles size={14} /> {t("cardEditor.kicker")}
							</div>
							<span id={titleId} className="flashcard-modal-title">
								<Icon size={17} /> {title}
							</span>
							<span id={subtitleId} className="flashcard-modal-subtitle">
								{selectedDeck
									? t("cardEditor.subtitle", {
											deckName: selectedDeck.name,
										})
									: t("cardEditor.selectDeck")}
							</span>
						</div>
						<FlashcardButton
							preset="icon"
							icon={X}
							onClick={requestClose}
							disabled={isSaving}
							title={t("common.close")}
							aria-label={t("common.close")}
						/>
					</div>

					<div className={cls("flashcard-modal-body", styles.body)}>
						{mode === "create" && (
							<label className={styles.field}>
								<span>{t("cardEditor.selectDeck")}</span>
								<FlashcardSelect
									value={deckId}
									onChange={(e) => setDeckId(e.target.value)}
									disabled={isSaving}
									{...initialFocusProps}
								>
									{decks.map((deck) => (
										<option key={deck.id} value={deck.id}>
											{deck.name} · {deck.tag}
										</option>
									))}
								</FlashcardSelect>
							</label>
						)}

						<label className={styles.field}>
							<span>{t("common.cardFront")}</span>
							<FlashcardTextarea
								value={front}
								onChange={(e) => setFront(e.target.value)}
								placeholder={t("cardEditor.frontPlaceholder")}
								disabled={isSaving}
								rows={7}
								{...(mode === "edit" ? initialFocusProps : {})}
							/>
						</label>

						<label className={styles.field}>
							<span>{t("common.cardBack")}</span>
							<FlashcardTextarea
								value={back}
								onChange={(e) => setBack(e.target.value)}
								placeholder={t("cardEditor.backPlaceholder")}
								disabled={isSaving}
								rows={7}
							/>
						</label>

						<label className={styles.field}>
							<span>{t("common.explanationOptional")}</span>
							<FlashcardTextarea
								value={explanation}
								onChange={(e) => setExplanation(e.target.value)}
								placeholder={t("cardEditor.explanationPlaceholder")}
								disabled={isSaving}
								rows={5}
							/>
						</label>

						{error && <div className={styles.error}>{error}</div>}
					</div>

					<div className="flashcard-modal-footer">
						<FlashcardButton
							variant="secondary"
							onClick={requestClose}
							disabled={isSaving}
						>
							{t("common.cancel")}
						</FlashcardButton>
						<FlashcardButton
							variant="primary"
							onClick={() => void handleSave()}
							disabled={isSaving}
						>
							{isSaving
								? t("cardEditor.saving")
								: mode === "edit"
									? t("cardEditor.saveEdit")
									: t("cardEditor.saveCreate")}
						</FlashcardButton>
					</div>
				</>
			)}
		</ModalSurface>
	);
});
