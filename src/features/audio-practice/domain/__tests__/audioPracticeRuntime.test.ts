import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AudioPracticeRuntime } from "../audioPracticeRuntime";
import { emptyAudioPracticeData, normalizeAudioPracticeData } from "../repository";
import { audioFailure } from "../failures";
import { MAX_AUDIO_BYTES } from "../transcriptionTypes";
import type { AudioSourceStat, GenerationInput, TimedTextWord } from "../transcriptionTypes";
import {
	alignTimedWords,
	type SubtitleDraftSnapshot,
	type SubtitleDraftEngine,
	type SubtitleDraftAction,
} from "../subtitleDraftEngine";
import type { AudioPracticeSettings } from "../../settings/slice";
import type {
	AudioFileChange,
	AudioMediaPort,
	AudioPracticeData,
	AudioPracticeFiles,
	AudioPracticeRepository,
	SubtitleCue,
} from "../types";

class Media implements AudioMediaPort {
	src = "";
	currentTime = 0;
	duration = 20;
	playbackRate = 1;
	paused = true;
	listeners = new Map<string, Set<() => void>>();
	play = vi.fn(async () => {
		this.paused = false;
		this.emit("play");
	});
	pause() {
		this.paused = true;
		this.emit("pause");
	}
	load() {}
	addEventListener(event: string, listener: () => void) {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
	}
	removeEventListener(event: string, listener: () => void) {
		this.listeners.get(event)?.delete(listener);
	}
	emit(event: string) {
		this.listeners.get(event)?.forEach((listener) => listener());
	}
}
async function setup() {
	let saved: AudioPracticeData = emptyAudioPracticeData();
	let external = () => {};
	let fileChange = (_change: AudioFileChange) => {};
	let subtitle = "1\n00:01,000 --> 00:02,000\nOne\n\n2\n00:03,000 --> 00:04,000\nTwo";
	const repo: AudioPracticeRepository = {
		load: () => saved,
		save: vi.fn(async (data: AudioPracticeData) => {
			saved = data;
		}),
		subscribeExternal: (listener) => {
			external = listener;
			return () => {};
		},
	};
	const files: AudioPracticeFiles = {
		exists: () => true,
		stat: () => ({ size: 1024, mtime: 10 }),
		mediaUrl: (path) => path,
		readText: async () => subtitle,
		writeSubtitle: async () => "generated.srt",
		subscribe: (listener) => {
			fileChange = listener;
			return () => {};
		},
	};
	const runtime = new AudioPracticeRuntime({ repository: repo, files });
	await runtime.addMaterial({ title: "Audio", audioPath: "test.mp3", subtitlePath: "test.srt" });
	const media = new Media();
	const release = runtime.bindMedia(media);
	return {
		runtime,
		media,
		release,
		repo,
		files,
		fileChange: (change: AudioFileChange) => fileChange(change),
		setSubtitle: (value: string) => {
			subtitle = value;
		},
		sync: (data: AudioPracticeData) => {
			saved = data;
			external();
		},
	};
}
async function setupTimedPlayback() {
	const h = await setup();
	const cue = h.runtime.getSnapshot().cues[0]!;
	h.sync({
		...h.runtime.getSnapshot(),
		materials: h.runtime.getSnapshot().materials.map((material) =>
			material.id === h.runtime.getSnapshot().currentMaterialId
				? {
						...material,
						wordTimings: {
							[cue.id]: [{ startOffset: 0, endOffset: 3, start: 1.5, end: 1.8 }],
						},
					}
				: material,
		),
	});
	await vi.waitFor(() => {
		expect(h.runtime.getSnapshot().loading).toBe(false);
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings?.[cue.id]).toHaveLength(1);
	});
	return h;
}
describe("audio practice runtime", () => {
	afterEach(() => vi.useRealTimers());
	it("difficult-only pauses, selects a marked sentence, and enforces sentence playback", async () => {
		const { runtime, media } = await setup();
		const [first, second] = runtime.getSnapshot().cues;
		runtime.toggleDifficult(second!.id);
		runtime.setMode("continuous");
		runtime.togglePlayback();
		runtime.setDifficultOnly(true);
		expect(media.paused).toBe(true);
		expect(media.currentTime).toBe(3);
		expect(runtime.getSnapshot().currentCueId).toBe(second!.id);
		runtime.setMode("continuous");
		expect(runtime.getSnapshot().mode).toBe("sentence");
		runtime.selectCue(first!.id, true);
		expect(media.paused).toBe(true);
		runtime.togglePlayback();
		expect(media.paused).toBe(false);
		media.currentTime = 4;
		media.emit("timeupdate");
		expect(media.paused).toBe(true);
		runtime.toggleDifficult(second!.id);
		runtime.togglePlayback();
		expect(media.paused).toBe(true);
		expect(runtime.getSnapshot().currentCueId).toBeNull();
		runtime.dispose();
	});
	it("updates descendants on folder rename and detects deleted folders without deleting materials", async () => {
		const { runtime, files, fileChange, media } = await setup();
		await runtime.addMaterial({
			title: "Nested",
			audioPath: "old/deep/a.mp3",
			subtitlePath: "old/deep/a.srt",
		});
		fileChange({ kind: "rename", path: "old", nextPath: "new" });
		await Promise.resolve();
		expect(runtime.getSnapshot().currentMaterial).toMatchObject({
			audioPath: "new/deep/a.mp3",
			subtitlePath: "new/deep/a.srt",
		});
		runtime.repeat();
		files.exists = (path) => !path.startsWith("new/");
		fileChange({ kind: "delete", path: "new" });
		await Promise.resolve();
		expect(media.paused).toBe(true);
		expect(runtime.getSnapshot().failure).toEqual({ kind: "missing-file" });
		expect(runtime.getSnapshot().materials).toHaveLength(2);
		runtime.dispose();
	});
	it("jumps from a gap to the next sentence and repeats the last after the end", async () => {
		const { runtime, media } = await setup();
		runtime.seekTo(2.5);
		runtime.togglePlayback();
		expect(media.currentTime).toBe(3);
		expect(media.paused).toBe(false);
		media.currentTime = 4;
		media.emit("timeupdate");
		expect(media.paused).toBe(true);
		runtime.seekTo(10);
		runtime.togglePlayback();
		expect(media.currentTime).toBe(3);
		runtime.dispose();
	});
	it("rejects a second material edit while the first is reading subtitles", async () => {
		const { runtime, files } = await setup();
		const id = runtime.getSnapshot().currentMaterialId!;
		const originalRead = files.readText.bind(files);
		let finish!: (value: string) => void;
		files.readText = (path) =>
			path === "slow.srt"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: originalRead(path);
		const current = runtime.getSnapshot().currentMaterial!;
		const slow = runtime.editMaterial(id, { ...current, subtitlePath: "slow.srt" });
		await expect(
			runtime.editMaterial(id, { ...current, subtitlePath: "new.srt" }),
		).rejects.toMatchObject({
			failure: { kind: "busy" },
		});
		finish(await originalRead("test.srt"));
		await slow;
		expect(runtime.getSnapshot().currentMaterial!.subtitlePath).toBe("slow.srt");
		runtime.dispose();
	});
	it("rejects subtitle reads invalidated by synchronized data", async () => {
		const { runtime, files, sync } = await setup();
		const originalRead = files.readText.bind(files);
		let finish!: (value: string) => void;
		files.readText = (path) =>
			path === "slow.srt"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: originalRead(path);
		const current = runtime.getSnapshot().currentMaterial!;
		const pending = runtime.editMaterial(current.id, { ...current, subtitlePath: "slow.srt" });
		const rejected = expect(pending).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		sync(runtime.getSnapshot());
		finish(await originalRead("test.srt"));
		await rejected;
		expect(runtime.getSnapshot().currentMaterial!.subtitlePath).toBe("test.srt");
		runtime.dispose();
	});
	it("does not report subtitle save success when the partition commit fails", async () => {
		const { runtime, repo } = await setup();
		vi.spyOn(repo, "save").mockImplementation(async (data) => {
			if (data.materials.some((material) => material.subtitlePath === "generated.srt"))
				throw new Error("disk full");
		});
		await expect(
			runtime.saveSubtitles(
				runtime.getSnapshot().currentMaterialId!,
				runtime.getSnapshot().cues,
			),
		).rejects.toThrow("disk full");
		expect(runtime.getSnapshot().failure).toEqual({ kind: "persist-failed" });
		runtime.dispose();
	});
	it("stops at the boundary even when timeupdate is absent", async () => {
		vi.useFakeTimers();
		const { runtime, media } = await setup();
		runtime.repeat();
		media.currentTime = 2;
		vi.advanceTimersByTime(999);
		expect(media.paused).toBe(false);
		vi.advanceTimersByTime(1);
		expect(media.paused).toBe(true);
		expect(media.currentTime).toBe(2);
		runtime.dispose();
	});
	it("reschedules boundaries for playback rate and seeking and cancels on close", async () => {
		vi.useFakeTimers();
		const { runtime, media, release } = await setup();
		runtime.repeat();
		runtime.setPlaybackRate(0.5);
		media.currentTime = 1.5;
		vi.advanceTimersByTime(1000);
		expect(media.paused).toBe(false);
		runtime.seekTo(1.75);
		media.currentTime = 2;
		vi.advanceTimersByTime(499);
		expect(media.paused).toBe(false);
		vi.advanceTimersByTime(1);
		expect(media.paused).toBe(true);
		runtime.repeat();
		release();
		const replacement = new Media();
		runtime.bindMedia(replacement);
		runtime.setMode("continuous");
		runtime.togglePlayback();
		replacement.currentTime = 3;
		vi.advanceTimersByTime(5000);
		expect(replacement.paused).toBe(false);
		runtime.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("an old cleanup cannot release a newer lease for the same media element", async () => {
		vi.useFakeTimers();
		const { runtime, media, release } = await setup();
		runtime.bindMedia(media);
		runtime.repeat();
		release();
		expect(media.paused).toBe(false);
		media.currentTime = 2;
		vi.advanceTimersByTime(1000);
		expect(media.paused).toBe(true);
		runtime.dispose();
	});
	it("does not confuse buffered wall time with media progress", async () => {
		vi.useFakeTimers();
		const { runtime, media } = await setup();
		runtime.repeat();
		media.currentTime = 1.25;
		vi.advanceTimersByTime(1000);
		expect(media.paused).toBe(false);
		media.emit("waiting");
		expect(vi.getTimerCount()).toBe(0);
		media.emit("playing");
		media.currentTime = 2;
		vi.advanceTimersByTime(750);
		expect(media.paused).toBe(true);
		runtime.dispose();
	});
	it("updates at a word boundary even when timeupdate arrived a few milliseconds early", async () => {
		const { runtime, media } = await setupTimedPlayback();
		vi.useFakeTimers();
		const published: number[] = [];
		const release = runtime.subscribe(() => published.push(runtime.getSnapshot().currentTime));
		runtime.repeat();
		media.currentTime = 1.498;
		media.emit("timeupdate");
		media.currentTime = 1.5;
		vi.advanceTimersByTime(10);
		expect(published[published.length - 1]).toBe(1.5);
		release();
		runtime.dispose();
	});
	it("resumes word boundaries when media advances after stalled without a playing event", async () => {
		const { runtime, media } = await setupTimedPlayback();
		vi.useFakeTimers();
		const published: number[] = [];
		const release = runtime.subscribe(() => published.push(runtime.getSnapshot().currentTime));
		runtime.repeat();
		media.currentTime = 1.2;
		media.emit("stalled");
		expect(vi.getTimerCount()).toBe(0);
		media.emit("timeupdate");
		expect(vi.getTimerCount()).toBe(0);
		media.currentTime = 1.498;
		media.emit("timeupdate");
		media.currentTime = 1.5;
		vi.advanceTimersByTime(10);
		expect(published[published.length - 1]).toBe(1.5);
		release();
		runtime.dispose();
	});
	it("cancels word boundary timers on pause and reschedules after seeking and rate changes", async () => {
		const { runtime, media } = await setupTimedPlayback();
		vi.useFakeTimers();
		runtime.repeat();
		runtime.setPlaybackRate(0.5);
		media.currentTime = 1;
		media.emit("timeupdate");
		media.currentTime = 1.5;
		vi.advanceTimersByTime(999);
		expect(runtime.getSnapshot().currentTime).toBe(1);
		vi.advanceTimersByTime(1);
		expect(runtime.getSnapshot().currentTime).toBe(1.5);
		runtime.pause();
		expect(vi.getTimerCount()).toBe(0);
		runtime.seekTo(1.2);
		expect(vi.getTimerCount()).toBe(0);
		runtime.togglePlayback();
		media.emit("seeking");
		expect(vi.getTimerCount()).toBe(0);
		media.currentTime = 1.3;
		media.emit("seeked");
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		runtime.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("pauses at sentence end, plays the explicitly requested next sentence, and hides its text", async () => {
		const { runtime, media } = await setup();
		runtime.setBlind(true);
		runtime.reveal();
		runtime.repeat();
		expect(media.paused).toBe(false);
		media.currentTime = 2.1;
		media.emit("timeupdate");
		expect(media.paused).toBe(true);
		expect(media.currentTime).toBe(2);
		runtime.next();
		expect(media.currentTime).toBe(3);
		expect(media.paused).toBe(false);
		expect(media.play).toHaveBeenCalledTimes(2);
		expect(runtime.getSnapshot().revealed).toBe(false);
		runtime.dispose();
	});
	it("plays draft preview independently of the selected sentence boundary", async () => {
		const { runtime, media } = await setup();
		runtime.preview(5, 6);
		media.currentTime = 5.5;
		media.emit("timeupdate");
		expect(media.paused).toBe(false);
		media.currentTime = 6.2;
		media.emit("timeupdate");
		expect(media.paused).toBe(true);
		expect(media.currentTime).toBe(6);
		runtime.dispose();
	});
	it("retains unique exact matching marks after external subtitle edits", async () => {
		const { runtime, setSubtitle } = await setup();
		const second = runtime.getSnapshot().cues[1]!;
		runtime.toggleDifficult(second.id);
		setSubtitle("1\n00:00,000 --> 00:00,500\nNew\n\n2\n00:03,000 --> 00:04,000\nTwo");
		await runtime.refreshSubtitles();
		const data = runtime.getSnapshot();
		expect(data.progress[data.currentMaterialId!]!.difficultCueIds).toEqual([second.id]);
		runtime.dispose();
	});
	it("pauses and reloads synchronized data without saving stale progress", async () => {
		const { runtime, media, sync } = await setup();
		runtime.repeat();
		sync({
			...runtime.getSnapshot(),
			progress: {
				[runtime.getSnapshot().currentMaterialId!]: {
					time: 3,
					cueId: runtime.getSnapshot().cues[1]!.id,
					offset: 0,
					difficultCueIds: [],
				},
			},
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(media.paused).toBe(true);
		expect(media.currentTime).toBe(3);
		runtime.dispose();
	});
	it("recovers malformed partitions without accepting future versions", () => {
		expect(normalizeAudioPracticeData({ schemaVersion: 2, materials: [] })).toEqual(
			emptyAudioPracticeData(),
		);
		expect(
			normalizeAudioPracticeData({
				schemaVersion: 1,
				materials: [null],
				playbackRate: Infinity,
			}).materials,
		).toEqual([]);
	});
	it("drops unsorted word timings from synchronized material data", () => {
		const data = normalizeAudioPracticeData({
			...emptyAudioPracticeData(),
			materials: [
				{
					id: "a",
					title: "Audio",
					audioPath: "a.wav",
					subtitlePath: "a.srt",
					wordTimings: {
						bad: [
							{ startOffset: 4, endOffset: 7, start: 1, end: 1.2 },
							{ startOffset: 0, endOffset: 3, start: 1.3, end: 1.5 },
						],
						good: [{ startOffset: 0, endOffset: 3, start: 2, end: 2.2 }],
					},
				},
			],
		});
		expect(data.materials[0]?.wordTimings).toEqual({
			good: [{ startOffset: 0, endOffset: 3, start: 2, end: 2.2 }],
		});
	});
});

async function materialEditHarness() {
	const initialSubtitle =
		"1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo";
	const subtitles: Record<string, string> = {
		"old.srt": initialSubtitle,
		"new.srt":
			"1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\nChanged",
	};
	let saved: AudioPracticeData = {
		...emptyAudioPracticeData(),
		materials: [
			{
				id: "material",
				title: "Original",
				audioPath: "old.mp3",
				subtitlePath: "old.srt",
				originalText: "Original text",
			},
		],
		currentMaterialId: "material",
	};
	let external = () => {};
	let fileChange = (_change: AudioFileChange) => {};
	const repo = {
		load: () => saved,
		save: vi.fn(async (data: AudioPracticeData) => {
			saved = data;
		}),
		subscribeExternal: (listener: () => void) => {
			external = listener;
			return () => {};
		},
	};
	const stats = new Map<string, { size: number; mtime: number }>([
		["old.mp3", { size: 100, mtime: 1 }],
		["new.mp3", { size: 100, mtime: 1 }],
		["old.srt", { size: 100, mtime: 1 }],
		["new.srt", { size: 100, mtime: 1 }],
	]);
	const files = {
		exists: (path: string) => stats.has(path),
		stat: (path: string) => stats.get(path) ?? null,
		mediaUrl: (path: string) => path,
		readText: vi.fn(async (path: string) => subtitles[path] ?? ""),
		writeSubtitle: async () => "generated.srt",
		subscribe: (listener: (change: AudioFileChange) => void) => {
			fileChange = listener;
			return () => {};
		},
	};
	const runtime = new AudioPracticeRuntime({ repository: repo, files });
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const input = () => ({ ...runtime.getSnapshot().currentMaterial! });
	return {
		runtime,
		repo,
		files,
		stats,
		input,
		getSaved: () => saved,
		setSaved: (data: AudioPracticeData) => {
			saved = data;
		},
		sync: (data: AudioPracticeData) => {
			saved = data;
			external();
		},
		fileChange: (change: AudioFileChange) => fileChange(change),
	};
}

describe("listening material edit", () => {
	it("publishes one shared operation result only after an add is durable", async () => {
		const h = await materialEditHarness();
		let finish!: () => void;
		vi.mocked(h.repo.save).mockImplementationOnce(async (data) => {
			await new Promise<void>((resolve) => (finish = resolve));
			h.setSaved(data);
		});
		const pending = h.runtime.addMaterial({
			title: "Another",
			audioPath: "new.mp3",
			subtitlePath: "new.srt",
		});
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		expect(h.runtime.getSnapshot().materialOperation).toMatchObject({
			kind: "add",
			status: "pending",
			failure: null,
		});
		expect(h.runtime.getSnapshot().materials).toHaveLength(1);
		expect(h.getSaved().materials).toHaveLength(1);
		await expect(h.runtime.selectMaterial("material")).rejects.toMatchObject({
			failure: { kind: "busy" },
		});
		finish();
		const id = await pending;
		expect(h.runtime.getSnapshot().materialOperation).toMatchObject({
			kind: "add",
			materialId: id,
			status: "succeeded",
		});
		expect(h.runtime.getSnapshot().currentMaterialId).toBe(id);
		expect(h.getSaved().currentMaterialId).toBe(id);
		expect(h.runtime.getSnapshot().currentCueId).toBe(h.runtime.getSnapshot().cues[0]?.id);
		h.runtime.dispose();
	});

	it("keeps an add failure separate from media and draft failures", async () => {
		const h = await materialEditHarness();
		vi.mocked(h.repo.save).mockRejectedValueOnce(new Error("disk full"));
		await expect(
			h.runtime.addMaterial({ title: "Another", audioPath: "new.mp3" }),
		).rejects.toMatchObject({ failure: { kind: "persist-failed" } });
		expect(h.runtime.getSnapshot().materials).toHaveLength(1);
		expect(h.getSaved().materials).toHaveLength(1);
		expect(h.runtime.getSnapshot().materialOperation).toMatchObject({
			kind: "add",
			status: "failed",
			failure: { kind: "persist-failed" },
		});
		expect(h.runtime.getSnapshot().failure).toBeNull();
		expect(h.runtime.getSnapshot().draft.error).toBeNull();
		h.runtime.dismissMaterialOperationFailure();
		expect(h.runtime.getSnapshot().materialOperation.status).toBe("idle");
		h.runtime.dispose();
	});

	it("keeps the old selection when the target subtitle cannot be read", async () => {
		const h = await materialEditHarness();
		const added = await h.runtime.addMaterial({
			title: "Another",
			audioPath: "new.mp3",
			subtitlePath: "new.srt",
		});
		vi.mocked(h.files.readText).mockRejectedValueOnce(new Error("unreadable"));
		await expect(h.runtime.selectMaterial("material")).rejects.toThrow("unreadable");
		expect(h.runtime.getSnapshot().currentMaterialId).toBe(added);
		expect(h.getSaved().currentMaterialId).toBe(added);
		expect(h.runtime.getSnapshot().materialOperation).toMatchObject({
			kind: "select",
			materialId: "material",
			status: "failed",
		});
		h.runtime.dispose();
	});

	it("waits for removal persistence before changing the visible list", async () => {
		const h = await materialEditHarness();
		let finish!: () => void;
		vi.mocked(h.repo.save).mockImplementationOnce(async (data) => {
			await new Promise<void>((resolve) => (finish = resolve));
			h.setSaved(data);
		});
		const pending = h.runtime.removeMaterial("material");
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		expect(h.runtime.getSnapshot().materials).toHaveLength(1);
		expect(h.runtime.getSnapshot().materialOperation.status).toBe("pending");
		finish();
		await pending;
		expect(h.runtime.getSnapshot().materials).toHaveLength(0);
		expect(h.getSaved().materials).toHaveLength(0);
		expect(h.runtime.getSnapshot().materialOperation.status).toBe("succeeded");
		h.runtime.dispose();
	});

	it("rejects an add superseded by external synchronized data", async () => {
		const h = await materialEditHarness();
		let finish!: (value: string) => void;
		vi.mocked(h.files.readText).mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve)),
		);
		const pending = h.runtime.addMaterial({
			title: "Another",
			audioPath: "new.mp3",
			subtitlePath: "new.srt",
		});
		const rejected = expect(pending).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		const synced = {
			...h.getSaved(),
			materials: [{ ...h.input(), title: "Other device" }],
		};
		h.sync(synced);
		finish("1\n00:00:01,000 --> 00:00:02,000\nOne");
		await rejected;
		expect(h.runtime.getSnapshot().materials[0]?.title).toBe("Other device");
		expect(h.getSaved()).toBe(synced);
		h.runtime.dispose();
	});

	it("commits material fields and matched subtitle progress together", async () => {
		const h = await materialEditHarness();
		const [first, second] = h.runtime.getSnapshot().cues;
		h.runtime.toggleDifficult(first!.id);
		h.runtime.toggleDifficult(second!.id);
		h.runtime.seekTo(3.2);
		await h.runtime.editMaterial("material", {
			...h.input(),
			title: " Revised ",
			subtitlePath: "new.srt",
		});
		const snapshot = h.runtime.getSnapshot();
		expect(snapshot.currentMaterial).toMatchObject({
			title: "Revised",
			subtitlePath: "new.srt",
		});
		expect(snapshot.progress.material).toMatchObject({
			time: 3.2,
			difficultCueIds: [first!.id],
		});
		expect(snapshot.invalidatedMarks).toBe(1);
		expect(h.getSaved().materials[0]).toEqual(snapshot.currentMaterial);
		expect(h.getSaved().progress.material).toEqual(snapshot.progress.material);
		h.runtime.dispose();
	});

	it("keeps the old material when subtitle reading fails", async () => {
		const h = await materialEditHarness();
		const before = h.runtime.getSnapshot().currentMaterial;
		const savedBefore = h.getSaved();
		vi.mocked(h.files.readText).mockRejectedValueOnce(new Error("read failed"));
		await expect(
			h.runtime.editMaterial("material", {
				...h.input(),
				title: "Revised",
				subtitlePath: "new.srt",
			}),
		).rejects.toThrow("read failed");
		expect(h.runtime.getSnapshot().currentMaterial).toEqual(before);
		expect(h.getSaved()).toBe(savedBefore);
		h.runtime.dispose();
	});

	it("keeps the old material and independent playback progress when persistence fails", async () => {
		const h = await materialEditHarness();
		const before = h.runtime.getSnapshot().currentMaterial;
		h.runtime.seekTo(2.5);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		vi.mocked(h.repo.save).mockRejectedValueOnce(new Error("disk full"));
		await expect(
			h.runtime.editMaterial("material", {
				...h.input(),
				title: "Revised",
			}),
		).rejects.toMatchObject({ failure: { kind: "persist-failed" } });
		expect(h.runtime.getSnapshot().currentMaterial).toEqual(before);
		expect(h.runtime.getSnapshot().progress.material?.time).toBe(2.5);
		h.runtime.dispose();
	});

	it("resets progress after an intentional audio replacement", async () => {
		const h = await materialEditHarness();
		const cue = h.runtime.getSnapshot().cues[0]!;
		h.runtime.toggleDifficult(cue.id);
		h.runtime.setOffset(0.5);
		h.runtime.seekTo(1.5);
		await h.runtime.editMaterial("material", {
			...h.input(),
			audioPath: "new.mp3",
		});
		expect(h.runtime.getSnapshot().currentMaterial?.id).toBe("material");
		expect(h.runtime.getSnapshot().progress.material).toEqual({
			time: 0,
			cueId: null,
			difficultCueIds: [],
			offset: 0,
		});
		h.runtime.dispose();
	});

	it("preserves playback changes made while a title edit is saving", async () => {
		const h = await materialEditHarness();
		let finish!: () => void;
		vi.mocked(h.repo.save).mockImplementationOnce(
			() => new Promise<void>((resolve) => (finish = resolve)),
		);
		const pending = h.runtime.editMaterial("material", {
			...h.input(),
			title: "Revised",
		});
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		h.runtime.seekTo(3.2);
		h.runtime.toggleDifficult(h.runtime.getSnapshot().cues[1]!.id);
		finish();
		await pending;
		await vi.waitFor(() => expect(h.getSaved().progress.material?.time).toBe(3.2));
		expect(h.runtime.getSnapshot().progress.material).toEqual(h.getSaved().progress.material);
		expect(h.getSaved().materials[0]?.title).toBe("Revised");
		h.runtime.dispose();
	});

	it("rolls back a saved edit when its audio changes during persistence", async () => {
		const h = await materialEditHarness();
		let finish!: () => void;
		vi.mocked(h.repo.save).mockImplementationOnce(async (data) => {
			await new Promise<void>((resolve) => (finish = resolve));
			h.setSaved(data);
		});
		const pending = h.runtime.editMaterial("material", {
			...h.input(),
			title: "Revised",
		});
		const rejected = expect(pending).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		h.fileChange({ kind: "change", path: "old.mp3" });
		finish();
		await rejected;
		await vi.waitFor(() => expect(h.getSaved().materials[0]?.title).toBe("Original"));
		expect(h.runtime.getSnapshot().currentMaterial?.title).toBe("Original");
		h.runtime.dispose();
	});

	it("adopts the committed edit if a later rollback write fails", async () => {
		const h = await materialEditHarness();
		let finish!: () => void;
		vi.mocked(h.repo.save)
			.mockImplementationOnce(async (data) => {
				await new Promise<void>((resolve) => (finish = resolve));
				h.setSaved(data);
			})
			.mockRejectedValueOnce(new Error("rollback failed"));
		const pending = h.runtime.editMaterial("material", {
			...h.input(),
			title: "Revised",
		});
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		h.fileChange({ kind: "change", path: "old.mp3" });
		finish();
		await pending;
		expect(h.runtime.getSnapshot().currentMaterial).toEqual(h.getSaved().materials[0]);
		expect(h.runtime.getSnapshot().currentMaterial?.title).toBe("Revised");
		h.runtime.dispose();
	});

	it("clears an old preview stop after replacing audio", async () => {
		const h = await materialEditHarness();
		const media = new Media();
		h.runtime.bindMedia(media);
		h.runtime.setMode("continuous");
		h.runtime.preview(1, 2);
		await h.runtime.editMaterial("material", { ...h.input(), audioPath: "new.mp3" });
		media.currentTime = 2.1;
		h.runtime.togglePlayback();
		media.emit("timeupdate");
		expect(media.paused).toBe(false);
		h.runtime.dispose();
	});

	it("rejects an edit superseded by external synchronized data", async () => {
		const h = await materialEditHarness();
		let finish!: (value: string) => void;
		vi.mocked(h.files.readText).mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve)),
		);
		const pending = h.runtime.editMaterial("material", {
			...h.input(),
			title: "Old edit",
			subtitlePath: "new.srt",
		});
		const rejected = expect(pending).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		const synced = {
			...h.getSaved(),
			materials: [{ ...h.input(), title: "Other device" }],
		};
		h.sync(synced);
		finish("1\n00:00:01,000 --> 00:00:02,000\nOne");
		await rejected;
		expect(h.runtime.getSnapshot().currentMaterial?.title).toBe("Other device");
		expect(h.getSaved()).toBe(synced);
		h.runtime.dispose();
	});

	it("rejects retrying an edit form based on superseded material", async () => {
		const h = await materialEditHarness();
		const opened = h.input();
		const synced = {
			...h.getSaved(),
			materials: [{ ...opened, title: "Other device" }],
		};
		h.sync(synced);
		await expect(
			h.runtime.editMaterial("material", { ...opened, originalText: "Local draft" }, opened),
		).rejects.toMatchObject({ failure: { kind: "stale-material" } });
		expect(h.getSaved()).toBe(synced);
		expect(h.runtime.getSnapshot().currentMaterial?.title).toBe("Other device");
		h.runtime.dispose();
	});

	it("rejects a subtitle modified while it is being read", async () => {
		const h = await materialEditHarness();
		let finish!: (value: string) => void;
		vi.mocked(h.files.readText).mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve)),
		);
		const pending = h.runtime.editMaterial("material", {
			...h.input(),
			subtitlePath: "new.srt",
		});
		const rejected = expect(pending).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		h.stats.set("new.srt", { size: 101, mtime: 2 });
		finish("1\n00:00:01,000 --> 00:00:02,000\nOne");
		await rejected;
		expect(h.runtime.getSnapshot().currentMaterial?.subtitlePath).toBe("old.srt");
		h.runtime.dispose();
	});
});

