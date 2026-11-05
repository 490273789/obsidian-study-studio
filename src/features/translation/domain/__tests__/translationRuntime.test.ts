import { describe, expect, it, vi } from "vite-plus/test";
import { AiService } from "../../../../core/ai";
import { TransportError, type OutboundResponse } from "../../../../core/net/types";
import { normalizeTranslationSettings, renderTranslationPrompt } from "../configuration";
import { TranslationRuntime } from "../translationRuntime";
import type { TranslationOutput, TranslationSettings } from "../types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (value: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const response = (text: string): OutboundResponse => ({
	status: 200,
	text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
});
function setup() {
	const request = vi.fn<() => Promise<OutboundResponse>>().mockResolvedValue(response("Hello"));
	const ai = new AiService(
		{
			configs: [
				{
					id: "a",
					name: "A",
					provider: "deepseek",
					baseUrl: "https://api.deepseek.com",
					secretId: "key",
					model: "model",
				},
			],
			defaultConfigId: "a",
		},
		{
			net: { request, readSecret: () => "secret" },
			createId: () => "new",
			persist: async () => {},
		},
	);
	const settings: TranslationSettings = {
		...normalizeTranslationSettings(undefined),
		enabled: true,
		youdao: {
			baseUrl: "https://openapi.youdao.com/api",
			appKeySecretId: "youdao-app-key",
			appSecretSecretId: "youdao-app-secret",
		},
		profiles: [
			{ id: "a", name: "A", kind: "engine", configId: "a", enabled: true },
			{ id: "b", name: "B", kind: "youdao", configId: "", enabled: true },
		],
	};
	const persist = vi.fn<(_: TranslationSettings) => Promise<void>>().mockResolvedValue(undefined);
	const youdao = vi
		.fn<() => Promise<TranslationOutput>>()
		.mockResolvedValue({ text: "Hi", usage: null });
	const runtime = new TranslationRuntime(settings, ai, { persist, youdao });
	return { runtime, ai, request, persist, youdao, settings };
}

