import type React from "react";

export interface PopupViewport {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface PopupPositionSnapshot {
	left: number;
	top: number;
	maxWidth: number;
	maxHeight: number;
}

interface ElementSize {
	width: number;
	height: number;
}

type PlacementReason = "initial" | "content" | "viewport" | "drag";

interface DragPoint {
	x: number;
	y: number;
}

interface PopupTargetPoint {
	x: number;
	y: number;
	trigger?: string;
}

interface PopupPlacementControllerOptions {
	element?: HTMLElement | null;
	ownerWindow?:
		| (Window & {
				visualViewport?: VisualViewport | null;
				ResizeObserver?: typeof ResizeObserver;
		  })
		| null;
	target: PopupTargetPoint;
	mode: "actions" | "dictionary";
	onPositionChange?: (position: PopupPositionSnapshot) => void;
}

interface ActiveDragState {
	pointerId: number;
	header: HTMLElement | null;
	x: number;
	y: number;
	left: number;
	top: number;
}

/** Keep measured popup bounds inside the visible viewport, including the keyboard. */
export function popupPosition(
	target: { x: number; y: number },
	size: { width: number; height: number },
	viewport: PopupViewport,
	manualPosition?: { left: number; top: number } | null,
): PopupPositionSnapshot {
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
): PopupPositionSnapshot {
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

/**
 * Encapsulates selection popup layout placement, anchor stabilization,
 * boundary clamping, and header drag interactions.
 */
export class PopupPlacementController {
	private readonly element: HTMLElement | null;
	private readonly ownerWindow:
		| (Window & {
				visualViewport?: VisualViewport | null;
				ResizeObserver?: typeof ResizeObserver;
		  })
		| null;
	private readonly target: PopupTargetPoint;
	private readonly mode: "actions" | "dictionary";
	private readonly onPositionChange?: (position: PopupPositionSnapshot) => void;

	private manualPosition: { left: number; top: number } | null = null;
	private placedCorner: { left: number; top: number } | null = null;
	private currentPosition: PopupPositionSnapshot = {
		left: 0,
		top: 0,
		maxWidth: 570,
		maxHeight: 420,
	};
	private drag: ActiveDragState | null = null;
	private observer: ResizeObserver | null = null;
	private readonly listeners = new Set<() => void>();
	private lastEmitted: PopupPositionSnapshot | null = null;

	readonly onHeaderPointerDown: React.PointerEventHandler<HTMLElement> | null;

	constructor(options: PopupPlacementControllerOptions) {
		this.element = options.element ?? null;
		this.ownerWindow =
			options.ownerWindow ??
			(options.element?.ownerDocument?.defaultView as
				| (Window & {
						visualViewport?: VisualViewport | null;
						ResizeObserver?: typeof ResizeObserver;
				  })
				| null) ??
			null;
		this.target = options.target;
		this.mode = options.mode;
		this.onPositionChange = options.onPositionChange;

		if (this.mode === "dictionary") {
			this.onHeaderPointerDown = (event) => this.handleHeaderPointerDown(event);
		} else {
			this.onHeaderPointerDown = null;
		}

		if (this.element && this.ownerWindow) {
			const ownerWindow = this.ownerWindow;
			if (this.mode === "dictionary") {
				ownerWindow.addEventListener("pointermove", this.handlePointerMove, {
					passive: false,
				});
				ownerWindow.addEventListener("pointerup", this.handlePointerUp);
				ownerWindow.addEventListener("pointercancel", this.handlePointerUp);
				ownerWindow.addEventListener("blur", this.finishDrag);
			}

			const Observer = ownerWindow.ResizeObserver;
			this.observer = Observer ? new Observer(() => this.measure("content")) : null;
			this.observer?.observe(this.element);

			ownerWindow.addEventListener("resize", this.handleViewportChange);
			ownerWindow.visualViewport?.addEventListener("resize", this.handleViewportChange);
			ownerWindow.visualViewport?.addEventListener("scroll", this.handleViewportChange);

			this.measure("initial");
		}
	}

	get isDragging(): boolean {
		return this.drag !== null;
	}

	get placedAnchor(): { left: number; top: number } | null {
		return this.placedCorner ? { ...this.placedCorner } : null;
	}

	get currentManualPosition(): { left: number; top: number } | null {
		return this.manualPosition ? { ...this.manualPosition } : null;
	}

	getSnapshot = (): PopupPositionSnapshot => {
		return this.currentPosition;
	};

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	measure(
		reason: PlacementReason = "initial",
		explicitSize?: ElementSize,
		explicitViewport?: PopupViewport,
	): PopupPositionSnapshot {
		const visibleArea = explicitViewport ?? this.getVisibleViewport();
		const size = explicitSize ?? {
			width: this.element?.offsetWidth ?? 0,
			height: this.element?.offsetHeight ?? 0,
		};

		const next =
			this.mode === "dictionary" && reason === "content" && this.placedCorner
				? popupPositionAtAnchor(this.placedCorner, visibleArea)
				: popupPosition(
						this.target,
						size,
						visibleArea,
						this.manualPosition ??
							this.placedCorner ??
							(this.target.trigger === "manual"
								? {
										left:
											visibleArea.left +
											(visibleArea.width -
												Math.min(size.width, visibleArea.width - 32)) /
												2,
										top:
											visibleArea.top +
											(visibleArea.height -
												Math.min(size.height, visibleArea.height * 0.7)) /
												2,
									}
								: null),
					);

		this.currentPosition = next;
		if (this.mode === "dictionary") {
			this.placedCorner = { left: next.left, top: next.top };
		}
		if (this.manualPosition) {
			this.manualPosition = { left: next.left, top: next.top };
		}

		this.notify();
		return next;
	}

	syncMeasurements(
		size: ElementSize,
		viewport: PopupViewport,
		reason: PlacementReason = "content",
	): PopupPositionSnapshot {
		return this.measure(reason, size, viewport);
	}

	startDrag(point: DragPoint, pointerId = 1): void {
		if (this.drag) return;
		this.drag = {
			pointerId,
			header: null,
			x: point.x,
			y: point.y,
			left: this.currentPosition.left,
			top: this.currentPosition.top,
		};
	}

	moveDrag(
		point: DragPoint,
		pointerId = 1,
		explicitSize?: ElementSize,
		explicitViewport?: PopupViewport,
	): void {
		if (!this.drag || pointerId !== this.drag.pointerId) return;
		this.manualPosition = {
			left: this.drag.left + point.x - this.drag.x,
			top: this.drag.top + point.y - this.drag.y,
		};
		this.measure("drag", explicitSize, explicitViewport);
	}

	endDrag(pointerId = 1): void {
		if (this.drag?.pointerId === pointerId) {
			this.finishDrag();
		}
	}

	readonly finishDrag = (): void => {
		const previous = this.drag;
		this.drag = null;
		if (!previous) return;
		if (previous.header) {
			previous.header.style.cursor = "";
			previous.header.removeEventListener("lostpointercapture", this.finishDrag);
			if (previous.header.hasPointerCapture?.(previous.pointerId)) {
				previous.header.releasePointerCapture(previous.pointerId);
			}
		}
	};

	private handleHeaderPointerDown = (
		event: React.PointerEvent<HTMLElement> | PointerEvent,
	): void => {
		if (this.drag || event.button !== 0 || !event.isPrimary) return;
		const header = (event.currentTarget ?? event.target) as HTMLElement;
		const targetElement = event.target as HTMLElement | null;
		if (
			targetElement?.closest?.(
				"button,a,input,textarea,select,[role='tablist'],[role='button']",
			)
		) {
			return;
		}
		event.preventDefault();
		this.drag = {
			pointerId: event.pointerId,
			header,
			x: event.clientX,
			y: event.clientY,
			left: this.currentPosition.left,
			top: this.currentPosition.top,
		};
		header.style.cursor = "grabbing";
		header.addEventListener("lostpointercapture", this.finishDrag);
		header.setPointerCapture?.(event.pointerId);
	};

	private handlePointerMove = (event: PointerEvent): void => {
		if (!this.drag || event.pointerId !== this.drag.pointerId) return;
		event.preventDefault();
		this.manualPosition = {
			left: this.drag.left + event.clientX - this.drag.x,
			top: this.drag.top + event.clientY - this.drag.y,
		};
		this.measure("drag");
	};

	private handlePointerUp = (event: PointerEvent): void => {
		if (event.pointerId === this.drag?.pointerId) {
			this.finishDrag();
		}
	};

	private handleViewportChange = (): void => {
		this.measure("viewport");
	};

	private getVisibleViewport(): PopupViewport {
		const ownerWindow = this.ownerWindow;
		const viewport = ownerWindow?.visualViewport;
		return {
			left: viewport?.offsetLeft ?? 0,
			top: viewport?.offsetTop ?? 0,
			width: viewport?.width ?? ownerWindow?.innerWidth ?? 0,
			height: viewport?.height ?? ownerWindow?.innerHeight ?? 0,
		};
	}

	private notify(): void {
		const prev = this.lastEmitted;
		const next = this.currentPosition;
		if (
			prev &&
			prev.left === next.left &&
			prev.top === next.top &&
			prev.maxWidth === next.maxWidth &&
			prev.maxHeight === next.maxHeight
		) {
			return;
		}
		this.lastEmitted = next;
		for (const listener of this.listeners) {
			listener();
		}
		this.onPositionChange?.(next);
	}

	dispose = (): void => {
		this.finishDrag();
		if (this.ownerWindow) {
			const ownerWindow = this.ownerWindow;
			ownerWindow.removeEventListener("pointermove", this.handlePointerMove);
			ownerWindow.removeEventListener("pointerup", this.handlePointerUp);
			ownerWindow.removeEventListener("pointercancel", this.handlePointerUp);
			ownerWindow.removeEventListener("blur", this.finishDrag);

			ownerWindow.removeEventListener("resize", this.handleViewportChange);
			ownerWindow.visualViewport?.removeEventListener("resize", this.handleViewportChange);
			ownerWindow.visualViewport?.removeEventListener("scroll", this.handleViewportChange);
		}
		this.observer?.disconnect();
		this.observer = null;
		this.listeners.clear();
	};
}
