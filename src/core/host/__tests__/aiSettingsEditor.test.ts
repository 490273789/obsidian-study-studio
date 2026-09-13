import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { AiEngineConfig, AiService, AiSnapshot } from "../../ai";
import type { SettingsPresentation } from "../../settings/presentation";
import { AiSettingsEditor } from "../aiSettingsEditor";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

function createMockService(initialConfigs: AiEngineConfig[] = []) {
	let configs = [...initialConfigs];
	let defaultConfigId: string | null = configs[0]?.id ?? null;
	const getSnapshot = vi.fn((): AiSnapshot => ({
		settings: { configs, defaultConfigId },
		models: {},
		loadingModels: [],
		testing: [],
	}));
	const saveConfig = vi.fn(async (draft: Partial<AiEngineConfig>) => {
		const saved: AiEngineConfig = {
			id: draft.id ?? `engine-${configs.length + 1}`,
			name: draft.name ?? "",
			provider: draft.provider ?? "deepseek",
			baseUrl: draft.baseUrl ?? "",
			secretId: draft.secretId ?? "",
			model: draft.model ?? "",
		};
		const index = configs.findIndex((config) => config.id === saved.id);
		if (index >= 0) configs[index] = saved;
		else configs.push(saved);
		return saved.id;
	});
	const deleteConfig = vi.fn(async (id: string) => {
		configs = configs.filter((config) => config.id !== id);
		if (defaultConfigId === id) defaultConfigId = null;
	});
	const testConnection = vi.fn(async () => undefined);
	return {
		service: {
			getSnapshot,
			subscribe: vi.fn(() => () => undefined),
			saveConfig,
			deleteConfig,
			setDefault: vi.fn(async (id: string | null) => {
				defaultConfigId = id;
			}),
			listModels: vi.fn(async () => []),
			testConnection,
		} as unknown as AiService,
		saveConfig,
		deleteConfig,
		testConnection,
	};
}

const rows = (presentation: SettingsPresentation) =>
	presentation.snapshot.groups.flatMap((g) => g.rows);

async function press(presentation: SettingsPresentation, rowName: string, label: string) {
	const control = rows(presentation)
		.find((row) => row.name === rowName)
		?.controls.find((candidate) => candidate.kind === "button" && candidate.label === label);
	if (control?.kind !== "button") throw new Error(`Missing button: ${rowName}/${label}`);
	return presentation.invoke({ action: control.action, value: undefined });
}

async function pressByRowKey(presentation: SettingsPresentation, rowKey: string, label: string) {
	const control = rows(presentation)
		.find((row) => row.key === rowKey)
		?.controls.find((candidate) => candidate.kind === "button" && candidate.label === label);
	if (control?.kind !== "button") throw new Error(`Missing button: ${rowKey}/${label}`);
	return presentation.invoke({ action: control.action, value: undefined });
}

async function change(presentation: SettingsPresentation, rowName: string, value: string) {
	const control = rows(presentation).find((row) => row.name === rowName)?.controls[0];
	if (!control || !("action" in control)) throw new Error(`Missing input: ${rowName}`);
	return presentation.invoke({ action: control.action, value });
}

describe("AiSettingsEditor presentation operations", () => {
	it("moves from the engine list to the add form", async () => {
		const { service } = createMockService([]);
		const refresh = vi.fn();
		const editor = new AiSettingsEditor(service, () => "zh", refresh);
		const list = editor.presentation();
		expect(list.snapshot.groups[0]?.heading).toBe("AI 引擎");
		await press(list, "已配置引擎", "新增引擎");
		expect(editor.presentation().snapshot.groups[0]?.heading).toContain("新增 AI 引擎");
		expect(refresh).toHaveBeenCalled();
	});

	it("edits a draft, tests it, saves it, and returns to the list", async () => {
		const { service, saveConfig, testConnection } = createMockService([]);
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		await press(editor.presentation(), "已配置引擎", "新增引擎");
		const form = editor.presentation();
		await change(form, "配置名称", "New Engine");
		await change(form, "模型 ID", "model-abc");
		await change(form, "API Key", "secret-ref");
		await press(form, "测试连接", "测试连接");
		expect(testConnection).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "New Engine",
				model: "model-abc",
				secretId: "secret-ref",
			}),
		);
		expect(Notice).toHaveBeenCalledWith("AI 文本连接测试成功");
		await press(form, "引擎配置", "保存配置");
		expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ name: "New Engine" }));
		expect(editor.presentation().snapshot.groups[0]?.heading).toBe("AI 引擎");
	});

	it("edits and deletes an existing engine through semantic actions", async () => {
		const initial: AiEngineConfig = {
			id: "eng-1",
			name: "Old Name",
			provider: "deepseek",
			baseUrl: "https://api.deepseek.com",
			secretId: "key-1",
			model: "deepseek-v4-flash",
		};
		const { service, saveConfig, deleteConfig } = createMockService([initial]);
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		await pressByRowKey(editor.presentation(), "engine-eng-1", "编辑");
		const form = editor.presentation();
		await change(form, "配置名称", "Renamed Engine");
		await press(form, "引擎配置", "保存配置");
		expect(saveConfig).toHaveBeenCalledWith(
			expect.objectContaining({ id: "eng-1", name: "Renamed Engine" }),
		);
		await pressByRowKey(editor.presentation(), "engine-eng-1", "删除");
		expect(deleteConfig).toHaveBeenCalledWith("eng-1");
	});
});
