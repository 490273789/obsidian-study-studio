import { describe, expect, it, vi } from "vite-plus/test";
import { VideoPlayerRuntime, emptyState } from "../videoPlayerRuntime";
import type { DeviceVideoPlayerStateV1, VideoMediaPort, VideoPlayerDocumentStore } from "../types";

class MemoryStore implements VideoPlayerDocumentStore {
	state: DeviceVideoPlayerStateV1 = emptyState();
	saves = 0;
	load = () => this.state;
	save = (state: DeviceVideoPlayerStateV1) => {
		this.state = state;
		this.saves++;
	};
	clear = () => {
		this.state = emptyState();
	};
}

class Media implements VideoMediaPort {
	currentTime = 0;
	duration = 100;
	paused = true;
	playbackRate = 1;
	src = "";
	private readonly listeners = new Map<string, Set<EventListener>>();
	play = vi.fn(async () => {
		this.paused = false;
		this.emit("play");
	});
	pause = vi.fn(() => {
		this.paused = true;
		this.emit("pause");
	});
	load = vi.fn();
	addEventListener(type: string, listener: EventListener): void {
		(this.listeners.get(type) ?? this.add(type)).add(listener);
	}
	removeEventListener(type: string, listener: EventListener): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
	}
	private add(type: string): Set<EventListener> {
		const listeners = new Set<EventListener>();
		this.listeners.set(type, listeners);
		return listeners;
	}
}

const source = (id: string) => ({ id, path: `/videos/${id}.mp4`, name: `${id}.mp4` });

