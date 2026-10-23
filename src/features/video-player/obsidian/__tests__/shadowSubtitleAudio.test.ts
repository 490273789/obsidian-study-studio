import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";
import { createDesktopShadowAudioExtractor } from "../shadowSubtitleAudio";

function fixture(audioStreams = 1, hang = false, ffmpegPath?: string) {
	const stat = { size: 1000, mtimeMs: 10 };
	const fs = {
		stat: vi.fn(async () => stat),
		mkdtemp: vi.fn(async () => "/tmp/test-shadow"),
		readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
		rm: vi.fn(async () => {}),
	};
	const children: (EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	})[] = [];
	const spawn = vi.fn((command: string, _args: string[]) => {
		const process = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(),
		});
		children.push(process);
		queueMicrotask(() => {
			if (command.endsWith("ffprobe")) {
				process.stdout.emit(
					"data",
					new TextEncoder().encode(
						JSON.stringify({
							format: { duration: "70" },
							streams: Array.from({ length: audioStreams }, () => ({
								codec_type: "audio",
							})),
						}),
					),
				);
				process.emit("close", 0);
			} else if (!hang) process.emit("close", 0);
		});
		return process;
	});
	const requireModule = (id: string): unknown =>
		({
			"node:fs/promises": fs,
			"node:child_process": { spawn },
			"node:os": { tmpdir: () => "/tmp" },
			"node:path": { join: (...parts: string[]) => parts.join("/") },
		})[id];
	return {
		fs,
		spawn,
		children,
		extract: createDesktopShadowAudioExtractor({ requireModule, timeoutMs: 20, ffmpegPath }),
	};
}
describe("desktop shadow audio extraction", () => {
	it("extracts bounded mono PCM with safe argument arrays and cleans temporary files", async () => {
		const { extract, spawn, fs } = fixture();
		const result = await extract(
			{ id: "v", path: "/some/$(video).mp4" },
			59,
			new AbortController().signal,
		);
		expect(result).toMatchObject({
			duration: 11,
			totalDuration: 70,
			sourceSignature: "1000:10",
		});
		expect(result.audio.byteLength).toBe(3);
		expect(spawn.mock.calls[1]).toEqual(expect.arrayContaining(["ffmpeg"]));
		expect(spawn.mock.calls[1]![1]).toEqual(
			expect.arrayContaining([
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"pcm_s16le",
				"/some/$(video).mp4",
			]),
		);
		expect(fs.rm).toHaveBeenCalledWith("/tmp/test-shadow", { recursive: true, force: true });
	});
	it("rejects ambiguous audio streams before extraction", async () => {
		const { extract, spawn } = fixture(2);
		await expect(
			extract({ id: "v", path: "/video.mp4" }, 0, new AbortController().signal),
		).rejects.toThrow("一条音轨");
		expect(spawn).toHaveBeenCalledTimes(1);
	});
	it("uses ffprobe beside a configured FFmpeg binary", async () => {
		const { extract, spawn } = fixture(1, false, "/custom/bin/ffmpeg");
		await extract({ id: "v", path: "/video.mp4" }, 0, new AbortController().signal);
		expect(spawn.mock.calls[0]![0]).toBe("/custom/bin/ffprobe");
		expect(spawn.mock.calls[1]![0]).toBe("/custom/bin/ffmpeg");
	});
	it("kills timed out extraction and clears temporary files", async () => {
		const { extract, fs, children } = fixture(1, true);
		await expect(
			extract({ id: "v", path: "/video.mp4" }, 0, new AbortController().signal),
		).rejects.toThrow("超时");
		expect(children[1]!.kill).toHaveBeenCalledWith("SIGKILL");
		expect(fs.rm).toHaveBeenCalled();
	});
});
