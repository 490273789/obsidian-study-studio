import type {
	PlayerViewAction,
	PlayerViewActionResult,
	PlayerViewDomAdapter,
	PlayerViewDomMount,
	PlayerViewRefs,
	PlayerViewSnapshot,
	PointerPoint,
} from "./playerViewInteraction";
import styles from "./VideoPlayer.module.scss";

type PointerKind = "move" | "resize-left" | "resize-right";

interface MountInput {
	readonly ownerDocument: Document;
	readonly getSnapshot: () => PlayerViewSnapshot;
	readonly act: (action: PlayerViewAction) => PlayerViewActionResult;
	readonly focusReady: () => void;
	readonly beginPointer: (kind: PointerKind, point: PointerPoint) => void;
	readonly movePointer: (point: PointerPoint) => void;
	readonly finishPointer: () => void;
	readonly viewportChanged: () => void;
}

export class BrowserPlayerViewDomAdapter implements PlayerViewDomAdapter {
	mount(input: MountInput): PlayerViewDomMount {
		return new BrowserPlayerViewDomMount(input);
	}
}

class BrowserPlayerViewDomMount implements PlayerViewDomMount {
	readonly media: HTMLVideoElement;
	readonly refs: PlayerViewRefs;
	private active = false;
	private disposed = false;
	private focusNode: HTMLElement | null = null;
	private mediaHostNode: HTMLElement | null = null;
	private readonly refCleanups = new Map<keyof PlayerViewRefs, () => void>();
	private pointerCleanup: (() => void) | null = null;

	constructor(private readonly input: MountInput) {
		this.media = input.ownerDocument.createElement("video");
		this.media.className = styles.video;
		this.media.playsInline = true;
		this.media.preload = "metadata";
		this.media.tabIndex = -1;
		this.refs = {
			focusSurface: (node) => this.setFocusNode(node),
			mediaHost: (node) => this.setMediaHost(node),
			floatingHeader: (node) => this.bindPointerRef("floatingHeader", node, "move", true),
			resizeLeft: (node) => this.bindPointerRef("resizeLeft", node, "resize-left", false),
			resizeRight: (node) => this.bindPointerRef("resizeRight", node, "resize-right", false),
		};
	}

	focus(): boolean {
		const node = this.focusNode;
		if (!node || this.disposed) return false;
		const win = this.input.ownerDocument.defaultView;
		if (win?.requestAnimationFrame) win.requestAnimationFrame(() => node.focus());
		else node.focus();
		return true;
	}

	getViewport(): { width: number; height: number } {
		return {
			width: this.input.ownerDocument.defaultView?.innerWidth ?? 1024,
			height: this.input.ownerDocument.defaultView?.innerHeight ?? 768,
		};
	}

	setActive(active: boolean): void {
		if (this.disposed || this.active === active) return;
		this.active = active;
		const win = this.input.ownerDocument.defaultView;
		if (active) {
			if (this.mediaHostNode && this.media.parentElement !== this.mediaHostNode) {
				this.mediaHostNode.append(this.media);
			}
			win?.addEventListener("resize", this.handleViewportChange);
			win?.addEventListener("keydown", this.handleKeyDown);
		} else {
			win?.removeEventListener("resize", this.handleViewportChange);
			win?.removeEventListener("keydown", this.handleKeyDown);
			this.clearPointer();
			this.media.remove();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.setActive(false);
		this.disposed = true;
		for (const cleanup of this.refCleanups.values()) cleanup();
		this.refCleanups.clear();
		this.media.pause();
		this.media.remove();
		this.focusNode = null;
		this.mediaHostNode = null;
	}

	private setFocusNode(node: HTMLElement | null): void {
		this.focusNode = node;
		if (node) this.input.focusReady();
	}

	private setMediaHost(node: HTMLElement | null): void {
		this.clearRef("mediaHost");
		this.mediaHostNode = node;
		if (node && this.active && this.media.parentElement !== node) node.append(this.media);
		if (!node) return;
		const onDoubleClick = (event: MouseEvent) => {
			if (!isInteractiveTarget(event.target)) {
				event.preventDefault();
				this.input.act({ type: "toggle-maximized" });
			}
		};
		node.addEventListener("dblclick", onDoubleClick);
		this.refCleanups.set("mediaHost", () =>
			node.removeEventListener("dblclick", onDoubleClick),
		);
	}

	private bindPointerRef(
		key: "floatingHeader" | "resizeLeft" | "resizeRight",
		node: HTMLElement | null,
		kind: PointerKind,
		ignoreInteractive: boolean,
	): void {
		this.clearRef(key);
		if (!node) return;
		const onPointerDown = (event: PointerEvent) => {
			if (ignoreInteractive && isInteractiveTarget(event.target)) return;
			event.preventDefault();
			this.beginPointer(kind, event);
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (kind !== "move" || (ignoreInteractive && isInteractiveTarget(event.target))) return;
			event.preventDefault();
			this.input.act({ type: "toggle-maximized" });
		};
		node.addEventListener("pointerdown", onPointerDown);
		node.addEventListener("dblclick", onDoubleClick);
		this.refCleanups.set(key, () => {
			node.removeEventListener("pointerdown", onPointerDown);
			node.removeEventListener("dblclick", onDoubleClick);
		});
	}

	private beginPointer(kind: PointerKind, event: PointerEvent): void {
		if (!this.active) return;
		this.clearPointer();
		const win = this.input.ownerDocument.defaultView;
		if (!win) return;
		this.input.beginPointer(kind, point(event));
		const move = (next: PointerEvent) => this.input.movePointer(point(next));
		const finish = () => {
			this.input.finishPointer();
			this.clearPointer();
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", finish, { once: true });
		win.addEventListener("pointercancel", finish, { once: true });
		this.pointerCleanup = () => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", finish);
			win.removeEventListener("pointercancel", finish);
		};
	}

	private clearPointer(): void {
		this.pointerCleanup?.();
		this.pointerCleanup = null;
	}

	private clearRef(key: keyof PlayerViewRefs): void {
		this.refCleanups.get(key)?.();
		this.refCleanups.delete(key);
	}

	private readonly handleViewportChange = (): void => this.input.viewportChanged();

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const presentation = this.input.getSnapshot().presentation;
		if (event.key !== "Escape" || presentation.kind !== "floating" || !presentation.maximized)
			return;
		event.preventDefault();
		this.input.act({ type: "toggle-maximized" });
	};
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
