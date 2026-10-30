import { describe, expect, it, vi } from "vite-plus/test";
import { MediaSubtitlePipeline, type SubtitleTranslationPort } from "../mediaSubtitlePipeline";
import { mediaFailure } from "../../failures";

describe("MediaSubtitlePipeline", () => {
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
			getSignature: vi.fn().mockResolvedValue(transcriptionSig),
			transcribe: vi.fn().mockImplementation(async () => {
				if (overrides.transcriptionError) throw overrides.transcriptionError;
				return {
					cues: [
						{ start: 0, end: 2.5, text: "Hello world" },
						{ start: 2.5, end: 5.0, text: "How are you" },
					],
				};
			}),
		};

		const translation: SubtitleTranslationPort = {
			getProfileId: vi.fn((sel) => sel || "default-profile"),
			getSignature: vi.fn(() => translationSig),
			listProfiles: vi.fn(() => [{ id: "default-profile", name: "Default" }]),
			translate: vi.fn().mockImplementation(async () => {
				if (overrides.translationError) throw overrides.translationError;
				return "你好世界";
			}),
		};

		const pipeline = new MediaSubtitlePipeline({ transcription, translation });
		return { pipeline, transcription, translation };
	}

	it("computes atomic opaque signature from transcription and translation", async () => {
		const { pipeline } = setup({ transcriptionSig: "t-sig", translationSig: "tr-sig" });
		const signature = await pipeline.getSignature({
			transcriptionProvider: "bailian",
			translationProfileId: "prof-1",
		});
		expect(typeof signature).toBe("string");
		expect(signature).toContain("bailian");
	});

	it("transcribes audio chunk and formats cues", async () => {
		const { pipeline } = setup();
		const sig = await pipeline.getSignature({ transcriptionProvider: "bailian" });
		const audio = new ArrayBuffer(16);
		const cues = await pipeline.transcribe(audio, sig);
		expect(cues).toEqual([
			{ start: 0, end: 2.5, text: "Hello world" },
			{ start: 2.5, end: 5.0, text: "How are you" },
		]);
	});

	it("detects transcription configuration drift and throws standardized message", async () => {
		const { pipeline, transcription } = setup();
		const sig = await pipeline.getSignature({ transcriptionProvider: "bailian" });

		// Simulate settings change
		transcription.getSignature.mockResolvedValue("new-drifted-signature");

		await expect(pipeline.transcribe(new ArrayBuffer(16), sig)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
	});

	it("catches config-drift media failure from engine and throws user friendly error", async () => {
		const { pipeline } = setup({
			transcriptionError: mediaFailure({ kind: "config-drift" }),
		});
		const sig = await pipeline.getSignature({ transcriptionProvider: "bailian" });

		await expect(pipeline.transcribe(new ArrayBuffer(16), sig)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
	});

	it("translates text using valid signature", async () => {
		const { pipeline } = setup();
		const sig = await pipeline.getSignature({
			transcriptionProvider: "bailian",
			translationProfileId: "prof-1",
		});
		const result = await pipeline.translate("Hello world", sig);
		expect(result).toBe("你好世界");
	});

	it("detects translation configuration drift and throws standardized message", async () => {
		const { pipeline, translation } = setup();
		const sig = await pipeline.getSignature({
			transcriptionProvider: "bailian",
			translationProfileId: "prof-1",
		});

		// Simulate translation settings drift
		translation.getSignature = vi.fn(() => "new-translation-sig");

		await expect(pipeline.translate("Hello world", sig)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});

	it("supports decoding legacy JSON format signatures seamlessly", async () => {
		const { pipeline } = setup({ transcriptionSig: "trans-1", translationSig: "trans-2" });
		const legacySignature = JSON.stringify({
			provider: "bailian",
			transcription: "trans-1",
			translationProfileId: "profile-1",
			translation: "trans-2",
		});

		const cues = await pipeline.transcribe(new ArrayBuffer(8), legacySignature);
		expect(cues).toHaveLength(2);

		const translated = await pipeline.translate("test", legacySignature);
		expect(translated).toBe("你好世界");
	});
});
