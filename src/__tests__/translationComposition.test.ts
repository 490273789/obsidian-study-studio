import { describe, expect, it, vi } from "vite-plus/test";
import { AiService, type AiEngineConfig } from "../core/ai";
import { DEFAULT_SETTINGS } from "../core/host/settingsSlices";
import type { OutboundPort, OutboundResponse } from "../core/net/types";
import { WorkbenchStore } from "../core/storage/workbenchStore";
import { createWorkbenchModules } from "../features";
import type { VideoShadowingServices } from "../features/video-player/feature";
import { TranslationRuntime } from "../features/translation/domain/translationRuntime";
import {
	VideoSubtitleJobs,
	type ShadowSubtitleStore,
} from "../features/video-player/domain/shadowSubtitlesJobs";

const composition = vi.hoisted(() => ({ video: vi.fn() }));

function response(text: string): OutboundResponse {
	return {
		status: 200,
		text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
	};
}

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
vi.mock("../features/flashcards/feature", () => ({
	createFlashcardFeature: () => ({ sourceEditAdapter: {} }),
}));
vi.mock("../features/translation/feature", () => ({
	createTranslationFeature: () => ({ selectionAdapter: {} }),
}));
vi.mock("../features/dictionary/feature", () => ({
	createDictionaryFeature: () => ({ selectionAdapter: {} }),
}));
vi.mock("../features/dictionary/ui/SelectionDictionaryResultContent", () => ({
	SelectionDictionaryResultContent: () => null,
}));
vi.mock("../features/video-player/feature", () => ({
	createVideoPlayerFeature: composition.video,
}));
vi.mock("../features/audio-practice/feature", () => ({ createAudioPracticeFeature: () => ({}) }));
vi.mock("../core/selectionHelper/module", () => ({ createSelectionHelperModule: () => ({}) }));

function setup() {
	const engine: AiEngineConfig = {
		id: "engine",
		name: "Engine",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		secretId: "engine-key",
		model: "original-model",
	};
	const settings = {
		...DEFAULT_SETTINGS,
		ai: { configs: [engine], defaultConfigId: engine.id },
		translation: {
			...DEFAULT_SETTINGS.translation,
			enabled: true,
			profiles: [
				{
					id: "profile",
					name: "Profile",
					enabled: true,
					kind: "engine" as const,
					configId: engine.id,
				},
			],
		},
	};
	const store = new WorkbenchStore(
		{ loadData: async () => null, saveData: async () => {} },
		settings,
	);
	const request = vi.fn<OutboundPort["request"]>().mockResolvedValue(response("译文"));
	const net: OutboundPort = {
		request,
		readSecret: () => "test-credential",
		requestHostPinned: vi.fn(),
	};
	const ai = new AiService(settings.ai, {
		net,
		persist: async (ai) => store.saveSettings({ ...store.getSettings(), ai }),
		createId: () => "new-engine",
	});
	composition.video.mockClear();
	createWorkbenchModules({ ai, store, net, plugin: {} as never });
	const services = composition.video.mock.calls[0]![0].shadowing as VideoShadowingServices;
	return { ai, engine, store, services, request };
}

