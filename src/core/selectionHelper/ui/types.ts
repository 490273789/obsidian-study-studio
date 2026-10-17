import type { ComponentType } from "react";
import type { Language } from "../../shared/types";

/** Rendering stays in the supplying feature; the assistant sees only an opaque result handle. */
export interface SelectionResultContentProps {
	handle: object;
	language: Language;
	theme: "dark" | "light";
	onLookup: (word: string) => void;
	onSelectSection: (sectionIndex: number) => void;
	onClose: () => void;
}

export type SelectionResultContentRenderer = ComponentType<SelectionResultContentProps>;
