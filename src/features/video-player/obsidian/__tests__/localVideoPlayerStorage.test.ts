import { describe, expect, it } from "vite-plus/test";
import type { ShadowSubtitleCheckpoint } from "../../domain/shadowSubtitlesJobs";
import {
	ObsidianShadowCheckpointStore,
	ObsidianVideoSourceIdentityStore,
	SHADOW_CHECKPOINTS_STORAGE_KEY,
	SOURCE_IDS_STORAGE_KEY,
	parseDeviceVideoPlayerState,
} from "../localVideoPlayerStorage";

describe("parseDeviceVideoPlayerState", () => {
	it("falls back from malformed values", () => {
		expect(parseDeviceVideoPlayerState({ schemaVersion: 2 })).toMatchObject({
			schemaVersion: 1,
			sources: [],
			playbackRate: 1,
			queueExpanded: false,
		});
	});
	it("keeps valid paths, progress, playback rate, and geometry", () => {
		const state = parseDeviceVideoPlayerState({
			schemaVersion: 1,
			sources: [{ id: "a", path: "/a.mp4", name: "a.mp4" }],
			currentSourceId: "a",
			progressBySource: { a: 12, stale: 4 },
			completedSourceIds: ["a", "a", "stale"],
			playbackRate: 1.5,
			floatingRect: { x: 3, y: 4, width: 480, height: 320 },
			queueExpanded: false,
		});
		expect(state).toMatchObject({
			currentSourceId: "a",
			progressBySource: { a: 12 },
			completedSourceIds: ["a"],
			playbackRate: 1.5,
			floatingRect: { width: 480 },
			queueExpanded: false,
		});
	});
});

describe("ObsidianVideoSourceIdentityStore", () => {
	it("loads and saves identity registry from local storage", () => {
		const storage = new Map<string, unknown>();
		const app = {
			loadLocalStorage: (key: string) => storage.get(key) ?? null,
			saveLocalStorage: (key: string, value: unknown) => {
				storage.set(key, value);
			},
		};

		const store = new ObsidianVideoSourceIdentityStore(app);
		expect(store.load()).toEqual({});

		storage.set(SOURCE_IDS_STORAGE_KEY, {
			"/videos/a.mp4": "id-a",
			invalid: 123,
		});
		expect(store.load()).toEqual({ "/videos/a.mp4": "id-a" });

		store.save({ "/videos/b.mp4": "id-b" });
		expect(storage.get(SOURCE_IDS_STORAGE_KEY)).toEqual({ "/videos/b.mp4": "id-b" });

		store.clear();
		expect(storage.get(SOURCE_IDS_STORAGE_KEY)).toBeNull();
	});
});

describe("ObsidianShadowCheckpointStore", () => {
	it("persists valid subtitle checkpoints and filters malformed stored entries", () => {
		const storage = new Map<string, unknown>();
		const app = {
			loadLocalStorage: (key: string) => storage.get(key) ?? null,
			saveLocalStorage: (key: string, value: unknown) => {
				storage.set(key, value);
			},
		};
		const store = new ObsidianShadowCheckpointStore(app);
		const valid: ShadowSubtitleCheckpoint = {
			source: { id: "video", path: "/video.mp4" },
			config: { sourceSignature: "100:200", serviceSignature: "svc" },
			nextOffset: 15,
			totalDuration: 60,
			status: "paused",
			error: null,
		};
		store.save([valid]);
		storage.set(SHADOW_CHECKPOINTS_STORAGE_KEY, [
			valid,
			{
				source: { id: "missing-path" },
				config: { serviceSignature: "s", sourceSignature: "x" },
				nextOffset: 0,
			},
			{
				source: { id: "v2", path: "/v2.mp4" },
				config: { serviceSignature: "s", sourceSignature: "x" },
				nextOffset: -1,
			},
			null,
		]);
		const reopened = new ObsidianShadowCheckpointStore(app);
		expect(reopened.load()).toEqual([valid]);
	});
});
