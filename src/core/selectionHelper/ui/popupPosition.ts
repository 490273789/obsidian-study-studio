export interface PopupViewport {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Keep measured popup bounds inside the visible viewport, including the keyboard. */
export function popupPosition(
	target: { x: number; y: number },
	size: { width: number; height: number },
	viewport: PopupViewport,
	manualPosition?: { left: number; top: number } | null,
): { left: number; top: number; maxWidth: number; maxHeight: number } {
	const margin = 16;
	const maxWidth = Math.max(0, viewport.width - margin * 2);
	const maxHeight = Math.max(0, Math.min(viewport.height * 0.7, viewport.height - margin * 2));
	const width = Math.min(size.width, maxWidth);
	const height = Math.min(size.height, maxHeight);
	const minLeft = viewport.left + margin;
	const minTop = viewport.top + margin;
	const right = viewport.left + viewport.width - margin;
	const bottom = viewport.top + viewport.height - margin;
	const preferredTop = target.y + 12;
	const top =
		manualPosition?.top ??
		(preferredTop + height > bottom ? target.y - height - 12 : preferredTop);
	return {
		left: Math.max(minLeft, Math.min(manualPosition?.left ?? target.x, right - width)),
		top: Math.max(minTop, Math.min(top, bottom - height)),
		maxWidth,
		maxHeight,
	};
}

/** Let dictionary content resize to the right and below an already placed corner. */
export function popupPositionAtAnchor(
	anchor: { left: number; top: number },
	viewport: PopupViewport,
): { left: number; top: number; maxWidth: number; maxHeight: number } {
	const margin = 16;
	const right = viewport.left + viewport.width - margin;
	const bottom = viewport.top + viewport.height - margin;
	const left = Math.max(viewport.left + margin, Math.min(anchor.left, right));
	const top = Math.max(viewport.top + margin, Math.min(anchor.top, bottom));
	return {
		left,
		top,
		maxWidth: Math.max(0, Math.min(viewport.width - margin * 2, right - left)),
		maxHeight: Math.max(0, Math.min(viewport.height * 0.7, bottom - top)),
	};
}
