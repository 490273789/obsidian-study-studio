import { describe, expect, it, vi } from "vite-plus/test";
import { buildTranslationSettingsViewModel } from "../viewModel";
import type {
	TranslationSettingsEditorActions,
	TranslationSettingsEditorState,
} from "../viewModel";

function setup(): {
	state: TranslationSettingsEditorState;
	actions: TranslationSettingsEditorActions;
} {
	const settings = {
		enabled: false,
		direction: "zh-en" as const,
		profiles: [
			{
				id: "engine",
				name: "Primary",
				enabled: true,
				engineId: "deepseek",
			},
			{ id: "youdao", name: "Youdao", enabled: true, engineId: "youdao-engine" },
		],
		promptTemplate: "Translate {source_language} to {target_language}",
		thinkingEnabled: false,
	};
	return {
		state: {
			saving: false,
			draft: settings,
			snapshot: {
				input: "",
				translatedInput: "",
				translatedDirection: settings.direction,
				stale: false,
				clearUndoId: null,
				results: [],
				status: "idle",
				saving: false,
				settings,
			},
			aiSnapshot: {
				settings: {
					engines: [
						{
							id: "deepseek",
							kind: "llm" as const,
							name: "Translation",
							provider: "deepseek" as const,
							baseUrl: "https://api.deepseek.com",
							secretId: "key",
							model: "deepseek-chat",
						},
						{
							id: "youdao-engine",
							kind: "translation" as const,
							name: "Youdao",
							provider: "youdao" as const,
							baseUrl: "https://openapi.youdao.com/api",
							appKeySecretId: "app-key",
							appSecretSecretId: "app-secret",
						},
						{
							id: "speech",
							kind: "asr" as const,
							name: "Speech",
							provider: "openai-compatible" as const,
							baseUrl: "https://api.openai.com/v1",
							workspaceId: "",
							workspaceSecretId: "",
							secretId: "speech-key",
							model: "whisper-1",
						},
					],
					defaults: { llm: "deepseek", asr: "speech" },
				},
				models: {},
				loadingModels: [],
				testing: [],
			},
		},
		actions: {
			patch: vi.fn(),
			patchProfile: vi.fn(),
			addProfile: vi.fn(),
			removeProfile: vi.fn(),
			moveProfile: vi.fn(),
			resetPrompt: vi.fn(),
			save: vi.fn(),
		},
	};
}

describe("translation settings presentation", () => {
	it("links to the unified AI engine settings page", async () => {
		const { state, actions } = setup();
		const openAiSettings = vi.fn();
		const presentation = buildTranslationSettingsViewModel(
			state,
			{ ...actions, openAiSettings },
			"zh",
		);
		const control = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find(
				(candidate) =>
					candidate.kind === "button" && candidate.label === "打开 AI 引擎设置",
			);
		if (control?.kind !== "button") throw new Error("Missing AI settings link");
		await presentation.invoke({ action: control.action, value: undefined });
		expect(openAiSettings).toHaveBeenCalledOnce();
	});

	it("offers only non-ASR engines and no credential fields", () => {
		const { state, actions } = setup();
		const presentation = buildTranslationSettingsViewModel(state, actions, "zh");
		const groups = presentation.snapshot.groups;
		expect(groups.map((group) => group.heading)).toEqual([
			"常规设置",
			"翻译方案管理",
			"提示词模板",
			"保存设置",
		]);
		const cards = groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		expect(cards.items).toHaveLength(2);
		const engineField = cards.items[0]?.fields.find((field) => field.key === "engine");
		const engineSelect = engineField?.controls.find((control) => control.key === "engine");
		if (engineSelect?.kind !== "select") throw new Error("Expected engine select");
		expect(engineSelect.options.map((option) => option.value)).toEqual([
			"",
			"deepseek",
			"youdao-engine",
		]);
		expect(
			presentation.snapshot.groups
				.flatMap((group) => group.rows)
				.flatMap((row) => row.controls)
				.some((control) => control.kind === "text" || control.kind === "secret"),
		).toBe(false);
	});

	it("keeps a missing selected engine available for repair", () => {
		const { state, actions } = setup();
		state.draft.profiles[0] = { ...state.draft.profiles[0]!, engineId: "deleted" };
		const cards = buildTranslationSettingsViewModel(state, actions, "en")
			.snapshot.groups.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const select = cards.items[0]?.fields
			.find((field) => field.key === "engine")
			?.controls.find((control) => control.key === "engine");
		if (select?.kind !== "select") throw new Error("Expected engine select");
		expect(select.value).toBe("deleted");
		expect(select.options[0]).toEqual({
			value: "deleted",
			label: "Deleted engine configuration",
		});
	});

	it("dispatches profile movement, engine selection, and prompt reset", async () => {
		const { state, actions } = setup();
		const presentation = buildTranslationSettingsViewModel(state, actions, "en");
		const cards = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const move = cards.items[0]?.actions.find((action) => action.icon === "move-down");
		const engine = cards.items[0]?.fields
			.find((field) => field.key === "engine")
			?.controls.find((control) => control.key === "engine");
		const reset = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find(
				(control) =>
					control.kind === "button" && control.label === "Restore default prompt",
			);
		if (!move || engine?.kind !== "select" || reset?.kind !== "button")
			throw new Error("Expected actions");
		await presentation.invoke({ action: move.action, value: undefined });
		await presentation.invoke({ action: engine.action, value: "youdao-engine" });
		await presentation.invoke({ action: reset.action, value: undefined });
		expect(actions.moveProfile).toHaveBeenCalledWith("engine", 1);
		expect(actions.patchProfile).toHaveBeenCalledWith("engine", {
			engineId: "youdao-engine",
		});
		expect(actions.resetPrompt).toHaveBeenCalledOnce();
	});

	it("explains when no engine can be selected yet", () => {
		const { state, actions } = setup();
		state.aiSnapshot = {
			...state.aiSnapshot,
			settings: { engines: [], defaults: { llm: null, asr: null } },
		};
		const groups = buildTranslationSettingsViewModel(state, actions, "zh").snapshot.groups;
		const cards = groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const engineField = cards.items[0]?.fields.find((field) => field.key === "engine");
		expect(engineField?.description).toBe(
			"尚无可用于翻译的 AI 引擎配置，请先在 AI 引擎设置中添加。",
		);
	});
});
