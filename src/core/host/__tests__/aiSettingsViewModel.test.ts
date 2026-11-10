import { describe, expect, it, vi } from "vite-plus/test";
import type { SettingsPresentation } from "../../settings/presentation";
import type { AiEngineConfig, AiEngineKind, AiService } from "../../ai";
import {
	buildAiSettingsViewModel,
	type AiSettingsHost,
	type AiViewMode,
} from "../aiSettingsViewModel";

const llm: AiEngineConfig = {
	id: "saved",
	kind: "llm",
	name: "Translate",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	secretId: "secret-id",
	model: "deepseek-v4-flash",
};
const asr: AiEngineConfig = {
	id: "asr",
	kind: "asr",
	name: "Speech",
	provider: "bailian",
	baseUrl: "",
	workspaceId: "",
	workspaceSecretId: "workspace-secret",
	secretId: "asr-secret",
	model: "fun-asr-flash-2026-06-15",
};

function setup(kind: AiEngineKind = "llm", view: AiViewMode = "list"): AiSettingsHost {
	const draft = kind === "llm" ? llm : asr;
	return {
		service: {
			getSnapshot: () => ({
				settings: {
					engines: [llm, asr],
					defaults: { llm: llm.id, asr: asr.id },
				},
				models: {},
				loadingModels: [],
				testing: [],
			}),
		} as unknown as AiService,
		currentKind: kind,
		currentView: view,
		currentDraft: draft,
		isDraftNew: false,
		availableModels: [],
		isSaving: false,
		setKind: vi.fn(),
		startAdd: vi.fn(),
		editEngine: vi.fn(),
		backToList: vi.fn(),
		patchDraft: vi.fn(),
		setProvider: vi.fn(),
		setDefaultEngine: vi.fn(),
		saveDraft: vi.fn(),
		deleteEngine: vi.fn(),
		loadModels: vi.fn(),
		testDraft: vi.fn(),
	};
}

const rows = (presentation: SettingsPresentation) =>
	presentation.snapshot.groups.flatMap((group) => group.rows);

describe("AI settings presentation", () => {
	it("groups every engine by service type and switches the visible list", async () => {
		const host = setup("llm");
		const presentation = buildAiSettingsViewModel(host, "zh");
		expect(presentation.snapshot.groups[0]?.heading).toBe("服务类型");
		const kinds = rows(presentation).find((row) => row.key === "kind")?.controls[0];
		if (kinds?.kind !== "choiceButtons") throw new Error("Missing kind tabs");
		expect(kinds.value).toBe("llm");
		expect(kinds.choices.map((choice) => choice.id)).toEqual(["llm", "asr", "translation"]);
		await presentation.invoke({ action: kinds.action, value: "asr" });
		expect(host.setKind).toHaveBeenCalledWith("asr");

		const texts = rows(presentation).map((row) => row.name);
		expect(texts.some((name) => name.includes("Translate"))).toBe(true);
		expect(texts.some((name) => name.includes("Speech"))).toBe(false);
	});

	it("uses distinct row names to prevent stutter against group headings", () => {
		const host = setup("llm");
		const presentation = buildAiSettingsViewModel(host, "zh");
		for (const group of presentation.snapshot.groups) {
			if (!group.heading) continue;
			for (const row of group.rows) {
				expect(row.name).not.toBe(group.heading);
			}
		}
	});

	it("presents the ASR engine list with its default and edits", async () => {
		const host = setup("asr");
		const presentation = buildAiSettingsViewModel(host, "zh");
		const engine = rows(presentation).find((row) => row.key === "engine-asr");
		expect(engine?.name).toContain("Speech");
		expect(engine?.name).toContain("默认");
		expect(engine?.description).toContain("当前默认引擎");
		const remove = engine?.controls.find(
			(control) => control.kind === "button" && control.label === "删除",
		);
		if (remove?.kind !== "button") throw new Error("Missing delete");
		expect(remove.tone).toBe("neutral");
		await presentation.invoke({ action: remove.action, value: undefined });
		expect(host.deleteEngine).toHaveBeenCalledWith("asr");
		const defaultSelect = rows(presentation).find((row) => row.key === "default")?.controls[0];
		expect(defaultSelect).toMatchObject({ kind: "select", value: "asr" });
	});

	it("shows type-specific fields instead of a shared credential form", () => {
		const llmHost = setup("llm", "form");
		const llmForm = buildAiSettingsViewModel(llmHost, "zh");
		expect(rows(llmForm).map((row) => row.key)).toEqual(
			expect.arrayContaining(["provider", "base-url", "secret", "model"]),
		);

		const asrHost = setup("asr", "form");
		const asrForm = buildAiSettingsViewModel(asrHost, "zh");
		expect(rows(asrForm).map((row) => row.key)).toEqual(
			expect.arrayContaining(["workspace", "model", "secret"]),
		);
		expect(rows(asrForm).map((row) => row.key)).not.toContain("app-key");
	});

	it("keeps the translation form credential-shaped and testable", async () => {
		const translation: AiEngineConfig = {
			id: "tr",
			kind: "translation",
			name: "Youdao",
			provider: "youdao",
			baseUrl: "https://openapi.youdao.com/api",
			appKeySecretId: "app-key",
			appSecretSecretId: "app-secret",
		};
		const host: AiSettingsHost = {
			...setup(),
			currentKind: "translation",
			currentDraft: translation,
			currentView: "form",
			isDraftNew: true,
			service: {
				getSnapshot: () => ({
					settings: { engines: [translation], defaults: { llm: null, asr: null } },
					models: {},
					loadingModels: [],
					testing: [],
				}),
			} as unknown as AiService,
		};
		const presentation = buildAiSettingsViewModel(host, "zh");
		const keys = rows(presentation).map((row) => row.key);
		expect(keys).toEqual(expect.arrayContaining(["app-key", "app-secret", "test"]));
		expect(keys).not.toContain("workspace");

		const test = rows(presentation).find((row) => row.key === "test")?.controls[0];
		if (test?.kind !== "button") throw new Error("Missing translation test");
		await presentation.invoke({ action: test.action, value: undefined });
		expect(host.testDraft).toHaveBeenCalledOnce();
	});

	it("keeps secrets and manual model input free of callbacks in the snapshot", async () => {
		const host = setup("llm", "form");
		const presentation = buildAiSettingsViewModel(host, "en");
		const secret = rows(presentation).find((row) => row.key === "secret")?.controls[0];
		const model = rows(presentation).find((row) => row.key === "model")?.controls[0];
		expect(secret).toMatchObject({ kind: "secret", value: "secret-id" });
		if (model?.kind !== "text") throw new Error("Missing model input");
		await presentation.invoke({ action: model.action, value: "custom-model" });
		expect(host.patchDraft).toHaveBeenCalledWith({ model: "custom-model" });
		expect(JSON.stringify(presentation.snapshot)).not.toContain("onClick");
	});
});