const defaultSettings: AudioPracticeSettings = {
	enabled: true,
	provider: "bailian",
	bailianWorkspaceId: "workspace",
	bailianSecretId: "secret",
	bailianModel: "fun-asr-flash-2026-06-15",
	openaiBaseUrl: "https://api.openai.com/v1",
	openaiSecretId: "",
	openaiModel: "whisper-1",
};

const savedCues: SubtitleCue[] = [{ id: "cue-1", text: "hello", start: 0, end: 1 }];

function draftHarness(
	options: {
		materials?: {
			id: string;
			title: string;
			audioPath: string;
			subtitlePath: string | null;
			originalText: string;
		}[];
		currentMaterialId?: string | null;
		generationSnapshot?: Partial<SubtitleDraftSnapshot>;
		sourceStat?: AudioSourceStat | null;
		sourceStats?: (AudioSourceStat | null)[];
		readBinary?: () => Promise<ArrayBuffer>;
		matchesSource?: () => Promise<boolean>;
		settingsPatch?: Partial<AudioPracticeSettings>;
		secret?: string | null;
		timedWords?: { text: string; start: number; end: number }[];
	} = {},
) {
	const materials = options.materials ?? [
		{ id: "a", title: "a", audioPath: "a.wav", subtitlePath: null, originalText: "hello" },
	];
	let data: AudioPracticeData = {
		...emptyAudioPracticeData(),
		materials,
		currentMaterialId: options.currentMaterialId ?? materials[0]?.id ?? null,
	};
	let external = () => {};
	let fileChange = (_change: AudioFileChange) => {};
	const repo = {
		load: () => data,
		save: vi.fn(async (next: AudioPracticeData) => {
			data = next;
		}),
		subscribeExternal: (listener: () => void) => {
			external = listener;
			return () => {};
		},
	};
	let savedSubtitleText = "1\n00:00:00,000 --> 00:00:01,000\nhello";
	const files = {
		exists: () => true,
		stat: () => ({ size: 1024, mtime: 10 }),
		mediaUrl: (p: string) => p,
		readText: vi.fn(async () => savedSubtitleText),
		writeSubtitle: vi.fn(async (_audioPath: string, content: string) => {
			savedSubtitleText = content;
			return "a.srt";
		}),
		subscribe: (listener: (change: AudioFileChange) => void) => {
			fileChange = listener;
			return () => {};
		},
	};

	let genSnapshot: SubtitleDraftSnapshot = {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		notice: null,
		taskKey: null,
		hasReviewWordTimings: false,
		...options.generationSnapshot,
	};
	const genListeners = new Set<() => void>();
	const publishGen = (patch: Partial<SubtitleDraftSnapshot>) => {
		genSnapshot = { ...genSnapshot, ...patch };
		for (const listener of genListeners) listener();
	};

	const generation = {
		getSnapshot: () => genSnapshot,
		getTimedWords: () => options.timedWords ?? [],
		subscribe: (listener: () => void) => {
			genListeners.add(listener);
			return () => genListeners.delete(listener);
		},
		generate: vi.fn(async () => {}),
		cancel: vi.fn(() => {
			publishGen({ status: "cancelled", failure: null });
		}),
		discard: vi.fn(async (taskKey: string) => {
			if (genSnapshot.taskKey === taskKey) {
				generation.cancel();
				publishGen({ taskKey: null, status: "idle", cues: [] });
			}
		}),
		restore: vi.fn(async () => true),
		matchesSource: vi.fn(options.matchesSource ?? (async () => true)),
		validatedCues: vi.fn(() => savedCues.map((c) => ({ ...c }))),
		getValidatedWordTimings: vi.fn(() => {
			const timings: Record<string, TimedTextWord[]> = {};
			const words = options.timedWords ?? [];
			for (const cue of savedCues) {
				const matched = alignTimedWords(cue.text.trim(), cue.start, cue.end, words);
				if (matched) timings[cue.id] = matched;
			}
			return timings;
		}),
		act: vi.fn((action: SubtitleDraftAction) => {
			switch (action.type) {
				case "edit-cue":
					publishGen({
						cues: genSnapshot.cues.map((c) =>
							c.id === action.id ? { ...c, ...action.patch } : c,
						),
					});
					break;
				case "add-cue": {
					const cue = {
						id: "new-cue",
						start: null,
						end: null,
						text: "",
						needsReview: true,
						highlightable: false,
					};
					publishGen({ cues: [...genSnapshot.cues, cue] });
					break;
				}
				case "remove-cue":
					publishGen({ cues: genSnapshot.cues.filter((c) => c.id !== action.id) });
					break;
				case "confirm-all-cues":
					publishGen({
						cues: genSnapshot.cues.map((c) => ({ ...c, needsReview: false })),
					});
					break;
			}
		}),
	};

	const remainingStats = [...(options.sourceStats ?? [])];
	const defaultStat: AudioSourceStat | null =
		options.sourceStat === undefined ? { size: 1024, mtime: 10 } : options.sourceStat;
	const source = {
		stat: vi.fn(() => (remainingStats.length ? (remainingStats.shift() ?? null) : defaultStat)),
		readBinary: vi.fn(options.readBinary ?? (async () => new ArrayBuffer(8))),
	};
	const settingsReader = {
		read: () => ({ ...defaultSettings, ...options.settingsPatch }),
		readSecret: vi.fn(() => (options.secret === undefined ? "secret" : options.secret)),
	};

	const runtime = new AudioPracticeRuntime({
		repository: repo,
		files,
		source,
		settings: settingsReader,
		generation: generation as unknown as SubtitleDraftEngine,
	});

	return {
		runtime,
		getSaved: () => data,
		repo,
		generation,
		source,
		settingsReader,
		files,
		publishGen,
		sync: (next: AudioPracticeData) => {
			data = next;
			external();
		},
		fileChange: (change: AudioFileChange) => fileChange(change),
	};
}

