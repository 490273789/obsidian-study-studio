import type { VideoPlayerPresentationStateStore } from "../domain/localVideoPlayerState";
import type { FloatingRect, VideoMediaPort } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";

export type PlayerViewPresentation =
	| { readonly kind: "docked" }
	| {
			readonly kind: "floating";
			readonly maximized: boolean;
			readonly rect: FloatingRect;
	  };

export interface PlayerViewSnapshot {
	readonly role: "presenter" | "waiting";
	readonly presentation: PlayerViewPresentation;
	readonly queueExpanded: boolean;
}

export type PlayerViewAction =
	| { readonly type: "enter-floating" }
	| { readonly type: "dock-and-pause" }
	| { readonly type: "toggle-maximized" }
	| { readonly type: "set-queue-expanded"; readonly expanded: boolean };

export type PlayerViewActionResult =
	| { readonly kind: "applied" }
	| {
			readonly kind: "rejected";
			readonly reason: "not-presenter" | "invalid-transition" | "released" | "disposed";
	  };

export interface PlayerViewRefs {
	readonly focusSurface: (node: HTMLElement | null) => void;
	readonly mediaHost: (node: HTMLElement | null) => void;
	readonly floatingHeader: (node: HTMLElement | null) => void;
	readonly resizeLeft: (node: HTMLElement | null) => void;
	readonly resizeRight: (node: HTMLElement | null) => void;
}

export interface PlayerViewMount {
	getSnapshot(): PlayerViewSnapshot;
	subscribe(listener: () => void): () => void;
	readonly refs: PlayerViewRefs;
	act(action: PlayerViewAction): PlayerViewActionResult;
	dispose(): void;
}

export interface PlayerViewDomMount {
	readonly media: VideoMediaPort;
	readonly refs: PlayerViewRefs;
	focus(): boolean;
	getViewport(): { readonly width: number; readonly height: number };
	setActive(active: boolean): void;
	dispose(): void;
}

export interface PlayerViewDomAdapter {
	mount(input: {
		readonly ownerDocument: Document;
		readonly getSnapshot: () => PlayerViewSnapshot;
		readonly act: (action: PlayerViewAction) => PlayerViewActionResult;
		readonly focusReady: () => void;
		readonly beginPointer: (
			kind: "move" | "resize-left" | "resize-right",
			point: PointerPoint,
		) => void;
		readonly movePointer: (point: PointerPoint) => void;
		readonly finishPointer: () => void;
		readonly viewportChanged: () => void;
	}): PlayerViewDomMount;
}

export interface PointerPoint {
	readonly x: number;
	readonly y: number;
}

export interface PlayerViewInteractionOptions {
	readonly runtime: VideoPlayerRuntime;
	readonly presentation: VideoPlayerPresentationStateStore;
	readonly dom: PlayerViewDomAdapter;
}

interface Registration {
	dom: PlayerViewDomMount | null;
	mediaRelease: (() => void) | null;
	snapshot: PlayerViewSnapshot;
	readonly listeners: Set<() => void>;
	released: boolean;
}

interface PointerGesture {
	readonly registration: Registration;
	readonly kind: "move" | "resize-left" | "resize-right";
	readonly origin: PointerPoint;
	start: FloatingRect;
	moved: boolean;
}

export class PlayerViewInteraction {
	private readonly registrations: Registration[] = [];
	private presentation: PlayerViewPresentation = { kind: "docked" };
	private queueExpanded: boolean;
	private pendingFocus = false;
	private pointerGesture: PointerGesture | null = null;
	private disposed = false;
	private readonly unsubscribePresentation: () => void;

	constructor(private readonly options: PlayerViewInteractionOptions) {
		this.queueExpanded = options.presentation.load().queueExpanded;
		this.unsubscribePresentation = options.presentation.subscribe(() => {
			const state = options.presentation.load();
			const rect =
				this.presentation.kind === "floating" && state.floatingRect
					? state.floatingRect
					: this.presentation.kind === "floating"
						? this.presentation.rect
						: null;
			const changed =
				state.queueExpanded !== this.queueExpanded ||
				(this.presentation.kind === "floating" && rect !== this.presentation.rect);
			this.queueExpanded = state.queueExpanded;
			if (this.presentation.kind === "floating" && rect) {
				this.presentation = { ...this.presentation, rect };
			}
			if (changed) this.publish();
		});
	}

	async open(activateView: () => Promise<void>): Promise<void> {
		if (this.disposed) return;
		this.pendingFocus = true;
		if (this.presentation.kind !== "floating") {
			try {
				await activateView();
			} catch (error) {
				this.pendingFocus = false;
				throw error;
			}
		}
		this.consumePendingFocus();
	}

