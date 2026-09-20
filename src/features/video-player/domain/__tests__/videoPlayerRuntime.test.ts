import { describe, expect, it, vi } from "vitest";
import { VideoPlayerRuntime, emptyPlaybackState } from "../videoPlayerRuntime";
import type { VideoMediaPort, VideoPlayerPlaybackStateV1, VideoPlayerStateStore } from "../types";

class MemoryStore implements VideoPlayerStateStore {
	state: VideoPlayerPlaybackStateV1 = emptyPlaybackState();
	saves = 0;
	load = () => this.state;
	save = (state: VideoPlayerPlaybackStateV1) => {
		this.state = state;
		this.saves++;
	};
	clear = () => {
		this.state = emptyPlaybackState();
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
			state: new MemoryStore(),
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
			state: store,
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
			state: new MemoryStore(),
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
			state: new MemoryStore(),
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
			...emptyPlaybackState(),
			sources: [source("one")],
			currentSourceId: "one",
			progressBySource: { one: 100 },
			completedSourceIds: ["one"],
		};
		const runtime = new VideoPlayerRuntime({ state: store, toMediaUrl: (path) => path });
		const media = new Media();
		runtime.bindMedia(media);
		media.emit("loadedmetadata");

		expect(runtime.getSnapshot().currentTime).toBe(100);
		expect(runtime.getSnapshot().completedSourceIds).toEqual(["one"]);
	});

	it("selects the next source after deleting current, otherwise previous", () => {
		const runtime = new VideoPlayerRuntime({
			state: new MemoryStore(),
			toMediaUrl: (path) => path,
		});
		runtime.addSources([source("one"), source("two"), source("three")]);
		runtime.selectSource("two");
		runtime.removeSource("two");
		expect(runtime.getSnapshot().currentSourceId).toBe("three");
		runtime.removeSource("three");
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
	});
});