describe("composed video translation", () => {
	it.each<[string, Partial<AiEngineConfig>]>([
		["model", { model: "replacement-model" }],
		["endpoint", { baseUrl: "https://replacement.example/v1" }],
		["provider", { provider: "bailian" }],
		["credential reference", { secretId: "replacement-key" }],
	])(
		"changes the task signature when the same engine ID changes its %s",
		async (_field, patch) => {
			const { ai, engine, services, request } = setup();
			try {
				const accepted = services.getTranslationSignature("profile");
				await ai.saveConfig({ ...engine, ...patch });
				expect(services.getTranslationSignature("profile")).not.toBe(accepted);
				expect(request).not.toHaveBeenCalled();
			} finally {
				ai.dispose();
			}
		},
	);

	it("changes the task signature when thinking changes", async () => {
		const { ai, store, services } = setup();
		try {
			const accepted = services.getTranslationSignature("profile");
			const settings = store.getSettings();
			await store.saveSettings({
				...settings,
				translation: { ...settings.translation, thinkingEnabled: true },
			});
			expect(services.getTranslationSignature("profile")).not.toBe(accepted);
		} finally {
			ai.dispose();
		}
	});

	it("uses the same translation rules for the translator and video without sharing their session", async () => {
		const { ai, store, services, request } = setup();
		const runtime = new TranslationRuntime(
			{ ...store.getSettings().translation, direction: "en-zh", thinkingEnabled: true },
			ai,
			{ persist: async () => {}, youdao: vi.fn() },
		);
		try {
			const settings = store.getSettings();
			await store.saveSettings({
				...settings,
				translation: { ...settings.translation, thinkingEnabled: true },
			});
			runtime.setInput("Hello");
			await runtime.translate();
			const signature = services.getTranslationSignature("profile");
			await expect(
				services.translate("Hello", "profile", signature, new AbortController().signal),
			).resolves.toBe("译文");
			expect(request).toHaveBeenCalledTimes(2);
			expect(request.mock.calls[1]![0].body).toBe(request.mock.calls[0]![0].body);
			expect(runtime.getSnapshot().input).toBe("Hello");
		} finally {
			runtime.dispose();
			ai.dispose();
		}
	});

	it("checks the accepted signature again when execution follows an earlier configuration check", async () => {
		const { ai, store, services, request } = setup();
		try {
			const accepted = services.getTranslationSignature("profile");
			const settings = store.getSettings();
			await store.saveSettings({
				...settings,
				translation: { ...settings.translation, promptTemplate: "A different prompt" },
			});
			await expect(
				services.translate("Hello", "profile", accepted, new AbortController().signal),
			).rejects.toThrow("翻译配置已变化");
			expect(request).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("stops queued cues after an engine change and preserves already accepted translations", async () => {
		const { ai, engine, services, request } = setup();
		let finish!: (response: OutboundResponse) => void;
		request.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const store: ShadowSubtitleStore = {
			load: async () => null,
			save: async () => {},
			loadCheckpoints: () => [],
			saveCheckpoints: () => {},
		};
		const jobs = new VideoSubtitleJobs({
			store,
			extract: vi.fn(),
			transcribe: vi.fn(),
			serviceSignature: () => services.getTranslationSignature("profile"),
			translate: (text, task, signal) =>
				services.translate(text, "profile", task.config.serviceSignature, signal),
		});
		try {
			await jobs.importSubtitles(
				"video",
				"1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond",
				"srt",
			);
			await jobs.adoptCandidate("video");
			const source = { id: "video", path: "/video.mp4" };
			const pending = jobs.translateSubtitles(source, {
				sourceSignature: "source",
				serviceSignature: services.getTranslationSignature("profile"),
			});
			await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
			await ai.saveConfig({ ...engine, model: "replacement-model" });
			finish(response("第一句原配置译文"));
			await pending;
			expect(request).toHaveBeenCalledTimes(1);
			expect(jobs.getCues("video").map((cue) => cue.translation)).toEqual([
				"第一句原配置译文",
				"",
			]);
			expect(jobs.getSnapshot().translationFailures.video).toContain("翻译配置已变化");
			await expect(jobs.retryTranslation("video")).rejects.toThrow("配置已变化");
			await jobs.translateSubtitles(source, {
				sourceSignature: "source",
				serviceSignature: services.getTranslationSignature("profile"),
			});
			expect(request).toHaveBeenCalledTimes(2);
			expect(jobs.getCues("video").map((cue) => cue.translation)).toEqual([
				"第一句原配置译文",
				"译文",
			]);
			expect(jobs.getSnapshot().translationFailures.video).toBeUndefined();
		} finally {
			jobs.dispose();
			ai.dispose();
		}
	});
});
