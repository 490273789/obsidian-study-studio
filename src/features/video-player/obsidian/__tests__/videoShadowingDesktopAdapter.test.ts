/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import type { App } from "obsidian";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	Platform: { resourcePathPrefix: "app://vault/" },
}));

import type { LocalVideoSource } from "../../domain/types";
import { normalizeVideoPlayerSettings } from "../../settings/slice";
import {
	VideoShadowingDesktopAdapter,
	type VideoShadowingServices,
} from "../videoShadowingDesktopAdapter";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";

const mockCreateShadowRecorder = vi.fn((_win?: Window) => ({
	start: vi.fn(),
	stop: vi.fn(),
	cancel: vi.fn(),
	play: vi.fn(),
	dispose: vi.fn(),
}));
vi.mock("../shadowRecorder", () => ({
	createShadowRecorder: (win: Window) => mockCreateShadowRecorder(win),
}));

describe("VideoShadowingDesktopAdapter", () => {
	let localStorageData: Record<string, unknown>;
	let app: App;
	let sources: LocalVideoSource[];
	let runtime: VideoPlayerRuntime;

	beforeEach(() => {
		vi.clearAllMocks();
		localStorageData = {};
		sources = [
			{ id: "src-1", name: "video1.mp4", path: "/videos/video1.mp4" },
			{ id: "src-2", name: "video2.mp4", path: "/videos/video2.mp4" },
		];
		app = {
			loadLocalStorage: vi.fn((key: string) => localStorageData[key] ?? null),
			saveLocalStorage: vi.fn((key: string, value: unknown) => {
				localStorageData[key] = value;
			}),
			vault: {
				adapter: {},
			},
		} as unknown as App;

		runtime = {
			getSnapshot: () => ({
				sources,
				currentSourceId: "src-1",
				playbackRate: 1,
				playing: false,
			}),
			clearLocalData: vi.fn(),
			subscribe: vi.fn(() => () => undefined),
			subscribeInterruptions: vi.fn(() => () => undefined),
			seekTo: vi.fn(),
			stopRange: vi.fn(),
			pause: vi.fn(),
		} as unknown as VideoPlayerRuntime;
	});

	it("initializes ffmpeg path and manages storage", () => {
		localStorageData["study-studio.shadowing.ffmpeg-path.v1"] = "/usr/local/bin/ffmpeg";

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
		});

		expect(adapter.getFfmpegPath()).toBe("/usr/local/bin/ffmpeg");
		adapter.setFfmpegPath("/opt/homebrew/bin/ffmpeg");
		expect(adapter.getFfmpegPath()).toBe("/opt/homebrew/bin/ffmpeg");
		expect(app.saveLocalStorage).toHaveBeenCalledWith(
			"study-studio.shadowing.ffmpeg-path.v1",
			"/opt/homebrew/bin/ffmpeg",
		);
	});

	it("binds presenter window and manages recorder lifecycle across windows", () => {
		const fakeWindow1 = { require: vi.fn() } as unknown as Window;
		const fakeWindow2 = { require: vi.fn() } as unknown as Window;

		const services: VideoShadowingServices = {
			transcribe: vi.fn().mockResolvedValue([{ start: 0, end: 1, text: "hello" }]),
			translate: vi.fn().mockResolvedValue("你好"),
			getSignature: vi.fn().mockResolvedValue("test-sig"),
			listTranslationProfiles: vi.fn(() => []),
		};

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			services,
			initialWindow: fakeWindow1,
		});

		expect(adapter.shadowingSession).toBeDefined();

		// Change presenter window to fakeWindow2
		adapter.bindPresenterWindow(fakeWindow2);

		adapter.dispose();
	});

	it("delegates transcription and translation through pipeline services without JSON unpacking", async () => {
		const fakeWindow = {
			require: vi.fn(() => ({
				stat: vi.fn().mockResolvedValue({ mtimeMs: 1000, size: 2000 }),
			})),
		} as unknown as Window;

		const services: VideoShadowingServices = {
			transcribe: vi.fn().mockResolvedValue([{ start: 0, end: 1.5, text: "hello world" }]),
			translate: vi.fn().mockResolvedValue("你好世界"),
			getSignature: vi.fn().mockResolvedValue("pipeline-sig-123"),
			listTranslationProfiles: vi.fn(() => [{ id: "p1", name: "Profile 1" }]),
		};

		const settings = normalizeVideoPlayerSettings({
			shadowTranscriptionProvider: "bailian",
			shadowTranslationProfileId: "prof-a",
		});

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => settings,
			runtime,
			services,
			initialWindow: fakeWindow,
		});

		expect(adapter.jobs).toBeDefined();

		const source = sources[0]!;

		// Trigger service signature generation via taskConfig
		// @ts-expect-error accessing private taskConfig for verification
		const config = await adapter.taskConfig(source);
		expect(config.serviceSignature).toBe("pipeline-sig-123");
		expect(services.getSignature).toHaveBeenCalledWith({
			transcriptionProvider: "bailian",
			translationProfileId: "prof-a",
		});

		// Verify jobs.ports transcribe and translate delegate directly to services
		// @ts-expect-error accessing private ports on jobs
		const ports = adapter.jobs.ports;
		expect(ports.translate).toBeDefined();
		const mockTask = {
			source,
			config: { serviceSignature: "opaque-sig-xyz", sourceSignature: "src-sig" },
			nextOffset: 0,
			totalDuration: 10,
			status: "running" as const,
			error: null,
		};
		const dummyBuffer = new ArrayBuffer(8);
		const signal = new AbortController().signal;

		const cues = await ports.transcribe(dummyBuffer, mockTask, signal);
		expect(services.transcribe).toHaveBeenCalledWith(dummyBuffer, "opaque-sig-xyz", signal);
		expect(cues).toEqual([{ start: 0, end: 1.5, text: "hello world" }]);

		const translated = await ports.translate!("hello world", mockTask, signal);
		expect(services.translate).toHaveBeenCalledWith("hello world", "opaque-sig-xyz", signal);
		expect(translated).toBe("你好世界");

		adapter.dispose();
	});
});
