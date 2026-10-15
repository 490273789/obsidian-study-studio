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

/** Setup shortcuts belong only to the focused page in its owning document. */
export function handleSetupKeyDown(
	event: KeyboardEvent,
	root: HTMLElement,
	start: () => void,
	disabled: boolean,
): void {
	const doc = root.ownerDocument;
	if (
		event.defaultPrevented ||
		event.isComposing ||
		event.keyCode === 229 ||
		event.ctrlKey ||
		event.altKey ||
		event.metaKey ||
		event.shiftKey ||
		(event.code !== "Space" && event.key !== " ") ||
		!root.isConnected ||
		root.closest(HIDDEN) ||
		doc.querySelector(MODALS) ||
		!root.contains(doc.activeElement)
	)
		return;
	for (const target of event.composedPath()) {
		if (target === root) break;
		if ((target as Node).nodeType !== 1) continue;
		for (let el: Element | null = target as Element; el && el !== root; el = el.parentElement) {
			if ((el as HTMLElement).isContentEditable || el.matches(CONTROLS)) return;
		}
	}
	event.preventDefault();
	if (!event.repeat && !disabled) start();
}
