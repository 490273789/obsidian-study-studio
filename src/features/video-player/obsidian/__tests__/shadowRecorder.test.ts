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
});
