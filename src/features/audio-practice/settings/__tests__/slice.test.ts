import { describe, expect, it } from "vite-plus/test";
import {
	audioPracticeSettingsSlice,
	DEFAULT_BAILIAN_MODEL,
	DEFAULT_OPENAI_BASE_URL,
	DEFAULT_OPENAI_MODEL,
} from "../slice";

const normalize = (raw: unknown) => audioPracticeSettingsSlice.normalize(raw).audioPractice;

describe("audio practice settings slice", () => {
	it("defaults to the Bailian synchronous transcription service", () => {
		expect(audioPracticeSettingsSlice.defaults().audioPractice).toEqual({
			enabled: true,
			provider: "bailian",
			bailianWorkspaceId: "",
			bailianSecretId: "",
			bailianModel: DEFAULT_BAILIAN_MODEL,
			openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
			openaiSecretId: "",
			openaiModel: DEFAULT_OPENAI_MODEL,
		});
	});
	it("migrates the legacy workspace and secret fields", () => {
		const settings = normalize({
			audioPractice: { enabled: false, workspaceId: " ws ", secretId: " key " },
		});
		expect(settings).toMatchObject({
			enabled: false,
			provider: "bailian",
			bailianWorkspaceId: "ws",
			bailianSecretId: "key",
			bailianModel: DEFAULT_BAILIAN_MODEL,
		});
	});
	it("prefers explicit provider fields over legacy ones", () => {
		const settings = normalize({
			audioPractice: {
				workspaceId: "legacy",
				secretId: "legacy-secret",
				bailianWorkspaceId: "current",
				bailianSecretId: "current-secret",
				bailianModel: "qwen-audio-3.1-asr-flash",
				provider: "openai-compatible",
				openaiBaseUrl: "https://gateway.test/v1",
				openaiSecretId: "gateway-secret",
				openaiModel: "whisper-large-v3",
			},
		});
		expect(settings).toMatchObject({
			provider: "openai-compatible",
			bailianWorkspaceId: "current",
			bailianSecretId: "current-secret",
			bailianModel: "qwen-audio-3.1-asr-flash",
			openaiBaseUrl: "https://gateway.test/v1",
			openaiSecretId: "gateway-secret",
			openaiModel: "whisper-large-v3",
		});
	});
	it("repairs unknown providers and keeps only known fields", () => {
		const settings = normalize({
			audioPractice: {
				provider: "something-else",
				workspaceId: "legacy",
				secretId: "legacy-secret",
				manifest: "unexpected",
			},
		});
		expect(settings.provider).toBe("bailian");
		expect(settings).not.toHaveProperty("workspaceId");
		expect(settings).not.toHaveProperty("secretId");
		expect(settings).not.toHaveProperty("manifest");
	});
	it("ignores non-string model and URL values", () => {
		const settings = normalize({
			audioPractice: { bailianModel: 42, openaiBaseUrl: false, openaiModel: null },
		});
		expect(settings.bailianModel).toBe(DEFAULT_BAILIAN_MODEL);
		expect(settings.openaiBaseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
		expect(settings.openaiModel).toBe(DEFAULT_OPENAI_MODEL);
	});
});
