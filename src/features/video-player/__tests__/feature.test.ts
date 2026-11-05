import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Notice } from "obsidian";
import type { AiEngineConfig, AiService } from "../../../core/ai";
import { AI_ENGINE_SECTION_ID } from "../../../core/host/sectionIds";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import {
	createVideoPlayerFeature,
	VIDEO_PLAYER_SECTION_ID,
	VIEW_TYPE_VIDEO_PLAYER,
} from "../feature";
import { videoPlayerStrings } from "../strings/videoPlayer";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	Platform: { resourcePathPrefix: "app://vault/" },
}));

const shadowingServices = {
	transcribe: vi.fn(async () => []),
	translate: vi.fn(async () => ""),
	getSignature: vi.fn(async () => "configured"),
	listTranslationProfiles: () => [],
};

const engineRegistry: AiEngineConfig[] = [
	{
		id: "llm-1",
		kind: "llm",
		name: "Text engine",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		secretId: "llm-key",
		model: "deepseek-chat",
	},
	{
		id: "engine-a",
		kind: "asr",
		name: "Bailian ASR",
		provider: "bailian",
		baseUrl: "",
		workspaceId: "",
		workspaceSecretId: "",
		secretId: "bailian-key",
		model: "fun-asr",
	},
	{
		id: "engine-b",
		kind: "asr",
		name: "Compatible ASR",
		provider: "openai-compatible",
		baseUrl: "https://api.example.com/v1",
		workspaceId: "",
		workspaceSecretId: "",
		secretId: "compatible-key",
		model: "whisper-1",
	},
];

function createFakeAi(): { ai: AiService; listeners: Set<() => void> } {
	const listeners = new Set<() => void>();
	const ai = {
		getSnapshot: () => ({
			settings: { engines: engineRegistry, defaults: { llm: "llm-1", asr: "engine-a" } },
			models: {},
			loadingModels: [],
			testing: [],
		}),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	} as unknown as AiService;
	return { ai, listeners };
}

describe("video player feature", () => {
	beforeEach(() => vi.mocked(Notice).mockClear());

	it("registers a main-tab catalog entry, view, and settings section", async () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const feature = createVideoPlayerFeature();

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([VIEW_TYPE_VIDEO_PLAYER]);
		const entry = fake.catalog.get("video-player")!;
		expect(entry.title("zh")).toBe(videoPlayerStrings("zh").title);
		expect(entry.openCommandId).toBe("open-local-video-player");
		expect(entry.shortcutKey).toBe("videoPlayer");
		expect(entry.settingsSectionId).toBe(VIDEO_PLAYER_SECTION_ID);
		expect(entry.available()).toBe(true);
		expect(fake.ribbons).toEqual([]);
		expect(fake.sections.get(VIDEO_PLAYER_SECTION_ID)!.order).toBe(4);

		entry.open();
		await vi.waitFor(() => {
			expect(fake.activateView).toHaveBeenCalledWith(VIEW_TYPE_VIDEO_PLAYER, {
				mainTab: true,
			});
		});

		feature.stop();
	});

	it("hides its catalog entry when disabled", () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost(
			"videoPlayer",
			{
				...DEFAULT_SETTINGS,
				videoPlayer: { ...DEFAULT_SETTINGS.videoPlayer, enabled: false },
			},
			app,
		);
		const feature = createVideoPlayerFeature();

		feature.render(fake.host);
		expect(fake.catalog.get("video-player")!.available()).toBe(false);

		feature.stop();
	});

	it("starts shared shadowing services before any player window is mounted", () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			vault: { adapter: {} },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const feature = createVideoPlayerFeature({
			shadowing: {
				transcribe: vi.fn(async () => []),
				translate: vi.fn(async () => ""),
				getSignature: vi.fn(async () => "configured"),
				listTranslationProfiles: () => [],
			},
		});
		feature.render(fake.host);
		expect(fake.views.has(VIEW_TYPE_VIDEO_PLAYER)).toBe(true);
		feature.stop();
	});

	it("offers the shared ASR engines and the AI engine settings entry", async () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			vault: { adapter: {} },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const { ai, listeners } = createFakeAi();
		const feature = createVideoPlayerFeature({ ai, shadowing: shadowingServices });
		feature.render(fake.host);

		const section = fake.sections.get(VIDEO_PLAYER_SECTION_ID)!;
		const presentation = section.presentation("zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);

		const engineSelect = rows.find((row) => row.key === "transcription-engine")?.controls[0];
		if (engineSelect?.kind !== "select") throw new Error("Expected ASR engine select");
		expect(engineSelect.options).toEqual([
			{ value: "", label: expect.any(String) },
			{ value: "engine-a", label: "Bailian ASR" },
			{ value: "engine-b", label: "Compatible ASR" },
		]);

		const openAiSettings = rows.find((row) => row.key === "open-ai-settings")?.controls[0];
		if (openAiSettings?.kind !== "button") throw new Error("Expected AI settings button");
		await presentation.invoke({ action: openAiSettings.action, value: undefined });
		expect(fake.settingsTab.open).toHaveBeenCalledWith(AI_ENGINE_SECTION_ID);

		for (const listener of listeners) listener();
		expect(fake.settingsTab.refresh).toHaveBeenCalledWith(VIDEO_PLAYER_SECTION_ID);

		feature.stop();
		expect(listeners.size).toBe(0);
	});

	it("hides the shadowing group without shared shadowing services", () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const { ai } = createFakeAi();
		const feature = createVideoPlayerFeature({ ai });
		feature.render(fake.host);

		const presentation = fake.sections.get(VIDEO_PLAYER_SECTION_ID)!.presentation("zh");
		expect(presentation.snapshot.groups.map((group) => group.key)).not.toContain("shadowing");
		feature.stop();
	});
});
