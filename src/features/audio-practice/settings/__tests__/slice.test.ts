import { describe, expect, it } from "vite-plus/test";
import {
	LEGACY_ASR_BAILIAN_ENGINE_ID,
	LEGACY_ASR_OPENAI_ENGINE_ID,
} from "../../../../core/ai/legacy";
import { audioPracticeSettingsSlice } from "../slice";

const normalize = (raw: unknown) => audioPracticeSettingsSlice.normalize(raw).audioPractice;

describe("audio practice settings slice", () => {
	it("defaults to enabled with the default ASR engine", () => {
		expect(audioPracticeSettingsSlice.defaults().audioPractice).toEqual({
			enabled: true,
			transcriptionEngineId: "",
		});
	});

	it("keeps an explicit engine selection and drops unknown fields", () => {
		const settings = normalize({
			audioPractice: {
				enabled: false,
				transcriptionEngineId: " custom-asr ",
				manifest: "unexpected",
			},
		});
		expect(settings).toEqual({
			enabled: false,
			transcriptionEngineId: "custom-asr",
		});
	});

	it("keeps no transcription credential fields of its own", () => {
		const settings = normalize({
			audioPractice: {
				provider: "openai-compatible",
				openaiSecretId: "secret",
				bailianWorkspaceId: "workspace",
				openaiModel: "whisper-1",
			},
		});
		expect(Object.keys(settings).sort()).toEqual(["enabled", "transcriptionEngineId"]);
	});

	it("migrates the removed mediaTranscription choice to a stable engine id", () => {
		const settings = normalize({
			mediaTranscription: { provider: "bailian", bailianSecretId: "key" },
		});
		expect(settings.transcriptionEngineId).toBe(LEGACY_ASR_BAILIAN_ENGINE_ID);
	});

	it("migrates the legacy audio practice provider as fallback", () => {
		const settings = normalize({
			audioPractice: {
				enabled: true,
				provider: "openai-compatible",
				openaiSecretId: "gateway-secret",
			},
		});
		expect(settings.transcriptionEngineId).toBe(LEGACY_ASR_OPENAI_ENGINE_ID);
	});

	it("prefers the newest legacy owner over the audio practice fields", () => {
		const settings = normalize({
			mediaTranscription: { provider: "openai-compatible", openaiSecretId: "gateway" },
			audioPractice: { provider: "bailian", secretId: "bailian-key" },
		});
		expect(settings.transcriptionEngineId).toBe(LEGACY_ASR_OPENAI_ENGINE_ID);
	});

	it("prefers a new selection over migration", () => {
		const settings = normalize({
			audioPractice: { transcriptionEngineId: "custom-asr" },
			mediaTranscription: { provider: "bailian", bailianSecretId: "key" },
		});
		expect(settings.transcriptionEngineId).toBe("custom-asr");
	});

	it("leaves the selection empty when no engine was ever configured", () => {
		expect(normalize({ audioPractice: { enabled: true } }).transcriptionEngineId).toBe("");
	});

	it("ignores non-string selections", () => {
		expect(normalize({ audioPractice: { transcriptionEngineId: 42 } })).toEqual({
			enabled: true,
			transcriptionEngineId: "",
		});
	});

	it("is idempotent for the normalized document", () => {
		const first = normalize({
			mediaTranscription: { provider: "bailian", bailianSecretId: "key" },
		});
		expect(normalize({ audioPractice: first })).toEqual(first);
	});
});
