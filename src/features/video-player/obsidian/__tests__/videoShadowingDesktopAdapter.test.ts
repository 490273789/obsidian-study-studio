/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import type { App } from "obsidian";

const mocks = vi.hoisted(() => ({
	mockCreateShadowRecorder: vi.fn((_win?: Window) => ({
		start: vi.fn(),
		stop: vi.fn(),
		cancel: vi.fn(),
		play: vi.fn(),
		dispose: vi.fn(),
	})),
	audioBuffer: new ArrayBuffer(8),
}));

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	Platform: { resourcePathPrefix: "app://vault/" },
}));
vi.mock("../shadowRecorder", () => ({
	createShadowRecorder: (win: Window) => mocks.mockCreateShadowRecorder(win),
}));
vi.mock("../shadowSubtitleAudio", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../shadowSubtitleAudio")>();
	return {
		...actual,
		createDesktopShadowAudioExtractor: () => async () => ({
			audio: mocks.audioBuffer,
			duration: 10,
			totalDuration: 10,
			sourceSignature: "2000:1000",
		}),
	};
});

import type { LocalVideoSource } from "../../domain/types";
import { VideoPlayerRuntime, emptyState } from "../../domain/videoPlayerRuntime";
import { normalizeVideoPlayerSettings } from "../../settings/slice";
import {
	VideoShadowingDesktopAdapter,
	type VideoShadowingServices,
} from "../videoShadowingDesktopAdapter";

function createMemoryVaultAdapter() {
	const files = new Map<string, string>();
	const binaries = new Map<string, ArrayBuffer>();
	const directories = new Set<string>();
	return {
		exists: vi.fn(
			async (path: string) => files.has(path) || binaries.has(path) || directories.has(path),
		),
		read: vi.fn(async (path: string) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`Missing file: ${path}`);
			return content;
		}),
		write: vi.fn(async (path: string, text: string) => {
			files.set(path, text);
		}),
		mkdir: vi.fn(async (path: string) => {
			directories.add(path);
		}),
		list: vi.fn(async (path: string) => ({
			files: [...files.keys()].filter(
				(file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/"),
			),
			folders: [...directories].filter(
				(dir) => dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes("/"),
			),
		})),
		readBinary: vi.fn(async (path: string) => binaries.get(path)!),
		writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
			binaries.set(path, data);
		}),
		remove: vi.fn(async (path: string) => {
			binaries.delete(path);
			files.delete(path);
		}),
	};
}

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
				adapter: createMemoryVaultAdapter(),
			},
		} as unknown as App;

		runtime = new VideoPlayerRuntime({
			store: {
				load: () => ({ ...emptyState(), sources, currentSourceId: "src-1" }),
				save: () => undefined,
				clear: () => undefined,
			},
			toMediaUrl: (path) => path,
		});
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
		adapter.dispose();
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
		adapter.bindPresenterWindow(fakeWindow2);
		adapter.dispose();
	});

	it("runs generation through the public shadowingSession interface with resolved source and service signatures", async () => {
		const stat = vi.fn().mockResolvedValue({ mtimeMs: 1000, size: 2000 });
		const fakeWindow = {
			require: vi.fn(() => ({ stat })),
		} as unknown as Window;

		const services: VideoShadowingServices = {
			transcribe: vi.fn().mockResolvedValue([{ start: 0, end: 1.5, text: "hello world" }]),
			translate: vi.fn().mockResolvedValue("你好世界"),
			getSignature: vi.fn().mockResolvedValue("pipeline-sig-123"),
			listTranslationProfiles: vi.fn(() => [{ id: "p1", name: "Profile 1" }]),
		};

		const settings = normalizeVideoPlayerSettings({
			shadowTranscriptionEngineId: "engine-a",
			shadowTranslationProfileId: "prof-a",
		});

		const adapter = new VideoShadowingDesktopAdapter({
			app,
			readSettings: () => settings,
			runtime,
			services,
			initialWindow: fakeWindow,
		});

		await adapter.shadowingSession!.act({ type: "generate" });

		await vi.waitFor(() =>
			expect(adapter.shadowingSession!.getSnapshot().cues).toEqual([
				expect.objectContaining({
					start: 0,
					end: 1.5,
					text: "hello world",
					translation: "你好世界",
				}),
			]),
		);

		expect(stat).toHaveBeenCalledWith("/videos/video1.mp4");
		expect(services.getSignature).toHaveBeenCalledWith({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-a",
		});
		expect(services.transcribe).toHaveBeenCalledWith(
			mocks.audioBuffer,
			"pipeline-sig-123",
			expect.any(AbortSignal),
		);
		expect(services.translate).toHaveBeenCalledWith(
			"hello world",
			"pipeline-sig-123",
			expect.any(AbortSignal),
		);

		adapter.dispose();
	});
});
