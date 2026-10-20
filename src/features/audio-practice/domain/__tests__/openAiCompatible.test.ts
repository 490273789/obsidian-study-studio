import { describe, expect, it, vi } from "vite-plus/test";
import { AudioFailureError, type AudioFailure } from "../failures";
import { TransportError } from "../../../../core/net/types";
import type { OutboundPort } from "../../../../core/net/types";
import { buildMultipartBody } from "../transcription/multipart";
import {
	createOpenAiCompatibleProvider,
	parseOpenAiCompatibleResponse,
} from "../transcription/openAiCompatibleProvider";
import { createTranscriptionProvider } from "../transcription/providers";
import {
	openAiCompatibleAudioUrl,
	transcriptionConfigFingerprint,
	validateTranscriptionConfig,
} from "../transcription/transcriptionConfig";
import type { OpenAiCompatibleTranscriptionConfig } from "../transcriptionTypes";

const chunk = {
	index: 0,
	start: 0,
	end: 2,
	wav: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x80, 0xff]).buffer,
};
const config: OpenAiCompatibleTranscriptionConfig = {
	provider: "openai-compatible",
	baseUrl: "https://api.example.test/v1",
	secretId: "secret",
	model: "whisper-1",
};

function contains(bytes: Uint8Array, needle: readonly number[]): boolean {
	for (let start = 0; start <= bytes.length - needle.length; start++) {
		if (needle.every((value, offset) => bytes[start + offset] === value)) return true;
	}
	return false;
}

function failureOf(run: () => unknown): AudioFailure {
	try {
		run();
	} catch (error) {
		if (error instanceof AudioFailureError) return error.failure;
		throw error;
	}
	throw new Error("Expected an audio failure");
}