	mount(input: { readonly ownerDocument: Document }): PlayerViewMount {
		const registration: Registration = {
			dom: null,
			mediaRelease: null,
			snapshot: this.snapshotFor("waiting"),
			listeners: new Set(),
			released: false,
		};
		const getSnapshot = () => registration.snapshot;
		const act = (action: PlayerViewAction) => this.act(registration, action);
		const handle: PlayerViewMount = {
			getSnapshot,
			subscribe: (listener) => {
				registration.listeners.add(listener);
				return () => registration.listeners.delete(listener);
			},
			get refs() {
				return registration.dom!.refs;
			},
			act,
			dispose: () => this.release(registration),
		};
		registration.dom = this.options.dom.mount({
			ownerDocument: input.ownerDocument,
			getSnapshot,
			act,
			focusReady: () => this.consumePendingFocus(),
			beginPointer: (kind, point) => this.beginPointer(registration, kind, point),
			movePointer: (point) => this.movePointer(point),
			finishPointer: () => this.finishPointer(),
			viewportChanged: () => this.viewportChanged(registration),
		});
		this.registrations.push(registration);
		if (this.registrations.length === 1) this.activate(registration);
		this.publish();
		return handle;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribePresentation();
		while (this.registrations.length > 0) this.release(this.registrations[0]!);
	}

	private act(registration: Registration, action: PlayerViewAction): PlayerViewActionResult {
		if (this.disposed) return { kind: "rejected", reason: "disposed" };
		if (registration.released) return { kind: "rejected", reason: "released" };
		if (registration !== this.presenter()) return { kind: "rejected", reason: "not-presenter" };
		switch (action.type) {
			case "enter-floating": {
				if (this.presentation.kind === "floating") return { kind: "applied" };
				const saved = this.options.presentation.load().floatingRect;
				this.presentation = {
					kind: "floating",
					maximized: false,
					rect: saved ?? defaultFloatingRect(registration.dom!.getViewport()),
				};
				this.pendingFocus = true;
				this.publish();
				return { kind: "applied" };
			}
			case "toggle-maximized":
				if (this.presentation.kind !== "floating") {
					return { kind: "rejected", reason: "invalid-transition" };
				}
				this.presentation = {
					...this.presentation,
					maximized: !this.presentation.maximized,
				};
				this.publish();
				return { kind: "applied" };
			case "dock-and-pause":
				this.options.runtime.pause();
				this.presentation = { kind: "docked" };
				this.pendingFocus = true;
				this.publish();
				return { kind: "applied" };
			case "set-queue-expanded":
				if (this.queueExpanded === action.expanded) return { kind: "applied" };
				this.queueExpanded = action.expanded;
				this.options.presentation.save({
					...this.options.presentation.load(),
					queueExpanded: action.expanded,
				});
				this.publish();
				return { kind: "applied" };
		}
	}

	private release(registration: Registration): void {
		if (registration.released) return;
		const wasPresenter = registration === this.presenter();
		registration.released = true;
		if (wasPresenter) {
			this.options.runtime.pause();
			this.presentation = { kind: "docked" };
			registration.mediaRelease?.();
			registration.dom?.setActive(false);
		}
		registration.dom?.dispose();
		registration.listeners.clear();
		const index = this.registrations.indexOf(registration);
		if (index >= 0) this.registrations.splice(index, 1);
		if (wasPresenter) {
			const next = this.registrations[0];
			if (next) this.activate(next);
		}
		this.publish();
	}

	private activate(registration: Registration): void {
		const dom = registration.dom;
		if (!dom) return;
		dom.setActive(true);
		registration.mediaRelease = this.options.runtime.bindMedia(dom.media);
		this.consumePendingFocus();
	}

	private presenter(): Registration | undefined {
		return this.registrations[0];
	}

	private publish(): void {
		const presenter = this.presenter();
		for (const registration of this.registrations) {
			registration.snapshot = this.snapshotFor(
				registration === presenter ? "presenter" : "waiting",
			);
			for (const listener of registration.listeners) listener();
		}
	}

	private snapshotFor(role: PlayerViewSnapshot["role"]): PlayerViewSnapshot {
		return {
			role,
			presentation: this.presentation,
			queueExpanded: this.queueExpanded,
		};
	}

	private consumePendingFocus(): void {
		if (!this.pendingFocus) return;
		if (this.presenter()?.dom?.focus()) this.pendingFocus = false;
	}

