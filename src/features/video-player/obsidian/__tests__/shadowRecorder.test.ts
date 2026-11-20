import { describe, expect, it, vi } from "vite-plus/test";
import { createShadowRecorder } from "../shadowRecorder";

class Recorder extends EventTarget {
	static current: Recorder;
	static isTypeSupported = () => true;
	state = "inactive";
	mimeType = "audio/webm;codecs=opus";
	constructor() {
		super();
		Recorder.current = this;
	}
	start() {
		this.state = "recording";
	}
	stop() {
		this.state = "inactive";
	}
	finish() {
		const event = new Event("dataavailable");
		Object.defineProperty(event, "data", { value: new Blob(["last packet"]) });
		this.dispatchEvent(event);
		this.dispatchEvent(new Event("stop"));
	}
}
function setup(getUserMedia?: () => Promise<MediaStream>) {
	const track = { stop: vi.fn(), addEventListener: vi.fn() };
	const stream = {
		getTracks: () => [track],
		getAudioTracks: () => [track],
	} as unknown as MediaStream;
	const owner = {
		navigator: { mediaDevices: { getUserMedia: getUserMedia ?? vi.fn(async () => stream) } },
		MediaRecorder: Recorder,
	} as unknown as Window;
	return { adapter: createShadowRecorder(owner), track, stream };
}

class Audio extends EventTarget {
	static instances: Audio[] = [];
	play = vi.fn(async () => {});
	pause = vi.fn();
	removeAttribute = vi.fn();
	load = vi.fn();
	constructor() {
		super();
		Audio.instances.push(this);
	}
}

describe("shadow recorder", () => {
	it("waits for the last data packet and stop event before returning the Blob", async () => {
		const { adapter, track } = setup();
		await adapter.start();
		let settled = false;
		const result = adapter.stop().then((blob) => {
			settled = true;
			return blob;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		Recorder.current.finish();
		const blob = await result;
		expect(blob.size).toBe(11);
		expect(blob.type).toBe("audio/webm;codecs=opus");
		expect(track.stop).toHaveBeenCalledOnce();
		adapter.dispose();
	});
	it("releases tracks when permission arrives after cancellation", async () => {
		let grant!: (stream: MediaStream) => void;
		const { adapter, stream, track } = setup(
			() =>
				new Promise((resolve) => {
					grant = resolve;
				}),
		);
		const start = adapter.start();
		adapter.cancel();
		grant(stream);
		await expect(start).rejects.toThrow("录音已取消");
		expect(track.stop).toHaveBeenCalledOnce();
		adapter.dispose();
	});
	it("cancels a pending stop without accepting a partial recording", async () => {
		const { adapter, track } = setup();
		await adapter.start();
		const stop = adapter.stop();
		adapter.cancel();
		Recorder.current.finish();
		await expect(stop).rejects.toThrow("录音已取消");
		expect(track.stop).toHaveBeenCalledOnce();
		adapter.dispose();
	});

	it("ignores a cancelled recorder's error after a new recording starts", async () => {
		const { adapter, track } = setup();
		await adapter.start();
		const previous = Recorder.current;
		await adapter.start();
		expect(track.stop).toHaveBeenCalledOnce();

		previous.dispatchEvent(new Event("error"));
		expect(track.stop).toHaveBeenCalledOnce();

		const recording = adapter.stop();
		Recorder.current.finish();
		await expect(recording).resolves.toMatchObject({ size: 11 });
		expect(track.stop).toHaveBeenCalledTimes(2);
		adapter.dispose();
	});

	it("ignores late playback events from a superseded take", async () => {
		Audio.instances = [];
		const revokeObjectURL = vi.fn();
		const adapter = createShadowRecorder({
			Audio,
			URL: {
				createObjectURL: vi
					.fn()
					.mockReturnValueOnce("blob:first")
					.mockReturnValueOnce("blob:second"),
				revokeObjectURL,
			},
		} as unknown as Window);
		const first = adapter.play(new Blob(["first"]));
		const cancelled = expect(first).rejects.toThrow("回听已停止");
		const second = adapter.play(new Blob(["second"]));
		await cancelled;
		const [previous, current] = Audio.instances;

		previous!.dispatchEvent(new Event("error"));
		expect(current!.pause).not.toHaveBeenCalled();
		expect(revokeObjectURL.mock.calls).toEqual([["blob:first"]]);

		current!.dispatchEvent(new Event("ended"));
		await expect(second).resolves.toBeUndefined();
		expect(revokeObjectURL.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
		adapter.dispose();
	});
});
