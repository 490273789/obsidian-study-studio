import { describe, expect, it } from "vite-plus/test";
import { normalizeVideoPlayerSettings } from "../slice";

describe("video player settings", () => {
	it("normalizes legacy settings with new playback defaults", () => {
		expect(normalizeVideoPlayerSettings({ enabled: false })).toEqual({
			enabled: false,
			skipInterval: 10,
			shadowTranscriptionProvider: "bailian",
			shadowTranslationProfileId: "",
			shadowVaultFolder: "Study Studio/影子跟读",
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
	it("rejects vault folder paths that could escape the vault", () => {
		for (const path of [
			"../outside",
			"Study Studio\\..\\outside",
			"C:/outside",
			"/outside",
			"a//b",
		]) {
			expect(
				normalizeVideoPlayerSettings({ shadowVaultFolder: path }).shadowVaultFolder,
			).toBe("Study Studio/影子跟读");
		}
	});
});
