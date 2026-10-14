import { describe, expect, it, vi } from "vite-plus/test";
import { PlayerViewInteraction, type PlayerViewDomMount } from "../playerViewInteraction";
import type { FloatingRect } from "../../domain/types";
import { BrowserPlayerViewDomAdapter } from "../playerViewDomAdapter";

interface FakeNode {
	parentElement: FakeNode | null;
	append(child: FakeNode): void;
	remove(): void;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
}

function node(): FakeNode {
	const value: FakeNode = {
		parentElement: null,
		append(child) {
			child.parentElement = value;
		},
		remove() {
			value.parentElement = null;
		},
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		focus: vi.fn(),
	};
	return value;
}

describe("BrowserPlayerViewDomAdapter", () => {
	it("creates one owner-document media element and reparents it across player surfaces", () => {
		const media = Object.assign(node(), {
			className: "",
			playsInline: false,
			preload: "",
			tabIndex: 0,
			pause: vi.fn(),
			currentTime: 0,
			duration: 0,
			paused: true,
			playbackRate: 1,
			src: "",
			play: vi.fn(async () => undefined),
			load: vi.fn(),
		});
		const win = {
			innerWidth: 1000,
			innerHeight: 800,
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		const createElement = vi.fn(() => media);
		const ownerDocument = {
			createElement,
			defaultView: win,
		} as unknown as Document;
		const mount = new BrowserPlayerViewDomAdapter().mount({
			ownerDocument,
			getSnapshot: () => ({
				role: "presenter",
				presentation: { kind: "docked" },
				queueExpanded: true,
			}),
			act: () => ({ kind: "applied" }),
			focusReady: vi.fn(),
			beginPointer: vi.fn(),
			movePointer: vi.fn(),
			finishPointer: vi.fn(),
			viewportChanged: vi.fn(),
		});
		const docked = node();
		const floating = node();

		mount.setActive(true);
		mount.refs.mediaHost(docked as unknown as HTMLElement);
		expect(media.parentElement).toBe(docked);

		mount.refs.mediaHost(floating as unknown as HTMLElement);
		expect(media.parentElement).toBe(floating);
		expect(createElement).toHaveBeenCalledOnce();

		mount.dispose();
		expect(media.pause).toHaveBeenCalledOnce();
		expect(media.parentElement).toBeNull();
	});
});

function pointerHarness(kind: "move" | "resize-left" | "resize-right" = "move", maximized = false) {
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0;
	const listeners = new Map<string, EventListener>();
	const win = {
		requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
			frames.set(++frameId, callback);
			return frameId;
		}),
		cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
		addEventListener: vi.fn((name: string, listener: EventListener) =>
			listeners.set(name, listener),
		),
		removeEventListener: vi.fn((name: string) => listeners.delete(name)),
	};
	const media = Object.assign(node(), { pause: vi.fn() });
	let movePointer = vi.fn();
	let finishPointer = vi.fn();
	let mount!: PlayerViewDomMount;
	let saved = { floatingRect: null as FloatingRect | null, queueExpanded: true };
	const save = vi.fn((state: typeof saved) => {
		saved = state;
	});
	const interaction = new PlayerViewInteraction({
		runtime: { pause: vi.fn(), bindMedia: () => () => {} } as never,
		presentation: { load: () => saved, save, subscribe: () => () => {} },
		dom: {
			mount(input) {
				movePointer = vi.fn(input.movePointer);
				finishPointer = vi.fn(input.finishPointer);
				mount = new BrowserPlayerViewDomAdapter().mount({
					...input,
					movePointer,
					finishPointer,
				});
				return mount;
			},
		},
	});
	const view = interaction.mount({
		ownerDocument: { defaultView: win, createElement: () => media } as unknown as Document,
	});
	view.act({ type: "enter-floating" });
	if (maximized) view.act({ type: "toggle-maximized" });
	const header = node();
	mount.setActive(true);
	const ref =
		kind === "move"
			? mount.refs.floatingHeader
			: kind === "resize-left"
				? mount.refs.resizeLeft
				: mount.refs.resizeRight;
	ref(header as unknown as HTMLElement);
	const pointerDown = header.addEventListener.mock.calls.find(
		([name]) => name === "pointerdown",
	)![1];
	pointerDown({ preventDefault: vi.fn(), target: null, clientX: 0, clientY: 0, pointerId: 1 });
	return {
		mount,
		view,
		save,
		frames,
		movePointer,
		finishPointer,
		move: (x: number, pointerId = 1, y = x + 1) =>
			listeners.get("pointermove")!({
				clientX: x,
				clientY: y,
				pointerId,
			} as unknown as Event),
		finish: (kind = "pointerup", pointerId = 1) =>
			listeners.get(kind)!({ pointerId } as unknown as Event),
		frame: () => {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback(0);
		},
	};
}

