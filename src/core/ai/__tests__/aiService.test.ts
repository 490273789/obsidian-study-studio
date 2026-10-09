import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AiService } from "../aiService";
import { type AiEngineConfig, type AiSettings } from "../types";
import { normalizeAiSettings } from "../configuration";
import { TransportError, type OutboundRequest, type OutboundResponse } from "../../net/types";

const config: AiEngineConfig = {
	id: "engine-1",
	name: "Translation",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	secretId: "ai-key",
	model: "deepseek-v4-flash",
};
const response = (text = "Hello"): OutboundResponse => ({
	status: 200,
	text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
});
const messages = [{ role: "user" as const, text: "Translate this" }];
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function abortablePending(signal?: AbortSignal): Promise<OutboundResponse> {
	return new Promise((_, reject) => {
		const cancel = () => reject(new TransportError("cancelled"));
		if (signal?.aborted) cancel();
		else signal?.addEventListener("abort", cancel, { once: true });
	});
}
function setup(settings: AiSettings = { configs: [config], defaultConfigId: config.id }) {
	const request = vi
		.fn<(_: OutboundRequest) => Promise<OutboundResponse>>()
		.mockResolvedValue(response());
	const persist = vi.fn<(_: AiSettings) => Promise<void>>().mockResolvedValue(undefined);
	const readSecret = vi.fn<(_: string) => string | null>().mockReturnValue("secret-value");
	const service = new AiService(settings, {
		net: { request, readSecret },
		persist,
		createId: () => "new-id",
	});
	return { service, request, persist, readSecret };
}
afterEach(() => vi.useRealTimers());

describe("AI configuration ownership", () => {
	it("loads legacy settings and strips secret values and malformed duplicate entries", () => {
		expect(normalizeAiSettings(undefined)).toEqual({ configs: [], defaultConfigId: null });
		const normalized = normalizeAiSettings({
			configs: [
				{ ...config, apiKey: "DO-NOT-SAVE" },
				config,
				null,
				{ id: "bad", provider: "unknown" },
			],
			defaultConfigId: "missing",
		});
		expect(normalized).toEqual({ configs: [config], defaultConfigId: null });
		expect(JSON.stringify(normalized)).not.toContain("DO-NOT-SAVE");
	});
	it("publishes only after persistence and recovers after a failed write", async () => {
		const { service, persist } = setup();
		const gate = deferred<void>();
		persist.mockReturnValueOnce(gate.promise);
		const save = service.saveConfig({ ...config, name: "New name" });
		expect(service.getSnapshot().settings.configs[0]?.name).toBe("Translation");
		gate.reject(new Error("disk unavailable"));
		await expect(save).rejects.toMatchObject({ code: "save-failed" });
		expect(service.getSnapshot().settings.configs[0]?.name).toBe("Translation");
		await service.saveConfig({ ...config, name: "Recovered" });
		expect(service.getSnapshot().settings.configs[0]?.name).toBe("Recovered");
	});
	it("serializes independent changes and clears a removed default without deleting secrets", async () => {
		const { service, persist } = setup();
		const first = service.saveConfig({ ...config, id: undefined, name: "Second" });
		const second = service.setDefault("new-id");
		await Promise.all([first, second]);
		expect(service.getSnapshot().settings.configs).toHaveLength(2);
		expect(service.getSnapshot().settings.defaultConfigId).toBe("new-id");
		await service.deleteConfig("new-id");
		expect(service.getSnapshot().settings.defaultConfigId).toBeNull();
		expect(JSON.stringify(persist.mock.calls)).not.toContain("secret-value");
	});
	it("rejects missing fields and credential-bearing URLs without a network call", async () => {
		const { service, request } = setup();
		for (const patch of [
			{ name: " " },
			{ model: "" },
			{ secretId: "" },
			{ baseUrl: "https://secret@example.com/v1" },
			{ baseUrl: "https://example.com?api_key=secret" },
		]) {
			await expect(service.saveConfig({ ...config, ...patch })).rejects.toMatchObject({
				code: "invalid-config",
			});
		}
		expect(request).not.toHaveBeenCalled();
	});
});

