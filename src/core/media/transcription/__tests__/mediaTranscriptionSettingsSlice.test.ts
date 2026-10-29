import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_BAILIAN_MODEL,
	mediaTranscriptionDefaults,
	mediaTranscriptionSettingsSlice,
} from "../settingsSlice";

describe("mediaTranscriptionSettingsSlice", () => {
	it("returns expected defaults", () => {
		expect(mediaTranscriptionSettingsSlice.defaults()).toEqual({
			mediaTranscription: mediaTranscriptionDefaults,
		});
	});

	it("normalizes an empty raw input to defaults", () => {
		expect(mediaTranscriptionSettingsSlice.normalize(undefined)).toEqual({
			mediaTranscription: mediaTranscriptionDefaults,
		});
		expect(mediaTranscriptionSettingsSlice.normalize({})).toEqual({
			mediaTranscription: mediaTranscriptionDefaults,
		});
	});

	it("migrates legacy audioPractice settings when mediaTranscription is empty", () => {
		const raw = {
			audioPractice: {
				provider: "openai-compatible",
				bailianWorkspaceId: "legacy-ws",
				bailianSecretId: "legacy-secret",
				openaiBaseUrl: "https://my-openai-gateway.com/v1",
				openaiSecretId: "legacy-openai-secret",
				openaiModel: "whisper-custom",
			},
		};

		const normalized = mediaTranscriptionSettingsSlice.normalize(raw);
		expect(normalized.mediaTranscription).toEqual({
			provider: "openai-compatible",
			bailianWorkspaceId: "legacy-ws",
			bailianWorkspaceSecretId: "",
			bailianSecretId: "legacy-secret",
			bailianModel: DEFAULT_BAILIAN_MODEL,
			openaiBaseUrl: "https://my-openai-gateway.com/v1",
			openaiSecretId: "legacy-openai-secret",
			openaiModel: "whisper-custom",
		});
	});

	it("prefers direct mediaTranscription settings over legacy audioPractice", () => {
		const raw = {
			audioPractice: {
				provider: "bailian",
				bailianWorkspaceId: "legacy-ws",
			},
			mediaTranscription: {
				provider: "openai-compatible",
				openaiBaseUrl: "https://custom.com/v1",
				openaiSecretId: "new-secret",
			},
		};

		const normalized = mediaTranscriptionSettingsSlice.normalize(raw);
		expect(normalized.mediaTranscription.provider).toBe("openai-compatible");
		expect(normalized.mediaTranscription.openaiBaseUrl).toBe("https://custom.com/v1");
		expect(normalized.mediaTranscription.openaiSecretId).toBe("new-secret");
	});
});
