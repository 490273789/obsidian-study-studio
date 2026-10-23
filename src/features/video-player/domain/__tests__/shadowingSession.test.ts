import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ShadowingSession, type ShadowRecorderPort } from "../shadowingSession";
import { VideoPlayerRuntime, emptyState } from "../videoPlayerRuntime";
import type { VideoMediaPort } from "../types";

class Media extends EventTarget implements VideoMediaPort {
	currentTime = 0;
	duration = 100;
	paused = true;
	seeking = false;
	playbackRate = 1;
	src = "";
	play = vi.fn(async () => {
		this.paused = false;
		this.dispatchEvent(new Event("play"));
	});
	pause = () => {
		this.paused = true;
		this.dispatchEvent(new Event("pause"));
	};
	load = () => undefined;
	end(time: number) {
		this.currentTime = time;
		this.dispatchEvent(new Event("timeupdate"));
	}
}
function setup(saveTake?: () => Promise<void>) {
	vi.useFakeTimers();
	const runtime = new VideoPlayerRuntime({
		store: { load: emptyState, save: () => undefined, clear: () => undefined },
		toMediaUrl: (path) => path,
	});
	runtime.addSources([
		{ id: "one", path: "one.mp4", name: "one" },
		{ id: "two", path: "two.mp4", name: "two" },
	]);
	const media = new Media();
	runtime.bindMedia(media);
	const recorder: ShadowRecorderPort = {
		start: vi.fn(async () => undefined),
		stop: vi.fn(async () => new Blob(["voice"], { type: "audio/webm" })),
		cancel: vi.fn(),
		play: vi.fn(async () => undefined),
		dispose: vi.fn(),
	};
	const session = new ShadowingSession({ runtime, recorder, saveTake });
	session.selectRange("one", 10, 14, "Hello");
	return { runtime, media, recorder, session };
}
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});
describe("shadowing playback and recordings", () => {
	it("loops by media boundary and waits two seconds, with buffering consuming no rest time", async () => {
		const { session, media } = setup();
		session.startLoop();
		await vi.advanceTimersByTimeAsync(6000);
		expect(session.getSnapshot().phase).toBe("playing");
		media.end(14);
		await Promise.resolve();
		expect(session.getSnapshot().phase).toBe("resting");
		await vi.advanceTimersByTimeAsync(1999);
		expect(media.currentTime).toBe(14);
		await vi.advanceTimersByTimeAsync(1);
		expect(media.currentTime).toBe(10);
		expect(session.getSnapshot().phase).toBe("playing");
		session.dispose();
	});
	it("manual pause during rest cancels automatic continuation", async () => {
		const { runtime, session, media } = setup();
		session.startLoop();
		media.end(14);
		await Promise.resolve();
		runtime.pause();
		await vi.advanceTimersByTimeAsync(5000);
		expect(session.getSnapshot().phase).toBe("paused");
		expect(media.play).toHaveBeenCalledTimes(1);
		session.dispose();
	});
	it("uses rate-adjusted duration plus one second for repeat-after", async () => {
		const { runtime, session, media } = setup();
		runtime.setPlaybackRate(0.5);
		session.setMode("repeat-after");
		session.startLoop();
		media.end(14);
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(8999);
		expect(session.getSnapshot().phase).toBe("resting");
		await vi.advanceTimersByTimeAsync(1);
		expect(session.getSnapshot().phase).toBe("playing");
		session.dispose();
	});
	it("records exactly one pass after countdown then retains the complete Blob", async () => {
		const { session, media, recorder } = setup();
		session.recordOnce();
		expect(session.getSnapshot().countdown).toBe(3);
		await vi.advanceTimersByTimeAsync(3000);
		expect(recorder.start).toHaveBeenCalledOnce();
		expect(session.getSnapshot().phase).toBe("recording");
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		expect(recorder.stop).toHaveBeenCalledOnce();
		expect(session.getSnapshot().phase).toBe("review");
		expect(session.getSnapshot().take?.blob.size).toBe(5);
		await vi.advanceTimersByTimeAsync(10000);
		expect(media.play).toHaveBeenCalledOnce();
		session.dispose();
	});
	it("records only the response window in repeat-after mode", async () => {
		const { session, media, recorder } = setup();
		session.setMode("repeat-after");
		session.recordOnce();
		await vi.advanceTimersByTimeAsync(3000);
		expect(recorder.start).not.toHaveBeenCalled();
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		expect(recorder.start).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(5000);
		expect(session.getSnapshot().take?.mode).toBe("repeat-after");
		session.dispose();
	});
	it("cancels countdown on rate changes and clears temporary recordings on source switch", async () => {
		const { runtime, session, recorder } = setup();
		session.recordOnce();
		runtime.setPlaybackRate(1.5);
		await vi.advanceTimersByTimeAsync(5000);
		expect(recorder.start).not.toHaveBeenCalled();
		runtime.selectSource("two");
		expect(session.getSnapshot().range).toBeNull();
		expect(session.getSnapshot().take).toBeNull();
		session.dispose();
	});
	it("keeps an accepted failed save after leaving and retries the captured take", async () => {
		const save = vi
			.fn()
			.mockRejectedValueOnce(new Error("disk full"))
			.mockResolvedValueOnce(undefined);
		const { session, media } = setup(save);
		session.recordOnce();
		await vi.advanceTimersByTimeAsync(3000);
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		const id = session.getSnapshot().take!.id;
		const accepted = session.saveTake();
		session.leave();
		await accepted;
		expect(session.getSnapshot().take).toBeNull();
		expect(session.getSnapshot().failedSaves[0]?.id).toBe(id);
		await session.retrySave(id);
		expect(save).toHaveBeenCalledTimes(2);
		expect(session.getSnapshot().failedSaves).toEqual([]);
		session.dispose();
	});
	it("dismisses practice without jumping ahead when shadowing is disabled", () => {
		const { session, media } = setup();
		media.currentTime = 11;
		session.leave({ seekToEnd: false });
		expect(media.currentTime).toBe(11);
		expect(session.getSnapshot().range).toBeNull();
		expect(session.getSnapshot().phase).toBe("idle");
		session.dispose();
	});
	it("never advances the queue when a practice range ends at the video end", async () => {
		const { runtime, session, media } = setup();
		session.selectRange("one", 95, 100);
		session.startLoop();
		media.end(100);
		media.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
		expect(runtime.getSnapshot().completedSourceIds).toEqual([]);
		session.dispose();
	});
	it("waits for seeked before starting the range", async () => {
		const { runtime, session, media } = setup();
		media.seeking = true;
		const completion = runtime.playRange(20, 25);
		expect(media.play).not.toHaveBeenCalled();
		media.seeking = false;
		media.dispatchEvent(new Event("seeked"));
		expect(media.play).toHaveBeenCalledOnce();
		media.end(25);
		expect(await completion).toBe("completed");
		session.dispose();
	});
});
