import type { VideoPlayerPresentationStateStore } from "../domain/localVideoPlayerState";
import type { FloatingRect } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import styles from "./VideoPlayer.module.scss";

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

export interface PointerPoint {
	readonly x: number;
	readonly y: number;
}

export interface PlayerViewInteractionOptions {
	readonly runtime: VideoPlayerRuntime;
	readonly presentation: VideoPlayerPresentationStateStore;
}

type PointerKind = "move" | "resize-left" | "resize-right";

interface Registration {
	readonly ownerDocument: Document;
	readonly media: HTMLVideoElement;
	readonly refs: PlayerViewRefs;
	readonly listeners: Set<() => void>;
	readonly refCleanups: Map<keyof PlayerViewRefs, () => void>;
	focusNode: HTMLElement | null;
	mediaHostNode: HTMLElement | null;
	pointerCleanup: (() => void) | null;
	snapshot: PlayerViewSnapshot;
	mediaRelease: (() => void) | null;
	active: boolean;
	released: boolean;
}

interface PointerGesture {
	readonly registration: Registration;
	readonly kind: PointerKind;
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
		const doc = input.ownerDocument;
		const media = doc.createElement("video");
		media.className = styles.video;
		media.playsInline = true;
		media.preload = "metadata";
		media.tabIndex = -1;

		const registration: Registration = {
			ownerDocument: doc,
			media,
			refs: {
				focusSurface: (node) => this.setFocusNode(registration, node),
				mediaHost: (node) => this.setMediaHost(registration, node),
				floatingHeader: (node) =>
					this.bindPointerRef(registration, "floatingHeader", node, "move", true),
				resizeLeft: (node) =>
					this.bindPointerRef(registration, "resizeLeft", node, "resize-left", false),
				resizeRight: (node) =>
					this.bindPointerRef(registration, "resizeRight", node, "resize-right", false),
			},
			listeners: new Set(),
			refCleanups: new Map(),
			focusNode: null,
			mediaHostNode: null,
			pointerCleanup: null,
			snapshot: this.snapshotFor("waiting"),
			mediaRelease: null,
			active: false,
			released: false,
		};

