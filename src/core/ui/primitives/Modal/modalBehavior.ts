export type ModalId = string;

type ModalFocusDestination = "container" | "first" | "last" | null;

const TAB_STOP_SELECTOR =
	"button, a[href], area[href], input, select, textarea, iframe, [contenteditable], [tabindex]";

/** Follow the browser's tab order so the trap wraps at the actual boundaries. */
export function getModalTabStops(container: HTMLElement): HTMLElement[] {
	const view = container.ownerDocument.defaultView;
	return Array.from(container.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR))
		.filter((element) => {
			if (
				element.matches(':disabled, input[type="hidden"]') ||
				element.closest('[hidden], [inert], [aria-hidden="true"]') ||
				element.getClientRects().length === 0
			) {
				return false;
			}
			const visibility = view?.getComputedStyle(element).visibility;
			if (visibility === "hidden" || visibility === "collapse") return false;
			if (element.hasAttribute("tabindex")) return element.tabIndex >= 0;
			return (
				element.tabIndex >= 0 ||
				(element.isContentEditable && !element.parentElement?.isContentEditable)
			);
		})
		.sort((left, right) => tabOrder(left) - tabOrder(right));
}

function tabOrder(element: HTMLElement): number {
	return element.tabIndex > 0 ? element.tabIndex : Number.MAX_SAFE_INTEGER;
}

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
