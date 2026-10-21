export type ModalId = string;

type ModalFocusDestination = "container" | "first" | "last" | null;

export function registerModal(stack: readonly ModalId[], modalId: ModalId): readonly ModalId[] {
	if (stack.includes(modalId)) return stack;
	return [...stack, modalId];
}

export function unregisterModal(stack: readonly ModalId[], modalId: ModalId): readonly ModalId[] {
	if (!stack.includes(modalId)) return stack;
	return stack.filter((candidate) => candidate !== modalId);
}

export function getModalLayer(
	stack: readonly ModalId[],
	modalId: ModalId,
): { index: number; isTopmost: boolean } {
	const index = stack.indexOf(modalId);
	return {
		index,
		isTopmost: index >= 0 && index === stack.length - 1,
	};
}

export function getModalFocusDestination(
	focusableCount: number,
	activeIndex: number,
	shiftKey: boolean,
): ModalFocusDestination {
	if (focusableCount === 0) return "container";
	if (activeIndex < 0) return shiftKey ? "last" : "first";
	if (shiftKey && activeIndex === 0) return "last";
	if (!shiftKey && activeIndex === focusableCount - 1) return "first";
	return null;
}

export function canRequestModalClose(isTopmost: boolean, isDismissible: boolean): boolean {
	return isTopmost && isDismissible;
}
