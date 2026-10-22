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
				kind: "engine" as const,
				configId: "deepseek",
			},
			{ id: "youdao", name: "Youdao", enabled: true, kind: "youdao" as const, configId: "" },
		],
		promptTemplate: "Translate {source_language} to {target_language}",
		thinkingEnabled: false,
		youdao: {
			baseUrl: "https://youdao.example",
			appKeySecretId: "app",
			appSecretSecretId: "secret",
		},
	};
	return {
		state: {
			saving: false,
			draft: settings,
			snapshot: {
				input: "",
				results: [],
				status: "idle",
				saving: false,
				testing: false,
				settings,
			},
			aiSnapshot: {
				settings: {
					configs: [
						{
							id: "deepseek",
							name: "Translation",
							provider: "deepseek",
							baseUrl: "https://api.deepseek.com",
							secretId: "key",
							model: "deepseek-chat",
						},
						{
							id: "gateway",
							name: "Gateway",
							provider: "youdao",
							baseUrl: "https://gateway",
							secretId: "key",
							model: "model",
						},
					],
					defaultConfigId: null,
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
			testYoudao: vi.fn(),
		},
	};
}

describe("translation settings presentation", () => {
	it("opens the unified Youdao settings page from translation settings", async () => {
		const { state, actions } = setup();
		const openYoudao = vi.fn();
		const presentation = buildTranslationSettingsViewModel(
			state,
			{ ...actions, openYoudao },
			"zh",
		);
		const control = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find(
				(candidate) =>
					candidate.kind === "button" && candidate.label === "打开有道智云设置",
			);
		if (control?.kind !== "button") throw new Error("Missing Youdao link");
		await presentation.invoke({ action: control.action, value: undefined });
		expect(openYoudao).toHaveBeenCalledOnce();
	});

	it("keeps service credentials on the Youdao page and offers all configured AI engines", () => {
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
		const providerField = cards.items[0]?.fields.find((field) => field.key === "provider");
		expect(providerField?.controls).toHaveLength(2);
		const engineSelect = providerField?.controls.find((control) => control.key === "engine");
		if (engineSelect?.kind !== "select") throw new Error("Expected engine select");
		expect(engineSelect.options.map((option) => option.value)).toEqual([
			"",
			"deepseek",
			"gateway",
		]);
		const youdao = buildTranslationSettingsViewModel(state, actions, "zh", "youdao");
		expect(youdao.snapshot.groups.map((group) => group.heading)).toEqual([
			"文本翻译 API（应用 ID / 应用密钥）",
			"保存设置",
		]);
	});

	it("keeps a missing selected engine available for repair", () => {
		const { state, actions } = setup();
		state.draft.profiles[0] = { ...state.draft.profiles[0]!, configId: "deleted" };
		const cards = buildTranslationSettingsViewModel(state, actions, "en")
			.snapshot.groups.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const select = cards.items[0]?.fields
			.find((field) => field.key === "provider")
			?.controls.find((control) => control.key === "engine");
		if (select?.kind !== "select") throw new Error("Expected engine select");
		expect(select.options[0]).toEqual({
			value: "deleted",
			label: "Deleted engine configuration",
		});
	});

	it("dispatches profile movement and prompt reset through action references", async () => {
		const { state, actions } = setup();
		const presentation = buildTranslationSettingsViewModel(state, actions, "en");
		const cards = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "cards");
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const move = cards.items[0]?.actions.find((action) => action.icon === "move-down");
		const reset = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.flatMap((row) => row.controls)
			.find(
				(control) =>
					control.kind === "button" && control.label === "Restore default prompt",
			);
		if (!move || reset?.kind !== "button") throw new Error("Expected actions");
		await presentation.invoke({ action: move.action, value: undefined });
		await presentation.invoke({ action: reset.action, value: undefined });
		expect(actions.moveProfile).toHaveBeenCalledWith("engine", 1);
		expect(actions.resetPrompt).toHaveBeenCalledOnce();
	});
});
