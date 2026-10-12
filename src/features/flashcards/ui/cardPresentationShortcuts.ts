import type { StudyRating } from "../../../core/shared/types";

export type CardShortcutState = (
	| {
			readonly mode: "study" | "practice";
			readonly answerVisible: boolean;
			readonly canPrevious: boolean;
	  }
	| {
			readonly mode: "challenge";
			readonly phase: "question" | "feedback";
			readonly questionMode: "normal" | "reversed" | "spelling";
			readonly answerVisible: boolean;
	  }
) & { readonly busy: boolean };

export type CardShortcutIntent =
	| { readonly kind: "reveal" }
	| { readonly kind: "rate"; readonly rating: StudyRating }
	| { readonly kind: "answer"; readonly correct: boolean }
	| { readonly kind: "previous" }
	| { readonly kind: "continue" };

const CONTROLS = [
	"input",
	"textarea",
	"select",
	"button",
	"a[href]",
	"summary",
	"audio[controls]",
	"video[controls]",
	'[tabindex]:not([tabindex="-1"])',
	'[role="button"]',
	'[role="link"]',
	'[role="textbox"]',
	'[role="combobox"]',
	'[role="listbox"]',
	'[role="slider"]',
	'[role="spinbutton"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="switch"]',
	'[role="menuitem"]',
].join(", ");
const HIDDEN = '[hidden], [inert], [aria-hidden="true"]';
const MODALS = 'dialog[open], [aria-modal="true"]:not([aria-hidden="true"]), .modal-container';

/** One focused card surface owns its shortcuts; session transitions stay with the caller. */
export function bindCardPresentationShortcuts(
	root: HTMLElement,
	read: () => CardShortcutState,
	dispatch: (intent: CardShortcutIntent) => void,
): () => void {
	const doc = root.ownerDocument;
	const originalTabIndex = root.getAttribute("tabindex");
	if (originalTabIndex === null) root.setAttribute("tabindex", "-1");

	const blocked = () =>
		!root.isConnected || !!root.closest(HIDDEN) || !!doc.querySelector(MODALS);
	const focusSurface = () => root.focus({ preventScroll: true });
	let ownedFocus: Element | null = root.contains(doc.activeElement) ? doc.activeElement : null;
	const onFocusIn = () => {
		ownedFocus = root.contains(doc.activeElement) ? doc.activeElement : null;
	};
	const onDocumentPointerDown = (event: PointerEvent) => {
		if (!event.composedPath().includes(root)) ownedFocus = null;
	};
	// Replacing a focused reveal/rating button sends focus to body. Restore only
	// that lost focus; a deliberate interaction elsewhere relinquishes ownership.
	const observer = doc.defaultView
		? new doc.defaultView.MutationObserver(() => {
				if (
					ownedFocus &&
					!ownedFocus.isConnected &&
					(!doc.activeElement || doc.activeElement === doc.body) &&
					!blocked() &&
					!isSpellingQuestion(read())
				)
					focusSurface();
			})
		: null;
	const onPointerDown = (event: PointerEvent) => {
		if (event.defaultPrevented || event.button !== 0 || blocked()) return;
		const state = read();
		if (isSpellingQuestion(state) || isControlEvent(event, root)) return;
		focusSurface();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			event.keyCode === 229 ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			event.shiftKey ||
			blocked() ||
			!root.contains(doc.activeElement) ||
			isControlEvent(event, root)
		)
			return;
		const state = read();
		const intent = interpret(state, event.code);
		if (!intent) return;
		event.preventDefault();
		if (event.repeat || state.busy) return;
		if (intent.kind === "previous" && state.mode !== "challenge" && !state.canPrevious) return;
		dispatch(intent);
	};

	root.addEventListener("keydown", onKeyDown);
	root.addEventListener("pointerdown", onPointerDown);
	doc.addEventListener("focusin", onFocusIn);
	doc.addEventListener("pointerdown", onDocumentPointerDown, true);
	observer?.observe(root, { childList: true, subtree: true });
	if (
		!blocked() &&
		!isSpellingQuestion(read()) &&
		(!doc.activeElement ||
			doc.activeElement === doc.body ||
			root.contains(doc.activeElement)) &&
		!isControlElement(doc.activeElement, root)
	)
		focusSurface();

	let released = false;
	return () => {
		if (released) return;
		released = true;
		root.removeEventListener("keydown", onKeyDown);
		root.removeEventListener("pointerdown", onPointerDown);
		doc.removeEventListener("focusin", onFocusIn);
		doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
		observer?.disconnect();
		if (originalTabIndex === null) root.removeAttribute("tabindex");
	};
}

function isSpellingQuestion(state: CardShortcutState): boolean {
	return (
		state.mode === "challenge" &&
		state.phase === "question" &&
		state.questionMode === "spelling"
	);
}

function isControlElement(target: Element | null, root: HTMLElement): boolean {
	for (let el = target; el && el !== root; el = el.parentElement) {
		if ((el as HTMLElement).isContentEditable || el.matches(CONTROLS)) return true;
	}
	return false;
}

function isControlEvent(event: Event, root: HTMLElement): boolean {
	// Use the owning document's elements, including composed paths from embedded content.
	for (const target of event.composedPath()) {
		if (target === root) break;
		if ((target as Node).nodeType === 1 && isControlElement(target as Element, root))
			return true;
	}
	return false;
}

function interpret(state: CardShortcutState, code: string): CardShortcutIntent | null {
	if (state.mode === "challenge") {
		if (state.phase === "feedback")
			return code === "Space" || code === "Enter" ? { kind: "continue" } : null;
		if (isSpellingQuestion(state)) return null;
	}
	if (!state.answerVisible) return code === "Space" ? { kind: "reveal" } : null;
	if (state.mode !== "challenge" && (code === "Digit6" || code === "Numpad6"))
		return { kind: "previous" };
	if (state.mode === "study") {
		if (code === "Space") return { kind: "rate", rating: 2 };
		const digit = /^(?:Digit|Numpad)([1-5])$/.exec(code)?.[1];
		return digit ? { kind: "rate", rating: Number(digit) as StudyRating } : null;
	}
	if (code === "Digit1" || code === "Numpad1" || code === "KeyX")
		return { kind: "answer", correct: false };
	if (code === "Digit2" || code === "Numpad2" || code === "KeyO" || code === "Space")
		return { kind: "answer", correct: true };
	return null;
}
