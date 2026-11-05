import { describe, expect, it } from "vite-plus/test";
import { LEGACY_YOUDAO_TRANSLATION_ENGINE_ID } from "../../../../core/ai";
import { normalizeTranslationSettings, validateTranslationSettings } from "../configuration";

describe("translation settings normalization", () => {
	it("migrates legacy kind/configId and the Youdao connection into an engine id", () => {
		const settings = normalizeTranslationSettings({
			enabled: true,
			profiles: [
				{ id: "llm", name: "LLM", enabled: true, kind: "engine", configId: "deepseek" },
				{ id: "youdao", name: "Youdao", enabled: true, kind: "youdao" },
			],
			youdao: {
				baseUrl: "https://openapi.youdao.com/api",
				appKeySecretId: "app-key",
				appSecretSecretId: "app-secret",
			},
		});
		expect(settings.profiles).toEqual([
			{ id: "llm", name: "LLM", enabled: true, engineId: "deepseek" },
			{
				id: "youdao",
				name: "Youdao",
				enabled: true,
				engineId: LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
			},
		]);
		expect(settings).not.toHaveProperty("youdao");
	});

	it("prefers a committed engine id and drops the removed kind/configId fields", () => {
		const settings = normalizeTranslationSettings({
			profiles: [
				{
					id: "committed",
					name: "Committed",
					enabled: true,
					engineId: "current",
					configId: "stale",
				},
			],
		});
		expect(settings.profiles[0]).toEqual({
			id: "committed",
			name: "Committed",
			enabled: true,
			engineId: "current",
		});
	});

	it("leaves a legacy Youdao profile without credentials unconfigured", () => {
		const settings = normalizeTranslationSettings({
			profiles: [{ id: "youdao", name: "Youdao", enabled: true, kind: "youdao" }],
		});
		expect(settings.profiles[0]?.engineId).toBe("");
	});

	it("keeps the historical default profile names and points only the Youdao one at the legacy engine", () => {
		const withLegacy = normalizeTranslationSettings({
			youdao: { appKeySecretId: "app-key", appSecretSecretId: "app-secret" },
		});
		expect(withLegacy.profiles.map((profile) => profile.name)).toEqual([
			"DeepSeek",
			"百炼",
			"有道智云",
		]);
		expect(withLegacy.profiles.map((profile) => profile.engineId)).toEqual([
			"",
			"",
			LEGACY_YOUDAO_TRANSLATION_ENGINE_ID,
		]);
		expect(
			normalizeTranslationSettings({}).profiles.map((profile) => profile.engineId),
		).toEqual(["", "", ""]);
	});

	it("drops duplicate ids and unknown credential fields", () => {
		const settings = normalizeTranslationSettings({
			apiKey: "private",
			profiles: [
				{ id: "one", name: "One", enabled: true, appSecret: "private" },
				{ id: "one", name: "Duplicate", enabled: true },
				{ id: "", name: "Empty", enabled: true },
			],
			youdao: { appSecretSecretId: "private" },
		});
		expect(settings.profiles).toHaveLength(1);
		expect(JSON.stringify(settings)).not.toContain("private");
	});

	it("never validates engine endpoints here, only the profile shape", () => {
		const settings = normalizeTranslationSettings({
			profiles: [{ id: "one", name: "One", enabled: true, engineId: "missing" }],
		});
		expect(() => validateTranslationSettings(settings)).not.toThrow();
		expect(() =>
			validateTranslationSettings({
				...settings,
				profiles: [{ ...settings.profiles[0]!, name: "" }],
			}),
		).toThrow(expect.objectContaining({ code: "invalid-config" }));
	});
});
