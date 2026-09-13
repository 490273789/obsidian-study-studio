import { describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import type { AiService, AiSnapshot } from "../../../../core/ai";
import type { SettingsPresentation } from "../../../../core/settings/presentation";
import type { TranslationSettings, TranslationSnapshot } from "../../domain/types";
import { TranslationSettingsEditor, type TranslationSettingsRuntime } from "../settingsEditor";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

function snapshot(settings: TranslationSettings): TranslationSnapshot {
	return { settings, input: "", results: [], status: "idle", saving: false, testing: false };
}

function createRuntime(initial: TranslationSettings) {
	let settings = initial;
	const configure = vi.fn(async (next: TranslationSettings) => {
		settings = next;
	});
	const testYoudao = vi.fn(async () => {});
	const runtime: TranslationSettingsRuntime = {
		getSnapshot: () => snapshot(settings),
		subscribe: vi.fn(() => () => {}),
		configure,
		testYoudao,
	};
	return { runtime, configure, testYoudao, settings: () => settings };
}

function createAi(): AiService {
	const aiSnapshot: AiSnapshot = {
		settings: {
			configs: [
				{
					id: "deepseek",
					name: "DeepSeek",
					provider: "deepseek",
					baseUrl: "https://api.deepseek.com",
					secretId: "secret",
					model: "chat",
				},
			],
			defaultConfigId: null,
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
	profiles: [{ id: "first", name: "First", enabled: true, kind: "engine", configId: "deepseek" }],
	promptTemplate: "Prompt",
	thinkingEnabled: false,
	youdao: {
		baseUrl: "https://youdao.example",
		appKeySecretId: "key",
		appSecretSecretId: "secret",
	},
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
		expect(Notice).toHaveBeenCalledWith("翻译设置已保存");
	});

	it("disables removal below one profile and tests Youdao without saving", async () => {
		const { runtime, configure, testYoudao } = createRuntime(initial);
		const editor = new TranslationSettingsEditor(runtime, createAi(), () => "en", vi.fn());
		const presentation = editor.presentation();
		const cards = findControl(presentation, "cards");
		const test = findControl(presentation, "button", "Test Youdao connection");
		if (cards?.kind !== "cards" || test?.kind !== "button") throw new Error("Missing controls");
		expect(cards.items[0]?.actions.find((action) => action.icon === "remove")?.disabled).toBe(
			true,
		);
		await presentation.invoke({ action: test.action, value: undefined });
		expect(testYoudao).toHaveBeenCalledOnce();
		expect(configure).not.toHaveBeenCalled();
	});
});
