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
	it("does not fall back to default when a selected engine disappears", async () => {
		const { runtime, ai, request } = setup();
		await ai.deleteConfig("a");
		runtime.setInput("你好");
		await runtime.translate();
		expect(runtime.getSnapshot().results[0]?.error).toBe("config-not-found");
		expect(request).not.toHaveBeenCalled();
		expect(runtime.getSnapshot().results[1]?.status).toBe("success");
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
});
