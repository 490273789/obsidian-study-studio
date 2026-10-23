import { describe, expect, it, vi } from "vite-plus/test";
import { parseShadowSubtitleImport } from "../shadowSubtitles";
import {
	VideoSubtitleJobs,
	type ShadowSubtitleCheckpoint,
	type ShadowSubtitleStore,
} from "../shadowSubtitlesJobs";
import type { ShadowSubtitleDocument } from "../shadowSubtitles";

function fixture() {
	const documents = new Map<string, ShadowSubtitleDocument>();
	const store: ShadowSubtitleStore = {
		load: async (id) => documents.get(id) ?? null,
		save: async (document) => {
			documents.set(document.sourceId, structuredClone(document));
		},
		loadCheckpoints: () => [],
		saveCheckpoints: vi.fn(),
	};
	return { store, documents };
}
async function until(predicate: () => boolean) {
	await vi.waitFor(() => expect(predicate()).toBe(true));
}
const source = { id: "video", path: "/video.mp4" };
const config = { sourceSignature: "signature", serviceSignature: "service" };

describe("shadow subtitles", () => {
	it("imports multi-line text literally and parses both timestamp formats", () => {
		expect(
			parseShadowSubtitleImport(
				"1\n00:00:01,000 --> 00:00:03,000\nHello\n<script>x</script>",
				"srt",
			)[0],
		).toMatchObject({ start: 1, end: 3, text: "Hello\n<script>x</script>" });
		expect(
			parseShadowSubtitleImport(
				"WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHello",
				"vtt",
			)[0],
		).toMatchObject({ start: 1, end: 2 });
		expect(() =>
			parseShadowSubtitleImport("1\n00:00:03,000 --> 00:00:01,000\nx", "srt"),
		).toThrow();
	});
	it("requires adoption, preserves previous version, and protects manual edits from late translation", async () => {
		const { store } = fixture();
		let finish!: (text: string) => void;
		const jobs = new VideoSubtitleJobs({
			store,
			extract: async () => ({
				audio: new ArrayBuffer(0),
				duration: 10,
				totalDuration: 10,
				sourceSignature: "signature",
			}),
			transcribe: async () => [{ start: 0, end: 1, text: "Hello" }],
			translate: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		await jobs.start(source, config);
		await until(() => jobs.getCues("video").length === 1);
		await jobs.editCue("video", jobs.getCues("video")[0]!.id, {
			text: "Corrected",
			translation: "人工译文",
		});
		finish("自动译文");
		await until(() => jobs.getSnapshot().tasks[0]?.status === "complete");
		expect(jobs.getCues("video")[0]).toMatchObject({
			text: "Corrected",
			translation: "人工译文",
		});
		await jobs.importSubtitles("video", "1\n00:00:00,000 --> 00:00:01,000\nReplacement", "srt");
		expect(jobs.getCues("video")[0]!.text).toBe("Corrected");
		await jobs.adoptCandidate("video");
		expect(jobs.getCues("video")[0]!.text).toBe("Replacement");
		await jobs.restorePrevious("video");
		expect(jobs.getCues("video")[0]!.text).toBe("Corrected");
		jobs.dispose();
	});
	it("uses one extraction slot, deduplicates chunk overlap and persists continuation", async () => {
		const { store } = fixture();
		const offsets: number[] = [];
		const jobs = new VideoSubtitleJobs({
			store,
			extract: async (_source, offset) => {
				offsets.push(offset);
				return {
					audio: new ArrayBuffer(offset),
					duration: offset === 0 ? 60 : 11,
					totalDuration: 70,
					sourceSignature: "signature",
				};
			},
			transcribe: async (audio) =>
				audio.byteLength === 0
					? [{ start: 59, end: 60, text: "overlap" }]
					: [
							{ start: 0, end: 1, text: "overlap" },
							{ start: 2, end: 3, text: "next" },
						],
		});
		await jobs.start(source, config);
		await until(() => jobs.getSnapshot().tasks[0]?.status === "complete");
		expect(offsets).toEqual([0, 59]);
		expect(jobs.getCues("video").map((cue) => cue.text)).toEqual(["overlap", "next"]);
		expect(jobs.getSnapshot().tasks[0]!.nextOffset).toBe(70);
		jobs.dispose();
	});
	it("resumes restored tasks only on explicit request and rejects a changed video", async () => {
		const { store } = fixture();
		const task: ShadowSubtitleCheckpoint = {
			source,
			config,
			nextOffset: 59,
			totalDuration: 70,
			status: "running",
			error: null,
		};
		store.loadCheckpoints = () => [task];
		const extract = vi.fn(async () => ({
			audio: new ArrayBuffer(0),
			duration: 11,
			totalDuration: 70,
			sourceSignature: "changed",
		}));
		const jobs = new VideoSubtitleJobs({ store, extract, transcribe: vi.fn() });
		expect(jobs.getSnapshot().tasks[0]!.status).toBe("paused");
		expect(extract).not.toHaveBeenCalled();
		await jobs.resume("video");
		await until(() => jobs.getSnapshot().tasks[0]?.status === "failed");
		expect(jobs.getSnapshot().tasks[0]!.error).toContain("变化");
		expect(jobs.getSnapshot().tasks[0]!.nextOffset).toBe(59);
		jobs.dispose();
	});
	it("discards late results after pause", async () => {
		const { store } = fixture();
		let finish!: (cues: { start: number; end: number; text: string }[]) => void;
		const jobs = new VideoSubtitleJobs({
			store,
			extract: async () => ({
				audio: new ArrayBuffer(0),
				duration: 10,
				totalDuration: 10,
				sourceSignature: "signature",
			}),
			transcribe: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		await jobs.start(source, config);
		await until(() => !!finish);
		jobs.pause("video");
		finish([{ start: 0, end: 1, text: "late" }]);
		await until(() => jobs.getSnapshot().tasks[0]?.status === "paused");
		expect(jobs.getCues("video")).toEqual([]);
		jobs.dispose();
	});
	it("keeps a translation failure visible when a later cue succeeds", async () => {
		const { store } = fixture();
		let failFirst = true;
		const jobs = new VideoSubtitleJobs({
			store,
			extract: vi.fn(),
			transcribe: vi.fn(),
			translate: async (text) => {
				if (text === "First" && failFirst) throw new Error("translation unavailable");
				return `译文 ${text}`;
			},
		});
		await jobs.importSubtitles(
			"video",
			"1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond",
			"srt",
		);
		await jobs.adoptCandidate("video");
		await jobs.translateSubtitles(source, config);
		expect(jobs.getSnapshot().translationFailures.video).toBe("translation unavailable");
		expect(jobs.getCues("video").map((cue) => cue.translation)).toEqual(["", "译文 Second"]);
		failFirst = false;
		await jobs.retryTranslation("video");
		expect(jobs.getSnapshot().translationFailures.video).toBeUndefined();
		expect(jobs.getCues("video")[0]?.translation).toBe("译文 First");
		jobs.dispose();
	});
	it("reloads an externally replaced subtitle document instead of reusing its cache", async () => {
		const { store, documents } = fixture();
		const jobs = new VideoSubtitleJobs({ store, extract: vi.fn(), transcribe: vi.fn() });
		await jobs.importSubtitles("video", "1\n00:00:00,000 --> 00:00:01,000\nLocal", "srt");
		await jobs.adoptCandidate("video");
		const external = structuredClone(documents.get("video")!);
		external.cues[0]!.text = "Synced";
		documents.set("video", external);
		await jobs.reloadSource("video");
		expect(jobs.getCues("video")[0]?.text).toBe("Synced");
		jobs.dispose();
	});
	it("treats empty model output as a retryable translation failure", async () => {
		const { store } = fixture();
		const jobs = new VideoSubtitleJobs({
			store,
			extract: vi.fn(),
			transcribe: vi.fn(),
			translate: async () => "  ",
		});
		await jobs.importSubtitles("video", "1\n00:00:00,000 --> 00:00:01,000\nHello", "srt");
		await jobs.adoptCandidate("video");
		await jobs.translateSubtitles(source, config);
		expect(jobs.getSnapshot().translationFailures.video).toContain("空内容");
		jobs.dispose();
	});
});