describe("audio practice runtime subtitle generation admission", () => {
	it("keeps another material's generation running after an edit", async () => {
		const h = draftHarness({
			materials: [
				{ id: "a", title: "a", audioPath: "a.wav", subtitlePath: null, originalText: "a" },
				{ id: "b", title: "b", audioPath: "b.wav", subtitlePath: null, originalText: "b" },
			],
			currentMaterialId: "b",
			generationSnapshot: { taskKey: "a", status: "transcribing" },
		});
		await h.runtime.editMaterial("b", {
			title: "b",
			audioPath: "b.wav",
			subtitlePath: null,
			originalText: "updated",
		});
		expect(h.generation.cancel).not.toHaveBeenCalled();
		expect(h.generation.getSnapshot()).toMatchObject({ taskKey: "a", status: "transcribing" });
		expect(
			h.runtime.getSnapshot().materials.find((material) => material.id === "b"),
		).toMatchObject({ originalText: "updated" });
		h.runtime.dispose();
	});

	it("cancels generation only after its material removal is durable", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "transcribing" },
		});
		let finish!: () => void;
		vi.mocked(h.repo.save).mockImplementationOnce(
			() => new Promise<void>((resolve) => (finish = resolve)),
		);
		const pending = h.runtime.removeMaterial("a");
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		expect(h.generation.cancel).not.toHaveBeenCalled();
		expect(h.runtime.getSnapshot().materials).toHaveLength(1);
		finish();
		await pending;
		expect(h.generation.cancel).toHaveBeenCalledOnce();
		expect(h.generation.discard).toHaveBeenCalledWith("a");
		expect(h.runtime.getSnapshot().materials).toHaveLength(0);
		h.runtime.dispose();
	});

	it("preserves generation and material when removal persistence fails", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "transcribing" },
		});
		vi.mocked(h.repo.save).mockRejectedValueOnce(new Error("disk full"));
		await expect(h.runtime.removeMaterial("a")).rejects.toMatchObject({
			failure: { kind: "persist-failed" },
		});
		expect(h.runtime.getSnapshot().materials).toHaveLength(1);
		expect(h.runtime.getSnapshot().materialOperation).toMatchObject({
			kind: "remove",
			status: "failed",
		});
		expect(h.generation.cancel).not.toHaveBeenCalled();
		expect(h.generation.discard).not.toHaveBeenCalled();
		h.runtime.dispose();
	});

	it("fails with missing when no material is selected", async () => {
		const h = draftHarness({ materials: [], currentMaterialId: null });
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({ kind: "missing-file" });
		expect(h.generation.generate).not.toHaveBeenCalled();
	});

	it("fails with missing when the audio file is absent", async () => {
		const h = draftHarness({ sourceStat: null });
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({ kind: "missing-file" });
		expect(h.source.readBinary).not.toHaveBeenCalled();
	});

	it("rejects oversized audio before reading it", async () => {
		const h = draftHarness({ sourceStat: { size: MAX_AUDIO_BYTES + 1, mtime: 10 } });
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({
			kind: "audio-too-large",
			maxBytes: MAX_AUDIO_BYTES,
		});
		expect(h.source.readBinary).not.toHaveBeenCalled();
	});

	it("fails before vault read when configured service is incomplete", async () => {
		const h = draftHarness({ settingsPatch: { bailianWorkspaceId: "" } });
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({
			kind: "config-invalid",
			field: "workspace",
		});
		expect(h.source.stat).not.toHaveBeenCalled();
	});

	it("fails when secret is not configured", async () => {
		const h = draftHarness({ secret: null });
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({
			kind: "config-invalid",
			field: "secret",
		});
	});

	it("surfaces a vault read failure without starting generation", async () => {
		const h = draftHarness({
			readBinary: async () => {
				throw new Error("read boom");
			},
		});
		const ok = await h.runtime.generateSubtitles();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error?.kind).toBe("unknown");
		expect(h.generation.generate).not.toHaveBeenCalled();
	});

	it("delegates the admitted input and force flag to generation", async () => {
		const h = draftHarness();
		const ok = await h.runtime.generateSubtitles(true);
		expect(ok).toBe(true);
		expect(h.generation.generate).toHaveBeenCalledTimes(1);
		const [input, generateOptions] = (h.generation.generate as any).mock.calls[0] as [
			GenerationInput,
			{ force?: boolean },
		];
		expect(input).toMatchObject({
			name: "a.wav",
			taskKey: "a",
			referenceText: "hello",
		});
		expect(input.config).toEqual({
			provider: "bailian",
			workspaceId: "workspace",
			secretId: "secret",
			model: "fun-asr-flash-2026-06-15",
		});
		expect(generateOptions).toEqual({ force: true });
		expect(h.runtime.getSnapshot().draft.error).toBeNull();
	});

	it("cancels generation and clears failure on dismissFailure", async () => {
		const h = draftHarness({ sourceStat: null });
		await h.runtime.generateSubtitles();
		expect(h.runtime.getSnapshot().draft.error?.kind).toBe("missing-file");
		h.runtime.dismissFailure();
		expect(h.runtime.getSnapshot().draft.error).toBeNull();

		h.runtime.cancelSubtitleGeneration();
		expect(h.generation.cancel).toHaveBeenCalled();
	});
});

