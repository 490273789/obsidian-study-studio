export interface SessionSummaryKeyboardOptions {
	readonly actions: readonly { label: string; onClick: () => void; primary?: boolean }[];
	readonly onHome: () => void;
}

/**
 * Dispatches primary action on Enter / Space and onHome on Escape
 * while ignoring inputs and contenteditable targets.
 */
export function handleSessionSummaryKeyDown(
	event: Pick<KeyboardEvent, "key" | "preventDefault" | "target">,
	options: SessionSummaryKeyboardOptions,
): boolean {
	const target = event.target as {
		tagName?: string;
		isContentEditable?: boolean;
	} | null;

	const isInput =
		Boolean(target) &&
		(target?.tagName === "INPUT" ||
			target?.tagName === "TEXTAREA" ||
			Boolean(target?.isContentEditable));

	if (isInput) return false;

	if (event.key === "Enter" || event.key === " ") {
		const primaryAction = options.actions.find((a) => a.primary);
		if (primaryAction) {
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
