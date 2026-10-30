/** DOM objects and coordinate conversion stay at the Obsidian boundary. */
interface CapturedSelection {
	text: string;
	x: number;
	y: number;
}

export function isAssistantElement(node: EventTarget | Node | null): boolean {
	return Boolean(elementOf(node)?.closest?.(".fc-selection-popup-container"));
}

/** Efficiently checks whether any of the mutation nodes is or contains a specific tag. */
export function hasMatchingElement(nodes: NodeList | readonly Node[], tagName: string): boolean {
	const lower = tagName.toLowerCase();
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (!node || node.nodeType !== 1) continue;
		const el = node as Element;
		if (el.tagName?.toLowerCase() === lower) return true;
		if (typeof el.querySelector === "function" && el.querySelector(tagName) !== null) {
			return true;
		}
	}
	return false;
}

function elementOf(node: EventTarget | Node | null): Element | null {
	if (!node) return null;
	const candidate = node as Node;
	return candidate.nodeType === 1 ? (candidate as Element) : candidate.parentElement;
}

function excluded(node: Node | EventTarget | null): boolean {
	return Boolean(
		elementOf(node)?.closest?.('.fc-selection-popup-container, input[type="password"]'),
	);
}

/** The actual selected node is retained only by the DOM listener for removal checks. */
export function selectionOrigin(doc: Document, target: EventTarget | null): Node | null {
	const control =
		elementOf(target)?.closest?.("input, textarea") ??
		(doc.activeElement?.matches?.("input, textarea") ? doc.activeElement : null);
	return control ?? doc.defaultView?.getSelection()?.anchorNode ?? null;
}

export function captureSelection(
	doc: Document,
	target: EventTarget | null,
	fallback: { x: number; y: number },
): CapturedSelection | null {
	if (excluded(target)) return null;
	const element = elementOf(target);
	const active = doc.activeElement;
	const input =
		element?.closest?.("input, textarea") ??
		(active?.matches?.("input, textarea") ? active : null);
	if (input) {
		const control = input as HTMLInputElement | HTMLTextAreaElement;
		if (excluded(control)) return null;
		const start = control.selectionStart;
		const end = control.selectionEnd;
		if (start === null || end === null || start === undefined || end === undefined) return null;
		const bounds = control.getBoundingClientRect();
		return { text: control.value.slice(start, end).trim(), x: bounds.left, y: bounds.bottom };
	}
	const selection = doc.defaultView?.getSelection();
	if (!selection || excluded(selection.anchorNode) || excluded(selection.focusNode)) return null;
	const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	if (range && excluded(range.commonAncestorContainer)) return null;
	const bounds = range?.getBoundingClientRect();
	return {
		text: selection.toString().trim(),
		x: bounds && (bounds.width || bounds.height) ? bounds.left : fallback.x,
		y: bounds && (bounds.width || bounds.height) ? bounds.bottom : fallback.y,
	};
}

export function toHostCoordinates(
	doc: Document,
	host: Document,
	point: CapturedSelection,
): CapturedSelection | null {
	let current = doc;
	let { x, y } = point;
	try {
		while (current !== host) {
			const frame = current.defaultView?.frameElement;
			if (!frame) return null;
			const bounds = frame.getBoundingClientRect();
			const htmlFrame = frame as HTMLElement;
			const scaleX = htmlFrame.offsetWidth ? bounds.width / htmlFrame.offsetWidth : 1;
			const scaleY = htmlFrame.offsetHeight ? bounds.height / htmlFrame.offsetHeight : 1;
			x = bounds.left + (x + htmlFrame.clientLeft) * scaleX;
			y = bounds.top + (y + htmlFrame.clientTop) * scaleY;
			current = frame.ownerDocument;
		}
		return { ...point, x, y };
	} catch {
		return null;
	}
}
