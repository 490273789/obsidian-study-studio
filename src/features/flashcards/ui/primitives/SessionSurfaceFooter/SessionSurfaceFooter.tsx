import React from "react";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";

interface SessionSurfaceFooterProps {
	busy: boolean;
	answerVisible: boolean;
	onReveal: () => void;
	revealLabel: string;
	shortcutLabel: string;
	/** The answered-state controls; the reveal state is shared, its content is not. */
	children?: React.ReactNode;
}

/**
 * Shared show-answer footer, rendered as a plain function so the surrounding
 * view's element tree stays flat for the node-level view tests.
 */
export function sessionSurfaceFooter({
	busy,
	answerVisible,
	onReveal,
	revealLabel,
	shortcutLabel,
	children,
}: SessionSurfaceFooterProps): React.ReactNode {
	if (answerVisible) return children;
	return (
		<FlashcardButton
			preset="show"
			variant="primary"
			size="lg"
			onClick={onReveal}
			disabled={busy}
		>
			{revealLabel}
			<span className="flashcard-shortcut">({shortcutLabel})</span>
		</FlashcardButton>
	);
}
