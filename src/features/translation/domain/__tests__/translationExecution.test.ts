import { describe, expect, it, vi } from "vite-plus/test";
import { AiService, type AiEngineConfig } from "../../../../core/ai";
import type { OutboundPort } from "../../../../core/net/types";
import { normalizeTranslationSettings } from "../configuration";
import {
	TranslationConfigurationChangedError,
	TranslationExecution,
} from "../translationExecution";

function setup() {
	const engine: AiEngineConfig = {
		id: "engine",
		name: "Engine",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		secretId: "credential-reference",
		model: "model",
	};
	const request = vi.fn<OutboundPort["request"]>().mockResolvedValue({
		status: 200,
		text: JSON.stringify({
			choices: [{ finish_reason: "stop", message: { content: "Translation" } }],
		}),
	});
	const ai = new AiService(
		{ configs: [engine], defaultConfigId: engine.id },
		{
			net: { request, readSecret: () => "credential-value" },
			persist: async () => {},
			createId: () => "other-engine",
		},
	);
	const settings = normalizeTranslationSettings({
		enabled: true,
		profiles: [
			{
				id: "engine-profile",
				name: "Engine",
				enabled: true,
				kind: "engine",
				configId: engine.id,
			},
			{ id: "youdao-profile", name: "Youdao", enabled: true, kind: "youdao", configId: "" },
		],
		youdao: {
			baseUrl: "https://openapi.youdao.com/api",
			appKeySecretId: "app-key-reference",
			appSecretSecretId: "app-secret-reference",
		},
	});
	const youdao = vi.fn().mockResolvedValue({ text: "Youdao translation", usage: null });
	const execution = new TranslationExecution({ ai, readSettings: () => settings, youdao });
	return { ai, engine, settings, execution, request, youdao };
}

describe("translation execution", () => {
	it("keeps discovery request-free and defaults only an unselected profile", async () => {
		const { ai, execution, settings, request, youdao } = setup();
		try {
			expect(execution.listProfiles().map((profile) => profile.id)).toEqual([
				"engine-profile",
				"youdao-profile",
			]);
			expect(execution.prepare("").profileId).toBe("engine-profile");
			settings.profiles[0]!.enabled = false;
			expect(execution.prepare("").profileId).toBe("youdao-profile");
			await expect(
				execution
					.prepare("engine-profile")
					.translate("Hello", new AbortController().signal),
			).rejects.toMatchObject({ code: "config-not-found" });
			settings.profiles[1]!.enabled = false;
			expect(execution.prepare("").signature).toBe("none");
			expect(request).not.toHaveBeenCalled();
			expect(youdao).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("routes Youdao with its captured connection and direction", async () => {
		const { ai, execution, settings, request, youdao } = setup();
		try {
			const operation = execution.prepare("youdao-profile", "en-zh");
			const signal = new AbortController().signal;
			await expect(operation.translate("Hello", signal)).resolves.toMatchObject({
				text: "Youdao translation",
			});
			expect(youdao).toHaveBeenCalledWith(settings.youdao, "Hello", "en-zh", signal);
			expect(request).not.toHaveBeenCalled();
			expect(operation.signature).not.toContain("app-key-reference");
		} finally {
			ai.dispose();
		}
	});

	it("rejects an operation prepared before its Youdao connection changes", async () => {
		const { ai, execution, settings, youdao } = setup();
		try {
			const operation = execution.prepare("youdao-profile");
			settings.youdao.appSecretSecretId = "replacement-reference";
			await expect(
				operation.translate("Hello", new AbortController().signal),
			).rejects.toBeInstanceOf(TranslationConfigurationChangedError);
			expect(youdao).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("rejects prepared AI work after the selected engine changes and never falls back to a default", async () => {
		const { ai, engine, execution, request } = setup();
		try {
			const operation = execution.prepare("engine-profile");
			await ai.saveConfig({ ...engine, model: "replacement" });
			await expect(
				operation.translate("Hello", new AbortController().signal),
			).rejects.toBeInstanceOf(TranslationConfigurationChangedError);
			const fallbackId = await ai.saveConfig({ ...engine, id: undefined, name: "Fallback" });
			await ai.setDefault(fallbackId);
			await ai.deleteConfig(engine.id);
			const missing = execution.prepare("engine-profile");
			await expect(
				missing.translate("Hello", new AbortController().signal),
			).rejects.toMatchObject({ code: "config-not-found" });
			expect(request).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("borrows a fixed translation direction independently of the translator view's enabled state and direction", async () => {
		const { ai, execution, settings, request } = setup();
		try {
			const operation = execution.prepare("engine-profile", "en-zh");
			settings.enabled = false;
			settings.direction = "en-zh";
			await operation.translate("Hello", new AbortController().signal);
			expect(request).toHaveBeenCalledOnce();
			expect(request.mock.calls[0]![0].body).toContain("英文翻译为中文");
			expect(operation.signature).not.toContain("credential-reference");
		} finally {
			ai.dispose();
		}
	});

	it("rejects old task identities instead of treating an incomplete signature as current configuration", async () => {
		const { ai, execution, request } = setup();
		try {
			await expect(
				execution
					.prepare("engine-profile")
					.translate("Hello", new AbortController().signal, "8de0aced"),
			).rejects.toBeInstanceOf(TranslationConfigurationChangedError);
			expect(request).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});

	it("does not send cancelled requests", async () => {
		const { ai, execution, request, youdao } = setup();
		try {
			const controller = new AbortController();
			controller.abort();
			await expect(
				execution.prepare("engine-profile").translate("Hello", controller.signal),
			).rejects.toMatchObject({ code: "cancelled" });
			expect(request).not.toHaveBeenCalled();
			expect(youdao).not.toHaveBeenCalled();
		} finally {
			ai.dispose();
		}
	});
});
