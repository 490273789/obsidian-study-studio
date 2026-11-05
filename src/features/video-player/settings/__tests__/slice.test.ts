import { describe, expect, it } from "vite-plus/test";
import {
	LEGACY_ASR_BAILIAN_ENGINE_ID,
	LEGACY_ASR_OPENAI_ENGINE_ID,
} from "../../../../core/ai/legacy";
import { normalizeVideoPlayerSettings, videoPlayerSettingsSlice } from "../slice";

describe("video player settings", () => {
	it("normalizes legacy settings with new playback defaults", () => {
		expect(normalizeVideoPlayerSettings({ enabled: false })).toEqual({
			enabled: false,
			skipInterval: 10,
			shadowTranscriptionEngineId: "",
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

	it("keeps the selected ASR engine id and trims surrounding whitespace", () => {
		expect(
			normalizeVideoPlayerSettings({ shadowTranscriptionEngineId: "  engine-a  " })
				.shadowTranscriptionEngineId,
		).toBe("engine-a");
		expect(
			normalizeVideoPlayerSettings({ shadowTranscriptionEngineId: 42 })
				.shadowTranscriptionEngineId,
		).toBe("");
	});

	it("maps the legacy Bailian provider to the migrated ASR engine id", () => {
		const normalized = videoPlayerSettingsSlice.normalize({
			videoPlayer: { shadowTranscriptionProvider: "bailian" },
			mediaTranscription: { provider: "bailian", bailianSecretId: "bailian-key" },
		});
		expect(normalized.videoPlayer.shadowTranscriptionEngineId).toBe(
			LEGACY_ASR_BAILIAN_ENGINE_ID,
		);
	});

	it("maps the legacy OpenAI-compatible provider to the migrated ASR engine id", () => {
		const normalized = videoPlayerSettingsSlice.normalize({
			videoPlayer: { shadowTranscriptionProvider: "openai-compatible" },
			mediaTranscription: { provider: "bailian", openaiSecretId: "openai-key" },
		});
		expect(normalized.videoPlayer.shadowTranscriptionEngineId).toBe(
			LEGACY_ASR_OPENAI_ENGINE_ID,
		);
	});

	it("falls back to the default ASR engine when the old provider had no configuration", () => {
		const normalized = videoPlayerSettingsSlice.normalize({
			videoPlayer: { shadowTranscriptionProvider: "openai-compatible" },
			mediaTranscription: { provider: "bailian", bailianSecretId: "bailian-key" },
		});
		expect(normalized.videoPlayer.shadowTranscriptionEngineId).toBe("");
	});

	it("prefers the new engine id over the legacy provider enum", () => {
		const normalized = videoPlayerSettingsSlice.normalize({
			videoPlayer: {
				shadowTranscriptionProvider: "bailian",
				shadowTranscriptionEngineId: "engine-new",
			},
			mediaTranscription: { provider: "bailian", bailianSecretId: "bailian-key" },
		});
		expect(normalized.videoPlayer.shadowTranscriptionEngineId).toBe("engine-new");
	});

	it("normalizes the migrated document idempotently", () => {
		const first = videoPlayerSettingsSlice.normalize({
			videoPlayer: { shadowTranscriptionProvider: "bailian" },
			mediaTranscription: { provider: "bailian", bailianSecretId: "bailian-key" },
		});
		const second = videoPlayerSettingsSlice.normalize(first);
		expect(second.videoPlayer.shadowTranscriptionEngineId).toBe(
			first.videoPlayer.shadowTranscriptionEngineId,
		);
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
