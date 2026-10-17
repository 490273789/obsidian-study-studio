import React from "react";
import { useCardContextMenu } from "../hooks/useCardContextMenu";

/**
 * Wrapper for one presented card. The view supplies the React key (its encounter
 * token) and the mode-specific content; the stack owns the shared surface.
 */
export const CardPresentationStack: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const handleContextMenu = useCardContextMenu();
	return (
		<div className="flashcard-card-stack" onContextMenu={handleContextMenu}>
			{children}
		</div>
	);
};
