import { describe, expect, it, vi } from "vite-plus/test";
import type { FloatingRect, VideoPlayerStateStore } from "../../domain/types";
import { VideoPlayerRuntime, emptyPlaybackState } from "../../domain/videoPlayerRuntime";
import type { VideoPlayerPresentationStateStore } from "../../domain/localVideoPlayerState";
import { PlayerViewInteraction } from "../playerViewInteraction";

class MemoryPlaybackStore implements VideoPlayerStateStore {
	state = emptyPlaybackState();
	load = () => this.state;
	save = (state: ReturnType<typeof emptyPlaybackState>) => {
		this.state = state;
	};
	clear = () => {
		this.state = emptyPlaybackState();
	};
}

class MemoryPresentationStore implements VideoPlayerPresentationStateStore {
	state: { floatingRect: FloatingRect | null; queueExpanded: boolean } = {
		floatingRect: null,
		queueExpanded: true,
	};
	private readonly listeners = new Set<() => void>();
	load = () => this.state;
	save = (state: typeof this.state) => {
		this.state = state;
		for (const listener of this.listeners) listener();
	};
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
}

interface TestElement {
	tagName: string;
	className: string;
	parentElement: TestElement | null;
	children: TestElement[];
	paused: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	src: string;
	playsInline: boolean;
	preload: string;
	tabIndex: number;
	append(child: TestElement): void;
	remove(): void;
	focus: ReturnType<typeof vi.fn>;
	pause: ReturnType<typeof vi.fn>;
	play: ReturnType<typeof vi.fn>;
	load: ReturnType<typeof vi.fn>;
	addEventListener(type: string, listener: (event: any) => void): void;
	removeEventListener(type: string, listener: (event: any) => void): void;
	dispatchEvent(event: any): boolean;
}

function createTestElement(tagName: string): TestElement {
	const listeners = new Map<string, Set<(event: any) => void>>();
	const element: TestElement = {
		tagName: tagName.toUpperCase(),
		className: "",
		parentElement: null,
		children: [],
		paused: true,
		currentTime: 0,
		duration: 100,
		playbackRate: 1,
		src: "",
		playsInline: false,
		preload: "metadata",
		tabIndex: -1,
		append(child: TestElement) {
			child.parentElement = element;
			element.children.push(child);
		},
		remove() {
			if (element.parentElement) {
				const index = element.parentElement.children.indexOf(element);
				if (index >= 0) element.parentElement.children.splice(index, 1);
				element.parentElement = null;
			}
		},
		focus: vi.fn(),
		pause: vi.fn(() => {
			element.paused = true;
			element.dispatchEvent({ type: "pause" });
		}),
		play: vi.fn(async () => {
			element.paused = false;
			element.dispatchEvent({ type: "play" });
		}),
		load: vi.fn(),
		addEventListener(type: string, listener: (event: any) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		},
		removeEventListener(type: string, listener: (event: any) => void) {
			listeners.get(type)?.delete(listener);
		},
		dispatchEvent(event: any): boolean {
			const set = listeners.get(event.type);
			if (set) {
				for (const listener of set) listener(event);
			}
			return true;
		},
	};
	return element;
}

interface TestDocument {
	readonly defaultView: {
		innerWidth: number;
		innerHeight: number;
		requestAnimationFrame(callback: FrameRequestCallback): number;
		cancelAnimationFrame(handle: number): void;
		addEventListener(type: string, listener: (event: any) => void): void;
		removeEventListener(type: string, listener: (event: any) => void): void;
		dispatchEvent(event: any): boolean;
	};
	readonly createdElements: TestElement[];
	createElement(tagName: string): TestElement;
}

function createTestDocument(viewport = { width: 1000, height: 800 }): TestDocument {
	const windowListeners = new Map<string, Set<(event: any) => void>>();
	const createdElements: TestElement[] = [];
	let frameId = 0;
	const activeFrames = new Map<number, FrameRequestCallback>();

	const defaultView = {
		innerWidth: viewport.width,
		innerHeight: viewport.height,
		requestAnimationFrame(callback: FrameRequestCallback): number {
			const id = ++frameId;
			activeFrames.set(id, callback);
			// Synchronously flush for immediate deterministic assertions
			callback(0);
			activeFrames.delete(id);
			return id;
		},
		cancelAnimationFrame(handle: number) {
			activeFrames.delete(handle);
		},
		addEventListener(type: string, listener: (event: any) => void) {
			if (!windowListeners.has(type)) windowListeners.set(type, new Set());
			windowListeners.get(type)!.add(listener);
		},
		removeEventListener(type: string, listener: (event: any) => void) {
			windowListeners.get(type)?.delete(listener);
		},
		dispatchEvent(event: any): boolean {
			const set = windowListeners.get(event.type);
			if (set) {
				for (const listener of set) listener(event);
			}
			return true;
		},
	};

	return {
		defaultView,
		createdElements,
		createElement(tagName: string) {
			const element = createTestElement(tagName);
			createdElements.push(element);
			return element;
		},
	};
}

