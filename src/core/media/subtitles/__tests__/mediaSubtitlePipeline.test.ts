import { describe, expect, it, vi } from "vite-plus/test";
import {
	MediaSubtitlePipeline,
	decodePipelineSignature,
	type SubtitleTranslationPort,
} from "../mediaSubtitlePipeline";
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
			getProfileId: vi.fn((sel: string) => sel || "default-profile"),
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

	it("computes a v2 signature from the ASR engine id and translation profile", async () => {
		const { pipeline, transcription } = setup({
			transcriptionSig: "t-sig",
			translationSig: "tr-sig",
		});
		const signature = await pipeline.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		expect(transcription.getSignature).toHaveBeenCalledWith("engine-a");
		expect(decodePipelineSignature(signature)).toEqual({
			v: 2,
			e: "engine-a",
			ts: "t-sig",
			tp: "prof-1",
			tls: "tr-sig",
		});
	});

	it("treats an empty engine id as the default ASR engine", async () => {
		const { pipeline, transcription } = setup({ transcriptionSig: "t-sig" });
		const signature = await pipeline.getSignature({ transcriptionEngineId: "" });
		expect(transcription.getSignature).toHaveBeenCalledWith("");
		expect(decodePipelineSignature(signature)).toMatchObject({ v: 2, e: "" });
	});

	it("transcribes audio through the signed engine id and formats cues", async () => {
		const { pipeline, transcription } = setup();
		const sig = await pipeline.getSignature({ transcriptionEngineId: "engine-a" });
		const audio = new ArrayBuffer(16);
		const cues = await pipeline.transcribe(audio, sig);
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
		const { pipeline, transcription } = setup();
		const sig = await pipeline.getSignature({ transcriptionEngineId: "engine-a" });

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
		const sig = await pipeline.getSignature({ transcriptionEngineId: "engine-a" });

		await expect(pipeline.transcribe(new ArrayBuffer(16), sig)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
	});

	it("translates text using valid signature", async () => {
		const { pipeline } = setup();
		const sig = await pipeline.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});
		const result = await pipeline.translate("Hello world", sig);
		expect(result).toBe("你好世界");
	});

	it("detects translation configuration drift and throws standardized message", async () => {
		const { pipeline, translation } = setup();
		const sig = await pipeline.getSignature({
			transcriptionEngineId: "engine-a",
			translationProfileId: "prof-1",
		});

		// Simulate translation settings drift
		translation.getSignature = vi.fn(() => "new-translation-sig");

		await expect(pipeline.translate("Hello world", sig)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});

	it("requires a translation profile before translating", async () => {
		const { pipeline, translation } = setup();
		translation.getProfileId = vi.fn(() => "");
		const sig = await pipeline.getSignature({ transcriptionEngineId: "engine-a" });
		await expect(pipeline.translate("Hello world", sig)).rejects.toThrow(
			"请在影子跟读设置中启用翻译配置。",
		);
	});

	it("rejects pre-v2 signatures that carry a transcription provider instead of an engine id", async () => {
		const { pipeline } = setup();
		const legacySignature = JSON.stringify({
			provider: "bailian",
			transcription: "trans-1",
			translationProfileId: "profile-1",
			translation: "trans-2",
		});

		await expect(pipeline.transcribe(new ArrayBuffer(8), legacySignature)).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
		await expect(pipeline.translate("test", legacySignature)).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});

	it("rejects malformed signatures", async () => {
		const { pipeline } = setup();
		await expect(pipeline.transcribe(new ArrayBuffer(8), "not-json")).rejects.toThrow(
			"转写配置已变化，请重新生成字幕。",
		);
		await expect(pipeline.translate("test", "not-json")).rejects.toThrow(
			"翻译配置已变化，请重新生成字幕。",
		);
	});
});
