import { describe, expect, it } from "vite-plus/test";
import { MediaFailureError, toMediaFailure } from "../../../../core/media/failures";
import { parseSubtitles as parseSharedSubtitles } from "../../../../core/media/subtitles";
import { AudioFailureError, type AudioFailure } from "../failures";
import { parseSubtitles, serializeSrt, validateCues } from "../subtitles";

function failureOf(run: () => unknown): AudioFailure {
	try {
		run();
	} catch (error) {
		if (error instanceof AudioFailureError) return error.failure;
		throw error;
	}
	throw new Error("Expected an audio failure");
}

describe("audio subtitles", () => {
	it("preserves typed errors and cue identity through shared media contracts", () => {
		const source = "00:01.000 --> 00:02.000\nHello";
		expect(parseSharedSubtitles(source)).toEqual(parseSubtitles(source));
		try {
			parseSharedSubtitles("");
			throw new Error("Expected subtitle failure");
		} catch (error) {
			expect(error).toBeInstanceOf(MediaFailureError);
			expect(error).toBeInstanceOf(AudioFailureError);
			expect(toMediaFailure(error)).toEqual({ kind: "subtitle-parse", reason: "empty" });
			expect(
				failureOf(() => {
					throw error;
				}),
			).toEqual(toMediaFailure(error));
		}
	});
	it("refuses blank lines that cannot survive SRT roundtrip without losing text", () => {
		const cue = { id: "draft", start: 1, end: 2, text: "Hello\n\nworld" };
		expect(failureOf(() => serializeSrt([cue]))).toMatchObject({
			kind: "subtitle-invalid",
			problems: [{ kind: "blank-line", cueIndex: 0 }],
		});
		const corrected = { ...cue, text: "Hello\nworld" };
		expect(parseSubtitles(serializeSrt([corrected]))[0]!.text).toBe(corrected.text);
	});
	it("reads multiline VTT settings and roundtrips SRT with stable identity", () => {
		const cues = parseSubtitles(
			"WEBVTT\n\nintro\n00:01.200 --> 00:02.300 align:start\nHello\nworld\n\n00:03.000 --> 00:04.000\nAgain",
		);
		expect(cues[0]).toMatchObject({ start: 1.2, end: 2.3, text: "Hello\nworld" });
		expect(parseSubtitles(serializeSrt(cues))).toEqual(cues);
	});
	it("rejects invalid times and refuses unreviewed draft publication", () => {
		expect(
			failureOf(() => parseSubtitles("1\n00:60:00,000 --> 00:61:00,000\nBad")),
		).toMatchObject({ kind: "subtitle-parse", reason: "content" });
		expect(
			validateCues([{ id: "x", text: "Hi", start: 1, end: 5, needsReview: true }], 4),
		).toHaveLength(2);
	});
	it("keeps identity when a preceding cue is added", () => {
		const original = "00:03.000 --> 00:04.000\nAgain";
		expect(parseSubtitles(`00:01.000 --> 00:02.000\nNew\n\n${original}`)[1]!.id).toEqual(
			parseSubtitles(original)[0]!.id,
		);
	});
});
