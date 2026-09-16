import { describe, expect, it } from "vitest";
import { parseDeviceVideoPlayerState } from "../localVideoPlayerStorage";

describe("parseDeviceVideoPlayerState", () => {
	it("falls back from malformed values", () => {
		expect(parseDeviceVideoPlayerState({ schemaVersion: 2 })).toMatchObject({
			schemaVersion: 1,
			sources: [],
			playbackRate: 1,
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
