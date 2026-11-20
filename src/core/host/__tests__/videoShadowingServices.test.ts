import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({
	AbstractInputSuggest: class {},
	Component: class {},
	ItemView: class {},
	MarkdownView: class {},
	Modal: class {},
	Notice: vi.fn(),
	Platform: { isDesktopApp: false, resourcePathPrefix: "app://vault/" },
	Plugin: class {},
	TFile: class {},
	normalizePath: (value: string) => value,
	requestUrl: vi.fn(),
}));

import {
	assembleVideoShadowingServices,
	type VideoShadowingServiceComponents,
} from "../../../features/index";
import { TranslationConfigurationChangedError } from "../../../features/translation/domain/translationExecution";
import { mediaFailure } from "../../media/failures";

describe("assembleVideoShadowingServices", () => {
	function setup(
		overrides: {
			transcriptionSig?: string;
			translationSig?: string;
			transcriptionError?: Error;
			translationError?: Error;
		} = {},
	) {
		const transcriptionSig = overrides.transcriptionSig ?? "trans-sig-1";
		const translationSig = overrides.translationSig ?? "trans-sig-en-zh";

		const transcription = {
			getSignature: vi.fn(async () => transcriptionSig),
			transcribe: vi.fn(async () => {
				if (overrides.transcriptionError) throw overrides.transcriptionError;
				return {
					cues: [
						{ id: "c1", start: 0, end: 2.5, text: "Hello world", needsReview: false },
						{ id: "c2", start: 2.5, end: 5.0, text: "How are you", needsReview: false },
						{ id: "c3", start: null, end: null, text: "unaligned", needsReview: true },
					],
					words: [],
					duration: 5.0,
					signature: transcriptionSig,
				};
			}),
		};

		const translation = {
			getProfileId: vi.fn((sel: string) => sel || "default-profile"),
			getSignature: vi.fn(() => translationSig),
			listProfiles: vi.fn(() => [{ id: "default-profile", name: "Default" }]),
			translate: vi.fn(async () => {
				if (overrides.translationError) throw overrides.translationError;
				return { text: "你好世界" };
			}),
		} satisfies VideoShadowingServiceComponents["translation"];

		const services = assembleVideoShadowingServices({ transcription, translation });
		return { services, transcription, translation };
	}

	it("computes a v2 signature from the ASR engine id and translation profile", async () => {
		const { services, transcription } = setup({
			transcriptionSig: "t-sig",
			translationSig: "tr-sig",
		});
		const signature = await services.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		expect(transcription.getSignature).toHaveBeenCalledWith("engine-a");
		expect(JSON.parse(signature)).toEqual({
			v: 2,
			e: "engine-a",
			ts: "t-sig",
			tp: "prof-1",
			tls: "tr-sig",
		});
	});

	it("treats an empty engine id as the default ASR engine", async () => {
		const { services, transcription } = setup({ transcriptionSig: "t-sig" });
		const signature = await services.getSignature({ transcriptionEngineId: "" });
		expect(transcription.getSignature).toHaveBeenCalledWith("");
		expect(JSON.parse(signature)).toMatchObject({ v: 2, e: "" });
	});

	it("transcribes audio through the signed engine id and filters unaligned cues", async () => {
		const { services, transcription } = setup();
		const sig = await services.getSignature({ transcriptionEngineId: "engine-a" });
		const audio = new ArrayBuffer(16);
		const cues = await services.transcribe(audio, sig);
		expect(transcription.transcribe).toHaveBeenCalledWith({
			audio,
			engineId: "engine-a",
			expectedSignature: "trans-sig-1",
			signal: undefined,
		});
		expect(cues).toEqual([
			{ start: 0, end: 2.5, text: "Hello world" },
			{ start: 2.5, end: 5.0, text: "How are you" },
		]);
	});

	it("detects transcription configuration drift and throws standardized message", async () => {
		const { services, transcription } = setup();
		const sig = await services.getSignature({ transcriptionEngineId: "engine-a" });

		transcription.getSignature.mockResolvedValue("new-drifted-signature");

		await expect(services.transcribe(new ArrayBuffer(16), sig)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
	});

	it("catches config-drift media failure from engine and throws user friendly error", async () => {
		const { services } = setup({
			transcriptionError: mediaFailure({ kind: "config-drift" }),
		});
		const sig = await services.getSignature({ transcriptionEngineId: "engine-a" });

		await expect(services.transcribe(new ArrayBuffer(16), sig)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
	});

	it("translates text using valid signature and lists translation profiles", async () => {
		const { services, translation } = setup();
		expect(services.listTranslationProfiles()).toEqual([
			{ id: "default-profile", name: "Default" },
		]);
		const sig = await services.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		const result = await services.translate("Hello world", sig);
		expect(result).toBe("你好世界");
		expect(translation.translate).toHaveBeenCalledWith("Hello world", {
			profileId: "prof-1",
			expectedSignature: "trans-sig-en-zh",
			signal: undefined,
		});
	});

	it("detects translation configuration drift and TranslationConfigurationChangedError", async () => {
		const drifted = setup();
		const sig = await drifted.services.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		drifted.translation.getSignature = vi.fn(() => "new-translation-sig");
		await expect(drifted.services.translate("Hello world", sig)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);

		const race = setup({ translationError: new TranslationConfigurationChangedError() });
		const raceSig = await race.services.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		await expect(race.services.translate("Hello world", raceSig)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});

	it("requires a translation profile before translating", async () => {
		const { services, translation } = setup();
		translation.getProfileId = vi.fn(() => "");
		const sig = await services.getSignature({ transcriptionEngineId: "engine-a" });
		await expect(services.translate("Hello world", sig)).rejects.toThrow(
			"请在影子跟读设置中启用翻译配置。",
		);
	});

	it("rejects pre-v2 signatures that carry a transcription provider instead of an engine id", async () => {
		const { services } = setup();
		const legacySignature = JSON.stringify({
			provider: "bailian",
			transcription: "trans-1",
			translationProfileId: "profile-1",
			translation: "trans-2",
		});

		await expect(services.transcribe(new ArrayBuffer(8), legacySignature)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
		await expect(services.translate("test", legacySignature)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});

	it("rejects malformed signatures", async () => {
		const { services } = setup();
		await expect(services.transcribe(new ArrayBuffer(8), "not-json")).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
		await expect(services.translate("test", "not-json")).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});
});