describe("AI text and image requests", () => {
	it("routes omitted IDs to the default and never falls back for explicit IDs", async () => {
		const { service, request } = setup();
		await expect(service.generate({ messages })).resolves.toEqual({
			text: "Hello",
			configId: config.id,
			model: config.model,
		});
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.deepseek.com/chat/completions",
				headers: expect.objectContaining({ Authorization: "Bearer secret-value" }),
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: "user", content: "Translate this" }],
					stream: false,
				}),
			}),
		);
		await expect(service.generate({ configId: "missing", messages })).rejects.toMatchObject({
			code: "config-not-found",
		});
		await service.setDefault(null);
		await expect(service.generate({ messages })).rejects.toMatchObject({ code: "no-default" });
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("sends provider-specific thinking controls only when explicitly requested", async () => {
		const { service, request } = setup();
		await service.generate({ messages, thinkingEnabled: true });
		expect(JSON.parse((request.mock.calls[0]![0] as { body: string }).body)).toMatchObject({
			thinking: { type: "enabled" },
		});
		await service.saveConfig({ ...config, provider: "bailian" });
		await service.generate({ messages, thinkingEnabled: false });
		expect(JSON.parse((request.mock.calls[1]![0] as { body: string }).body)).toMatchObject({
			enable_thinking: false,
		});
		await service.generate({ messages });
		expect(JSON.parse((request.mock.calls[2]![0] as { body: string }).body)).not.toHaveProperty(
			"enable_thinking",
		);
	});

	it("returns only valid finite integer token usage", async () => {
		const { service, request } = setup();
		request.mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				choices: [{ finish_reason: "stop", message: { content: "Hello" } }],
				usage: { prompt_tokens: 4, completion_tokens: "not-a-number" },
			}),
		});
		await expect(service.generate({ messages })).resolves.toMatchObject({
			usage: { inputTokens: 4, outputTokens: null },
		});
	});
	it("retains in-flight config and message content across edits and deletions", async () => {
		const { service, request } = setup();
		const gate = deferred<OutboundResponse>();
		request.mockReturnValueOnce(gate.promise);
		const input = [{ role: "user" as const, text: "original" }];
		const pending = service.generate({ messages: input });
		input[0]!.text = "changed";
		await service.saveConfig({
			...config,
			model: "new-model",
			baseUrl: "https://other.example/v1",
		});
		await service.deleteConfig(config.id);
		gate.resolve(response());
		await expect(pending).resolves.toMatchObject({ model: config.model });
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.deepseek.com/chat/completions",
				body: expect.stringContaining("original"),
			}),
		);
	});
	it("blocks known text-only models before reading a secret and permits unknown vision models", async () => {
		const { service, request, readSecret } = setup();
		const images = [{ mimeType: "image/png" as const, base64: "aGVsbG8=" }];
		await expect(
			service.generate({ messages: [{ role: "user", text: "Read image", images }] }),
		).rejects.toMatchObject({ code: "unsupported-image" });
		expect(readSecret).not.toHaveBeenCalled();
		await service.saveConfig({ ...config, model: "custom-vision-model" });
		await service.generate({ messages: [{ role: "user", text: "Read image", images }] });
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.stringContaining("data:image/png;base64,aGVsbG8="),
			}),
		);
	});
	it("rejects malformed images and empty prompts", async () => {
		const { service, request } = setup();
		await expect(service.generate({ messages: [] })).rejects.toMatchObject({
			code: "invalid-input",
		});
		await expect(
			service.generate({
				messages: [
					{
						role: "user",
						text: "image",
						images: [{ mimeType: "image/png", base64: "data:image/png;base64,abc" }],
					},
				],
			}),
		).rejects.toMatchObject({ code: "invalid-input" });
		expect(request).not.toHaveBeenCalled();
	});
	it.each([
		[401, "unauthorized"],
		[429, "rate-limited"],
		[500, "server"],
	])("returns safe HTTP %i errors without retrying", async (status, code) => {
		const { service, request } = setup();
		request.mockRejectedValue(
			new TransportError(code as "unauthorized" | "rate-limited" | "server", {
				httpStatus: Number(status),
				responseText: "secret-value and private prompt",
			}),
		);
		await expect(service.generate({ messages })).rejects.toMatchObject({
			code,
			httpStatus: status,
		});
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("does not expose raw transport errors or accept truncated model output", async () => {
		const { service, request } = setup();
		request.mockRejectedValueOnce(new Error("secret-value"));
		await expect(service.generate({ messages })).rejects.toMatchObject({ code: "network" });
		request.mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				choices: [{ finish_reason: "length", message: { content: "partial" } }],
			}),
		});
		await expect(service.generate({ messages })).rejects.toMatchObject({
			code: "incomplete-response",
		});
	});
});

