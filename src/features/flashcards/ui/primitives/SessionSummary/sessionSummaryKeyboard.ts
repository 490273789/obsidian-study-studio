export interface SessionSummaryKeyboardOptions {
	readonly actions: readonly {
		label: string;
		onClick: () => void;
		primary?: boolean;
		disabled?: boolean;
	}[];
	readonly onHome: () => void;
}

const HIDDEN = '[hidden], [inert], [aria-hidden="true"]';
const MODALS = 'dialog[open], [aria-modal="true"]:not([aria-hidden="true"]), .modal-container';

function canHandleSummaryShortcuts(root: HTMLElement): boolean {
	return root.isConnected && !root.closest(HIDDEN) && !root.ownerDocument.querySelector(MODALS);
}

export function focusSessionSummary(root: HTMLElement): void {
	if (
		root.ownerDocument.activeElement === root.ownerDocument.body &&
		canHandleSummaryShortcuts(root)
	) {
		root.focus({ preventScroll: true });
	}
}

/**
 * Dispatches primary action on Enter / Space and onHome on Escape
 * while ignoring inputs and contenteditable targets.
 */
export function handleSessionSummaryKeyDown(
	event: Pick<KeyboardEvent, "key" | "preventDefault" | "target"> &
		Partial<
			Pick<
				KeyboardEvent,
				| "defaultPrevented"
				| "isComposing"
				| "ctrlKey"
				| "metaKey"
				| "altKey"
				| "shiftKey"
				| "repeat"
			>
		>,
	options: SessionSummaryKeyboardOptions,
	root: HTMLElement,
): boolean {
	const target = event.target as {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => Element | null;
	} | null;
	if (
		event.defaultPrevented ||
		event.isComposing ||
		event.repeat ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.shiftKey ||
		!canHandleSummaryShortcuts(root) ||
		!root.contains(root.ownerDocument.activeElement)
	)
		return false;

	const isInput =
		Boolean(target) &&
		(target?.tagName === "INPUT" ||
			target?.tagName === "TEXTAREA" ||
			Boolean(target?.isContentEditable));

	if (isInput) return false;

	if (event.key === "Enter" || event.key === " ") {
		// Let focused controls (including descendants such as SVG icons) own
		// activation; expanding a card must never activate the page's home action.
		if (
			["BUTTON", "A", "SELECT", "SUMMARY"].includes(target?.tagName ?? "") ||
			target?.closest?.("button, a, select, summary, [role='button'], [contenteditable]")
		)
			return false;
		const primaryAction = options.actions.find((a) => a.primary);
		if (primaryAction && !primaryAction.disabled) {
			event.preventDefault?.();
			primaryAction.onClick();
			return true;
		}
	} else if (event.key === "Escape") {
		event.preventDefault?.();
		options.onHome();
		return true;
	}

	return false;
}
