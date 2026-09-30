import type { ComponentType } from "react";

/** Rendering stays in the supplying feature; the assistant sees only an opaque handle. */
export interface SelectionEmbeddedContentProps {
	handle: object;
	title: string;
	theme: "dark" | "light";
	className?: string;
	/** Documents fit their content so the popup grows and the surrounding reader owns scrolling. */
	fitContent?: boolean;
	onLookup: (word: string) => void;
	onClose: () => void;
}

export type SelectionEmbeddedContentRenderer = ComponentType<SelectionEmbeddedContentProps>;