describe("translation session", () => {
	it("uses a configured Youdao LLM gateway as an AI translation engine", async () => {
		const { runtime, ai, request, youdao, settings } = setup();
		const id = await ai.saveConfig({
			name: "Gateway",
			provider: "youdao",
			baseUrl: "https://openapi.youdao.com/llmgateway/api/v1",
			secretId: "gateway-key",
			model: "deepseek-v4-flash",
		});
		await runtime.configure({
			...settings,
			profiles: [
				{ id: "gateway", name: "Gateway", kind: "engine", configId: id, enabled: true },
			],
		});
		runtime.setInput("你好");
		await runtime.translate();
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://openapi.youdao.com/llmgateway/api/v1/chat/completions",
				headers: expect.objectContaining({ Authorization: "Bearer secret" }),
			}),
		);
		expect(youdao).not.toHaveBeenCalled();
		expect(runtime.getSnapshot().results[0]?.text).toBe("Hello");
		runtime.dispose();
	});

	it("prefills without requesting and preserves order when results finish out of order", async () => {
		const { runtime, request, youdao } = setup();
		const gate = deferred<OutboundResponse>();
		request.mockReturnValueOnce(gate.promise);
		runtime.prefill("你好");
		expect(request).not.toHaveBeenCalled();
		expect(youdao).not.toHaveBeenCalled();
		const pending = runtime.translate();
		await vi.waitFor(() => expect(runtime.getSnapshot().results[1]?.status).toBe("success"));
		expect(runtime.getSnapshot().results.map((result) => result.name)).toEqual(["A", "B"]);
		expect(runtime.getSnapshot().status).toBe("loading");
		gate.resolve(response("Hello"));
		await pending;
		expect(runtime.getSnapshot().results.map((result) => result.text)).toEqual(["Hello", "Hi"]);
		runtime.dispose();
	});
	it("keeps successful outputs when another provider fails and retries only failures", async () => {
		const { runtime, request, youdao } = setup();
		youdao.mockRejectedValueOnce(new TransportError("unauthorized"));
		runtime.setInput("你好");
		await runtime.translate();
		expect(runtime.getSnapshot().status).toBe("success");
		expect(runtime.getSnapshot().results[1]?.error).toBe("unauthorized");
		await runtime.translate();
		expect(request).toHaveBeenCalledTimes(1);
		expect(youdao).toHaveBeenCalledTimes(2);
		runtime.dispose();
	});
	it("skips a missing engine while still translating with a configured profile", async () => {
		const { runtime, ai, request } = setup();
		await ai.deleteConfig("a");
		runtime.setInput("你好");
		await runtime.translate();
		expect(runtime.getSnapshot().results[0]).toMatchObject({
			setupIssue: "engineSetup",
			status: "idle",
		});
		expect(request).not.toHaveBeenCalled();
		expect(runtime.getSnapshot().results[1]?.status).toBe("success");
		runtime.dispose();
	});
	it("preserves the source and sends nothing if no profile is configured", async () => {
		const { runtime, settings, ai, request, youdao } = setup();
		await ai.deleteConfig("a");
		await runtime.configure({
			...settings,
			youdao: { ...settings.youdao, appSecretSecretId: "" },
		});
		runtime.setInput("保留原文");
		await runtime.translate();
		expect(runtime.getSnapshot().input).toBe("保留原文");
		expect(runtime.getSnapshot().results.map((result) => result.setupIssue)).toEqual([
			"engineSetup",
			"youdaoSetup",
		]);
		expect(request).not.toHaveBeenCalled();
		expect(youdao).not.toHaveBeenCalled();
		runtime.dispose();
	});
	it("discards old results and old cache entries after prefill", async () => {
		const { runtime, youdao, settings } = setup();
		await runtime.configure({ ...settings, profiles: [settings.profiles[1]!] });
		const gate = deferred<TranslationOutput>();
		youdao.mockReturnValueOnce(gate.promise);
		runtime.prefill("old");
		const pending = runtime.translate();
		runtime.prefill("new");
		gate.resolve({ text: "stale" });
		await pending;
		expect(runtime.getSnapshot().input).toBe("new");
		expect(runtime.getSnapshot().results[0]?.text).toBe("");
		runtime.setInput("old");
		await runtime.translate();
		expect(youdao).toHaveBeenCalledTimes(2);
		runtime.dispose();
	});
	it("retains input while another view remains and resets only when the final view closes", async () => {
		const { runtime } = setup();
		const close1 = runtime.attachView();
		const close2 = runtime.attachView();
		runtime.setInput("你好");
		await runtime.translate();
		close1();
		close1();
		expect(runtime.getSnapshot().input).toBe("你好");
		close2();
		expect(runtime.getSnapshot().input).toBe("");
		expect(runtime.getSnapshot().results.every((result) => result.status === "idle")).toBe(
			true,
		);
		runtime.dispose();
	});
	it("publishes settings only after persistence, recovers from failures, and swaps direction without swapping text", async () => {
		const { runtime, persist, settings } = setup();
		const gate = deferred<void>();
		persist.mockReturnValueOnce(gate.promise);
		runtime.setInput("source");
		const saving = runtime.configure({ ...settings, thinkingEnabled: true });
		expect(runtime.getSnapshot().settings.thinkingEnabled).toBe(false);
		gate.reject(new Error("disk"));
		await expect(saving).rejects.toMatchObject({ code: "save-failed" });
		expect(runtime.getSnapshot().saving).toBe(false);
		await runtime.swapDirection();
		expect(runtime.getSnapshot().settings.direction).toBe("en-zh");
		expect(runtime.getSnapshot().input).toBe("source");
		runtime.dispose();
	});
	it("invalidates cached translations when shared engine settings change", async () => {
		const { runtime, ai, request } = setup();
		runtime.setInput("你好");
		await runtime.translate();
		await runtime.translate();
		expect(request).toHaveBeenCalledTimes(1);
		await ai.saveConfig({ ...ai.getSnapshot().settings.configs[0]!, model: "other" });
		await runtime.translate();
		expect(request).toHaveBeenCalledTimes(2);
		runtime.dispose();
	});
	it("bounds the per-result cache to 30 entries", async () => {
		const { runtime, youdao, settings } = setup();
		await runtime.configure({ ...settings, profiles: [settings.profiles[1]!] });
		for (let i = 0; i < 31; i++) {
			runtime.setInput(String(i));
			await runtime.translate();
		}
		runtime.setInput("30");
		await runtime.translate();
		expect(youdao).toHaveBeenCalledTimes(31);
		runtime.setInput("0");
		await runtime.translate();
		expect(youdao).toHaveBeenCalledTimes(32);
		runtime.dispose();
	});
	it("blocks disabled tools and empty input without network requests", async () => {
		const { runtime, request, youdao, settings } = setup();
		await runtime.translate();
		await runtime.configure({ ...settings, enabled: false });
		runtime.setInput("你好");
		await runtime.translate();
		expect(request).not.toHaveBeenCalled();
		expect(youdao).not.toHaveBeenCalled();
		runtime.dispose();
	});
	it("freezes snapshots and strips unknown credential fields when normalizing", () => {
		const { runtime, settings } = setup();
		expect(Object.isFrozen(runtime.getSnapshot().settings.profiles)).toBe(true);
		expect(
			JSON.stringify(
				normalizeTranslationSettings({
					...settings,
					apiKey: "private",
					youdao: { ...settings.youdao, appSecret: "private" },
				}),
			),
		).not.toContain("private");
		expect(
			renderTranslationPrompt(
				"{source_language}/{target_language}/{source_language}",
				"en-zh",
			),
		).toBe("英文/中文/英文");
		runtime.dispose();
	});

	it("automatically adapts translation direction and prefills input with persistence", async () => {
		const { runtime, persist } = setup();
		// Initial direction is "zh-en"
		expect(runtime.getSnapshot().settings.direction).toBe("zh-en");

		// English text should trigger auto-switch to "en-zh"
		await runtime.openPrefilled("hello world");
		expect(persist).toHaveBeenCalledWith(expect.objectContaining({ direction: "en-zh" }));
		expect(runtime.getSnapshot().settings.direction).toBe("en-zh");
		expect(runtime.getSnapshot().input).toBe("hello world");

		// Chinese text should trigger auto-switch back to "zh-en"
		await runtime.openPrefilled("这是一个测试句子");
		expect(persist).toHaveBeenCalledWith(expect.objectContaining({ direction: "zh-en" }));
		expect(runtime.getSnapshot().settings.direction).toBe("zh-en");
		expect(runtime.getSnapshot().input).toBe("这是一个测试句子");

		// Mixed text with Chinese should detect "zh-en" without re-persisting
		persist.mockClear();
		await runtime.openPrefilled("Hello 世界");
		expect(persist).not.toHaveBeenCalled();
		expect(runtime.getSnapshot().settings.direction).toBe("zh-en");
		expect(runtime.getSnapshot().input).toBe("Hello 世界");

		runtime.dispose();
	});

	it("degrades gracefully and preserves prefilled text when direction persistence fails", async () => {
		const { runtime, persist } = setup();
		expect(runtime.getSnapshot().settings.direction).toBe("zh-en");

		// Mock persistence failure
		persist.mockRejectedValueOnce(new Error("disk write error"));

		// Should not throw, should still prefill text and update in-memory direction
		await runtime.openPrefilled("hello error handling");
		expect(runtime.getSnapshot().settings.direction).toBe("en-zh");
		expect(runtime.getSnapshot().input).toBe("hello error handling");

		runtime.dispose();
	});

	it("undoes a clear once and restores the source and completed translations without a request", async () => {
		const { runtime, request, youdao } = setup();
		runtime.setInput("original input");
		await runtime.translate();
		runtime.clear({ undoable: true });
		const id = runtime.getSnapshot().clearUndoId;
		expect(id).not.toBeNull();
		expect(runtime.getSnapshot().input).toBe("");

		expect(runtime.undoClear(id!)).toBe(true);
		const snapshot = runtime.getSnapshot();
		expect(snapshot.input).toBe("original input");
		expect(snapshot.results[0]).toMatchObject({ status: "success", text: "Hello" });
		expect(snapshot.results[1]).toMatchObject({ status: "success", text: "Hi" });
		expect(snapshot.status).toBe("success");
		expect(snapshot.clearUndoId).toBeNull();
		expect(runtime.undoClear(id!)).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
		expect(youdao).toHaveBeenCalledTimes(1);
		runtime.dispose();
	});

	it("rejects stale undo actions without replacing a newer draft or aborting its request", async () => {
		const { runtime, request } = setup();
		runtime.setInput("old input");
		runtime.clear({ undoable: true });
		const id = runtime.getSnapshot().clearUndoId!;
		runtime.setInput("new input");
		expect(runtime.getSnapshot().clearUndoId).toBeNull();
		const gate = deferred<OutboundResponse>();
		request.mockReturnValueOnce(gate.promise);
		const pending = runtime.translate();
		expect(runtime.undoClear(id)).toBe(false);
		expect(runtime.getSnapshot()).toMatchObject({ input: "new input", status: "loading" });
		gate.resolve(response("New translation"));
		await pending;
		expect(runtime.getSnapshot().results[0]?.text).toBe("New translation");

		runtime.clear({ undoable: true });
		const newId = runtime.getSnapshot().clearUndoId!;
		expect(runtime.undoClear(id)).toBe(false);
		expect(runtime.undoClear(newId)).toBe(true);
		expect(runtime.getSnapshot().input).toBe("new input");
		runtime.dispose();
	});

	it("keeps results and marks them stale when the source changes", async () => {
		const { runtime, request } = setup();
		runtime.setInput("你好");
		await runtime.translate();
		expect(runtime.getSnapshot().results[0]?.text).toBe("Hello");
		expect(request).toHaveBeenCalledTimes(1);

		runtime.setInput("你好，世界");
		let snapshot = runtime.getSnapshot();
		expect(snapshot.results[0]).toMatchObject({ status: "success", text: "Hello" });
		expect(snapshot.translatedInput).toBe("你好");
		expect(snapshot.stale).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);

		runtime.setInput("你好");
		snapshot = runtime.getSnapshot();
		expect(snapshot.stale).toBe(false);
		runtime.dispose();
	});

	it("keeps results across a direction swap and marks them stale", async () => {
		const { runtime } = setup();
		runtime.setInput("你好");
		await runtime.translate();
		await runtime.swapDirection();
		let snapshot = runtime.getSnapshot();
		expect(snapshot.settings.direction).toBe("en-zh");
		expect(snapshot.translatedDirection).toBe("zh-en");
		expect(snapshot.results[0]?.text).toBe("Hello");
		expect(snapshot.stale).toBe(true);

		await runtime.translate();
		snapshot = runtime.getSnapshot();
		expect(snapshot.stale).toBe(false);
		expect(snapshot.translatedDirection).toBe("en-zh");
		runtime.dispose();
	});

	it("does not abort a running translation when the source changes", async () => {
		const { runtime, request } = setup();
		const gate = deferred<OutboundResponse>();
		request.mockReturnValueOnce(gate.promise);
		runtime.setInput("你好");
		const pending = runtime.translate();
		expect(runtime.getSnapshot().status).toBe("loading");
		runtime.setInput("你好，世界");
		gate.resolve(response("Hello"));
		await pending;
		const snapshot = runtime.getSnapshot();
		expect(snapshot.input).toBe("你好，世界");
		expect(snapshot.translatedInput).toBe("你好");
		expect(snapshot.results[0]?.text).toBe("Hello");
		expect(snapshot.stale).toBe(true);
		runtime.dispose();
	});

	it("retries only the failed profile", async () => {
		const { runtime, request, youdao } = setup();
		youdao.mockRejectedValueOnce(new TransportError("unauthorized"));
		runtime.setInput("你好");
		await runtime.translate();
		expect(runtime.getSnapshot().results[1]?.status).toBe("error");

		await runtime.retryResult("b");
		expect(request).toHaveBeenCalledTimes(1);
		expect(youdao).toHaveBeenCalledTimes(2);
		const snapshot = runtime.getSnapshot();
		expect(snapshot.results[0]).toMatchObject({ status: "success", text: "Hello" });
		expect(snapshot.results[1]).toMatchObject({ status: "success", text: "Hi" });
		expect(snapshot.status).toBe("success");
		runtime.dispose();
	});

	it("restores translated metadata with clear undo", async () => {
		const { runtime } = setup();
		runtime.setInput("original input");
		await runtime.translate();
		runtime.clear({ undoable: true });
		const id = runtime.getSnapshot().clearUndoId!;
		expect(runtime.undoClear(id)).toBe(true);
		const snapshot = runtime.getSnapshot();
		expect(snapshot.translatedInput).toBe("original input");
		expect(snapshot.translatedDirection).toBe("zh-en");
		expect(snapshot.stale).toBe(false);
		runtime.dispose();
	});

	it("does not retry a result that is not an error", async () => {
		const { runtime, request } = setup();
		runtime.setInput("你好");
		await runtime.translate();
		await runtime.retryResult("a");
		expect(request).toHaveBeenCalledTimes(1);
		runtime.dispose();
	});

	it.each(["prefill", "direction", "engine"] as const)(
		"invalidates undo after a %s change",
		async (change) => {
			const { runtime, ai } = setup();
			runtime.setInput("original input");
			await runtime.translate();
			runtime.clear({ undoable: true });
			const id = runtime.getSnapshot().clearUndoId!;
			if (change === "prefill") await runtime.openPrefilled("新选区");
			if (change === "direction") await runtime.swapDirection();
			if (change === "engine") await ai.deleteConfig("a");

			expect(runtime.getSnapshot().clearUndoId).toBeNull();
			expect(runtime.undoClear(id)).toBe(false);
			expect(runtime.getSnapshot().input).toBe(change === "prefill" ? "新选区" : "");
			expect(runtime.getSnapshot().results.every((result) => !result.text)).toBe(true);
			runtime.dispose();
		},
	);
});
