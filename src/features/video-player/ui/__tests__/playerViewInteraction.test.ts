import { describe, expect, it, vi } from "vitest";
import type { FloatingRect, VideoMediaPort, VideoPlayerStateStore } from "../../domain/types";
import { VideoPlayerRuntime, emptyPlaybackState } from "../../domain/videoPlayerRuntime";
import type { VideoPlayerPresentationStateStore } from "../../domain/localVideoPlayerState";
import {
	PlayerViewInteraction,
	type PlayerViewDomAdapter,
	type PlayerViewDomMount,
} from "../playerViewInteraction";

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

class Media implements VideoMediaPort {
	currentTime = 0;
	duration = 100;
	paused = true;
	playbackRate = 1;
	src = "";
	pause = vi.fn(() => {
		this.paused = true;
	});
	play = vi.fn(async () => {
		this.paused = false;
	});
	load = vi.fn();
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
}

class MemoryDomMount implements PlayerViewDomMount {
	readonly media = new Media();
	readonly refs = {
		focusSurface: vi.fn(),
		mediaHost: vi.fn(),
		floatingHeader: vi.fn(),
		resizeLeft: vi.fn(),
		resizeRight: vi.fn(),
	};
	focus = vi.fn(() => true);
	getViewport = vi.fn(() => ({ width: 1000, height: 800 }));
	setActive = vi.fn();
	dispose = vi.fn();
}

class MemoryDomAdapter implements PlayerViewDomAdapter {
	readonly mounts: MemoryDomMount[] = [];
	readonly inputs: Parameters<PlayerViewDomAdapter["mount"]>[0][] = [];
	mount(input: Parameters<PlayerViewDomAdapter["mount"]>[0]): MemoryDomMount {
		this.inputs.push(input);
		const mount = new MemoryDomMount();
		this.mounts.push(mount);
		return mount;
	}
}

describe("PlayerViewInteraction", () => {
	it("gives the earliest live Player view presentation and hands it off in registration order", async () => {
		const playback = new MemoryPlaybackStore();
		const runtime = new VideoPlayerRuntime({ state: playback, toMediaUrl: (path) => path });
		runtime.addSources([{ id: "one", path: "/one.mp4", name: "one.mp4" }]);
		const dom = new MemoryDomAdapter();
		const interaction = new PlayerViewInteraction({
			runtime,
			presentation: new MemoryPresentationStore(),
			dom,
		});

		const first = interaction.mount({ ownerDocument: {} as Document });
		const second = interaction.mount({ ownerDocument: {} as Document });
		const third = interaction.mount({ ownerDocument: {} as Document });

		expect(first.getSnapshot().role).toBe("presenter");
		expect(second.getSnapshot().role).toBe("waiting");
		expect(third.getSnapshot().role).toBe("waiting");

		runtime.togglePlayback();
		await Promise.resolve();
		expect(dom.mounts[0]!.media.paused).toBe(false);

		first.dispose();

		expect(dom.mounts[0]!.media.pause).toHaveBeenCalled();
		expect(dom.mounts[0]!.dispose).toHaveBeenCalledOnce();
		expect(second.getSnapshot().role).toBe("presenter");
		expect(third.getSnapshot().role).toBe("waiting");
	});

	it("owns the docked, Floating player, and maximized transitions", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const interaction = new PlayerViewInteraction({
			runtime,
			presentation: new MemoryPresentationStore(),
			dom: new MemoryDomAdapter(),
		});
		const view = interaction.mount({ ownerDocument: {} as Document });

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
		const dom = new MemoryDomAdapter();
		const interaction = new PlayerViewInteraction({
			runtime,
			presentation: new MemoryPresentationStore(),
			dom,
		});
		const view = interaction.mount({ ownerDocument: {} as Document });

		view.act({ type: "enter-floating" });
		expect(dom.mounts[0]!.focus).not.toHaveBeenCalled();
		dom.inputs[0]!.focusReady();
		expect(dom.mounts[0]!.focus).toHaveBeenCalledOnce();

		view.act({ type: "dock-and-pause" });
		expect(dom.mounts[0]!.focus).toHaveBeenCalledOnce();
		dom.inputs[0]!.focusReady();
		expect(dom.mounts[0]!.focus).toHaveBeenCalledTimes(2);
	});

	it("opens a docked Player view, focuses a Floating player, and persists queue disclosure", async () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const dom = new MemoryDomAdapter();
		const interaction = new PlayerViewInteraction({ runtime, presentation, dom });
		const activate = vi.fn(async () => undefined);

		await interaction.open(activate);
		const view = interaction.mount({ ownerDocument: {} as Document });
		expect(dom.mounts[0]!.focus).toHaveBeenCalledOnce();
		expect(activate).toHaveBeenCalledOnce();

		view.act({ type: "set-queue-expanded", expanded: false });
		expect(view.getSnapshot().queueExpanded).toBe(false);
		expect(presentation.state.queueExpanded).toBe(false);

		view.act({ type: "enter-floating" });
		await interaction.open(activate);
		expect(activate).toHaveBeenCalledOnce();
		expect(dom.mounts[0]!.focus).toHaveBeenCalledTimes(2);
	});

	it("demotes a maximized Floating player during drag and persists only the committed rect", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryPlaybackStore(),
			toMediaUrl: (path) => path,
		});
		const presentation = new MemoryPresentationStore();
		const dom = new MemoryDomAdapter();
		const interaction = new PlayerViewInteraction({ runtime, presentation, dom });
		const view = interaction.mount({ ownerDocument: {} as Document });
		view.act({ type: "enter-floating" });
		view.act({ type: "toggle-maximized" });

		dom.inputs[0]!.beginPointer("move", { x: 500, y: 20 });
		dom.inputs[0]!.movePointer({ x: 550, y: 70 });

		expect(view.getSnapshot().presentation).toMatchObject({
			kind: "floating",
			maximized: false,
		});
		expect(presentation.state.floatingRect).toBeNull();

		dom.inputs[0]!.finishPointer();
		expect(presentation.state.floatingRect).toEqual(
			expect.objectContaining({ width: 480, height: 320 }),
		);
	});
});
