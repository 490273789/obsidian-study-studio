import { describe, expect, it, vi } from "vite-plus/test";
import { Notice } from "obsidian";
import type { AiService, AiSnapshot } from "../../../../core/ai";
import type { SettingsPresentation } from "../../../../core/settings/presentation";
import type { TranslationSettings, TranslationSnapshot } from "../../domain/types";
import { TranslationSettingsEditor, type TranslationSettingsRuntime } from "../settingsEditor";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

function snapshot(settings: TranslationSettings): TranslationSnapshot {
	return {
		settings,
		input: "",
		translatedInput: "",
		translatedDirection: settings.direction,
		stale: false,
		clearUndoId: null,
		results: [],
		status: "idle",
		saving: false,
	};
}

function createRuntime(initial: TranslationSettings) {
	let settings = initial;
	const configure = vi.fn(async (next: TranslationSettings) => {
		settings = next;
	});
	const runtime: TranslationSettingsRuntime = {
		getSnapshot: () => snapshot(settings),
		subscribe: vi.fn(() => () => {}),
		configure,
	};
	return { runtime, configure, settings: () => settings };
}

function createAi(): AiService {
	const aiSnapshot: AiSnapshot = {
		settings: {
			engines: [
				{
					id: "deepseek",
					kind: "llm",
					name: "DeepSeek",
					provider: "deepseek",
					baseUrl: "https://api.deepseek.com",
					secretId: "secret",
					model: "chat",
				},
				{
					id: "youdao-engine",
					kind: "translation",
					name: "Youdao",
					provider: "youdao",
					baseUrl: "https://openapi.youdao.com/api",
					appKeySecretId: "app-key",
					appSecretSecretId: "app-secret",
				},
			],
			defaults: { llm: "deepseek", asr: null },
		},
		models: {},
		loadingModels: [],
		testing: [],
	};
	return {
		getSnapshot: () => aiSnapshot,
		subscribe: vi.fn(() => () => {}),
	} as unknown as AiService;
}

const initial: TranslationSettings = {
	enabled: false,
	direction: "zh-en",
	profiles: [{ id: "first", name: "First", enabled: true, engineId: "deepseek" }],
	promptTemplate: "Prompt",
	thinkingEnabled: false,
};

function findControl(presentation: SettingsPresentation, kind: string, label?: string) {
	return presentation.snapshot.groups
		.flatMap((group) => group.rows)
		.flatMap((row) => row.controls)
		.find(
			(control) =>
				control.kind === kind &&
				(label === undefined || ("label" in control && control.label === label)),
		);
}

describe("TranslationSettingsEditor", () => {
	it("stores only the shared engine id in a profile draft", async () => {
		const { runtime, settings } = createRuntime(initial);
		const editor = new TranslationSettingsEditor(runtime, createAi(), () => "zh", vi.fn());
		const engineSelect = (presentation: SettingsPresentation) => {
			const cards = findControl(presentation, "cards");
			if (cards?.kind !== "cards") throw new Error("Missing profile cards");
			const select = cards.items[0]?.fields
				.find((field) => field.key === "engine")
				?.controls.find((control) => control.key === "engine");
			if (select?.kind !== "select") throw new Error("Missing engine select");
			return select;
		};
		const presentation = editor.presentation();
		await presentation.invoke({
			action: engineSelect(presentation).action,
			value: "youdao-engine",
		});
		expect(engineSelect(editor.presentation()).value).toBe("youdao-engine");
		// The committed runtime is untouched until Save.
		expect(settings().profiles[0]).toEqual({
			id: "first",
			name: "First",
			enabled: true,
			engineId: "deepseek",
		});
	});

	it("holds a draft and persists it only through Save", async () => {
		const { runtime, configure, settings } = createRuntime(initial);
		const editor = new TranslationSettingsEditor(runtime, createAi(), () => "zh", vi.fn());
		let presentation = editor.presentation();
		const enabled = findControl(presentation, "toggle");
		const add = findControl(presentation, "button", "新增翻译方案");
		if (enabled?.kind !== "toggle" || add?.kind !== "button")
			throw new Error("Missing draft actions");
		await presentation.invoke({ action: enabled.action, value: true });
		await presentation.invoke({ action: add.action, value: undefined });
		expect(configure).not.toHaveBeenCalled();

		presentation.dispose();
		presentation = editor.presentation();
		const save = findControl(presentation, "button", "保存翻译设置");
		if (save?.kind !== "button") throw new Error("Missing save action");
		await presentation.invoke({ action: save.action, value: undefined });
		expect(configure).toHaveBeenCalledOnce();
		expect(settings().enabled).toBe(true);
		expect(settings().profiles).toHaveLength(2);
		expect(settings().profiles[1]?.engineId).toBe("");
		expect(Notice).toHaveBeenCalledWith("翻译设置已保存");
	});

	it("disables removal below one profile and opens AI engine settings without saving", async () => {
		const { runtime, configure } = createRuntime(initial);
		const openAiSettings = vi.fn();
		const editor = new TranslationSettingsEditor(
			runtime,
			createAi(),
			() => "en",
			vi.fn(),
			openAiSettings,
		);
		const presentation = editor.presentation();
		const cards = findControl(presentation, "cards");
		const open = findControl(presentation, "button", "Open AI engine settings");
		if (cards?.kind !== "cards" || open?.kind !== "button") throw new Error("Missing controls");
		expect(cards.items[0]?.actions.find((action) => action.icon === "remove")?.disabled).toBe(
			true,
		);
		await presentation.invoke({ action: open.action, value: undefined });
		expect(openAiSettings).toHaveBeenCalledOnce();
		expect(configure).not.toHaveBeenCalled();
	});

	it("reports persistence failures without losing the draft", async () => {
		const { runtime, configure } = createRuntime(initial);
		const editor = new TranslationSettingsEditor(runtime, createAi(), () => "zh", vi.fn());
		configure.mockRejectedValueOnce(new Error("disk"));
		const presentation = editor.presentation();
		const save = findControl(presentation, "button", "保存翻译设置");
		if (save?.kind !== "button") throw new Error("Missing save action");
		await presentation.invoke({ action: save.action, value: undefined });
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining("翻译设置操作失败："));
	});
});
