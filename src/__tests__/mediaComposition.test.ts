import { describe, expect, it, vi } from "vite-plus/test";
import { AiService, type AiEngineConfig } from "../core/ai";
import { DEFAULT_SETTINGS } from "../core/host/settingsSlices";
import type { OutboundPort, OutboundResponse } from "../core/net/types";
import { WorkbenchStore } from "../core/storage/workbenchStore";
import { createVideoShadowingServices, sanitizeTranscriptCues } from "../features/mediaComposition";
import { TranslationRuntime } from "../features/translation/domain/translationRuntime";
import {
	VideoSubtitleJobs,
	type ShadowSubtitleStore,
} from "../features/video-player/domain/shadowSubtitlesJobs";

function response(text: string): OutboundResponse {
	return {
		status: 200,
		text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
	};
}

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

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
	const services = createVideoShadowingServices({ ai, store, net });
	return { ai, engine, store, services, request, net };
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

describe("composed video transcription", () => {
	it("rejects configuration changes between a task's earlier check and actual transcription", async () => {
		const { ai, store, services, request } = setup();
		try {
			const settings = store.getSettings();
			await store.saveSettings({
				...settings,
				audioPractice: {
					...settings.audioPractice,
					provider: "openai-compatible",
					openaiSecretId: "speech-key",
					openaiModel: "original-model",
				},
			});
			request.mockResolvedValue({
				status: 200,
				text: JSON.stringify({ segments: [{ start: 0, end: 1, text: "Hello" }] }),
			});
			const accepted = await services.getTranscriptionSignature("openai-compatible");
			const current = store.getSettings();
			await store.saveSettings({
				...current,
				audioPractice: { ...current.audioPractice, openaiModel: "replacement-model" },
			});
			await expect(
				services.transcribe(
					new ArrayBuffer(1),
					"openai-compatible",
					accepted,
					new AbortController().signal,
				),
			).rejects.toThrow("转写配置已变化");
			expect(request).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("dispatches with the same configuration used for the accepted identity", async () => {
		const { ai, store, services, request } = setup();
		try {
			const settings = store.getSettings();
			await store.saveSettings({
				...settings,
				audioPractice: {
					...settings.audioPractice,
					openaiBaseUrl: "https://speech.example/v1",
					openaiSecretId: "speech-key",
					openaiModel: "speech-model",
				},
			});
			request.mockResolvedValue({
				status: 200,
				text: JSON.stringify({ segments: [{ start: 0, end: 1, text: "Hello" }] }),
			});
			const accepted = await services.getTranscriptionSignature("openai-compatible");
			await expect(
				services.transcribe(
					new ArrayBuffer(1),
					"openai-compatible",
					accepted,
					new AbortController().signal,
				),
			).resolves.toEqual([{ start: 0, end: 1, text: "Hello" }]);
			expect(request).toHaveBeenCalledOnce();
			const sent = request.mock.calls[0]![0];
			expect(sent.url).toBe("https://speech.example/v1/audio/transcriptions");
			expect(new TextDecoder().decode(sent.body as ArrayBuffer)).toContain("speech-model");
		} finally {
			ai.dispose();
		}
	});
});

describe("sanitizeTranscriptCues", () => {
	it("preserves valid cues and trims surrounding whitespace", () => {
		const result = sanitizeTranscriptCues([
			{ start: 0, end: 1.5, text: "  Hello world  " },
			{ start: 1.5, end: 3.25, text: "Second sentence." },
		]);
		expect(result).toEqual([
			{ start: 0, end: 1.5, text: "Hello world" },
			{ start: 1.5, end: 3.25, text: "Second sentence." },
		]);
	});

	it("filters out cues with null timestamps or non-finite numbers", () => {
		const result = sanitizeTranscriptCues([
			{ start: null, end: 1.0, text: "Null start" },
			{ start: 1.0, end: null, text: "Null end" },
			{ start: NaN, end: 2.0, text: "NaN start" },
			{ start: 2.0, end: Number.POSITIVE_INFINITY, text: "Infinite end" },
			{ start: 3.0, end: 4.0, text: "Valid" },
		]);
		expect(result).toEqual([{ start: 3.0, end: 4.0, text: "Valid" }]);
	});

	it("filters out cues with negative start or zero/inverted duration", () => {
		const result = sanitizeTranscriptCues([
			{ start: -0.5, end: 1.0, text: "Negative start" },
			{ start: 2.0, end: 2.0, text: "Zero duration" },
			{ start: 3.5, end: 3.0, text: "Inverted timing" },
			{ start: 4.0, end: 5.0, text: "Valid timing" },
		]);
		expect(result).toEqual([{ start: 4.0, end: 5.0, text: "Valid timing" }]);
	});

	it("filters out cues with empty or whitespace-only text", () => {
		const result = sanitizeTranscriptCues([
			{ start: 0, end: 1.0, text: "" },
			{ start: 1.0, end: 2.0, text: "   \t\n  " },
			{ start: 2.0, end: 3.0, text: "Non-empty" },
		]);
		expect(result).toEqual([{ start: 2.0, end: 3.0, text: "Non-empty" }]);
	});

	it("returns empty array when given empty cues", () => {
		expect(sanitizeTranscriptCues([])).toEqual([]);
	});
});
