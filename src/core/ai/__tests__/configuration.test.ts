import { describe, expect, it } from "vite-plus/test";
import {
	cleanEngine,
	defaultEngineFor,
	enginesOfKind,
	migrateAiSettings,
	normalizeAiSettings,
	selectedEngine,
} from "../configuration";
import {
	LEGACY_ASR_BAILIAN_ENGINE_ID,
	LEGACY_ASR_OPENAI_ENGINE_ID,
	LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
	legacyAsrEngineId,
	legacyActiveAsrEngineId,
	readLegacyTranscriptionSettings,
	readLegacyVideoTranscriptionProvider,
} from "../legacy";
import type { AiEngineConfig } from "../types";

const llm: AiEngineConfig = {
	id: "engine-1",
	kind: "llm",
	name: "DeepSeek",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	secretId: "llm-secret",
	model: "deepseek-v4-flash",
};

describe("AI engine normalization", () => {
	it("keeps only known fields, de-duplicates ids and validates defaults by kind", () => {
		const normalized = normalizeAiSettings({
			engines: [
				{ ...llm, apiKey: "DO-NOT-SAVE" },
				{ ...llm, name: "Duplicate" },
				{ id: "bad", kind: "llm", provider: "unknown" },
				{ id: "bad-kind", kind: "tts" },
			],
			defaults: { llm: "missing", asr: "engine-1" },
		});
		expect(normalized.engines).toEqual([llm]);
		expect(normalized.defaults).toEqual({ llm: null, asr: null });
		expect(JSON.stringify(normalized)).not.toContain("DO-NOT-SAVE");
	});

	it("accepts pre-registry LLM configurations as llm engines", () => {
		const normalized = normalizeAiSettings({
			configs: [{ ...llm, kind: undefined }],
			defaultConfigId: "engine-1",
		});
		expect(normalized.engines).toEqual([llm]);
	});

	it("validates provider-specific fields before saving", () => {
		const asr: AiEngineConfig = {
			id: "asr-1",
			kind: "asr",
			name: "Speech",
			provider: "bailian",
			baseUrl: "",
			workspaceId: "",
			workspaceSecretId: "",
			secretId: "key",
			model: "fun-asr-flash-2026-06-15",
		};
		expect(() => cleanEngine(asr)).toThrow();
		expect(() => cleanEngine({ ...asr, workspaceSecretId: "workspace-secret" })).not.toThrow();
		const translation: AiEngineConfig = {
			id: "tr",
			kind: "translation",
			name: "Youdao",
			provider: "youdao",
			baseUrl: "https://openapi.youdao.com/api",
			appKeySecretId: "",
			appSecretSecretId: "secret",
		};
		expect(() => cleanEngine(translation)).toThrow();
		expect(() => cleanEngine({ ...translation, appKeySecretId: "app-key" })).not.toThrow();
	});

	it("resolves selections by kind with default and first-engine fallbacks", () => {
		const asrA: AiEngineConfig = {
			id: "asr-a",
			kind: "asr",
			name: "A",
			provider: "openai-compatible",
			baseUrl: "https://api.openai.com/v1",
			workspaceId: "",
			workspaceSecretId: "",
			secretId: "key",
			model: "whisper-1",
		};
		const asrB: AiEngineConfig = { ...asrA, id: "asr-b", name: "B" };
		const settings = {
			engines: [llm, asrA, asrB],
			defaults: { llm: llm.id, asr: "asr-b" },
		};
		expect(enginesOfKind(settings, "asr")).toHaveLength(2);
		expect(selectedEngine(settings, "asr", "")?.id).toBe("asr-b");
		expect(selectedEngine(settings, "asr", "asr-a")?.id).toBe("asr-a");
		expect(selectedEngine(settings, "asr", llm.id)).toBeUndefined();
		expect(
			defaultEngineFor({ ...settings, defaults: { llm: null, asr: null } }, "asr")?.id,
		).toBe("asr-a");
	});
});

describe("legacy AI settings migration", () => {
	const legacyDocument = {
		ai: {
			configs: [{ ...llm, kind: undefined }],
			defaultConfigId: "engine-1",
		},
		mediaTranscription: {
			provider: "openai-compatible",
			bailianWorkspaceId: "workspace",
			bailianWorkspaceSecretId: "",
			bailianSecretId: "bailian-key",
			bailianModel: "fun-asr-flash-2026-06-15",
			openaiBaseUrl: "https://gateway.example/v1",
			openaiSecretId: "openai-key",
			openaiModel: "whisper-1",
		},
		translation: {
			youdao: {
				baseUrl: "https://openapi.youdao.com/api",
				appKeySecretId: "app-key",
				appSecretSecretId: "app-secret",
			},
		},
		videoPlayer: { shadowTranscriptionProvider: "openai-compatible" },
	};

	it("migrates LLM, ASR and Youdao translation configurations into one registry", () => {
		const migrated = migrateAiSettings(legacyDocument);
		expect(migrated.engines.map((engine) => engine.id).sort()).toEqual(
			[
				"engine-1",
				LEGACY_ASR_BAILIAN_ENGINE_ID,
				LEGACY_ASR_OPENAI_ENGINE_ID,
				LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
			].sort(),
		);
		expect(migrated.defaults).toEqual({
			llm: "engine-1",
			// The active legacy provider was openai-compatible.
			asr: LEGACY_ASR_OPENAI_ENGINE_ID,
		});
		const youdao = migrated.engines.find(
			(engine) => engine.id === LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
		);
		expect(youdao).toMatchObject({
			kind: "translation",
			appKeySecretId: "app-key",
			appSecretSecretId: "app-secret",
		});
		expect(JSON.stringify(migrated)).not.toContain("DO-NOT-SAVE");
	});

	it("is idempotent and does not resurrect legacy fields", () => {
		const migrated = migrateAiSettings(legacyDocument);
		const normalizedDocument = { ai: migrated };
		expect(migrateAiSettings(normalizedDocument)).toEqual(migrated);
	});

	it("maps the legacy video provider to the matching ASR engine id", () => {
		const transcription = readLegacyTranscriptionSettings(legacyDocument)!;
		expect(readLegacyVideoTranscriptionProvider(legacyDocument)).toBe("openai-compatible");
		expect(legacyAsrEngineId(transcription, "openai-compatible")).toBe(
			LEGACY_ASR_OPENAI_ENGINE_ID,
		);
		expect(legacyAsrEngineId(transcription, "bailian")).toBe(LEGACY_ASR_BAILIAN_ENGINE_ID);
		expect(legacyActiveAsrEngineId(transcription)).toBe(LEGACY_ASR_OPENAI_ENGINE_ID);
	});

	it("does not create engines for unconfigured legacy providers", () => {
		const migrated = migrateAiSettings({
			mediaTranscription: { provider: "bailian" },
			translation: {},
		});
		expect(migrated.engines).toEqual([]);
		expect(migrated.defaults).toEqual({ llm: null, asr: null });
	});

	it("keeps a new registry as the authority and never re-adds old sl slices", () => {
		const current = { engines: [llm], defaults: { llm: llm.id, asr: null } };
		expect(
			migrateAiSettings({
				ai: current,
				mediaTranscription: {
					provider: "bailian",
					bailianSecretId: "legacy-key",
					bailianModel: "fun-asr-flash-2026-06-15",
				},
			}).engines.map((engine) => engine.id),
		).toEqual([llm.id, LEGACY_ASR_BAILIAN_ENGINE_ID]);
	});
});