		const handle: PlayerViewMount = {
			getSnapshot: () => registration.snapshot,
			subscribe: (listener) => {
				registration.listeners.add(listener);
				return () => registration.listeners.delete(listener);
			},
			refs: registration.refs,
			act: (action) => this.act(registration, action),
			dispose: () => this.release(registration),
		};

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
					rect: saved ?? defaultFloatingRect(this.getViewport(registration)),
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
		this.setActive(registration, false);
		for (const cleanup of registration.refCleanups.values()) cleanup();
		registration.refCleanups.clear();
		registration.listeners.clear();
		registration.focusNode = null;
		registration.mediaHostNode = null;
		const index = this.registrations.indexOf(registration);
		if (index >= 0) this.registrations.splice(index, 1);
		if (wasPresenter) {
			const next = this.registrations[0];
			if (next) this.activate(next);
		}
		this.publish();
	}

	private activate(registration: Registration): void {
		this.setActive(registration, true);
		registration.mediaRelease = this.options.runtime.bindMedia(registration.media);
		this.consumePendingFocus();
	}

	private setActive(registration: Registration, active: boolean): void {
		if (registration.active === active) return;
		registration.active = active;
		const win = registration.ownerDocument.defaultView;
		if (active) {
			if (
				registration.mediaHostNode &&
				registration.media.parentElement !== registration.mediaHostNode
			) {
				registration.mediaHostNode.append(registration.media);
			}
			win?.addEventListener("resize", this.handleViewportChange);
			win?.addEventListener("keydown", this.handleKeyDown);
		} else {
			win?.removeEventListener("resize", this.handleViewportChange);
			win?.removeEventListener("keydown", this.handleKeyDown);
			this.clearPointer(registration);
			registration.mediaRelease?.();
			registration.mediaRelease = null;
			registration.media.pause();
			registration.media.remove();
		}
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
		const presenter = this.presenter();
		if (presenter && this.focus(presenter)) this.pendingFocus = false;
	}

	private focus(registration: Registration): boolean {
		const node = registration.focusNode;
		if (!node || registration.released || this.disposed) return false;
		const win = registration.ownerDocument.defaultView;
		if (win?.requestAnimationFrame) win.requestAnimationFrame(() => node.focus());
		else node.focus();
		return true;
	}

	private getViewport(registration: Registration): { width: number; height: number } {
		return {
			width: registration.ownerDocument.defaultView?.innerWidth ?? 1024,
			height: registration.ownerDocument.defaultView?.innerHeight ?? 768,
		};
	}

	private setFocusNode(registration: Registration, node: HTMLElement | null): void {
		registration.focusNode = node;
		if (node) this.consumePendingFocus();
	}

	private setMediaHost(registration: Registration, node: HTMLElement | null): void {
		this.clearRef(registration, "mediaHost");
		registration.mediaHostNode = node;
		if (node && registration.active && registration.media.parentElement !== node) {
			node.append(registration.media);
		}
		if (!node) return;
		const onDoubleClick = (event: MouseEvent) => {
			if (!isInteractiveTarget(event.target)) {
				event.preventDefault();
				this.act(registration, { type: "toggle-maximized" });
			}
		};
		node.addEventListener("dblclick", onDoubleClick);
		registration.refCleanups.set("mediaHost", () => {
			node.removeEventListener("dblclick", onDoubleClick);
		});
	}

	private bindPointerRef(
		registration: Registration,
		key: "floatingHeader" | "resizeLeft" | "resizeRight",
		node: HTMLElement | null,
		kind: PointerKind,
		ignoreInteractive: boolean,
	): void {
		this.clearRef(registration, key);
		if (!node) return;
		const onPointerDown = (event: PointerEvent) => {
			if (ignoreInteractive && isInteractiveTarget(event.target)) return;
			event.preventDefault();
			this.beginPointer(registration, kind, event);
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (kind !== "move" || (ignoreInteractive && isInteractiveTarget(event.target))) return;
			event.preventDefault();
			this.act(registration, { type: "toggle-maximized" });
		};
		node.addEventListener("pointerdown", onPointerDown);
		node.addEventListener("dblclick", onDoubleClick);
		registration.refCleanups.set(key, () => {
			node.removeEventListener("pointerdown", onPointerDown);
			node.removeEventListener("dblclick", onDoubleClick);
		});
	}

	private beginPointer(registration: Registration, kind: PointerKind, event: PointerEvent): void {
		if (
			!registration.active ||
			registration !== this.presenter() ||
			this.presentation.kind !== "floating"
		)
			return;
		this.clearPointer(registration);
		const win = registration.ownerDocument.defaultView;
		if (!win) return;
		const originPoint = point(event);
		this.pointerGesture = {
			registration,
			kind,
			origin: originPoint,
			start: this.presentation.rect,
			moved: false,
		};
		let frame: number | null = null;
		let pending: PointerPoint | null = null;
		let furthest: PointerPoint | null = null;
		let furthestDistance = -1;
		const pointerId = event.pointerId;
		const flush = () => {
			if (frame !== null) win.cancelAnimationFrame(frame);
			frame = null;
			const next = pending;
			const excursion = furthest;
			pending = null;
			furthest = null;
			furthestDistance = -1;
			if (excursion && excursion !== next) this.movePointer(excursion);
			if (next) this.movePointer(next);
		};
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			pending = point(next);
			const distance = (pending.x - originPoint.x) ** 2 + (pending.y - originPoint.y) ** 2;
			if (distance > furthestDistance) {
				furthest = pending;
				furthestDistance = distance;
			}
			if (!win.requestAnimationFrame) {
				flush();
			} else if (frame === null) {
				frame = win.requestAnimationFrame(() => {
					frame = null;
					flush();
				});
			}
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			flush();
			this.finishPointer();
			this.clearPointer(registration);
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", finish);
		win.addEventListener("pointercancel", finish);
		registration.pointerCleanup = () => {
			if (frame !== null) win.cancelAnimationFrame(frame);
			frame = null;
			pending = null;
			furthest = null;
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", finish);
			win.removeEventListener("pointercancel", finish);
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
					this.getViewport(gesture.registration),
				);
				this.presentation = { ...this.presentation, maximized: false, rect: gesture.start };
			}
		}
		const viewport = this.getViewport(gesture.registration);
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

	private clearPointer(registration: Registration): void {
		registration.pointerCleanup?.();
		registration.pointerCleanup = null;
	}

	private clearRef(registration: Registration, key: keyof PlayerViewRefs): void {
		registration.refCleanups.get(key)?.();
		registration.refCleanups.delete(key);
	}

	private readonly handleViewportChange = (): void => {
		const presenter = this.presenter();
		if (!presenter || this.presentation.kind !== "floating") return;
		const rect = clampFloatingRect(this.presentation.rect, this.getViewport(presenter));
		this.presentation = { ...this.presentation, rect };
		this.publish();
		if (!this.presentation.maximized) {
			this.options.presentation.save({
				...this.options.presentation.load(),
				floatingRect: rect,
			});
		}
	};

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const presenter = this.presenter();
		if (!presenter) return;
		const presentation = presenter.snapshot.presentation;
		if (event.key !== "Escape" || presentation.kind !== "floating" || !presentation.maximized) {
			return;
		}
		event.preventDefault();
		this.act(presenter, { type: "toggle-maximized" });
	};
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

function point(event: PointerEvent): PointerPoint {
	return { x: event.clientX, y: event.clientY };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
	return Boolean(
		(target as { closest?: (selector: string) => Element | null } | null)?.closest?.(
			"button, input, select, textarea, a, [role='button']",
		),
	);
}
