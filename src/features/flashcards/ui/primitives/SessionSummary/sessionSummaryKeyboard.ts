export interface SessionSummaryKeyboardOptions {
	readonly actions: readonly {
		label: string;
		onClick: () => void;
		primary?: boolean;
		disabled?: boolean;
	}[];
	readonly onHome: () => void;
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
				"defaultPrevented" | "isComposing" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
			>
		>,
	options: SessionSummaryKeyboardOptions,
): boolean {
	const target = event.target as {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => Element | null;
	} | null;
	if (
		event.defaultPrevented ||
		event.isComposing ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.shiftKey
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