describe("player pointer frame batching", () => {
	it("publishes only the latest of 120 pointer samples per frame", () => {
		const h = pointerHarness();
		for (let index = 1; index <= 120; index++) h.move(index);
		expect(h.movePointer).not.toHaveBeenCalled();
		expect(h.frames.size).toBe(1);
		h.frame();
		expect(h.movePointer).toHaveBeenCalledExactlyOnceWith({ x: 120, y: 121 });
		h.move(130);
		h.frame();
		expect(h.movePointer).toHaveBeenCalledTimes(2);
		h.mount.dispose();
	});

	it.each(["pointerup", "pointercancel"])(
		"flushes the final position before %s persists it",
		(kind) => {
			const h = pointerHarness();
			h.move(10);
			h.finish(kind);
			expect(h.movePointer).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 11 });
			expect(h.movePointer.mock.invocationCallOrder[0]).toBeLessThan(
				h.finishPointer.mock.invocationCallOrder[0]!,
			);
			expect(h.frames.size).toBe(0);
			h.mount.dispose();
		},
	);

	it("cancels pending samples when the presenting view releases its DOM", () => {
		const h = pointerHarness();
		h.move(10);
		h.mount.dispose();
		h.frame();
		expect(h.frames.size).toBe(0);
		expect(h.movePointer).not.toHaveBeenCalled();
		expect(h.finishPointer).not.toHaveBeenCalled();
	});
});

describe("player gesture excursions", () => {
	it.each(["move", "resize-left", "resize-right"] as const)(
		"preserves %s threshold crossings when the pointer returns within one frame",
		(kind) => {
			const h = pointerHarness(kind, true);
			h.move(10, 1, 0);
			h.move(0, 1, 0);
			h.frame();
			expect(h.movePointer).toHaveBeenCalledTimes(2);
			expect(h.view.getSnapshot().presentation).toMatchObject({
				kind: "floating",
				maximized: false,
			});
			h.finish();
			expect(h.save).toHaveBeenCalledOnce();
			expect(h.save.mock.calls[0]![0].floatingRect).toEqual(
				(h.view.getSnapshot().presentation as { rect: FloatingRect }).rect,
			);
			h.mount.dispose();
		},
	);

	it.each(["pointerup", "pointercancel"])(
		"flushes an excursion on %s before the first animation frame",
		(event) => {
			const h = pointerHarness("move", true);
			h.move(10, 1, 0);
			h.move(0, 1, 0);
			h.finish(event);
			expect(h.movePointer.mock.calls).toEqual([[{ x: 10, y: 0 }], [{ x: 0, y: 0 }]]);
			expect(h.view.getSnapshot().presentation).toMatchObject({ maximized: false });
			expect(h.save).toHaveBeenCalledOnce();
			expect(h.frames.size).toBe(0);
			h.mount.dispose();
		},
	);

	it("ignores other pointers without finishing or replacing the original samples", () => {
		const h = pointerHarness();
		h.move(10);
		h.move(100, 2);
		h.finish("pointerup", 2);
		expect(h.finishPointer).not.toHaveBeenCalled();
		h.finish();
		expect(h.movePointer).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 11 });
		expect(h.finishPointer).toHaveBeenCalledOnce();
		h.mount.dispose();
	});
});
