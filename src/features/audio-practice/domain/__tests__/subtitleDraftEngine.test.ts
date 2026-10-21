import { describe, expect, it, vi } from "vite-plus/test";
import {
	alignReference,
	alignTimedWords,
	mergeTranscripts,
	SubtitleDraftEngine,
	tokenizeUnicodeWords,
} from "../subtitleDraftEngine";
import type {
	AudioChunk,
	GenerationDraft,
	GenerationDraftStore,
	GenerationInput,
	TimedWord,
	Transcript,
} from "../transcriptionTypes";

function createMockAudio(bytes = 100): ArrayBuffer {
	return new ArrayBuffer(bytes);
}

const mockConfig = {
	provider: "bailian" as const,
	workspaceId: "test-workspace",
	secretId: "sec-1",
	model: "fun-asr-flash",
};

describe("subtitleDraftEngine - Unicode tokenization & alignment", () => {
	const words: TimedWord[] = [
		{ text: "Hello,", start: 1, end: 1.4 },
		{ text: "world!", start: 1.4, end: 2 },
	];

	it("preserves original text offsets while accepting capitalization and punctuation", () => {
		const text = "  HELLO — world?";
		const result = alignTimedWords(text, 1, 2, words);
		expect(result).toEqual([
			{ startOffset: 2, endOffset: 7, start: 1, end: 1.4 },
			{ startOffset: 10, endOffset: 15, start: 1.4, end: 2 },
		]);
		expect(result?.map((word) => text.slice(word.startOffset, word.endOffset))).toEqual([
			"HELLO",
			"world",
		]);
	});

	it("tokenizes words with unicode letters and standardized apostrophes", () => {
		const tokens = tokenizeUnicodeWords("Don’t say ‘hello’ in café!");
		expect(tokens.map((t) => t.text)).toEqual(["don't", "say", "hello", "in", "café"]);
		expect(tokens[0]!.start).toBe(0);
		expect(tokens[0]!.end).toBe(5);
	});

	it("normalizes curved apostrophes", () => {
		expect(alignTimedWords("Don’t!", 0, 1, [{ text: "don't", start: 0, end: 1 }])).toEqual([
			{ startOffset: 0, endOffset: 5, start: 0, end: 1 },
		]);
	});

	it("aligns contractions when recognition splits the apostrophe into timed words", () => {
		const text = "It's easy. But I've heard it.";
		expect(
			alignTimedWords(text, 1, 4.2, [
				{ text: "It", start: 1, end: 1.2 },
				{ text: "'", start: 1.2, end: 1.22 },
				{ text: "s", start: 1.22, end: 1.3 },
				{ text: "easy", start: 1.3, end: 1.8 },
				{ text: "But", start: 2, end: 2.3 },
				{ text: "I", start: 2.3, end: 2.5 },
				{ text: "'", start: 2.5, end: 2.55 },
				{ text: "ve", start: 2.55, end: 2.7 },
				{ text: "heard", start: 2.7, end: 3.3 },
				{ text: "it", start: 3.3, end: 4.2 },
			]),
		).toEqual([
			{ startOffset: 0, endOffset: 4, start: 1, end: 1.3 },
			{ startOffset: 5, endOffset: 9, start: 1.3, end: 1.8 },
			{ startOffset: 11, endOffset: 14, start: 2, end: 2.3 },
			{ startOffset: 15, endOffset: 19, start: 2.3, end: 2.7 },
			{ startOffset: 20, endOffset: 25, start: 2.7, end: 3.3 },
			{ startOffset: 26, endOffset: 28, start: 3.3, end: 4.2 },
		]);
	});

	it("matches repeated words individually in their original order", () => {
		expect(
			alignTimedWords("Go, go!", 0, 1, [
				{ text: "go", start: 0, end: 0.4 },
				{ text: "go", start: 0.5, end: 1 },
			]),
		).toEqual([
			{ startOffset: 0, endOffset: 2, start: 0, end: 0.4 },
			{ startOffset: 4, endOffset: 6, start: 0.5, end: 1 },
		]);
	});

	it("rejects missing, extra, reordered or edited words", () => {
		expect(alignTimedWords("Hello world again", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", 1, 2, words)).toBeNull();
		expect(alignTimedWords("world Hello", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello earth", 1, 2, words)).toBeNull();
		expect(
			alignTimedWords("Hello world", 1, 2, [{ text: "Hello world", start: 1, end: 2 }]),
		).toBeNull();
	});

	it("ignores other cues and clips small boundary errors", () => {
		expect(
			alignTimedWords("Hello world", 1, 2, [
				{ text: "before", start: 0, end: 0.8 },
				{ text: "Hello", start: 0.95, end: 1.4 },
				{ text: "world", start: 1.4, end: 2.05 },
				{ text: "after", start: 2.2, end: 3 },
			]),
		).toEqual([
			{ startOffset: 0, endOffset: 5, start: 1, end: 1.4 },
			{ startOffset: 6, endOffset: 11, start: 1.4, end: 2 },
		]);
	});

	it.each([
		[{ text: "Hello", start: NaN, end: 1.4 }, words[1]!],
		[{ text: "Hello", start: -1, end: 1.4 }, words[1]!],
		[{ text: "Hello", start: 1.4, end: 1 }, words[1]!],
		[{ text: "Hello", start: 1, end: 1 }, words[1]!],
		[{ text: "Hello", start: 0.8, end: 1.4 }, words[1]!],
		[words[0]!, { text: "world", start: 1.4, end: 2.2 }],
		[words[0]!, { text: "world", start: 1.3, end: 2 }],
		[
			{ text: "Hello", start: 1.6, end: 2 },
			{ text: "world", start: 1, end: 1.4 },
		],
	])(
		"rejects invalid, overlapping, nonmonotonic or out-of-bounds times: %j",
		(...invalidWords) => {
			expect(alignTimedWords("Hello world", 1, 2, invalidWords)).toBeNull();
		},
	);

	it("returns null without matching words or valid cue boundaries", () => {
		expect(alignTimedWords("Hello", 1, 2, [])).toBeNull();
		expect(alignTimedWords("?!", 1, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", 2, 1, words)).toBeNull();
		expect(alignTimedWords("Hello", NaN, 2, words)).toBeNull();
		expect(alignTimedWords("Hello", -1, 2, words)).toBeNull();
	});

	it("merges overlapping chunk transcripts using unicode word normalization", () => {
		const chunk1: AudioChunk = { index: 0, start: 0, end: 10, wav: createMockAudio() };
		const chunk2: AudioChunk = { index: 1, start: 9, end: 19, wav: createMockAudio() };
		const transcript1: Transcript = {
			cues: [{ id: "c1", text: "Don’t stop", start: 8.5, end: 9.8, needsReview: true }],
			words: [
				{ text: "don't", start: 8.5, end: 9.0 },
				{ text: "stop", start: 9.1, end: 9.8 },
			],
		};
		const transcript2: Transcript = {
			cues: [{ id: "c2", text: "stop now", start: 0.1, end: 1.5, needsReview: true }],
			words: [
				{ text: "stop", start: 0.1, end: 0.8 },
				{ text: "now", start: 0.9, end: 1.5 },
			],
		};
		const merged = mergeTranscripts([transcript1, transcript2], [chunk1, chunk2]);
		// "stop" in chunk2 maps to 9.1..9.8 in global time, overlapping with chunk1's "stop", so it is deduplicated
		expect(merged.words.map((w) => w.text)).toEqual(["don't", "stop", "now"]);
	});

	it("aligns reference text against recognized word timestamps", () => {
		const reference = "Hello world. Goodbye all.";
		const transcript: Transcript = {
			cues: [],
			words: [
				{ text: "hello", start: 1.0, end: 1.5 },
				{ text: "world", start: 1.5, end: 2.0 },
				{ text: "goodbye", start: 3.0, end: 3.5 },
				{ text: "all", start: 3.5, end: 4.0 },
			],
		};
		const alignedCues = alignReference(reference, transcript);
		expect(alignedCues).toHaveLength(2);
		expect(alignedCues[0]!.text).toBe("Hello world.");
		expect(alignedCues[0]!.start).toBe(1.0);
		expect(alignedCues[0]!.end).toBe(2.0);
		expect(alignedCues[0]!.needsReview).toBe(false);

		expect(alignedCues[1]!.text).toBe("Goodbye all.");
		expect(alignedCues[1]!.start).toBe(3.0);
		expect(alignedCues[1]!.end).toBe(4.0);
		expect(alignedCues[1]!.needsReview).toBe(false);
	});
});

describe("SubtitleDraftEngine - Deep Module Lifecycle & Actions", () => {
	function setupEngine() {
		const savedDrafts = new Map<string, GenerationDraft>();
		const draftStore: GenerationDraftStore = {
			load: async (key) => savedDrafts.get(key) ?? null,
			save: async (draft) => {
				savedDrafts.set(draft.taskKey, draft);
			},
			remove: async (key) => {
				savedDrafts.delete(key);
			},
		};

		const prepare = vi.fn(async () => ({
			duration: 10,
			chunks: [{ index: 0, start: 0, end: 10, wav: createMockAudio() }],
		}));

		const transcribe = vi.fn(async () => ({
			cues: [
				{ id: "cue-1", text: "Hello world", start: 1.0, end: 2.0, needsReview: true },
				{ id: "cue-2", text: "Nice to meet you", start: 3.0, end: 5.0, needsReview: true },
			],
			words: [
				{ text: "hello", start: 1.0, end: 1.4 },
				{ text: "world", start: 1.5, end: 2.0 },
				{ text: "nice", start: 3.0, end: 3.4 },
				{ text: "to", start: 3.5, end: 3.8 },
				{ text: "meet", start: 3.9, end: 4.4 },
				{ text: "you", start: 4.5, end: 5.0 },
			],
		}));

		const engine = new SubtitleDraftEngine({
			prepare,
			transcribe,
			drafts: draftStore,
		});

		return { engine, prepare, transcribe, draftStore, savedDrafts };
	}

	it("executes the full generation pipeline and delivers precomputed highlightable cues in snapshot", async () => {
		const { engine } = setupEngine();
		const input: GenerationInput = {
			audio: createMockAudio(),
			name: "test.mp3",
			taskKey: "material-1",
			config: mockConfig,
		};

		await engine.generate(input);

		const snapshot = engine.getSnapshot();
		expect(snapshot.status).toBe("review");
		expect(snapshot.taskKey).toBe("material-1");
		expect(snapshot.hasReviewWordTimings).toBe(true);
		expect(snapshot.cues).toHaveLength(2);

		// Both cues match recognized words exactly, so highlightable should be precomputed as true
		expect(snapshot.cues[0]!.highlightable).toBe(true);
		expect(snapshot.cues[1]!.highlightable).toBe(true);
	});

	it("dispatches atomic draft actions through the single act() seam", async () => {
		const { engine } = setupEngine();
		const input: GenerationInput = {
			audio: createMockAudio(),
			name: "test.mp3",
			taskKey: "material-1",
			config: mockConfig,
		};

		await engine.generate(input);

		let snapshot = engine.getSnapshot();
		const firstId = snapshot.cues[0]!.id;

		// 1. edit-cue: text changed so word alignment no longer matches
		engine.act({
			type: "edit-cue",
			id: firstId,
			patch: { text: "Hello planet" },
		});

		snapshot = engine.getSnapshot();
		expect(snapshot.cues[0]!.text).toBe("Hello planet");
		expect(snapshot.cues[0]!.highlightable).toBe(false); // "planet" doesn't match "world"!

		// 2. confirm-all-cues
		engine.act({ type: "confirm-all-cues" });
		snapshot = engine.getSnapshot();
		expect(snapshot.cues.every((c) => !c.needsReview)).toBe(true);

		// 3. add-cue
		engine.act({ type: "add-cue" });
		snapshot = engine.getSnapshot();
		expect(snapshot.cues).toHaveLength(3);
		const added = snapshot.cues[2]!;
		expect(added.text).toBe("");
		expect(added.needsReview).toBe(true);

		// 4. remove-cue
		engine.act({ type: "remove-cue", id: added.id });
		snapshot = engine.getSnapshot();
		expect(snapshot.cues).toHaveLength(2);
	});

	it("produces validated cues and aligned word timings for persistent storage", async () => {
		const { engine } = setupEngine();
		const input: GenerationInput = {
			audio: createMockAudio(),
			name: "test.mp3",
			taskKey: "material-1",
			config: mockConfig,
		};

		await engine.generate(input);
		engine.act({ type: "confirm-all-cues" });

		const validated = engine.validatedCues();
		expect(validated).toHaveLength(2);
		expect(validated[0]!.start).toBe(1.0);
		expect(validated[0]!.end).toBe(2.0);

		const firstId = validated[0]!.id;
		const secondId = validated[1]!.id;
		const timings = engine.getValidatedWordTimings();
		expect(timings[firstId]).toHaveLength(2);
		expect(timings[firstId]![0]!.startOffset).toBe(0);
		expect(timings[firstId]![0]!.endOffset).toBe(5);
		expect(timings[secondId]).toHaveLength(4);
	});
});
