import { describe, expect, it } from "vite-plus/test";
import { parseSubtitles, serializeSrt, validateCues } from "../subtitles";

describe("SRT timing precision", () => {
	const cue = { id: "cue", text: "Subtitle", start: 1.0001, end: 1.0002 };

	it("rejects a cue whose start and end round to the same millisecond", () => {
		expect(validateCues([cue])).toContainEqual({ kind: "bad-timing", cueIndex: 0 });
		expect(() => serializeSrt([cue])).toThrow("subtitle-invalid");
	});

	it("preserves cues that still span at least one millisecond after rounding", () => {
		const srt = serializeSrt([{ ...cue, end: 1.0008 }]);
		expect(parseSubtitles(srt)).toMatchObject([{ start: 1, end: 1.001, text: cue.text }]);
	});
});
