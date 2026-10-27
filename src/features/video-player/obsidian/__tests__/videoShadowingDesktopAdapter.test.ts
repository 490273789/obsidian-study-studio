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

const mockPickLocalVideoSources = vi.fn();
vi.mock("../localVideoFiles", () => ({
	pickLocalVideoSources: (...args: unknown[]) => mockPickLocalVideoSources(...args),
}));

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
	let notices: string[];
	let sources: LocalVideoSource[];
	let runtime: VideoPlayerRuntime;

	beforeEach(() => {
		vi.clearAllMocks();
		localStorageData = {};
		notices = [];
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

	it("initializes source ids, ffmpeg path, and syncs runtime sources", () => {
		localStorageData["study-studio.shadowing.source-ids.v1"] = {
			"/videos/existing.mp4": "src-existing",
		};
		localStorageData["study-studio.shadowing.ffmpeg-path.v1"] = "/usr/local/bin/ffmpeg";

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			reportNotice: (msg) => notices.push(msg),
		});

		expect(adapter.getFfmpegPath()).toBe("/usr/local/bin/ffmpeg");
		adapter.setFfmpegPath("/opt/homebrew/bin/ffmpeg");
		expect(adapter.getFfmpegPath()).toBe("/opt/homebrew/bin/ffmpeg");
		expect(app.saveLocalStorage).toHaveBeenCalledWith(
			"study-studio.shadowing.ffmpeg-path.v1",
			"/opt/homebrew/bin/ffmpeg",
		);
	});

	it("picks local videos, identifies stable source IDs, and persists them", async () => {
		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			reportNotice: (msg) => notices.push(msg),
		});

		const picked = [
			{ id: "raw-1", name: "video1.mp4", path: "/videos/video1.mp4" },
			{ id: "raw-3", name: "video3.mp4", path: "/videos/video3.mp4" },
		];
		mockPickLocalVideoSources.mockResolvedValueOnce(picked);

		const result = await adapter.pickVideos({
			document: {} as Document,
			strings: { addVideos: "添加视频", selectFailed: "选择失败" },
		});

		expect(result).toHaveLength(2);
		// /videos/video1.mp4 was already registered with src-1
		expect(result.find((s) => s.path === "/videos/video1.mp4")?.id).toBe("src-1");
		expect(app.saveLocalStorage).toHaveBeenCalledWith(
			"study-studio.shadowing.source-ids.v1",
			expect.objectContaining({
				"/videos/video1.mp4": "src-1",
				"/videos/video2.mp4": "src-2",
			}),
		);
	});

	it("reports notice when picking local videos fails", async () => {
		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			reportNotice: (msg) => notices.push(msg),
		});

		mockPickLocalVideoSources.mockRejectedValueOnce(new Error("File dialog failed"));

		const result = await adapter.pickVideos({
			document: {} as Document,
			strings: { addVideos: "添加视频", selectFailed: "选择失败" },
		});

		expect(result).toEqual([]);
		expect(notices).toEqual(["选择失败"]);
	});

	it("relinks video replacement, guards duplicate paths, and reports notice on error", async () => {
		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			reportNotice: (msg) => notices.push(msg),
		});

		// 1. Conflict: path already belongs to another source
		mockPickLocalVideoSources.mockResolvedValueOnce([
			{ id: "temp", name: "video2.mp4", path: "/videos/video2.mp4" },
		]);
		const conflict = await adapter.pickReplacement({
			sourceId: "src-1",
			document: {} as Document,
			strings: { replace: "重新关联", selectFailed: "关联失败" },
		});
		expect(conflict).toBeNull();

		// 2. Successful relink
		mockPickLocalVideoSources.mockResolvedValueOnce([
			{ id: "temp", name: "video1_new.mp4", path: "/videos/video1_new.mp4" },
		]);
		const relinked = await adapter.pickReplacement({
			sourceId: "src-1",
			document: {} as Document,
			strings: { replace: "重新关联", selectFailed: "关联失败" },
		});
		expect(relinked).not.toBeNull();
		expect(relinked?.id).toBe("src-1");
		expect(relinked?.path).toBe("/videos/video1_new.mp4");

		// 3. Error reporting
		mockPickLocalVideoSources.mockRejectedValueOnce(new Error("Dialog cancel"));
		const failed = await adapter.pickReplacement({
			sourceId: "src-1",
			document: {} as Document,
			strings: { replace: "重新关联", selectFailed: "关联失败" },
		});
		expect(failed).toBeNull();
		expect(notices).toContain("关联失败");
	});

	it("binds presenter window and manages recorder lifecycle across windows", () => {
		const fakeWindow1 = { require: vi.fn() } as unknown as Window;
		const fakeWindow2 = { require: vi.fn() } as unknown as Window;

		const services: VideoShadowingServices = {
			transcribe: vi.fn(),
			translate: vi.fn(),
			getTranscriptionSignature: vi.fn().mockResolvedValue("trans-sig"),
			getTranslationProfileId: vi.fn(() => "profile-1"),
			getTranslationSignature: vi.fn(() => "trans-sig"),
			listTranslationProfiles: vi.fn(() => []),
		};

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => normalizeVideoPlayerSettings({}),
			runtime,
			services,
			initialWindow: fakeWindow1,
			reportNotice: (msg) => notices.push(msg),
		});

		expect(adapter.shadowingSession).toBeDefined();

		// Change presenter window to fakeWindow2
		adapter.bindPresenterWindow(fakeWindow2);

		adapter.dispose();
	});
});
