import { useCallback } from "react";
import { Menu, Notice } from "obsidian";
import { useFlashcardI18n } from "../../strings/context";
import { copyTextToClipboard } from "../../../../core/shared/clipboard";

/**
 * Extracts card text while stripping the label badge text (e.g., "问题", "答案", "解释").
 */
export function extractCleanCardText(cardElement: HTMLElement): string {
	const markdownEl = cardElement.querySelector<HTMLElement>(".flashcard-markdown");
	if (markdownEl && markdownEl.classList?.contains?.("flashcard-markdown")) {
		const text = (markdownEl.innerText ?? markdownEl.textContent ?? "").trim();
		if (text) {
			return text;
		}
	}

	if (typeof cardElement.cloneNode === "function") {
		const clone = cardElement.cloneNode(true) as HTMLElement;
		clone.querySelector(".flashcard-label")?.remove();
		clone.querySelector(".flashcard-pronounce-btn")?.remove();
		return (clone.innerText ?? clone.textContent ?? "").trim();
	}

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

import type { TranslationKey } from "../../strings";

interface CardContextMenuContext {
	t: (key: TranslationKey) => string;
	copyText?: (text: string) => Promise<boolean>;
}

export function handleCardContextMenu(
	event: {
		target: EventTarget | null;
		currentTarget: EventTarget | null;
		nativeEvent: MouseEvent;
		preventDefault: () => void;
	},
	ctx: CardContextMenuContext,
): void {
	const targetEl = event.target as HTMLElement | null;
	const tagName = targetEl?.tagName?.toLowerCase();
	if (tagName === "input" || tagName === "textarea") {
		return;
	}

	const doc =
		(event.currentTarget as HTMLElement | null)?.ownerDocument ??
		(typeof document !== "undefined" ? document : null);
	const selection = doc?.defaultView?.getSelection()?.toString().trim() ?? "";

	const targetCard = (event.target as HTMLElement | null)?.closest?.(
		".flashcard-question, .flashcard-answer, .flashcard-explanation",
	) as HTMLElement | null;

	const stackContainer =
		((event.currentTarget as HTMLElement | null)?.closest?.(
			".flashcard-card-stack",
		) as HTMLElement | null) ?? (event.currentTarget as HTMLElement | null);

	if (!selection && !targetCard && !stackContainer) {
		return;
	}

	event.preventDefault();

	const menu = new Menu();
	const copyFn = ctx.copyText ?? copyTextToClipboard;

	if (selection) {
		menu.addItem((item) => {
			item.setTitle(ctx.t("common.copy"))
				.setIcon("copy")
				.onClick(async () => {
					const ok = await copyFn(selection);
					if (ok) {
						new Notice(ctx.t("notice.copied"));
					} else {
						new Notice(ctx.t("notice.copyFailed"));
					}
				});
		});
	}

	if (targetCard) {
		const sectionText = extractCleanCardText(targetCard);
		if (sectionText) {
			menu.addItem((item) => {
				item.setTitle(ctx.t("common.copySection"))
					.setIcon("copy")
					.onClick(async () => {
						const ok = await copyFn(sectionText);
						if (ok) {
							new Notice(ctx.t("notice.copied"));
						} else {
							new Notice(ctx.t("notice.copyFailed"));
						}
					});
			});
		}
	}

	// Offer copying the full card if in a card stack
	if (stackContainer && typeof stackContainer.querySelectorAll === "function") {
		const sections = Array.from(
			stackContainer.querySelectorAll<HTMLElement>(
				".flashcard-question, .flashcard-answer, .flashcard-explanation",
			),
		);
		if (sections.length > 0) {
			const allParts = sections.map((sec) => extractCleanCardText(sec)).filter(Boolean);
			const fullCardContent = allParts.join("\n\n");
			if (fullCardContent && (!targetCard || sections.length > 1)) {
				menu.addItem((item) => {
					item.setTitle(ctx.t("common.copyAllCard"))
						.setIcon("copy")
						.onClick(async () => {
							const ok = await copyFn(fullCardContent);
							if (ok) {
								new Notice(ctx.t("notice.copied"));
							} else {
								new Notice(ctx.t("notice.copyFailed"));
							}
						});
				});
			}
		}
	}

	menu.showAtMouseEvent(event.nativeEvent);
}

/**
 * Provides a context menu for flashcard stack items, allowing users to copy
 * selected text or copy the entire card section to the clipboard.
 */
export function useCardContextMenu() {
	const { t } = useFlashcardI18n();

	return useCallback(
		(event: React.MouseEvent) => {
			handleCardContextMenu(event, { t });
		},
		[t],
	);
}
