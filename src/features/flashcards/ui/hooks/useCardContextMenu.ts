import { useCallback } from "react";
import { Menu, Notice } from "obsidian";
import { useFlashcardI18n } from "../../strings/context";
import { copyTextToClipboard } from "../../../../core/shared/clipboard";

/**
 * Extracts card text while stripping the label badge text (e.g., "问题", "答案", "解释").
 */
export function extractCleanCardText(cardElement: HTMLElement): string {
	const labelEl = cardElement.querySelector(".flashcard-label");
	const labelText = labelEl?.textContent?.trim() ?? "";
	const fullText = (cardElement.textContent ?? "").trim();

	if (labelText && fullText.startsWith(labelText)) {
		return fullText.slice(labelText.length).trim();
	}
	if (labelText && fullText.endsWith(labelText)) {
		return fullText.slice(0, -labelText.length).trim();
	}
	return fullText;
}

/**
 * Provides a context menu for flashcard stack items, allowing users to copy
 * selected text or copy the entire card section to the clipboard.
 */
export function useCardContextMenu() {
	const { t } = useFlashcardI18n();

	return useCallback(
		(event: React.MouseEvent) => {
			if (
				event.target instanceof HTMLInputElement ||
				event.target instanceof HTMLTextAreaElement
			) {
				return;
			}

			const doc =
				event.currentTarget.ownerDocument ??
				(typeof document !== "undefined" ? document : null);
			const selection = doc?.defaultView?.getSelection()?.toString().trim() ?? "";

			const targetCard = (event.target as HTMLElement | null)?.closest?.(
				".flashcard-question, .flashcard-answer, .flashcard-explanation",
			) as HTMLElement | null;

			if (!selection && !targetCard) {
				return;
			}

			event.preventDefault();

			// In test environments or when Menu is not available, avoid throwing
			if (typeof Menu !== "function") {
				return;
			}

			const menu = new Menu();

			if (selection) {
				menu.addItem((item) => {
					item.setTitle(t("common.copy"))
						.setIcon("copy")
						.onClick(async () => {
							const ok = await copyTextToClipboard(selection);
							if (ok) {
								new Notice(t("notice.copied"));
							} else {
								new Notice(t("notice.copyFailed"));
							}
						});
				});
			} else if (targetCard) {
				const cleanText = extractCleanCardText(targetCard);
				if (cleanText) {
					menu.addItem((item) => {
						item.setTitle(t("common.copyCardContent"))
							.setIcon("copy")
							.onClick(async () => {
								const ok = await copyTextToClipboard(cleanText);
								if (ok) {
									new Notice(t("notice.copied"));
								} else {
									new Notice(t("notice.copyFailed"));
								}
							});
					});
				}
			}

			menu.showAtMouseEvent(event.nativeEvent);
		},
		[t],
	);
}