	private beginPointer(
		registration: Registration,
		kind: PointerGesture["kind"],
		point: PointerPoint,
	): void {
		if (registration !== this.presenter() || this.presentation.kind !== "floating") return;
		this.pointerGesture = {
			registration,
			kind,
			origin: point,
			start: this.presentation.rect,
			moved: false,
		};
	}

	private movePointer(point: PointerPoint): void {
		const gesture = this.pointerGesture;
		if (!gesture || this.presentation.kind !== "floating") return;
		const rawDx = point.x - gesture.origin.x;
		const rawDy = point.y - gesture.origin.y;
		if (!gesture.moved) {
			if (Math.hypot(rawDx, rawDy) < 3) return;
			gesture.moved = true;
			if (gesture.kind === "move" && this.presentation.maximized) {
				gesture.start = demotedDragStart(
					gesture.origin,
					this.presentation.rect,
					gesture.registration.dom!.getViewport(),
				);
				this.presentation = { ...this.presentation, maximized: false, rect: gesture.start };
			}
		}
		const viewport = gesture.registration.dom!.getViewport();
		const rect =
			gesture.kind === "resize-left"
				? resizeFromLeft(gesture.start, rawDx, rawDy, viewport)
				: clampFloatingRect(
						gesture.kind === "move"
							? {
									...gesture.start,
									x: gesture.start.x + rawDx,
									y: gesture.start.y + rawDy,
								}
							: {
									...gesture.start,
									width: gesture.start.width + rawDx,
									height: gesture.start.height + rawDy,
								},
						viewport,
					);
		this.presentation = { kind: "floating", maximized: false, rect };
		this.publish();
	}

	private finishPointer(): void {
		const gesture = this.pointerGesture;
		this.pointerGesture = null;
		if (!gesture?.moved || this.presentation.kind !== "floating") return;
		this.options.presentation.save({
			...this.options.presentation.load(),
			floatingRect: this.presentation.rect,
		});
	}

	private viewportChanged(registration: Registration): void {
		if (registration !== this.presenter() || this.presentation.kind !== "floating") return;
		const rect = clampFloatingRect(this.presentation.rect, registration.dom!.getViewport());
		this.presentation = { ...this.presentation, rect };
		this.publish();
		if (!this.presentation.maximized) {
			this.options.presentation.save({
				...this.options.presentation.load(),
				floatingRect: rect,
			});
		}
	}
}

function defaultFloatingRect(viewport: {
	readonly width: number;
	readonly height: number;
}): FloatingRect {
	const edgeGap = 16;
	const width = Math.min(480, Math.max(1, viewport.width - edgeGap * 2));
	const height = Math.min(320, Math.max(1, viewport.height - edgeGap * 2));
	return {
		x: Math.max(edgeGap, viewport.width - width - edgeGap),
		y: Math.max(edgeGap, viewport.height - height - edgeGap),
		width,
		height,
	};
}

function clampFloatingRect(
	rect: FloatingRect,
	viewport: { readonly width: number; readonly height: number },
): FloatingRect {
	const edgeGap = 16;
	const maxWidth = Math.max(1, viewport.width - edgeGap * 2);
	const maxHeight = Math.max(1, viewport.height - edgeGap * 2);
	const minWidth = Math.min(320, maxWidth);
	const minHeight = Math.min(240, maxHeight);
	const width = clamp(rect.width, minWidth, maxWidth);
	const height = clamp(rect.height, minHeight, maxHeight);
	return {
		x: clamp(rect.x, edgeGap, Math.max(edgeGap, viewport.width - width - edgeGap)),
		y: clamp(rect.y, edgeGap, Math.max(edgeGap, viewport.height - height - edgeGap)),
		width,
		height,
	};
}

function resizeFromLeft(
	start: FloatingRect,
	dx: number,
	dy: number,
	viewport: { readonly width: number; readonly height: number },
): FloatingRect {
	const edgeGap = 16;
	const right = start.x + start.width;
	const maxWidth = Math.max(1, right - edgeGap);
	const minWidth = Math.min(320, maxWidth);
	const width = clamp(start.width - dx, minWidth, maxWidth);
	return clampFloatingRect(
		{ ...start, x: right - width, width, height: start.height + dy },
		viewport,
	);
}

function demotedDragStart(
	origin: PointerPoint,
	normal: FloatingRect,
	viewport: { readonly width: number; readonly height: number },
): FloatingRect {
	const rect = clampFloatingRect(normal, viewport);
	const ratioX = viewport.width > 0 ? origin.x / viewport.width : 0.5;
	return clampFloatingRect(
		{
			...rect,
			x: origin.x - rect.width * ratioX,
			y: origin.y - 20,
		},
		viewport,
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
