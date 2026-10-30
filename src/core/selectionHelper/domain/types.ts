import type { Language } from "../../shared/types";

export type SelectionHelperModifier = "none" | "alt" | "shift" | "ctrl";

export interface SelectionHelperSettings {
	/** Whether the selection helper is active. */
	enabled: boolean;
	/** Modifier key required to trigger the helper after selecting text. */
	modifier: SelectionHelperModifier;
	/** Shortcut to open the current lookup in the main dictionary tab. */
	openMainShortcut: string;
	/** Persisted IDs of dictionary sources selected for inline lookup (legacy/optional). */
	selectedDictionaries?: string[];
	/** Popup-specific source order, independent of selection and the main dictionary catalog (legacy/optional). */
	dictionaryOrder?: string[];
}

export interface SelectionSource {
	/** Opaque page identity; a navigated page receives a fresh reference. */
	readonly id: string;
}

export interface SelectionRead {
	isCurrent(): boolean;
	submit(candidate: SelectionCandidate): boolean;
	dismiss(): void;
}

export interface SelectionSourceLease {
	readonly reference: SelectionSource;
	readonly active: boolean;
	/** Capture before asynchronous work, never after it completes. */
	capture(): SelectionRead;
	/** Clear this source's selection while allowing future captures. */
	dismiss(): void;
	dispose(): void;
}

export interface SelectionCandidate {
	trigger?: "mouse" | "touch" | "webview" | "manual";
	text: string;
	x: number;
	y: number;
	eligibleContext: boolean;
	altKey: boolean;
	shiftKey: boolean;
	ctrlOrMetaKey: boolean;
}

export interface SelectionTarget {
	source: SelectionSource;
	trigger?: "mouse" | "touch" | "webview" | "manual";
	text: string;
	isEnglishWord?: boolean;
	x: number;
	y: number;
}

export interface SelectionActionContext {
	readonly text: string;
	readonly trigger?: "mouse" | "touch" | "webview" | "manual";
	readonly x: number;
	readonly y: number;
}

export interface SelectionAction {
	readonly id: string;
	readonly label: (language: Language) => string;
	readonly icon?: React.ReactNode;
	readonly hint?: string;
	readonly keyEquivalents?: readonly string[];
	readonly isPrimary?: boolean;
	isEligible(context: SelectionActionContext): boolean;
	execute(context: SelectionActionContext): Promise<void> | void;
	readonly slotId?: string;
}

export interface SelectionDictionarySource {
	id: string;
	label: string;
	kind: "ai" | "dictionary";
}

export interface SelectionDictionarySourceProvider {
	sources(): readonly SelectionDictionarySource[];
}

export interface SelectionTranslationAdapter {
	available(): boolean;
	openPrefilled(text: string): Promise<void>;
}

export interface SelectionSlotProps {
	word: string;
	text?: string;
	onClose: () => void;
	onHeaderPointerDown?: React.PointerEventHandler<HTMLElement>;
	selectedDictionaries?: readonly string[];
	dictionaryOrder?: readonly string[];
	openMainShortcut?: string;
}

export type SelectionSlotRenderer = (props: SelectionSlotProps) => React.ReactNode;

export type SelectionLookupSlotProps = SelectionSlotProps;
export type SelectionLookupSlotRenderer = SelectionSlotRenderer;

export type SelectionHelperMode = "actions" | "slot" | "dictionary";

export interface SelectionHelperSnapshot {
	visible: boolean;
	mode: SelectionHelperMode;
	target: SelectionTarget | null;
	activeSlotId: string | null;
	eligibleActionIds: readonly string[];
	canLookup?: boolean;
	canTranslate?: boolean;
}
