import { describe, expect, it, vi } from "vite-plus/test";
import { transcriptionConfigFingerprint } from "../../../../core/media/transcription/transcriptionConfig";
import { audioPracticeSettingsSlice } from "../../settings/slice";
import {
	TranscriptionConfiguration,
	TranscriptionConfigurationChangedError,
} from "../transcriptionConfiguration";

function setup() {
	const settings = {
		...audioPracticeSettingsSlice.defaults().audioPractice,
		bailianWorkspaceId: " legacy-workspace ",
		bailianWorkspaceSecretId: " workspace-reference ",
		bailianSecretId: " api-key-reference ",
		bailianModel: " bailian-model ",
		openaiBaseUrl: " https://speech.example/v1/ ",
		openaiSecretId: " compatible-key-reference ",
		openaiModel: " compatible-model ",
	};
	const secrets = new Map([
		["workspace-reference", " selected-workspace "],
		["api-key-reference", "api-key-value"],
		["compatible-key-reference", "compatible-key-value"],
	]);
	const readSecret = vi.fn((id: string) => secrets.get(id) ?? null);
	const configuration = new TranscriptionConfiguration({ read: () => settings, readSecret });
	return { settings, secrets, readSecret, configuration };
}

describe("transcription configuration", () => {
	it("prepares the preferred workspace and normalized provider fields without changing the selected provider", () => {
		const { configuration, settings } = setup();
		expect(configuration.prepare()).toEqual({
			provider: "bailian",
			workspaceId: "selected-workspace",
			secretId: "api-key-reference",
			model: "bailian-model",
		});
		expect(configuration.prepare("openai-compatible")).toEqual({
			provider: "openai-compatible",
			baseUrl: "https://speech.example/v1/",
			secretId: "compatible-key-reference",
			model: "compatible-model",
		});
		expect(settings.provider).toBe("bailian");
	});

	it.each(["missing", "unreadable"])(
		"never falls back to plaintext for a %s selected workspace secret",
		(mode) => {
			const { configuration, secrets, readSecret } = setup();
			secrets.delete("workspace-reference");
			if (mode === "unreadable")
				readSecret.mockImplementation(() => {
					throw new Error("secret unavailable");
				});
			expect(() => configuration.prepare()).toThrowError(
				expect.objectContaining({
					failure: { kind: "config-invalid", field: "workspace" },
				}),
			);
		},
	);

	it("uses the legacy workspace only when no secret reference is selected", () => {
		const { configuration, settings, readSecret } = setup();
		settings.bailianWorkspaceSecretId = "";
		expect(configuration.prepare()).toMatchObject({ workspaceId: "legacy-workspace" });
		expect(readSecret).not.toHaveBeenCalledWith("workspace-reference");
	});

	it("classifies a failed API credential read during preflight", () => {
		const { configuration, readSecret } = setup();
		readSecret.mockImplementation((id) => {
			if (id === "workspace-reference") return "selected-workspace";
			throw new Error("secret unavailable");
		});
		expect(() => configuration.prepare()).toThrowError(
			expect.objectContaining({
				failure: { kind: "config-invalid", field: "secret" },
			}),
		);
	});

	it("keeps existing draft identities and does not require an API key just to identify configuration", async () => {
		const { configuration, secrets, readSecret } = setup();
		const expected = await transcriptionConfigFingerprint(configuration.prepare());
		readSecret.mockClear();
		secrets.delete("api-key-reference");
		expect(await configuration.signature()).toBe(expected);
		expect(await configuration.signature()).not.toContain("selected-workspace");
		expect(readSecret).not.toHaveBeenCalledWith("api-key-reference");
		expect(() => configuration.prepare()).toThrowError(
			expect.objectContaining({
				failure: { kind: "config-invalid", field: "secret" },
			}),
		);
	});

	it("rejects settings changed while a fingerprint is being computed", async () => {
		const { configuration, settings } = setup();
		const signature = await configuration.signature("openai-compatible");
		const pending = configuration.accept(
			"openai-compatible",
			signature,
			new AbortController().signal,
		);
		settings.openaiModel = "replacement-model";
		await expect(pending).rejects.toBeInstanceOf(TranscriptionConfigurationChangedError);
	});

	it("rejects a workspace secret changed while asynchronous hashing is in progress", async () => {
		const { configuration, secrets } = setup();
		const signature = await configuration.signature("bailian");
		const pending = configuration.accept("bailian", signature, new AbortController().signal);
		secrets.set("workspace-reference", "replacement-workspace");
		await expect(pending).rejects.toBeInstanceOf(TranscriptionConfigurationChangedError);
	});

	it("returns a fixed configuration for admitted work even if settings change afterwards", async () => {
		const { configuration, settings } = setup();
		const signature = await configuration.signature("bailian");
		const config = await configuration.accept(
			"bailian",
			signature,
			new AbortController().signal,
		);
		settings.bailianModel = "replacement-model";
		expect(config.model).toBe("bailian-model");
		expect(Object.isFrozen(config)).toBe(true);
	});

	it("rejects cancellation during asynchronous hashing", async () => {
		const { configuration } = setup();
		const signature = await configuration.signature("bailian");
		const controller = new AbortController();
		const pending = configuration.accept("bailian", signature, controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
	});
});
