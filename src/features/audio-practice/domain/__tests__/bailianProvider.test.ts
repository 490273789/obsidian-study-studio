import { describe, expect, it, vi } from "vite-plus/test";
import { AudioFailureError, type AudioFailure } from "../failures";
import { encodeMonoWav } from "../transcription/browserAudio";
import { createBailianProvider, parseBailianResponse } from "../transcription/bailianProvider";
import { transcriptionConfigFingerprint } from "../transcription/transcriptionConfig";
import type { BailianTranscriptionConfig } from "../transcriptionTypes";
import type { OutboundPort } from "../../../../core/net/types";

const chunk = { index: 0, start: 0, end: 2, wav: new ArrayBuffer(2) };
const config: BailianTranscriptionConfig = {
	provider: "bailian",
	workspaceId: "workspace",
	secretId: "secret",
	model: "fun-asr-flash-2026-06-15",
};

function failureOf(run: () => unknown): AudioFailure {
	try {
		run();
	} catch (error) {
		if (error instanceof AudioFailureError) return error.failure;
		throw error;
	}
	throw new Error("Expected an audio failure");
}

describe("bailian transcription & audio encoding", () => {
	it("keeps the workspace value out of saved draft fingerprints", async () => {
		const fingerprint = await transcriptionConfigFingerprint(config);
		expect(fingerprint).not.toContain(config.workspaceId);
		expect(fingerprint).not.toBe(
			await transcriptionConfigFingerprint({ ...config, workspaceId: "another-workspace" }),
		);
	});
	it("writes PCM WAV metadata and clips samples", () => {
		const wav = new DataView(encodeMonoWav(new Float32Array([-2, 0, 2])));
		expect(wav.getUint32(24, true)).toBe(16000);
		expect(wav.getUint16(22, true)).toBe(1);
		expect(wav.getInt16(44, true)).toBe(-32768);
		expect(wav.getInt16(48, true)).toBe(32767);
	});

	it("reads final SSE events, ignores partials, replaces duplicate sentence IDs", () => {
		const event = (text: string, final: boolean) =>
			`data:${JSON.stringify({ output: { sentence: { sentence_id: 1, sentence_end: final, begin_time: 0, end_time: 1000, text, words: [] } } })}\n\n`;
		expect(
			parseBailianResponse(
				event("partial", false) + event("final", true) + event("corrected", true),
			).cues.map((c) => c.text),
		).toEqual(["corrected"]);
		expect(failureOf(() => parseBailianResponse('{"code":"InvalidApiKey"}'))).toMatchObject({
			kind: "provider-failure",
			code: "server",
		});
	});

	it("folds cumulative SSE snapshots into one cue per sentence", () => {
		const event = (
			id: number,
			end: number,
			text: string,
			words: ReadonlyArray<readonly [string, number, number]>,
		) =>
			`data:${JSON.stringify({
				output: {
					sentence: {
						sentence_id: id,
						sentence_end: true,
						begin_time: 2190,
						end_time: end,
						text,
						words: words.map(([word, begin, finish]) => ({
							text: word,
							begin_time: begin,
							end_time: finish,
						})),
					},
				},
			})}\n\n`;
		const first = [
			["你", 2190, 2500],
			["好", 2500, 2800],
		] as const;
		const second = [...first, ["text", 9000, 9300], [" one", 9300, 9800]] as const;
		const third = [...second, ["再", 12000, 12400], ["见", 12400, 12800]] as const;
		const transcript = parseBailianResponse(
			event(1, 8520, "你好。", first) +
				event(2, 14480, "你好。text one. ", second) +
				event(3, 27020, "你好。text one. 再见。", third),
		);
		expect(transcript.cues.map((cue) => cue.text)).toEqual(["你好。", "text one.", "再见。"]);
		expect(transcript.cues.map((cue) => [cue.start, cue.end])).toEqual([
			[2.19, 8.52],
			[9, 14.48],
			[12, 27.02],
		]);
		expect(transcript.words.map((word) => word.text)).toEqual([
			"你",
			"好",
			"text",
			" one",
			"再",
			"见",
		]);
	});

	it("keeps independent sentences when a later text extends an earlier one", () => {
		const event = (id: number, begin: number, end: number, text: string) =>
			`data:${JSON.stringify({
				output: {
					sentence: {
						sentence_id: id,
						sentence_end: true,
						begin_time: begin,
						end_time: end,
						text,
						words: [],
					},
				},
			})}\n\n`;
		expect(
			parseBailianResponse(event(1, 0, 1000, "Hello") + event(2, 1000, 3000, "Hello world."))
				.cues,
		).toMatchObject([
			{ text: "Hello", start: 0, end: 1 },
			{ text: "Hello world.", start: 1, end: 3 },
		]);
	});

	it("sends only audio through outbound and pins workspace host and language", async () => {
		const request = vi.fn().mockResolvedValue({
			text: JSON.stringify({
				output: {
					sentence: {
						sentence_id: 1,
						sentence_end: true,
						begin_time: 0,
						end_time: 1000,
						text: "hello",
						words: [],
					},
				},
			}),
		});
		const port = { request, readSecret: () => "private-key" } as unknown as OutboundPort;
		await createBailianProvider(port)(chunk, config, new AbortController().signal);
		const spec = request.mock.calls[0]?.[0];
		expect(spec.url).toContain("workspace.cn-beijing.maas.aliyuncs.com");
		expect(JSON.parse(spec.body).parameters.language_hints).toEqual(["en"]);
		expect(JSON.parse(spec.body).input.messages).toHaveLength(1);
	});

	it("rejects a truncated SSE tail even when an earlier sentence completed", () => {
		const event = (id: number, final: boolean) =>
			`data:${JSON.stringify({ output: { sentence: { sentence_id: id, sentence_end: final, begin_time: 0, end_time: 1000, text: "hello", words: [] } } })}\n\n`;
		expect(
			failureOf(() => parseBailianResponse(event(1, true) + event(2, false))),
		).toMatchObject({
			kind: "provider-failure",
			code: "invalid-response",
			reason: "incomplete-stream",
		});
		expect(
			parseBailianResponse(event(1, true) + event(2, false) + event(2, true)).cues,
		).toHaveLength(2);
	});

	it("never exposes raw malformed provider response content", () => {
		expect(
			failureOf(() => parseBailianResponse('{"private-key":"sensitive-response" broken')),
		).toMatchObject({
			kind: "provider-failure",
			code: "invalid-response",
			reason: "invalid-payload",
		});
	});
});
