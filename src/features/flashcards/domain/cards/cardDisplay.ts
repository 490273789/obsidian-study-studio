import type { CardDirection, FlashCard } from "../../../../core/shared/types";

interface DisplayCardContent {
	prompt: string;
	answer: string;
	explanation: string;
}

export function getDisplayCardContent(
	card: Pick<FlashCard, "front" | "back" | "explanation">,
	direction: CardDirection,
): DisplayCardContent {
	return {
		prompt: direction === "reversed" ? card.back : card.front,
		answer: direction === "reversed" ? card.front : card.back,
		explanation: card.explanation?.trim() ?? "",
	};
}
