import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Headphones } from "lucide-react";
import type { AiEngineConfig, AiService } from "../../../core/ai";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { AI_ENGINE_SECTION_ID } from "../../../core/host/sectionIds";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import { WorkbenchStore } from "../../../core/storage/workbenchStore";
import { AUDIO_PRACTICE_VIEW, createAudioPracticeFeature } from "../feature";
import { audioPracticeStrings } from "../strings/audioPractice";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	TFile: class {},
}));

vi.mock("../../../core/host/reactItemView", () => ({
	createReactItemView: vi.fn((definition: unknown) => definition),
}));

function createApp() {
	return {
		workspace: { getLeavesOfType: () => [] },
		vault: {
			getFiles: () => [],
			getAbstractFileByPath: () => null,
			getResourcePath: () => "",
			on: () => ({}),
			offref: () => {},
			read: async () => "",
			readBinary: async () => new ArrayBuffer(0),
			create: async () => {},
		},
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

const asrEngines: AiEngineConfig[] = [
	{
		id: "asr-bailian",
		kind: "asr",
		name: "百炼语音识别",
		provider: "bailian",
		baseUrl: "",
		workspaceId: "workspace",
		workspaceSecretId: "",
		secretId: "secret",
		model: "fun-asr-flash-2026-06-15",
	},
	{
		id: "asr-gateway",
		kind: "asr",
		name: "OpenAI 兼容语音识别",
		provider: "openai-compatible",
		baseUrl: "https://gateway.test/v1",
		workspaceId: "",
		workspaceSecretId: "",
		secretId: "gateway-secret",
		model: "whisper-1",
	},
	{
		id: "llm-deepseek",
		kind: "llm",
		name: "DeepSeek",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		secretId: "deepseek-secret",
		model: "deepseek-v4-flash",
	},
];

function createAi(engines: readonly AiEngineConfig[] = asrEngines) {
	const listeners = new Set<() => void>();
	const snapshot = {
		settings: {
			engines,
			defaults: { llm: null, asr: null },
		},
		models: {},
		loadingModels: [],
		testing: [],
	};
	const ai = {
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return {
		ai: ai as unknown as AiService,
		emit: () => {
			for (const listener of Array.from(listeners)) listener();
		},
		listeners,
	};
}

function createFeature(engines: readonly AiEngineConfig[] = asrEngines) {
	const store = new WorkbenchStore({
		loadData: async () => null,
		saveData: async () => {},
	});
	const fakeAi = createAi(engines);
	const feature = createAudioPracticeFeature({
		ai: fakeAi.ai,
		store,
		net: { readSecret: vi.fn(() => null) } as never,
	});
	return { feature, app: createApp(), fakeAi };
}

function audioSettings(enabled: boolean) {
	return {
		...DEFAULT_SETTINGS,
		audioPractice: { ...DEFAULT_SETTINGS.audioPractice, enabled },
	};
}

describe("audio practice feature", () => {
	beforeEach(() => {
		vi.stubGlobal("window", {});
	});

	it("registers its view, catalog entry, and settings section", () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([AUDIO_PRACTICE_VIEW]);
		const entry = fake.catalog.get("audio-practice")!;
		expect(entry.title("zh")).toBe(audioPracticeStrings("zh").title);
		expect(entry.icon).toBe(Headphones);
		expect(entry.openCommandId).toBe("open-audio-practice");
		expect(entry.shortcutKey).toBe("audioPractice");
		expect(entry.settingsSectionId).toBe("audio-practice");
		expect(entry.available()).toBe(true);
		expect(fake.sections.get("audio-practice")!.order).toBe(5);

		entry.open();
		expect(fake.activateView).toHaveBeenCalledWith(AUDIO_PRACTICE_VIEW, { mainTab: true });

		feature.stop();
	});

	it("hides its catalog entry when the feature is disabled", () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(false), app);

		feature.render(fake.host);

		expect(fake.catalog.get("audio-practice")!.available()).toBe(false);
		feature.stop();
	});

	it("presents only the registered ASR engines from the shared AI registry", () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);

		feature.render(fake.host);

		const presentation = fake.sections.get("audio-practice")!.presentation("zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);
		const engine = rows.find((row) => row.key === "engine")?.controls[0];
		if (engine?.kind !== "select") throw new Error("Expected an engine select");
		expect(engine.options).toEqual([
			{ value: "", label: "默认引擎（使用 AI 引擎设置中的默认项）" },
			{ value: "asr-bailian", label: "百炼语音识别" },
			{ value: "asr-gateway", label: "OpenAI 兼容语音识别" },
		]);
		expect(rows.map((row) => row.key)).toEqual(["enabled", "engine", "open-ai-settings"]);

		feature.stop();
	});

	it("writes the selection into the audioPractice slice only", async () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);
		feature.render(fake.host);

		const presentation = fake.sections.get("audio-practice")!.presentation("zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);
		const engine = rows.find((row) => row.key === "engine")?.controls[0];
		if (engine?.kind !== "select") throw new Error("Expected an engine select");
		await presentation.invoke({ action: engine.action, value: "asr-gateway" });

		expect(fake.updateSettings).toHaveBeenCalledWith({
			audioPractice: { enabled: true, transcriptionEngineId: "asr-gateway" },
		});

		feature.stop();
	});

	it("opens the shared AI engine section from its settings", async () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);
		feature.render(fake.host);

		const presentation = fake.sections.get("audio-practice")!.presentation("zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);
		const button = rows.find((row) => row.key === "open-ai-settings")?.controls[0];
		if (button?.kind !== "button") throw new Error("Expected the AI settings button");
		await presentation.invoke({ action: button.action, value: undefined });

		expect(fake.settingsTab.open).toHaveBeenCalledWith(AI_ENGINE_SECTION_ID);

		feature.stop();
	});

	it("refreshes its section while the AI registry changes and stops when hidden", () => {
		const { feature, app, fakeAi } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);
		feature.render(fake.host);

		const section = fake.sections.get("audio-practice")!;
		section.activate?.();
		section.activate?.();
		expect(fakeAi.listeners.size).toBe(1);

		fakeAi.emit();
		expect(fake.settingsTab.refresh).toHaveBeenCalledTimes(1);
		expect(fake.settingsTab.refresh).toHaveBeenCalledWith("audio-practice");

		section.hide?.();
		fakeAi.emit();
		expect(fake.settingsTab.refresh).toHaveBeenCalledTimes(1);
		expect(fakeAi.listeners.size).toBe(0);

		feature.stop();
	});
});
