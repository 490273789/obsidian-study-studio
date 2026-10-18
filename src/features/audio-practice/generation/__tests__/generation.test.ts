import { describe, expect, it, vi } from "vite-plus/test";
import { alignReference, mergeTranscripts } from "../alignment";
import { encodeMonoWav } from "../browserAudio";
import { createBailianProvider, parseBailianResponse } from "../bailianProvider";
import { SubtitleGeneration, normalizeGenerationDraft } from "../subtitleGeneration";
import type {
	BailianTranscriptionConfig,
	GenerationDraft,
	GenerationInput,
	Transcript,
} from "../types";
import type { OutboundPort } from "../../../../core/net/types";

const transcript: Transcript = {
	cues: [{ id: "1", text: "Hello world.", start: 0, end: 1, needsReview: true }],
	words: [
		{ text: "Hello", start: 0, end: 0.5 },
		{ text: "world", start: 0.5, end: 1 },
	],
};
const chunk = { index: 0, start: 0, end: 2, wav: new ArrayBuffer(2) };
const config: BailianTranscriptionConfig = {
	provider: "bailian",
	workspaceId: "workspace",
	secretId: "secret",
	model: "fun-asr-flash-2026-06-15",
};
const input: GenerationInput = {
	audio: new ArrayBuffer(4),
	name: "test.wav",
	taskKey: "test",
	config,
};

