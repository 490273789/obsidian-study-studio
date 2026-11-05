import { describe, expect, it, vi } from "vite-plus/test";
import type { OutboundPort } from "../../../net/types";
import type { AiSettings, AsrEngineConfig } from "../../../ai/types";
import { MediaTranscriptionEngine } from "../mediaTranscriptionEngine";
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

const bailian: AsrEngineConfig = {
	id: "asr-bailian",
	kind: "asr",
	name: "Bailian",
	provider: "bailian",
	baseUrl: "",
	workspaceId: "llm-test-ws",
	workspaceSecretId: "",
	secretId: "secret-bailian-key",
	model: "fun-asr-flash-2026-06-15",
};

const openAi: AsrEngineConfig = {
	id: "asr-openai",
	kind: "asr",
	name: "Whisper",
	provider: "openai-compatible",
	baseUrl: "https://api.openai.com/v1",
	workspaceId: "",
	workspaceSecretId: "",
	secretId: "secret-openai-key",
	model: "whisper-1",
};

function registry(
	engines: AsrEngineConfig[] = [bailian],
	defaultId = engines[0]?.id ?? "",
): AiSettings {
	return { engines: [...engines], defaults: { llm: null, asr: defaultId || null } };
}

function createEngine(
	settings: AiSettings = registry(),
	select: () => string = () => "",
	readSecret: (id: string) => string | null = () => "valid-key",
) {
	const fake = createFakeOutbound();
	fake.readSecret.mockImplementation((id) => readSecret(id));
	const engine = new MediaTranscriptionEngine({
		readRegistry: () => settings,
		resolveEngineId: select,
		readSecret: (id) => {
			fake.readSecret(id);
			return readSecret(id);
		},
		outbound: fake.outbound,
	});
	return { engine, fake };
}

describe("MediaTranscriptionEngine", () => {
	it("computes a deterministic signature from the selected ASR engine", async () => {
		const { engine, fake } = createEngine();

		const signature = await engine.getSignature();
		expect(signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
		expect(fake.request).not.toHaveBeenCalled();
	});

	it("resolves a Workspace ID stored in Secret Storage", async () => {
		const secretEngine: AsrEngineConfig = {
			...bailian,
			workspaceId: "",
			workspaceSecretId: "workspace-secret",
		};
		const { engine, fake } = createEngine(
			registry([secretEngine]),
			() => "",
			(id) => (id === "workspace-secret" ? "resolved-workspace" : "valid-key"),
		);
		const signature = await engine.getSignature();
		expect(fake.readSecret).toHaveBeenCalledWith("workspace-secret");
		expect(signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
	});

	it("fails with config-invalid (engine) when no ASR engine is configured", async () => {
		const { engine } = createEngine(registry([]));
		await expect(engine.preflight()).rejects.toMatchObject({
			failure: { kind: "config-invalid", field: "engine" },
		});
	});

	it("honours an explicit engine override and the configured selection", async () => {
		const { engine } = createEngine(registry([bailian, openAi]), () => "asr-openai");
		expect(await engine.getSignature()).toMatch(/^openai-compatible\|/);
		expect(await engine.getSignature("asr-bailian")).toMatch(/^bailian\|/);
	});

	describe("preflight", () => {
		it("fails with config-invalid (secret) when the API key cannot be resolved", async () => {
			const { engine } = createEngine(
				registry(),
				() => "",
				() => null,
			);
			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "secret" },
			});
		});

		it("fails with config-invalid (workspace) when the Bailian workspace id is invalid", async () => {
			const invalid: AsrEngineConfig = { ...bailian, workspaceId: "invalid space!" };
			const { engine } = createEngine(registry([invalid]));
			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "workspace" },
			});
		});

		it("fails with config-invalid (security) for a non-loopback HTTP Base URL", async () => {
			const invalid: AsrEngineConfig = {
				...openAi,
				baseUrl: "http://api.remote.com/v1",
			};
			const { engine } = createEngine(registry([invalid]));
			await expect(engine.preflight()).rejects.toMatchObject({
				failure: { kind: "config-invalid", field: "security" },
			});
		});

		it("fails with config-drift when the expected signature is stale", async () => {
			const { engine } = createEngine();
			await expect(
				engine.preflight({ expectedSignature: "bailian|stale-hash|old-model" }),
			).rejects.toMatchObject({ failure: { kind: "config-drift" } });
		});

		it("returns the signature when the engine and credentials are valid", async () => {
			const { engine } = createEngine();
			const result = await engine.preflight();
			expect(result.signature).toMatch(/^bailian\|[a-f0-9]{64}\|fun-asr-flash-2026-06-15$/);
		});
	});

	describe("transcribe", () => {
		it("fails with config-drift before sending requests when the signature does not match", async () => {
			const { engine, fake } = createEngine();
			await expect(
				engine.transcribe({
					audio: new ArrayBuffer(16),
					expectedSignature: "bailian|old-signature|model",
				}),
			).rejects.toMatchObject({ failure: { kind: "config-drift" } });
			expect(fake.request).not.toHaveBeenCalled();
		});

		it("transcribes a chunk, sanitizing dirty cues and extracting words", async () => {
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

			const { engine, fake } = createEngine();
			fake.request.mockResolvedValueOnce({
				status: 200,
				headers: {},
				text:
					event(1, 0, 1500, "  Hello world.  ", [
						["Hello", 0, 800],
						["world", 800, 1500],
					]) + event(2, 1500, 3000, "Second valid sentence.", [["Second", 1500, 2000]]),
				arrayBuffer: new ArrayBuffer(0),
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

			const { engine } = createEngine();
			await expect(
				engine.transcribe({
					audio: new ArrayBuffer(16),
					signal: controller.signal,
				}),
			).rejects.toMatchObject({ failure: { kind: "cancelled" } });
		});
	});
});
