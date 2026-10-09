import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError } from "../../../../../core/net/types";
import { type PronunciationSettings } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import {
	PronunciationProviderError,
	createPronunciationRequestDescriptor,
	synthesizeAzureSpeech,
	synthesizeOpenAiSpeech,
	type PronunciationRequester,
} from "../providers";

function makeSettings(overrides: Partial<PronunciationSettings> = {}): PronunciationSettings {
	return {
		...DEFAULT_SETTINGS.pronunciation,
		onlineProvider: "azure",
		...overrides,
	};
}

function successfulRequester(): ReturnType<typeof vi.fn<PronunciationRequester>> {
	return vi.fn<PronunciationRequester>().mockResolvedValue({
		status: 200,
		text: "",
		arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
		headers: { "Content-Type": "audio/mpeg; charset=binary" },
	});
}

describe("pronunciation providers", () => {
	it("builds the Azure China endpoint, voice, escaped SSML, and slow rate", async () => {
		const settings = makeSettings({
			accent: "en-GB",
			rate: "slow",
			azureCloud: "china",
			azureRegion: "ChinaNorth2",
		});
		const descriptor = createPronunciationRequestDescriptor("rock & roll", settings);
		const requester = successfulRequester();
		if (!descriptor) throw new Error("Expected descriptor");

		const audio = await synthesizeAzureSpeech(
			{ request: requester },
			descriptor,
			settings,
			"azure-secret",
		);

		expect(audio).toMatchObject({ mimeType: "audio/mpeg", source: "azure" });
		expect(requester).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://chinanorth2.tts.speech.azure.cn/cognitiveservices/v1",
				method: "POST",
				headers: expect.objectContaining({
					"Ocp-Apim-Subscription-Key": "azure-secret",
				}),
			}),
		);
		const request = requester.mock.calls[0]![0];
		expect(request.body).toContain('name="en-GB-SoniaNeural"');
		expect(request.body).toContain('rate="-25%"');
		expect(request.body).toContain("rock &amp; roll");
	});

	it("uses the global Azure endpoint and rejects unsupported China regions", async () => {
		const globalSettings = makeSettings({
			azureCloud: "global",
			azureRegion: "eastus",
		});
		const descriptor = createPronunciationRequestDescriptor("hello", globalSettings);
		const requester = successfulRequester();
		if (!descriptor) throw new Error("Expected descriptor");
		await synthesizeAzureSpeech({ request: requester }, descriptor, globalSettings, "secret");
		expect(requester.mock.calls[0]![0].url).toBe(
			"https://eastus.tts.speech.microsoft.com/cognitiveservices/v1",
		);

		const chinaSettings = makeSettings({ azureRegion: "eastus" });
		const chinaDescriptor = createPronunciationRequestDescriptor("hello", chinaSettings);
		if (!chinaDescriptor) throw new Error("Expected descriptor");
		await expect(
			synthesizeAzureSpeech({ request: requester }, chinaDescriptor, chinaSettings, "secret"),
		).rejects.toBeInstanceOf(PronunciationProviderError);
	});

	it("uses the official OpenAI endpoint, requested model, voice, accent instruction, and speed", async () => {
		const settings = makeSettings({
			onlineProvider: "openai",
			accent: "en-US",
			rate: "slow",
		});
		const descriptor = createPronunciationRequestDescriptor("ice cream", settings);
		const requester = successfulRequester();
		if (!descriptor) throw new Error("Expected descriptor");

		await synthesizeOpenAiSpeech({ request: requester }, descriptor, "openai-secret");

		const request = requester.mock.calls[0]![0];
		expect(request.url).toBe("https://api.openai.com/v1/audio/speech");
		expect(request.headers).toEqual({
			Authorization: "Bearer openai-secret",
			"Content-Type": "application/json",
		});
		const body = JSON.parse(typeof request.body === "string" ? request.body : "{}");
		expect(body).toMatchObject({
			model: "gpt-4o-mini-tts",
			voice: "marin",
			input: "ice cream",
			response_format: "mp3",
			speed: 0.75,
		});
		expect(body.instructions).toContain("American English");
	});

	it("surfaces provider status codes without exposing request content", async () => {
		const settings = makeSettings();
		const descriptor = createPronunciationRequestDescriptor("hello", settings);
		if (!descriptor) throw new Error("Expected descriptor");
		const requester = vi
			.fn<PronunciationRequester>()
			.mockRejectedValue(new TransportError("rate-limited", { httpStatus: 429 }));

		await expect(
			synthesizeAzureSpeech({ request: requester }, descriptor, settings, "secret"),
		).rejects.toMatchObject({ code: "rate-limited", httpStatus: 429 });
	});

	it("uses the system's British locale for cloud fallback when accent follows system", () => {
		const descriptor = createPronunciationRequestDescriptor(
			"hello",
			makeSettings({ accent: "system" }),
			"en-GB",
		);
		expect(descriptor?.accent).toBe("en-GB");
		expect(descriptor?.variant).toContain("en-GB-SoniaNeural");
	});
});
