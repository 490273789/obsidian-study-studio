import { describe, expect, it } from "vite-plus/test";
import type { AudioFailure } from "../../domain/failures";
import { audioFailureCopy } from "../failures";

describe("audio failure copy", () => {
	it("keeps the existing Chinese messages and adds English ones", () => {
		expect(audioFailureCopy("zh", { kind: "audio-too-large", maxBytes: 1 }).message).toBe(
			"生成字幕仅支持 50 MiB 以内的音频。",
		);
		expect(audioFailureCopy("en", { kind: "audio-too-large", maxBytes: 1 }).message).toBe(
			"Subtitle generation supports audio up to 50 MiB.",
		);
		expect(audioFailureCopy("zh", { kind: "source-changed" }).message).toBe(
			"音频或原文已改变，请重新生成字幕后保存。",
		);
		expect(audioFailureCopy("en", { kind: "source-changed" }).message).toBe(
			"Audio or reference text has changed. Generate subtitles again before saving.",
		);
	});

	it("formats structured subtitle problems with 1-based indexes", () => {
		expect(
			audioFailureCopy("zh", {
				kind: "subtitle-invalid",
				problems: [
					{ kind: "no-cues" },
					{ kind: "empty-text", cueIndex: 0 },
					{ kind: "out-of-range", cueIndex: 2 },
				],
			}).message,
		).toBe("至少需要一个字幕片段；第 1 段文字为空；第 3 段超出音频范围");
	});

	it("maps provider codes and response reasons", () => {
		expect(
			audioFailureCopy("en", {
				kind: "provider-failure",
				code: "unauthorized",
			}).message,
		).toBe(
			"The speech service rejected the credentials. Check the API key and service configuration.",
		);
		expect(
			audioFailureCopy("zh", {
				kind: "provider-failure",
				code: "invalid-response",
				reason: "missing-word-timestamps",
			}).message,
		).toContain("词级时间戳");
	});

	it("exposes one recovery action per failure kind", () => {
		const cases: [AudioFailure, string | null][] = [
			[{ kind: "missing-file" }, "choose-file"],
			[{ kind: "audio-too-long", maxSeconds: 600 }, "choose-file"],
			[{ kind: "no-speech" }, "regenerate"],
			[{ kind: "source-changed" }, "regenerate"],
			[{ kind: "config-invalid", field: "secret" }, "open-settings"],
			[{ kind: "provider-failure", code: "timeout" }, "retry"],
			[{ kind: "subtitle-invalid", problems: [] }, "regenerate"],
			[{ kind: "cancelled" }, null],
			[{ kind: "stale-material" }, null],
		];
		for (const [failure, action] of cases)
			expect(audioFailureCopy("zh", failure).action).toBe(action);
	});

	it("renders busy and unknown through the same surface", () => {
		expect(audioFailureCopy("zh", { kind: "busy" }).message).toBe(
			"上一次操作尚未完成，请稍后再试。",
		);
		expect(audioFailureCopy("en", { kind: "unknown" }).message).toBe(
			"The operation failed. Retry.",
		);
	});
});