describe("audio practice runtime subtitle save adoption", () => {
	it("hides an existing review draft when synchronized source text changes", async () => {
		const h = draftHarness({
			generationSnapshot: {
				taskKey: "a",
				status: "review",
				cues: savedCues.map((cue) => ({
					...cue,
					needsReview: false,
					highlightable: false,
				})),
			},
			matchesSource: async () => false,
		});
		await vi.waitFor(() => expect(h.runtime.getSnapshot().loading).toBe(false));
		expect(h.runtime.getSnapshot().draft.status).toBe("review");
		h.sync({
			...h.runtime.getSnapshot(),
			materials: [{ ...h.runtime.getSnapshot().currentMaterial!, originalText: "changed" }],
		});
		await vi.waitFor(() => expect(h.generation.matchesSource).toHaveBeenCalled());
		expect(h.runtime.getSnapshot().draft.status).toBe("idle");
		expect(h.generation.restore).not.toHaveBeenCalled();
		h.runtime.dispose();
	});

	it("revalidates an existing review draft after its audio file changes", async () => {
		const h = draftHarness({
			generationSnapshot: {
				taskKey: "a",
				status: "review",
				cues: savedCues.map((cue) => ({
					...cue,
					needsReview: false,
					highlightable: false,
				})),
			},
			matchesSource: async () => false,
		});
		await vi.waitFor(() => expect(h.runtime.getSnapshot().loading).toBe(false));
		h.fileChange({ kind: "change", path: "a.wav" });
		await vi.waitFor(() => expect(h.generation.matchesSource).toHaveBeenCalled());
		expect(h.runtime.getSnapshot().draft.status).toBe("idle");
		h.runtime.dispose();
	});

	it("refuses a draft that belongs to another material", async () => {
		const h = draftHarness({ generationSnapshot: { taskKey: "other" } });
		const ok = await h.runtime.saveSubtitleDraft();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({ kind: "stale-material" });
	});

	it("refuses when source fingerprint no longer matches", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a" },
			matchesSource: async () => false,
		});
		const ok = await h.runtime.saveSubtitleDraft();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({ kind: "source-changed" });
	});

	it("refuses when source changed while bytes were being read", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a" },
			sourceStats: [
				{ size: 1024, mtime: 10 },
				{ size: 1024, mtime: 11 },
			],
		});
		const ok = await h.runtime.saveSubtitleDraft();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toEqual({ kind: "source-changed" });
	});

	it("turns validated-cue rejections into invalid-draft failures", async () => {
		const h = draftHarness({ generationSnapshot: { taskKey: "a" } });
		(h.generation.validatedCues as any).mockImplementationOnce(() => {
			throw audioFailure({
				kind: "subtitle-invalid",
				problems: [{ kind: "needs-review", cueIndex: 0 }],
			});
		});
		const ok = await h.runtime.saveSubtitleDraft();
		expect(ok).toBe(false);
		expect(h.runtime.getSnapshot().draft.error).toMatchObject({
			kind: "subtitle-invalid",
			problems: [{ kind: "needs-review", cueIndex: 0 }],
		});
	});

	it("writes validated cues and publishes updated draft", async () => {
		const h = draftHarness({ generationSnapshot: { taskKey: "a" } });
		const ok = await h.runtime.saveSubtitleDraft();
		expect(ok).toBe(true);
		expect(h.generation.validatedCues).toHaveBeenCalledTimes(1);
		expect(h.files.writeSubtitle).toHaveBeenCalled();
		expect(h.runtime.getSnapshot().draft.error).toBeNull();
	});
	it("stores generated word timing with parsed cue IDs and reloads it from synced data", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "review" },
			timedWords: [{ text: "hello", start: 0, end: 0.8 }],
		});
		expect(await h.runtime.saveSubtitleDraft()).toBe(true);
		const cue = h.runtime.getSnapshot().cues[0]!;
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings?.[cue.id]).toEqual([
			{ startOffset: 0, endOffset: 5, start: 0, end: 0.8 },
		]);
		await vi.waitFor(() =>
			expect(h.getSaved().materials[0]?.wordTimings?.[cue.id]).toHaveLength(1),
		);
		h.sync(normalizeAudioPracticeData(h.getSaved()));
		await vi.waitFor(() =>
			expect(h.runtime.getSnapshot().currentMaterial?.wordTimings?.[cue.id]).toHaveLength(1),
		);
		h.runtime.dispose();
	});
	it("keeps aligned offsets when the reviewed text has outer whitespace", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "review" },
			timedWords: [{ text: "hello", start: 0, end: 0.8 }],
		});
		h.generation.validatedCues.mockReturnValue([{ ...savedCues[0]!, text: " hello " }]);
		expect(await h.runtime.saveSubtitleDraft()).toBe(true);
		const cue = h.runtime.getSnapshot().cues[0]!;
		expect(cue.text).toBe("hello");
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings?.[cue.id]).toEqual([
			{ startOffset: 0, endOffset: 5, start: 0, end: 0.8 },
		]);
		h.runtime.dispose();
	});
	it("retains synced word timing when an audio or subtitle file first arrives", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "review" },
			timedWords: [{ text: "hello", start: 0, end: 0.8 }],
		});
		expect(await h.runtime.saveSubtitleDraft()).toBe(true);
		const synced = normalizeAudioPracticeData(h.getSaved());
		h.sync(synced);
		await vi.waitFor(() =>
			expect(h.runtime.getSnapshot().currentMaterial?.wordTimings).toBeDefined(),
		);
		h.fileChange({ kind: "create", path: "a.wav" });
		h.fileChange({ kind: "create", path: "a.srt" });
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings).toBeDefined();
		h.runtime.dispose();
	});
	it("keeps sentence highlighting when recognized words differ from reviewed text", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "review" },
			timedWords: [{ text: "hullo", start: 0, end: 0.8 }],
		});
		expect(await h.runtime.saveSubtitleDraft()).toBe(true);
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings).toBeUndefined();
		h.runtime.dispose();
	});
	it("invalidates generated timings after subtitle content changes", async () => {
		const h = draftHarness({
			generationSnapshot: { taskKey: "a", status: "review" },
			timedWords: [{ text: "hello", start: 0, end: 0.8 }],
		});
		expect(await h.runtime.saveSubtitleDraft()).toBe(true);
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings).toBeDefined();
		h.fileChange({ kind: "change", path: "a.srt" });
		expect(h.runtime.getSnapshot().currentMaterial?.wordTimings).toBeUndefined();
		h.runtime.dispose();
	});
});

describe("audio practice runtime subtitle draft editing", () => {
	it("edits, adds, removes, and confirms draft cues through runtime", () => {
		const h = draftHarness({
			generationSnapshot: {
				taskKey: "a",
				status: "review",
				cues: [
					{
						id: "cue-1",
						start: 0,
						end: 1,
						text: "original",
						needsReview: true,
						highlightable: false,
					},
				],
			},
		});
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(1);

		h.runtime.actOnSubtitleDraft({
			type: "edit-cue",
			id: "cue-1",
			patch: { text: "updated" },
		});
		expect(h.runtime.getSnapshot().draft.cues[0]?.text).toBe("updated");

		h.runtime.actOnSubtitleDraft({ type: "add-cue" });
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(2);

		h.runtime.actOnSubtitleDraft({ type: "confirm-all-cues" });
		expect(h.runtime.getSnapshot().draft.cues.every((c) => !c.needsReview)).toBe(true);

		h.runtime.actOnSubtitleDraft({ type: "remove-cue", id: "cue-1" });
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(1);
	});
});