describe("OpenAI-compatible transcription", () => {
	it("reads top-level words and segment cues", () => {
		const transcript = parseOpenAiCompatibleResponse(
			JSON.stringify({
				text: "Hello world.",
				words: [
					{ word: "Hello", start: 0, end: 0.5 },
					{ word: " world.", start: 0.5, end: 1 },
				],
				segments: [{ id: 0, text: " Hello world.", start: 0, end: 1 }],
			}),
		);
		expect(transcript.cues).toMatchObject([
			{ text: "Hello world.", start: 0, end: 1, needsReview: true },
		]);
		expect(transcript.words).toHaveLength(2);
	});
	it("flattens word timestamps nested inside segments", () => {
		const transcript = parseOpenAiCompatibleResponse(
			JSON.stringify({
				segments: [
					{
						id: 0,
						text: "Hello world.",
						start: 0,
						end: 1,
						words: [
							{ word: "Hello", start: 0, end: 0.4 },
							{ word: "world.", start: 0.5, end: 1 },
						],
					},
				],
			}),
		);
		expect(transcript.words.map((word) => word.text)).toEqual(["Hello", "world."]);
	});
	it("builds cues from word timestamps when the service omits segments", () => {
		const transcript = parseOpenAiCompatibleResponse(
			JSON.stringify({
				text: "Hello world. Next one",
				words: [
					{ word: "Hello", start: 0, end: 0.4 },
					{ word: "world.", start: 0.4, end: 0.9 },
					{ word: "Next", start: 1.1, end: 1.4 },
					{ word: "one", start: 1.4, end: 1.8 },
				],
			}),
		);
		expect(transcript.cues.map((cue) => cue.text)).toEqual(["Hello world.", "Next one"]);
	});
	it("rejects responses without any timing instead of inventing subtitles", () => {
		expect(
			failureOf(() => parseOpenAiCompatibleResponse(JSON.stringify({ text: "Hello" }))),
		).toMatchObject({
			kind: "provider-failure",
			code: "invalid-response",
			reason: "missing-word-timestamps",
		});
	});
	it("never exposes raw malformed response fragments", () => {
		expect(
			failureOf(() => parseOpenAiCompatibleResponse('{"private-key":"sensitive" broken')),
		).toMatchObject({
			kind: "provider-failure",
			code: "invalid-response",
			reason: "invalid-payload",
		});
	});
	it("posts a binary multipart body to the standard endpoint", async () => {
		const request = vi.fn().mockResolvedValue({
			text: JSON.stringify({
				text: "Hello world.",
				words: [{ word: "Hello", start: 0, end: 0.5 }],
				segments: [{ text: "Hello world.", start: 0, end: 1 }],
			}),
		});
		const port = { request, readSecret: () => "private-key" } as unknown as OutboundPort;
		await createTranscriptionProvider(port)(chunk, config, new AbortController().signal);
		const spec = request.mock.calls[0]?.[0];
		expect(spec.url).toBe("https://api.example.test/v1/audio/transcriptions");
		expect(spec.headers.Authorization).toBe("Bearer private-key");
		expect(spec.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
		expect(spec.body).toBeInstanceOf(ArrayBuffer);
		const bytes = new Uint8Array(spec.body as ArrayBuffer);
		expect(contains(bytes, [0x52, 0x49, 0x46, 0x46, 0x80, 0xff])).toBe(true);
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('Content-Disposition: form-data; name="model"');
		expect(text).toContain("whisper-1");
		expect(text).toContain("verbose_json");
		expect(text).toContain('name="file"; filename="chunk.wav"');
		expect((text.match(/name="timestamp_granularities\[\]"/g) ?? []).length).toBe(2);
	});
	it("keeps multipart framing intact around the audio bytes", () => {
		const body = buildMultipartBody(
			[{ name: "model", value: "whisper-1" }],
			{
				name: "file",
				filename: "a.wav",
				contentType: "audio/wav",
				bytes: new Uint8Array([0x80, 0xff, 0x00]).buffer,
			},
			"B",
		);
		const text = new TextDecoder().decode(body);
		expect(text).toContain('--B\r\nContent-Disposition: form-data; name="model"');
		expect(text.endsWith("--B--\r\n")).toBe(true);
		expect(contains(new Uint8Array(body), [0x80, 0xff, 0x00])).toBe(true);
	});
	it("fails before any request when the secret is missing", async () => {
		const request = vi.fn();
		const port = { request, readSecret: () => null } as unknown as OutboundPort;
		await expect(
			createTranscriptionProvider(port)(chunk, config, new AbortController().signal),
		).rejects.toMatchObject({
			failure: { kind: "config-invalid", field: "secret" },
		});
		expect(request).not.toHaveBeenCalled();
	});
	it("maps transport failures without leaking response bodies", async () => {
		const request = vi
			.fn()
			.mockRejectedValue(new TransportError("unauthorized", { responseText: "private-key" }));
		const port = { request, readSecret: () => "private-key" } as unknown as OutboundPort;
		const provider = createOpenAiCompatibleProvider(port);
		await expect(provider(chunk, config, new AbortController().signal)).rejects.toMatchObject({
			failure: { kind: "provider-failure", code: "unauthorized" },
		});
	});
});

describe("transcription configuration", () => {
	it("builds the endpoint from an API base URL with or without a path", () => {
		expect(openAiCompatibleAudioUrl("https://api.openai.com/v1")).toBe(
			"https://api.openai.com/v1/audio/transcriptions",
		);
		expect(openAiCompatibleAudioUrl("http://127.0.0.1:8080/v1/")).toBe(
			"http://127.0.0.1:8080/v1/audio/transcriptions",
		);
	});
	it("allows https and loopback http but rejects other plaintext endpoints", () => {
		expect(() => validateTranscriptionConfig(config)).not.toThrow();
		expect(() =>
			validateTranscriptionConfig({
				...config,
				baseUrl: "http://127.0.0.1:8080/v1",
			}),
		).not.toThrow();
		expect(() =>
			validateTranscriptionConfig({ ...config, baseUrl: "http://api.example.test/v1" }),
		).toThrow();
	});
	it("rejects incomplete or malformed configurations", () => {
		expect(
			failureOf(() => validateTranscriptionConfig({ ...config, model: " " })),
		).toMatchObject({ kind: "config-invalid", field: "model" });
		expect(
			failureOf(() => validateTranscriptionConfig({ ...config, secretId: "" })),
		).toMatchObject({ kind: "config-invalid", field: "secret" });
		expect(
			failureOf(() => validateTranscriptionConfig({ ...config, baseUrl: "not-a-url" })),
		).toMatchObject({ kind: "config-invalid", field: "base-url" });
	});
	it("changes the fingerprint when the provider or model changes", () => {
		expect(transcriptionConfigFingerprint(config)).not.toBe(
			transcriptionConfigFingerprint({ ...config, model: "gpt-4o-transcribe" }),
		);
		expect(transcriptionConfigFingerprint(config)).not.toContain("secret");
	});
});