describe("PlayerViewInteraction", () => {
	it("gives the earliest live Player view presentation and hands it off in registration order", async () => {
		const playback = new MemoryPlaybackStore();
		const runtime = new VideoPlayerRuntime({ state: playback, toMediaUrl: (path) => path });
		runtime.addSources([{ id: "one", path: "/one.mp4", name: "one.mp4" }]);
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });

		const doc1 = createTestDocument();
		const doc2 = createTestDocument();
		const doc3 = createTestDocument();

		const first = interaction.mount({ ownerDocument: doc1 as unknown as Document });
		const second = interaction.mount({ ownerDocument: doc2 as unknown as Document });
		const third = interaction.mount({ ownerDocument: doc3 as unknown as Document });

		expect(first.getSnapshot().role).toBe("presenter");
		expect(second.getSnapshot().role).toBe("waiting");
		expect(third.getSnapshot().role).toBe("waiting");

		const video1 = doc1.createdElements.find((el) => el.tagName === "VIDEO")!;
		expect(video1).toBeDefined();

		runtime.togglePlayback();
		await Promise.resolve();
		expect(video1.play).toHaveBeenCalled();

		first.dispose();

		expect(video1.pause).toHaveBeenCalled();
		expect(second.getSnapshot().role).toBe("presenter");
		expect(third.getSnapshot().role).toBe("waiting");
	});

	it("owns the docked, Floating player, and maximized transitions", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });

		expect(view.act({ type: "enter-floating" })).toEqual({ kind: "applied" });
		expect(view.getSnapshot().presentation).toEqual({
			kind: "floating",
			maximized: false,
			rect: { x: 504, y: 464, width: 480, height: 320 },
		});

		expect(view.act({ type: "toggle-maximized" })).toEqual({ kind: "applied" });
		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: true,
		});

		expect(view.act({ type: "dock-and-pause" })).toEqual({ kind: "applied" });
		expect(view.getSnapshot().presentation).toEqual({ kind: "docked" });
	});

	it("focuses only after the new docked or Floating surface reports that it mounted", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });
		const focusSurfaceEl = createTestElement("div");

		view.act({ type: "enter-floating" });
		expect(focusSurfaceEl.focus).not.toHaveBeenCalled();

		view.refs.focusSurface(focusSurfaceEl as unknown as HTMLElement);
		expect(focusSurfaceEl.focus).toHaveBeenCalledOnce();

		view.act({ type: "dock-and-pause" });
		// When transitioning, pendingFocus is set. When the surface ref re-registers:
		view.refs.focusSurface(focusSurfaceEl as unknown as HTMLElement);
		expect(focusSurfaceEl.focus).toHaveBeenCalledTimes(2);
	});

	it("opens a docked Player view, focuses a Floating player, and persists queue disclosure", async () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const activate = vi.fn(async () => undefined);

		await interaction.open(activate);
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });
		const focusSurfaceEl = createTestElement("div");
		view.refs.focusSurface(focusSurfaceEl as unknown as HTMLElement);

		expect(focusSurfaceEl.focus).toHaveBeenCalledOnce();
		expect(activate).toHaveBeenCalledOnce();

		view.act({ type: "set-queue-expanded", expanded: false });
		expect(view.getSnapshot().queueExpanded).toBe(false);
		expect(presentation.state.queueExpanded).toBe(false);

		view.act({ type: "enter-floating" });
		await interaction.open(activate);
		expect(activate).toHaveBeenCalledOnce();
		expect(focusSurfaceEl.focus).toHaveBeenCalledTimes(2);
	});

	it("creates one owner-document media element and reparents it across player surfaces", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });

		const video = doc.createdElements.find((el) => el.tagName === "VIDEO")!;
		expect(video).toBeDefined();

		const dockedHost = createTestElement("div");
		const floatingHost = createTestElement("div");

		view.refs.mediaHost(dockedHost as unknown as HTMLElement);
		expect(video.parentElement).toBe(dockedHost);

		view.refs.mediaHost(floatingHost as unknown as HTMLElement);
		expect(video.parentElement).toBe(floatingHost);

		view.dispose();
		expect(video.pause).toHaveBeenCalled();
		expect(video.parentElement).toBeNull();
	});

	it("demotes a maximized Floating player during drag and persists only the committed rect", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });
		const header = createTestElement("div");
		view.refs.floatingHeader(header as unknown as HTMLElement);

		view.act({ type: "enter-floating" });
		view.act({ type: "toggle-maximized" });

		// Trigger pointerdown on header
		header.dispatchEvent({
			type: "pointerdown",
			clientX: 500,
			clientY: 20,
			pointerId: 1,
			preventDefault: vi.fn(),
		});

		// Trigger pointermove on window
		doc.defaultView.dispatchEvent({
			type: "pointermove",
			clientX: 550,
			clientY: 70,
			pointerId: 1,
		});

		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: false,
		});
		expect(presentation.state.floatingRect).toBeNull();

		// Trigger pointerup on window to commit
		doc.defaultView.dispatchEvent({
			type: "pointerup",
			clientX: 550,
			clientY: 70,
			pointerId: 1,
		});

		expect(presentation.state.floatingRect).toEqual(
			expect.objectContaining({ width: 480, height: 320 }),
		);
	});

	it("toggles maximized on double clicking header or media surface", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });

		const header = createTestElement("div");
		const mediaHost = createTestElement("div");
		view.refs.floatingHeader(header as unknown as HTMLElement);
		view.refs.mediaHost(mediaHost as unknown as HTMLElement);

		view.act({ type: "enter-floating" });
		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: false,
		});

		header.dispatchEvent({ type: "dblclick", preventDefault: vi.fn() });
		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: true,
		});

		mediaHost.dispatchEvent({ type: "dblclick", preventDefault: vi.fn() });
		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: false,
		});
	});

	it("toggles maximized on Escape key when floating and maximized", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const interaction = new PlayerViewInteraction({ runtime, presentation });
		const doc = createTestDocument();
		const view = interaction.mount({ ownerDocument: doc as unknown as Document });

		view.act({ type: "enter-floating" });
		view.act({ type: "toggle-maximized" });
		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: true,
		});

		doc.defaultView.dispatchEvent({
			type: "keydown",
			key: "Escape",
			preventDefault: vi.fn(),
		});

		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: false,
		});
	});
});
