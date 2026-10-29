import { describe, expect, it, vi } from "vite-plus/test";
import type { OutboundPort } from "../../../net/types";
import {
	MediaTranscriptionEngine,
	type MediaTranscriptionSettings,
} from "../mediaTranscriptionEngine";
import type { AudioChunk } from "../../transcriptionTypes";

function createFakeOutbound() {
	const request = vi.fn<OutboundPort["request"]>();
	const readSecret = vi.fn<OutboundPort["readSecret"]>();
	const requestHostPinned = vi.fn<OutboundPort["requestHostPinned"]>();
	const outbound: OutboundPort = {
		request,
		readSecret,
		requestHostPinned,
	};
	return {
		outbound,
		request,
		readSecret,
		requestHostPinned,
	};
}

describe("MediaTranscriptionEngine", () => {
	const validBailianSettings: MediaTranscriptionSettings = {
		provider: "bailian",
		bailianWorkspaceId: "llm-test-ws",
		bailianWorkspaceSecretId: "",
		bailianSecretId: "secret-bailian-key",
		bailianModel: "fun-asr-flash-2026-06-15",
		openaiBaseUrl: "https://api.openai.com/v1",
		openaiSecretId: "",
		openaiModel: "whisper-1",
	};

	const validOpenAiSettings: MediaTranscriptionSettings = {
		provider: "openai-compatible",
		bailianWorkspaceId: "",
		bailianWorkspaceSecretId: "",
		bailianSecretId: "",
		bailianModel: "fun-asr-flash-2026-06-15",
		openaiBaseUrl: "https://api.openai.com/v1",
		openaiSecretId: "secret-openai-key",
		openaiModel: "whisper-1",
	};

	it("computes deterministic signature without reading secrets or performing network I/O", async () => {
		const readSecret = vi.fn();
		const fakeOutbound = createFakeOutbound();
		const engine = new MediaTranscriptionEngine({
			readSettings: () => validBailianSettings,
			readSecret,
			outbound: fakeOutbound.outbound,
		});

		const signature = await engine.getSignature();
		expect(signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
		expect(readSecret).not.toHaveBeenCalled();
		expect(fakeOutbound.request).not.toHaveBeenCalled();
	});

	describe("preflight", () => {
		it("fails with config-invalid (secret) when secret cannot be resolved", async () => {
			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: () => null,
				outbound: createFakeOutbound().outbound,
			});

			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "secret" },
			});
		});

		it("fails with config-invalid (workspace) when Bailian workspace is invalid", async () => {
			const engine = new MediaTranscriptionEngine({
				readSettings: () => ({
					...validBailianSettings,
					bailianWorkspaceId: "invalid space!",
				}),
				readSecret: () => "valid-key",
				outbound: createFakeOutbound().outbound,
			});

			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "workspace" },
			});
		});

		it("fails with config-invalid (security) when OpenAI Base URL is non-loopback HTTP", async () => {
			const engine = new MediaTranscriptionEngine({
				readSettings: () => ({
					...validOpenAiSettings,
					openaiBaseUrl: "http://api.remote.com/v1",
				}),
				readSecret: () => "valid-key",
				outbound: createFakeOutbound().outbound,
			});

			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "security" },
			});
		});

		it("fails with config-drift when expectedSignature does not match", async () => {
			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: () => "valid-key",
				outbound: createFakeOutbound().outbound,
			});

			await expect(
				engine.preflight({ expectedSignature: "bailian|stale-hash|old-model" }),
			).rejects.toMatchObject({
				failure: { kind: "config-drift" },
			});
		});

		it("succeeds and returns signature when configuration and secrets are valid", async () => {
			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: () => "valid-key",
				outbound: createFakeOutbound().outbound,
			});

			const result = await engine.preflight();
			expect(result.signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
		});
	});

	describe("transcribe", () => {
		it("fails with config-drift before sending requests when expectedSignature does not match", async () => {
			const fakeOutbound = createFakeOutbound();
			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: () => "valid-key",
				outbound: fakeOutbound.outbound,
			});

			await expect(
				engine.transcribe({
					audio: new ArrayBuffer(16),
					expectedSignature: "bailian|old-signature|model",
				}),
			).rejects.toMatchObject({
				failure: { kind: "config-drift" },
			});

			expect(fakeOutbound.request).not.toHaveBeenCalled();
		});

		it("transcribes single chunk, sanitizing dirty cues and extracting words", async () => {
			const fakeOutbound = createFakeOutbound();
			fakeOutbound.readSecret.mockReturnValue("valid-bailian-key");
			// Mock successful Bailian SSE response with sentence events
			const event = (
				id: number,
				start: number,
				end: number,
				text: string,
				words: [string, number, number][],
			) =>
				`data:${JSON.stringify({
					output: {
						sentence: {
							sentence_id: id,
							sentence_end: true,
							begin_time: start,
							end_time: end,
							text,
							words: words.map(([w, b, e]) => ({
								text: w,
								begin_time: b,
								end_time: e,
							})),
						},
					},
					usage: { duration: 3 },
				})}\n\n`;

			fakeOutbound.request.mockResolvedValueOnce({
				status: 200,
				headers: {},
				text:
					event(1, 0, 1500, "  Hello world.  ", [
						["Hello", 0, 800],
						["world", 800, 1500],
					]) + event(2, 1500, 3000, "Second valid sentence.", [["Second", 1500, 2000]]),
				arrayBuffer: new ArrayBuffer(0),
			});

			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: (id) => fakeOutbound.readSecret(id) as string | null,
				outbound: fakeOutbound.outbound,
			});

			const chunk: AudioChunk = {
				index: 0,
				start: 0,
				end: 3,
				wav: new ArrayBuffer(32),
			};

			const result = await engine.transcribe({ audio: chunk });
			expect(result.cues).toEqual([
				{
					id: "chunk-0-cue-0",
					start: 0,
					end: 1.5,
					text: "Hello world.",
					needsReview: true,
				},
				{
					id: "chunk-0-cue-1",
					start: 1.5,
					end: 3,
					text: "Second valid sentence.",
					needsReview: true,
				},
			]);
			expect(result.words).toEqual([
				{ start: 0, end: 0.8, text: "Hello" },
				{ start: 0.8, end: 1.5, text: "world" },
				{ start: 1.5, end: 2, text: "Second" },
			]);
			expect(result.duration).toBe(3);
			expect(result.signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
		});

		it("respects cancellation via AbortSignal", async () => {
			const controller = new AbortController();
			controller.abort();

			const engine = new MediaTranscriptionEngine({
				readSettings: () => validBailianSettings,
				readSecret: () => "valid-key",
				outbound: createFakeOutbound().outbound,
			});

			await expect(
				engine.transcribe({
					audio: new ArrayBuffer(16),
					signal: controller.signal,
				}),
			).rejects.toMatchObject({
				failure: { kind: "cancelled" },
			});
		});
	});
});