describe("VideoPlayerRuntime", () => {
	it("deduplicates paths and selects the first source", () => {
		const runtime = new VideoPlayerRuntime({
			store: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		runtime.addSources([
			source("one"),
			{ ...source("duplicate"), path: "/videos/one.mp4" },
			source("two"),
		]);
		expect(runtime.getSnapshot().sources.map((item) => item.id)).toEqual(["one", "two"]);
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
	});

	it("seeks within bounds, applies supported rates, and preserves progress", () => {
		let now = 0;
		const store = new MemoryStore();
		const runtime = new VideoPlayerRuntime({
			store,
			toMediaUrl: (path) => path,
			now: () => now,
		});
		const media = new Media();
		runtime.addSources([source("one")]);
		runtime.bindMedia(media);
		media.currentTime = 4;
		runtime.seekBy(-10);
		expect(media.currentTime).toBe(0);
		runtime.seekBy(500);
		expect(media.currentTime).toBe(100);
		runtime.seekTo(37);
		expect(media.currentTime).toBe(37);
		runtime.setPlaybackRate(1.5);
		expect(media.playbackRate).toBe(1.5);
		now = 6_000;
		media.currentTime = 42;
		media.emit("timeupdate");
		expect(store.state.progressBySource.one).toBe(42);
	});

	it("does not wrap queue navigation and auto-plays the next item after completion", async () => {
		const runtime = new VideoPlayerRuntime({
			store: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		const media = new Media();
		runtime.addSources([source("one"), source("two")]);
		runtime.bindMedia(media);
		runtime.previous();
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
		media.currentTime = 100;
		media.emit("ended");
		expect(runtime.getSnapshot().currentSourceId).toBe("two");
		await Promise.resolve();
		expect(media.play).toHaveBeenCalledOnce();
		runtime.next();
		expect(runtime.getSnapshot().currentSourceId).toBe("two");
	});

	it("marks completed videos and restarts them when selected again", () => {
		const runtime = new VideoPlayerRuntime({
			store: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		const media = new Media();
		runtime.addSources([source("one")]);
		runtime.bindMedia(media);
		media.currentTime = media.duration;
		media.emit("ended");
		expect(runtime.getSnapshot().completedSourceIds).toEqual(["one"]);

		runtime.selectSource("one");
		expect(runtime.getSnapshot().completedSourceIds).toEqual([]);
		expect(runtime.getSnapshot().currentTime).toBe(0);
	});

	it("restores a completed video's saved end position until it is actively selected", () => {
		const store = new MemoryStore();
		store.state = {
			...emptyState(),
			sources: [source("one")],
			currentSourceId: "one",
			progressBySource: { one: 100 },
			completedSourceIds: ["one"],
		};
		const runtime = new VideoPlayerRuntime({ store, toMediaUrl: (path) => path });
		const media = new Media();
		runtime.bindMedia(media);
		media.emit("loadedmetadata");

		expect(runtime.getSnapshot().currentTime).toBe(100);
		expect(runtime.getSnapshot().completedSourceIds).toEqual(["one"]);
	});

	it("selects the next source after deleting current, otherwise previous", () => {
		const runtime = new VideoPlayerRuntime({
			store: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		runtime.addSources([source("one"), source("two"), source("three")]);
		runtime.selectSource("two");
		runtime.removeSource("two");
		expect(runtime.getSnapshot().currentSourceId).toBe("three");
		runtime.removeSource("three");
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
	});

	it("updates queue disclosure and floating geometry in snapshot and document", () => {
		const store = new MemoryStore();
		const runtime = new VideoPlayerRuntime({
			store,
			toMediaUrl: (path) => path,
		});

		expect(runtime.getSnapshot().queueExpanded).toBe(false);
		expect(runtime.getSnapshot().floatingRect).toBeNull();

		runtime.setQueueExpanded(true);
		expect(runtime.getSnapshot().queueExpanded).toBe(true);
		expect(store.state.queueExpanded).toBe(true);

		const rect = { x: 50, y: 60, width: 400, height: 300 };
		runtime.setFloatingRect(rect);
		expect(runtime.getSnapshot().floatingRect).toEqual(rect);
		expect(store.state.floatingRect).toEqual(rect);
	});

	it("keeps in-memory state and reports error when document save throws", () => {
		const store = new MemoryStore();
		const failure = new Error("disk full");
		vi.spyOn(store, "save").mockImplementationOnce(() => {
			throw failure;
		});
		const reportError = vi.fn();
		const runtime = new VideoPlayerRuntime({
			store,
			toMediaUrl: (path) => path,
			reportError,
		});

		runtime.setQueueExpanded(true);
		expect(runtime.getSnapshot().queueExpanded).toBe(true);
		expect(reportError).toHaveBeenCalledWith(failure);
	});

	it("clears local data and resets both playback and presentation state", () => {
		const store = new MemoryStore();
		const runtime = new VideoPlayerRuntime({
			store,
			toMediaUrl: (path) => path,
		});
		runtime.addSources([source("one")]);
		runtime.setQueueExpanded(true);
		runtime.setFloatingRect({ x: 10, y: 20, width: 300, height: 200 });

		runtime.clearLocalData();
		expect(runtime.getSnapshot().sources).toEqual([]);
		expect(runtime.getSnapshot().queueExpanded).toBe(false);
		expect(runtime.getSnapshot().floatingRect).toBeNull();
		expect(store.state).toEqual(emptyState());
	});

	it("ignores a queued internal pause after bounded playback has resumed", async () => {
		const runtime = new VideoPlayerRuntime({
			store: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		const media = new Media();
		media.pause = vi.fn(() => {
			media.paused = true;
			queueMicrotask(() => media.emit("pause"));
		});
		runtime.addSources([source("one")]);
		runtime.bindMedia(media);
		await Promise.resolve();
		await media.play();
		const result = runtime.playRange(10, 12);
		await Promise.resolve();
		media.currentTime = 12;
		media.emit("timeupdate");
		expect(await result).toBe("completed");
	});

	describe("stable identity and picker seam", () => {
		it("reuses remembered source ID and persists identity registry across re-additions", () => {
			let savedRegistry: Record<string, string> = { "/videos/one.mp4": "stable-id-1" };
			const identityStore = {
				load: () => ({ ...savedRegistry }),
				save: (reg: Record<string, string>) => {
					savedRegistry = { ...reg };
				},
			};

			const runtime = new VideoPlayerRuntime({
				store: new MemoryStore(),
				identityStore,
				toMediaUrl: (path) => path,
			});

			runtime.addSources([{ path: "/videos/one.mp4", name: "one.mp4" }]);
			expect(runtime.getSnapshot().sources).toEqual([
				{ id: "stable-id-1", path: "/videos/one.mp4", name: "one.mp4" },
			]);
			expect(savedRegistry["/videos/one.mp4"]).toBe("stable-id-1");

			// Remove source then re-add without id:
			runtime.removeSource("stable-id-1");
			expect(runtime.getSnapshot().sources).toEqual([]);

			runtime.addSources([{ path: "/videos/one.mp4", name: "one.mp4" }]);
			expect(runtime.getSnapshot().sources[0]?.id).toBe("stable-id-1");
		});

		it("pickAndAddSources imports picked files and publishes snapshot", async () => {
			const picker = {
				pickSources: vi.fn().mockResolvedValue([
					{ path: "/videos/a.mp4", name: "a.mp4" },
					{ path: "/videos/b.mp4", name: "b.mp4" },
				]),
			};
			const runtime = new VideoPlayerRuntime({
				store: new MemoryStore(),
				picker,
				toMediaUrl: (path) => path,
			});

			const success = await runtime.pickAndAddSources({
				addVideos: "Add",
				selectFailed: "Failed",
			});
			expect(success).toBe(true);
			expect(runtime.getSnapshot().sources).toHaveLength(2);
			expect(runtime.getSnapshot().sources[0]?.path).toBe("/videos/a.mp4");
		});

		it("pickAndAddSources returns false quietly on user cancellation", async () => {
			const reportNotice = vi.fn();
			const picker = {
				pickSources: vi.fn().mockResolvedValue([]),
			};
			const runtime = new VideoPlayerRuntime({
				store: new MemoryStore(),
				picker,
				reportNotice,
				toMediaUrl: (path) => path,
			});

			const success = await runtime.pickAndAddSources({
				addVideos: "Add",
				selectFailed: "Failed",
			});
			expect(success).toBe(false);
			expect(reportNotice).not.toHaveBeenCalled();
		});

		it("pickAndAddSources reports notice when picker throws", async () => {
			const reportNotice = vi.fn();
			const reportError = vi.fn();
			const picker = {
				pickSources: vi.fn().mockRejectedValue(new Error("dialog error")),
			};
			const runtime = new VideoPlayerRuntime({
				store: new MemoryStore(),
				picker,
				reportNotice,
				reportError,
				toMediaUrl: (path) => path,
			});

			const success = await runtime.pickAndAddSources({
				addVideos: "Add",
				selectFailed: "Select failed notice",
			});
			expect(success).toBe(false);
			expect(reportNotice).toHaveBeenCalledWith("Select failed notice");
			expect(reportError).toHaveBeenCalled();
		});

		it("pickAndReplaceSource preserves ID and updates path, rejecting collisions", async () => {
			const savedRegistry: Record<string, string> = {};
			const identityStore = {
				load: () => savedRegistry,
				save: (reg: Record<string, string>) => Object.assign(savedRegistry, reg),
			};
			const picker = {
				pickSources: vi.fn(),
			};
			const runtime = new VideoPlayerRuntime({
				store: new MemoryStore(),
				identityStore,
				picker,
				toMediaUrl: (path) => path,
			});

			runtime.addSources([
				{ id: "id-1", path: "/videos/one.mp4", name: "one.mp4" },
				{ id: "id-2", path: "/videos/two.mp4", name: "two.mp4" },
			]);

			// Collision test: try to replace id-1 with path of id-2
			picker.pickSources.mockResolvedValueOnce([
				{ path: "/videos/two.mp4", name: "two.mp4" },
			]);
			const collisionSuccess = await runtime.pickAndReplaceSource("id-1", {
				replace: "Replace",
				selectFailed: "Failed",
			});
			expect(collisionSuccess).toBe(false);
			expect(runtime.getSnapshot().sources[0]?.path).toBe("/videos/one.mp4");

			// Valid replacement:
			picker.pickSources.mockResolvedValueOnce([
				{ path: "/videos/one-new.mp4", name: "one-new.mp4" },
			]);
			const validSuccess = await runtime.pickAndReplaceSource("id-1", {
				replace: "Replace",
				selectFailed: "Failed",
			});
			expect(validSuccess).toBe(true);
			expect(runtime.getSnapshot().sources[0]).toEqual({
				id: "id-1",
				path: "/videos/one-new.mp4",
				name: "one-new.mp4",
			});
			expect(savedRegistry["/videos/one-new.mp4"]).toBe("id-1");
			expect(savedRegistry["/videos/one.mp4"]).toBeUndefined();
		});
	});
});
