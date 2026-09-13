import { describe, expect, it, vi } from "vitest";
import type { SettingsPresentation } from "../../settings/presentation";
import {
	buildAiSettingsViewModel,
	type AiEditorActions,
	type AiEditorState,
} from "../aiSettingsViewModel";

function setup(view: "list" | "form" = "form") {
	const draft = {
		id: "saved",
		name: "Translate",
		provider: "deepseek" as const,
		baseUrl: "https://api.deepseek.com",
		secretId: "secret-id",
		model: "deepseek-v4-flash",
	};
	const state: AiEditorState = {
		draft,
		view,
		draftIsNew: false,
		saving: false,
		models: [],
		snapshot: {
			settings: { configs: [draft], defaultConfigId: "saved" },
			models: {},
			loadingModels: [],
			testing: [],
		},
	};
	const actions: AiEditorActions = {
		select: vi.fn(),
		add: vi.fn(),
		toAdd: vi.fn(),
		toEdit: vi.fn(),
		back: vi.fn(),
		patch: vi.fn(),
		provider: vi.fn(),
		selectModel: vi.fn(),
		setDefault: vi.fn(),
		save: vi.fn(),
		remove: vi.fn(),
		loadModels: vi.fn(),
		test: vi.fn(),
	};
	return { state, actions };
}

const rows = (presentation: SettingsPresentation) =>
	presentation.snapshot.groups.flatMap((g) => g.rows);

describe("AI settings presentation", () => {
	it("presents configured engines and dispatches list actions", async () => {
		const { state, actions } = setup("list");
		const presentation = buildAiSettingsViewModel(state, actions, "zh");
		expect(presentation.snapshot.groups[0]?.heading).toBe("AI 引擎");
		const add = rows(presentation).find((row) => row.name === "已配置引擎")?.controls[0];
		const engine = rows(presentation).find((row) => row.name.includes("Translate"));
		expect(engine?.description).toContain("DeepSeek");
		const edit = engine?.controls.find(
			(control) => control.kind === "button" && control.label === "编辑",
		);
		const remove = engine?.controls.find(
			(control) => control.kind === "button" && control.label === "删除",
		);
		if (add?.kind !== "button" || edit?.kind !== "button" || remove?.kind !== "button") {
			throw new Error("Expected engine actions");
		}
		await presentation.invoke({ action: add.action, value: undefined });
		await presentation.invoke({ action: edit.action, value: undefined });
		await presentation.invoke({ action: remove.action, value: undefined });
		expect(actions.toAdd).toHaveBeenCalledOnce();
		expect(actions.toEdit).toHaveBeenCalledWith("saved");
		expect(actions.remove).toHaveBeenCalledWith("saved");
	});

	it("keeps manual model input and saves through semantic actions", async () => {
		const { state, actions } = setup("form");
		const presentation = buildAiSettingsViewModel(state, actions, "zh");
		const input = rows(presentation).find((row) => row.name === "模型 ID")?.controls[0];
		const save = rows(presentation)
			.flatMap((row) => row.controls)
			.find((control) => control.kind === "button" && control.label === "保存配置");
		if (input?.kind !== "text" || save?.kind !== "button") throw new Error("Missing controls");
		await presentation.invoke({ action: input.action, value: "custom-model" });
		await presentation.invoke({ action: save.action, value: undefined });
		expect(actions.patch).toHaveBeenCalledWith({ model: "custom-model" });
		expect(actions.save).toHaveBeenCalledOnce();
	});

	it("presents secrets, testing and back navigation without callbacks in the snapshot", async () => {
		const { state, actions } = setup("form");
		state.draftIsNew = true;
		const presentation = buildAiSettingsViewModel(state, actions, "en");
		const secret = rows(presentation).find((row) => row.name === "API Key")?.controls[0];
		const test = rows(presentation).find((row) => row.name === "Test connection")?.controls[0];
		const back = rows(presentation).find((row) => row.name === "Back to list")?.controls[0];
		expect(secret).toMatchObject({ kind: "secret", value: "secret-id" });
		if (test?.kind !== "button" || back?.kind !== "button") throw new Error("Missing actions");
		await presentation.invoke({ action: test.action, value: undefined });
		await presentation.invoke({ action: back.action, value: undefined });
		expect(actions.test).toHaveBeenCalledOnce();
		expect(actions.back).toHaveBeenCalledOnce();
		expect(JSON.stringify(presentation.snapshot)).not.toContain("onClick");
	});
});