describe("subtitle generation", () => {
	it("aligns original spelling and refuses ambiguous or missing sentences", () => {
		expect(alignReference("Hello WORLD!", transcript)[0]).toMatchObject({
			text: "Hello WORLD!",
			start: 0,
			end: 1,
			needsReview: false,
		});
		expect(alignReference("Goodbye world.", transcript)[0]?.start).toBeNull();
		const repeated = {
			...transcript,
			words: [
				...transcript.words,
				...transcript.words.map((word) => ({
					...word,
					start: word.start + 2,
					end: word.end + 2,
				})),
			],
		};
		expect(alignReference("Hello world.", repeated)[0]?.needsReview).toBe(true);
	});
	it("retains missing text without borrowing adjacent time", () => {
		const cues = alignReference("Hello world. Missing phrase. Hello again.", {
			cues: [],
			words: [
				...transcript.words,
				{ text: "Hello", start: 3, end: 3.5 },
				{ text: "again", start: 3.5, end: 4 },
			],
		});
		expect(cues.map((c) => [c.start, c.end])).toEqual([
			[0, 1],
			[null, null],
			[3, 4],
		]);
	});
	it("keeps overlap words only once at global times", () => {
		const result = mergeTranscripts(
			[
				transcript,
				{
					cues: [{ id: "2", text: "world", start: 0, end: 0.5, needsReview: true }],
					words: [{ text: "world", start: 0, end: 0.5 }],
				},
			],
			[chunk, { ...chunk, index: 1, start: 0.5, end: 3 }],
		);
		expect(result.words).toHaveLength(2);
	});
	it("retains a word only observed by the later overlapping chunk", () => {
		const first: Transcript = {
			cues: [{ id: "1", text: "Hello", start: 59, end: 59.5, needsReview: true }],
			words: [{ text: "Hello", start: 59, end: 59.5 }],
		};
		const second: Transcript = {
			cues: [{ id: "2", text: "Hello world", start: 0, end: 1.1, needsReview: true }],
			words: [
				{ text: "Hello", start: 0.05, end: 0.5 },
				{ text: "world", start: 0.7, end: 1.1 },
			],
		};
		const result = mergeTranscripts(
			[first, second],
			[
				{ ...chunk, end: 60 },
				{ ...chunk, index: 1, start: 59, end: 119 },
			],
		);
		expect(result.words.map((word) => word.text)).toEqual(["Hello", "world"]);
		expect(result.words[1]?.start).toBe(59.7);
		expect(result.cues.map((cue) => cue.text)).toEqual(["Hello", "world"]);
	});
	it("rejects sparse matches and long silent gaps", () => {
		const sparse: Transcript = {
			cues: [],
			words: [
				{ text: "Hello", start: 0, end: 1 },
				...Array.from({ length: 20 }, (_, index) => ({
					text: "unrelated",
					start: index + 1,
					end: index + 2,
				})),
				{ text: "world", start: 25, end: 26 },
			],
		};
		expect(alignReference("Hello world.", sparse)[0]).toMatchObject({
			needsReview: true,
			start: null,
			end: null,
		});
		expect(
			alignReference("Hello world.", {
				cues: [],
				words: [sparse.words[0]!, sparse.words[21]!],
			})[0]?.needsReview,
		).toBe(true);
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
		expect(() => parseBailianResponse('{"code":"InvalidApiKey"}')).toThrow();
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
		expect(() => parseBailianResponse(event(1, true) + event(2, false))).toThrow("不完整");
		expect(
			parseBailianResponse(event(1, true) + event(2, false) + event(2, true)).cues,
		).toHaveLength(2);
	});
	it("never exposes raw malformed provider response content", () => {
		expect(() => parseBailianResponse('{"private-key":"sensitive-response" broken')).toThrow(
			"语音服务返回了无效或不完整的识别结果。",
		);
	});
	it("persists successful chunks and only retries failed chunks", async () => {
		let saved: GenerationDraft | null = null;
		const transcribe = vi
			.fn()
			.mockResolvedValueOnce(transcript)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(transcript);
		const controller = new SubtitleGeneration({
			prepare: async () => ({
				duration: 4,
				chunks: [chunk, { ...chunk, index: 1, start: 2, end: 4 }],
			}),
			transcribe,
			drafts: {
				load: async () => saved,
				save: async (draft) => {
					saved = draft;
				},
			},
		});
		await controller.generate(input);
		expect(controller.getSnapshot().status).toBe("error");
		await controller.retry();
		expect(controller.getSnapshot().status).toBe("review");
		expect(transcribe).toHaveBeenCalledTimes(3);
		controller.editCue("0-1", { text: "Edited" });
		await controller.retry();
		expect(transcribe).toHaveBeenCalledTimes(3);
		expect(controller.getSnapshot().cues[0]?.text).toBe("Edited");
	});
	it("discards a provider result received after cancellation", async () => {
		let finish: (value: Transcript) => void = () => {};
		const transcribe = vi.fn(
			() =>
				new Promise<Transcript>((resolve) => {
					finish = resolve;
				}),
		);
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe,
		});
		const running = controller.generate(input);
		await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
		controller.cancel();
		finish(transcript);
		await running;
		expect(controller.getSnapshot().status).toBe("cancelled");
		expect(controller.getSnapshot().completedChunks).toBe(0);
	});
	it("rejects null, out of bounds and invalid draft timestamps", async () => {
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe: async () => transcript,
		});
		await controller.generate({ ...input, referenceText: "Missing sentence." });
		expect(() => controller.validatedCues()).toThrow();
		const id = controller.getSnapshot().cues[0]!.id;
		controller.editCue(id, { start: 0, end: 3 });
		expect(() => controller.validatedCues()).toThrow();
		controller.editCue(id, { end: 1, needsReview: false });
		expect(controller.validatedCues()).toHaveLength(1);
	});
	it("ignores late restore and clears missing material drafts", async () => {
		let resolveOld: (draft: GenerationDraft | null) => void = () => {};
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe: async () => transcript,
			drafts: {
				load: async (key) =>
					key === "old"
						? new Promise((resolve) => {
								resolveOld = resolve;
							})
						: null,
				save: async () => {},
			},
		});
		const old = controller.restore("old");
		await vi.waitFor(() => expect(controller.getSnapshot().taskKey).toBe("old"));
		await controller.restore("new");
		resolveOld({
			taskKey: "old",
			fingerprint: "old",
			duration: 2,
			results: [],
			cues: transcript.cues,
			complete: true,
			configFingerprint: "",
			notice: null,
		});
		await old;
		expect(controller.getSnapshot()).toMatchObject({
			taskKey: "new",
			cues: [],
			status: "idle",
		});
	});
	it("force generation bypasses complete cached results", async () => {
		const transcribe = vi.fn().mockResolvedValue(transcript);
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe,
		});
		await controller.generate(input);
		await controller.generate(input);
		expect(transcribe).toHaveBeenCalledTimes(1);
		await controller.generate(input, { force: true });
		expect(transcribe).toHaveBeenCalledTimes(2);
	});
	it("checks both audio bytes and exact original text before publishing a draft", async () => {
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe: async () => transcript,
		});
		await controller.generate({ ...input, referenceText: "Hello world." });
		expect(await controller.matchesSource(input.audio, "Hello world.")).toBe(true);
		expect(await controller.matchesSource(input.audio, "Changed original.")).toBe(false);
		expect(
			await controller.matchesSource(new Uint8Array([1, 0, 0, 0]).buffer, "Hello world."),
		).toBe(false);
	});
	it("rejects source checks when draft identity changes while hashing", async () => {
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe: async () => transcript,
		});
		await controller.generate(input);
		const matching = controller.matchesSource(input.audio, "");
		await controller.restore("another-material");
		expect(await matching).toBe(false);
	});
	it("permanently prevents new work and ignores late restores after disposal", async () => {
		let resolveLoad: (draft: GenerationDraft | null) => void = () => {};
		const prepare = vi.fn(async () => ({ duration: 2, chunks: [chunk] }));
		const load = vi.fn(
			async () =>
				new Promise<GenerationDraft | null>((resolve) => {
					resolveLoad = resolve;
				}),
		);
		const controller = new SubtitleGeneration({
			prepare,
			transcribe: async () => transcript,
			drafts: {
				load,
				save: async () => {},
			},
		});
		const restoring = controller.restore("old");
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		controller.dispose();
		const snapshot = controller.getSnapshot();
		resolveLoad({
			taskKey: "old",
			fingerprint: "old",
			duration: 2,
			results: [],
			cues: transcript.cues,
			complete: true,
			configFingerprint: "",
			notice: null,
		});
		expect(await restoring).toBe(false);
		expect(controller.getSnapshot()).toBe(snapshot);
		expect(await controller.restore("new")).toBe(false);
		await expect(controller.generate(input)).rejects.toThrow("已关闭");
		controller.editCue("1", { text: "edited" });
		expect(controller.getSnapshot()).toBe(snapshot);
		expect(await controller.matchesSource(input.audio, "")).toBe(false);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("does not reuse completed results after the transcription service changes", async () => {
		const transcribe = vi.fn().mockResolvedValue(transcript);
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe,
		});
		await controller.generate(input);
		expect(transcribe).toHaveBeenCalledTimes(1);
		await controller.generate({
			...input,
			config: { ...config, model: "qwen-audio-3.1-asr-flash" },
		});
		expect(transcribe).toHaveBeenCalledTimes(2);
	});
	it("falls back to recognized segments and reports missing word timestamps", async () => {
		const controller = new SubtitleGeneration({
			prepare: async () => ({ duration: 2, chunks: [chunk] }),
			transcribe: async () => ({
				cues: [{ id: "0", text: "Hello world.", start: 0, end: 1, needsReview: true }],
				words: [],
			}),
		});
		await controller.generate({ ...input, referenceText: "Hello world." });
		const snapshot = controller.getSnapshot();
		expect(snapshot.notice).toBe("no-word-timestamps");
		expect(snapshot.cues.map((cue) => cue.text)).toEqual(["Hello world."]);
	});
	it("normalizes legacy drafts without provider identity and rejects unknown notices", () => {
		const legacy = {
			taskKey: "test",
			fingerprint: "fingerprint",
			duration: 2,
			results: [],
			cues: transcript.cues,
			complete: false,
		};
		expect(normalizeGenerationDraft(legacy)).toMatchObject({
			configFingerprint: "",
			notice: null,
		});
		expect(normalizeGenerationDraft({ ...legacy, notice: "unknown" })?.notice).toBeNull();
	});
});
