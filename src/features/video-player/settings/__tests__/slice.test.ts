import { describe, expect, it } from "vitest";
import { normalizeVideoPlayerSettings } from "../slice";

describe("video player settings", () => {
	it("normalizes legacy settings with new playback defaults", () => {
		expect(normalizeVideoPlayerSettings({ enabled: false })).toEqual({
			enabled: false,
			skipInterval: 10,
			shortcuts: {
				togglePlayback: "Space",
				seekBackward: "ArrowLeft",
				seekForward: "ArrowRight",
			},
		});
	});

	it("keeps valid custom values and repairs duplicate shortcuts", () => {
		expect(
			normalizeVideoPlayerSettings({
				skipInterval: 30,
				shortcuts: {
					togglePlayback: "Shift+P",
					seekBackward: "Shift+P",
					seekForward: "",
				},
			}),
		).toMatchObject({
			skipInterval: 30,
			shortcuts: {
				togglePlayback: "Shift+P",
				seekBackward: "ArrowLeft",
				seekForward: "",
			},
		});
	});
});
