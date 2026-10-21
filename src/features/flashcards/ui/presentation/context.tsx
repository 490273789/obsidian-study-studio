import React, { createContext, useContext, useMemo } from "react";
import type { MarkdownRendererFn } from "../primitives/Markdown";
import type { PronunciationRuntime } from "../../domain/pronunciation";

/** Renderer and pronunciation dependencies injected once at the flashcard app root. */
interface CardPresentationDependencies {
	readonly markdownRenderer: MarkdownRendererFn;
	readonly pronunciationRuntime: PronunciationRuntime;
}

const CardPresentationContext = createContext<CardPresentationDependencies | null>(null);

export const CardPresentationProvider: React.FC<
	CardPresentationDependencies & { children: React.ReactNode }
> = ({ markdownRenderer, pronunciationRuntime, children }) => {
	const value = useMemo<CardPresentationDependencies>(
		() => ({ markdownRenderer, pronunciationRuntime }),
		[markdownRenderer, pronunciationRuntime],
	);
	return (
		<CardPresentationContext.Provider value={value}>
			{children}
		</CardPresentationContext.Provider>
	);
};

export function useCardPresentationDependencies(): CardPresentationDependencies {
	const value = useContext(CardPresentationContext);
	if (!value) {
		throw new Error(
			"useCardPresentationDependencies must be used within CardPresentationProvider",
		);
	}
	return value;
}