describe("AI request lifecycle", () => {
	it("times out after 120 seconds, discards late results and leaves other requests independent", async () => {
		vi.useFakeTimers();
		const { service, request } = setup();
		request.mockImplementationOnce(
			(spec) =>
				new Promise((_, reject) =>
					setTimeout(() => reject(new TransportError("timeout")), spec.timeoutMs),
				),
		);
		const slow = service.generate({ messages });
		const rejection = expect(slow).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(119_999);
		await expect(service.generate({ messages })).resolves.toMatchObject({ text: "Hello" });
		await vi.advanceTimersByTimeAsync(1);
		await rejection;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("passes cancellation to the outbound port", async () => {
		const { service, request } = setup();
		request.mockImplementationOnce((spec) => abortablePending(spec.signal));
		const controller = new AbortController();
		const pending = service.generate({ messages, signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
		expect(request).toHaveBeenCalledOnce();
	});
	it("disposes active requests and rejects future calls", async () => {
		const { service, request } = setup();
		request.mockImplementation((spec) => abortablePending(spec.signal));
		const pending = service.generate({ messages });
		service.dispose();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
		await expect(service.generate({ messages })).rejects.toMatchObject({ code: "disposed" });
	});
});

describe("model discovery", () => {
	it("retains draft-discovered capabilities after saving and selecting a default", async () => {
		const { service, request } = setup({ configs: [], defaultConfigId: null });
		const draft: AiEngineConfig = {
			...config,
			id: "draft",
			provider: "bailian",
			baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
			model: "text-model",
		};
		request.mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				output: {
					total: 1,
					models: [
						{ model: "text-model", inference_metadata: { request_modality: ["Text"] } },
					],
				},
			}),
		});
		const models = await service.listModels(draft);
		models[0]!.imageInput = "supported"; // Caller-owned results cannot alter the service catalogue.
		const id = await service.saveConfig({ ...draft, id: undefined });
		await service.setDefault(id);
		await expect(
			service.generate({
				messages: [
					{
						role: "user",
						text: "read",
						images: [{ mimeType: "image/png", base64: "aGVsbG8=" }],
					},
				],
			}),
		).rejects.toMatchObject({ code: "unsupported-image" });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("queries a draft connection without a selected model and handles standard lists", async () => {
		const { service, request } = setup();
		request.mockResolvedValue({
			status: 200,
			text: JSON.stringify({ data: [{ id: "custom" }] }),
		});
		await expect(service.listModels({ ...config, model: "" })).resolves.toEqual([
			{ id: "custom", imageInput: "unknown" },
		]);
	});
	it("paginates native Bailian catalogues and uses image metadata", async () => {
		const bailian: AiEngineConfig = {
			...config,
			provider: "bailian",
			baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
			model: "vision",
		};
		const { service, request } = setup({ configs: [bailian], defaultConfigId: bailian.id });
		request.mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				output: {
					total: 101,
					models: [
						{
							model: "vision",
							inference_metadata: {
								request_modality: ["Text", "Image"],
								response_modality: ["Text"],
							},
						},
					],
				},
			}),
		});
		request.mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				output: {
					total: 101,
					models: [
						{
							model: "text",
							inference_metadata: {
								request_modality: ["Text"],
								response_modality: ["Text"],
							},
						},
					],
				},
			}),
		});
		await expect(service.listModels(bailian)).resolves.toEqual([
			{ id: "vision", imageInput: "supported" },
			{ id: "text", imageInput: "unsupported" },
		]);
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				url: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=2&page_size=100",
			}),
		);
	});
	it("does not publish a catalogue when its configuration changed while loading", async () => {
		const { service, request } = setup();
		const gate = deferred<OutboundResponse>();
		request.mockReturnValue(gate.promise);
		const pending = service.listModels(config);
		await service.saveConfig({ ...config, baseUrl: "https://new.example/v1" });
		gate.resolve({ status: 200, text: JSON.stringify({ data: [{ id: "old-model" }] }) });
		await pending;
		expect(service.getSnapshot().models).toEqual({});
		expect(service.getSnapshot().loadingModels).toEqual([]);
	});
});

describe("connection test", () => {
	it("tests connection using a saved configuration ID", async () => {
		const { service, request } = setup();
		request.mockResolvedValueOnce(response("OK"));
		await expect(service.testConnection(config.id)).resolves.toBeUndefined();
		expect(request).toHaveBeenCalledOnce();
	});

	it("tests connection using an unsaved draft AiEngineConfig", async () => {
		const { service, request } = setup();
		request.mockResolvedValueOnce(response("OK"));
		const draft: AiEngineConfig = {
			id: "draft-123",
			name: "",
			provider: "deepseek",
			baseUrl: "https://api.deepseek.com",
			secretId: "ai-key",
			model: "deepseek-v4-flash",
		};
		await expect(service.testConnection(draft)).resolves.toBeUndefined();
		expect(request).toHaveBeenCalledOnce();
	});

	it("rejects invalid draft configuration without sending a request", async () => {
		const { service, request } = setup();
		const invalidDraft: AiEngineConfig = {
			id: "draft-invalid",
			name: "",
			provider: "deepseek",
			baseUrl: "",
			secretId: "",
			model: "",
		};
		await expect(service.testConnection(invalidDraft)).rejects.toMatchObject({
			code: "invalid-config",
		});
		expect(request).not.toHaveBeenCalled();
	});
});
