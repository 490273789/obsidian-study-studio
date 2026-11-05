import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AiEngineConfig, AiService, AiSnapshot } from "../../ai";
import type { SettingsPresentation } from "../../settings/presentation";
import { AiSettingsEditor } from "../aiSettingsEditor";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

const llm: AiEngineConfig = {
	id: "eng-1",
	kind: "llm",
	name: "Old Name",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	secretId: "key-1",
	model: "deepseek-v4-flash",
};

function createMockService(initial: AiEngineConfig[] = []) {
	let engines = [...initial];
	let defaults: { llm: string | null; asr: string | null } = {
		llm: initial.find((engine) => engine.kind === "llm")?.id ?? null,
		asr: null,
	};
	let nextId = 1;
	const snapshot = (): AiSnapshot => ({
		settings: { engines, defaults },
		models: {},
		loadingModels: [],
		testing: [],
	});
	const saveEngine = vi.fn(async (engine: AiEngineConfig) => {
		const index = engines.findIndex((item) => item.id === engine.id);
		if (index >= 0) engines[index] = engine;
		else engines.push(engine);
		if (engine.kind !== "translation" && !defaults[engine.kind])
			defaults = { ...defaults, [engine.kind]: engine.id };
		return engine.id;
	});
	const deleteEngine = vi.fn(async (id: string) => {
		engines = engines.filter((engine) => engine.id !== id);
		if (defaults.llm === id) defaults = { ...defaults, llm: null };
		if (defaults.asr === id) defaults = { ...defaults, asr: null };
	});
	const testEngine = vi.fn(async () => undefined);
	return {
		service: {
			getSnapshot: vi.fn(snapshot),
			subscribe: vi.fn(() => () => undefined),
			createEngineId: vi.fn(() => `new-${nextId++}`),
			saveEngine,
			deleteEngine,
			setDefault: vi.fn(async (kind: "llm" | "asr", id: string | null) => {
				defaults = { ...defaults, [kind]: id };
			}),
			listModels: vi.fn(async () => []),
			testEngine,
		} as unknown as AiService,
		saveEngine,
		deleteEngine,
		testEngine,
	};
}

const rows = (presentation: SettingsPresentation) =>
	presentation.snapshot.groups.flatMap((group) => group.rows);

async function press(presentation: SettingsPresentation, rowKey: string, label: string) {
	const control = rows(presentation)
		.find((row) => row.key === rowKey)
		?.controls.find((candidate) => candidate.kind === "button" && candidate.label === label);
	if (control?.kind !== "button") throw new Error(`Missing button: ${rowKey}/${label}`);
	return presentation.invoke({ action: control.action, value: undefined });
}

async function change(presentation: SettingsPresentation, rowKey: string, value: string) {
	const control = rows(presentation).find((row) => row.key === rowKey)?.controls[0];
	if (!control || !("action" in control)) throw new Error(`Missing input: ${rowKey}`);
	return presentation.invoke({ action: control.action, value });
}

describe("AiSettingsEditor presentation operations", () => {
	it("moves from the engine list to the add form and switches service type", async () => {
		const { service } = createMockService();
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		const list = editor.presentation();
		expect(list.snapshot.groups[0]?.heading).toBe("服务类型");
		const kinds = rows(list).find((row) => row.key === "kind")?.controls[0];
		if (kinds?.kind !== "choiceButtons") throw new Error("Missing kind tabs");
		await list.invoke({ action: kinds.action, value: "asr" });
		expect(editor.presentation().snapshot.groups[1]?.heading).toBe("默认引擎");
		await press(editor.presentation(), "add", "新增引擎");
		const form = editor.presentation();
		expect(rows(form).map((row) => row.key)).toContain("workspace");
	});

	it("edits a draft, tests it, saves it, and returns to the list", async () => {
		const { service, saveEngine, testEngine } = createMockService();
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		await press(editor.presentation(), "add", "新增引擎");
		const form = editor.presentation();
		await change(form, "name", "New Engine");
		await change(form, "model", "model-abc");
		await change(form, "secret", "secret-ref");
		await press(form, "test", "测试连接");
		expect(testEngine).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "New Engine",
				kind: "llm",
				model: "model-abc",
				secretId: "secret-ref",
			}),
		);
		expect(Notice).toHaveBeenCalledWith("AI 文本连接测试成功");
		await press(form, "configuration", "保存配置");
		expect(saveEngine).toHaveBeenCalledWith(expect.objectContaining({ name: "New Engine" }));
		expect(editor.presentation().snapshot.groups[0]?.heading).toBe("服务类型");
	});

	it("edits and deletes an existing engine through semantic actions", async () => {
		const { service, saveEngine, deleteEngine } = createMockService([llm]);
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		await press(editor.presentation(), "engine-eng-1", "编辑");
		const form = editor.presentation();
		await change(form, "name", "Renamed Engine");
		await press(form, "configuration", "保存配置");
		expect(saveEngine).toHaveBeenCalledWith(
			expect.objectContaining({ id: "eng-1", name: "Renamed Engine" }),
		);
		await press(editor.presentation(), "engine-eng-1", "删除");
		expect(deleteEngine).toHaveBeenCalledWith("eng-1");
	});

	it("applies provider presets when the provider changes", async () => {
		const { service, saveEngine } = createMockService([llm]);
		const editor = new AiSettingsEditor(service, () => "zh", vi.fn());
		await press(editor.presentation(), "engine-eng-1", "编辑");
		const form = editor.presentation();
		const provider = rows(form).find((row) => row.key === "provider")?.controls[0];
		if (provider?.kind !== "select") throw new Error("Missing provider select");
		await form.invoke({ action: provider.action, value: "bailian" });
		await press(editor.presentation(), "configuration", "保存配置");
		expect(saveEngine).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "bailian",
				baseUrl: "",
				model: "",
				secretId: "",
			}),
		);
	});
});
