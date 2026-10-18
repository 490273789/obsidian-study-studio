/** Anchored geometry for the playback-rate popover, kept free of React and DOM. */

export type PlaybackRateTone = "default" | "dark";

export type PlaybackRatePopoverAlign = "start" | "center" | "end";

export type PlaybackRatePopoverPlacement = "top" | "bottom";

export interface PlaybackRateAnchorRect {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

export interface PlaybackRatePopoverSize {
	readonly width: number;
	readonly height: number;
}

export interface PlaybackRateViewport {
	readonly width: number;
	readonly height: number;
}

export interface PlaybackRatePopoverPosition {
	readonly top: number;
	readonly left: number;
	readonly placement: PlaybackRatePopoverPlacement;
}

/** Distance between the trigger and the popover. */
const ANCHOR_GAP = 8;

/** Minimum distance the popover keeps from every viewport edge. */
const VIEWPORT_MARGIN = 8;

export function formatPlaybackRate(rate: number): string {
	return `${rate}×`;
}

/**
 * Places the popover above the trigger whenever it fits there, otherwise below,
 * and clamps it inside the viewport. The popover is portaled, so the coordinates
 * are viewport-relative (CSS `position: fixed`).
 */
export function computePlaybackRatePopoverPosition({
	anchor,
	popover,
	viewport,
	align = "center",
}: {
	readonly anchor: PlaybackRateAnchorRect;
	readonly popover: PlaybackRatePopoverSize;
	readonly viewport: PlaybackRateViewport;
	readonly align?: PlaybackRatePopoverAlign;
}): PlaybackRatePopoverPosition {
	const spaceAbove = anchor.top - VIEWPORT_MARGIN;
	const spaceBelow = viewport.height - (anchor.top + anchor.height) - VIEWPORT_MARGIN;
	const required = popover.height + ANCHOR_GAP;
	const fitsAbove = spaceAbove >= required;
	const fitsBelow = spaceBelow >= required;
	const placement: PlaybackRatePopoverPlacement =
		fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow) ? "top" : "bottom";

	const desiredTop =
		placement === "top"
			? anchor.top - ANCHOR_GAP - popover.height
			: anchor.top + anchor.height + ANCHOR_GAP;
	const desiredLeft =
		align === "start"
			? anchor.left
			: align === "end"
				? anchor.left + anchor.width - popover.width
				: anchor.left + anchor.width / 2 - popover.width / 2;

	return {
		top: clampWithinViewport(desiredTop, viewport.height, popover.height),
		left: clampWithinViewport(desiredLeft, viewport.width, popover.width),
		placement,
	};
}

/**
 * Next focused option for menu-style arrow navigation. Returns `null` when the
 * key does not move focus. Focus wraps at both ends, matching native menus.
 */
export function nextPlaybackRateIndex(
	currentIndex: number,
	key: string,
	count: number,
): number | null {
	if (count <= 0) return null;
	if (currentIndex < 0 || currentIndex >= count) {
		switch (key) {
			case "ArrowDown":
			case "ArrowRight":
			case "Home":
				return 0;
			case "ArrowUp":
			case "ArrowLeft":
			case "End":
				return count - 1;
			default:
				return null;
		}
	}
	switch (key) {
		case "ArrowDown":
		case "ArrowRight":
			return (currentIndex + 1) % count;
		case "ArrowUp":
		case "ArrowLeft":
			return (currentIndex - 1 + count) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

function clampWithinViewport(value: number, viewportSize: number, size: number): number {
	const furthest = Math.max(VIEWPORT_MARGIN, viewportSize - size - VIEWPORT_MARGIN);
	return Math.min(furthest, Math.max(VIEWPORT_MARGIN, value));
}
