import { describe, expect, it, vi } from "vite-plus/test";
import type { SettingsPresentation } from "../../../../core/settings/presentation";
import { audioPracticeSettingsPresentation, type AudioPracticeAsrEngine } from "../viewModel";
import type { AudioPracticeSettings } from "../slice";

const asrEngines: AudioPracticeAsrEngine[] = [
	{ id: "bailian-main", name: "百炼语音识别" },
	{ id: "gateway-whisper", name: "OpenAI 兼容语音识别" },
];

function rows(presentation: SettingsPresentation) {
	return presentation.snapshot.groups.flatMap((group) => group.rows);
}

function build(
	settings: AudioPracticeSettings,
	engines: readonly AudioPracticeAsrEngine[] = asrEngines,
	language: "zh" | "en" = "zh",
) {
	const updates: Partial<AudioPracticeSettings>[] = [];
	const onOpenAiSettings = vi.fn();
	const presentation = audioPracticeSettingsPresentation(
		settings,
		engines,
		async (patch) => {
			updates.push(patch);
		},
		onOpenAiSettings,
		language,
	);
	return { updates, onOpenAiSettings, presentation };
}

describe("audio practice settings presentation", () => {
	it("only shows the enable toggle and the shared ASR engine choice", () => {
		const { presentation } = build({ enabled: true, transcriptionEngineId: "" });
		const keys = rows(presentation).map((row) => row.key);
		expect(keys).toEqual(["enabled", "engine", "open-ai-settings"]);
	});

	it("lists the registered ASR engines with the default choice first", () => {
		const { presentation } = build({ enabled: true, transcriptionEngineId: "" });
		const engine = rows(presentation).find((row) => row.key === "engine")?.controls[0];
		expect(engine).toMatchObject({
			kind: "select",
			value: "",
			options: [
				{ value: "", label: "默认引擎（使用 AI 引擎设置中的默认项）" },
				{ value: "bailian-main", label: "百炼语音识别" },
				{ value: "gateway-whisper", label: "OpenAI 兼容语音识别" },
			],
		});
	});

	it("routes the engine choice through the update seam", async () => {
		const { updates, presentation } = build({ enabled: true, transcriptionEngineId: "" });
		const engine = rows(presentation).find((row) => row.key === "engine")?.controls[0];
		if (engine?.kind !== "select") throw new Error("Expected an engine select");
		const result = await presentation.invoke({
			action: engine.action,
			value: "gateway-whisper",
		});
		expect(result).toEqual({ status: "applied" });
		expect(updates).toEqual([{ transcriptionEngineId: "gateway-whisper" }]);
	});

	it("keeps a stale selection visible and selectable", () => {
		const { presentation } = build({
			enabled: true,
			transcriptionEngineId: "deleted-engine",
		});
		const engine = rows(presentation).find((row) => row.key === "engine")?.controls[0];
		if (engine?.kind !== "select") throw new Error("Expected an engine select");
		expect(engine.value).toBe("deleted-engine");
		expect(engine.options[0]).toEqual({
			value: "deleted-engine",
			label: "已不可用的引擎: deleted-engine",
		});
	});

	it("toggles the feature through the update seam", async () => {
		const { updates, presentation } = build({ enabled: true, transcriptionEngineId: "" });
		const toggle = rows(presentation).find((row) => row.key === "enabled")?.controls[0];
		if (toggle?.kind !== "toggle") throw new Error("Expected the enabled toggle");
		const result = await presentation.invoke({ action: toggle.action, value: false });
		expect(result).toEqual({ status: "applied" });
		expect(updates).toEqual([{ enabled: false }]);
	});

	it("opens the shared AI engine section instead of editing credentials here", async () => {
		const { onOpenAiSettings, presentation } = build({
			enabled: true,
			transcriptionEngineId: "",
		});
		const button = rows(presentation).find((row) => row.key === "open-ai-settings")
			?.controls[0];
		if (button?.kind !== "button") throw new Error("Expected the AI settings button");
		expect(button.label).toBe("打开 AI 引擎设置");
		const result = await presentation.invoke({ action: button.action, value: undefined });
		expect(result).toEqual({ status: "applied" });
		expect(onOpenAiSettings).toHaveBeenCalledTimes(1);
	});

	it("never shows credential, model, or Base URL controls", () => {
		for (const language of ["zh", "en"] as const) {
			const { presentation } = build(
				{ enabled: true, transcriptionEngineId: "bailian-main" },
				asrEngines,
				language,
			);
			for (const row of rows(presentation)) {
				for (const control of row.controls) {
					expect(["button", "toggle", "select"]).toContain(control.kind);
				}
			}
		}
	});

	it("names the management entry in English", () => {
		const { presentation } = build(
			{ enabled: true, transcriptionEngineId: "" },
			asrEngines,
			"en",
		);
		const button = rows(presentation).find((row) => row.key === "open-ai-settings")
			?.controls[0];
		expect(button).toMatchObject({ kind: "button", label: "Open AI engine settings" });
	});
});
