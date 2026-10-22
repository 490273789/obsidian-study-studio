import { describe, expect, it } from "vite-plus/test";
import type { SettingsPresentation } from "../../../../core/settings/presentation";
import { audioPracticeSettingsPresentation } from "../viewModel";
import {
	DEFAULT_BAILIAN_MODEL,
	DEFAULT_OPENAI_BASE_URL,
	DEFAULT_OPENAI_MODEL,
	type AudioPracticeSettings,
} from "../slice";

const base: AudioPracticeSettings = {
	enabled: true,
	provider: "bailian",
	bailianWorkspaceId: "workspace",
	bailianSecretId: "secret",
	bailianModel: DEFAULT_BAILIAN_MODEL,
	openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
	openaiSecretId: "",
	openaiModel: DEFAULT_OPENAI_MODEL,
};

function rows(presentation: SettingsPresentation) {
	return presentation.snapshot.groups.flatMap((group) => group.rows);
}

function build(settings: AudioPracticeSettings) {
	const updates: Partial<AudioPracticeSettings>[] = [];
	const presentation = audioPracticeSettingsPresentation(
		settings,
		async (patch) => {
			updates.push(patch);
		},
		"zh",
	);
	return { updates, presentation };
}

describe("audio practice settings presentation", () => {
	it("shows the Bailian fields and hides the compatible-service fields", () => {
		const { presentation } = build(base);
		const keys = rows(presentation).map((row) => row.key);
		expect(keys).toEqual([
			"enabled",
			"provider",
			"workspace",
			"model",
			"secret",
			"explanation",
		]);
		const provider = rows(presentation).find((row) => row.key === "provider")?.controls[0];
		expect(provider).toMatchObject({
			kind: "select",
			value: "bailian",
			options: [{ value: "bailian" }, { value: "openai-compatible" }],
		});
		const model = rows(presentation).find((row) => row.key === "model")?.controls[0];
		expect(model).toMatchObject({
			kind: "select",
			value: DEFAULT_BAILIAN_MODEL,
			options: [
				{ value: "fun-asr-flash-2026-06-15" },
				{ value: "qwen-audio-3.1-asr-flash" },
				{ value: "qwen-audio-3.0-asr-flash" },
			],
		});
	});
	it("shows the compatible-service fields and hides the Bailian fields", () => {
		const { presentation } = build({ ...base, provider: "openai-compatible" });
		const keys = rows(presentation).map((row) => row.key);
		expect(keys).toEqual(["enabled", "provider", "base-url", "model", "secret", "explanation"]);
		expect(keys).not.toContain("workspace");
		const baseUrl = rows(presentation).find((row) => row.key === "base-url")?.controls[0];
		expect(baseUrl).toMatchObject({ kind: "text", value: DEFAULT_OPENAI_BASE_URL });
		const model = rows(presentation).find((row) => row.key === "model")?.controls[0];
		expect(model).toMatchObject({ kind: "text", value: DEFAULT_OPENAI_MODEL });
	});
	it("preserves an older model value until a supported model is selected", async () => {
		const { updates, presentation } = build({ ...base, bailianModel: "fun-asr" });
		const model = rows(presentation).find((row) => row.key === "model")?.controls[0];
		if (model?.kind !== "select") throw new Error("Expected model select");
		expect(model.value).toBe("fun-asr");
		expect(model.options[0]).toMatchObject({ value: "fun-asr" });
		const result = await presentation.invoke({
			action: model.action,
			value: "qwen-audio-3.1-asr-flash",
		});
		expect(result).toEqual({ status: "applied" });
		expect(updates).toEqual([{ bailianModel: "qwen-audio-3.1-asr-flash" }]);
	});
	it("routes the provider choice through the update seam", async () => {
		const { updates, presentation } = build(base);
		const provider = rows(presentation).find((row) => row.key === "provider")?.controls[0];
		if (provider?.kind !== "select") throw new Error("Expected provider select");
		const result = await presentation.invoke({
			action: provider.action,
			value: "openai-compatible",
		});
		expect(result).toEqual({ status: "applied" });
		expect(updates).toEqual([{ provider: "openai-compatible" }]);
	});
});
