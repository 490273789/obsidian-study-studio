import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AudioPracticeRuntime } from "../audioPracticeRuntime";
import { emptyAudioPracticeData, normalizeAudioPracticeData } from "../repository";
import { audioFailure } from "../failures";
import { MAX_AUDIO_BYTES } from "../../generation/limits";
import type { AudioSourceFiles, AudioSourceStat, GenerationInput } from "../../generation/types";
import type { GenerationSnapshot, SubtitleGeneration } from "../../generation/subtitleGeneration";
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
		mediaUrl: (path) => path,
		readText: async () => subtitle,
		writeSubtitle: async () => "generated.srt",
		subscribe: (listener) => {
			fileChange = listener;
			return () => {};
		},
	};
	const runtime = new AudioPracticeRuntime(repo, files);
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
	it("rejects a superseded subtitle read instead of rebinding old subtitles", async () => {
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
		const slow = runtime.setSubtitle(id, "slow.srt");
		const rejected = expect(slow).rejects.toMatchObject({
			failure: { kind: "stale-material" },
		});
		await runtime.setSubtitle(id, "new.srt");
		finish(await originalRead("test.srt"));
		await rejected;
		expect(runtime.getSnapshot().currentMaterial!.subtitlePath).toBe("new.srt");
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
		const pending = runtime.setSubtitle(runtime.getSnapshot().currentMaterialId!, "slow.srt");
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
		generationSnapshot?: Partial<GenerationSnapshot>;
		sourceStat?: AudioSourceStat | null;
		sourceStats?: (AudioSourceStat | null)[];
		readBinary?: () => Promise<ArrayBuffer>;
		matchesSource?: () => Promise<boolean>;
		settingsPatch?: Partial<AudioPracticeSettings>;
		secret?: string | null;
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
	const repo: AudioPracticeRepository = {
		load: () => data,
		save: vi.fn(async (next) => {
			data = next;
		}),
		subscribeExternal: () => () => {},
	};
	let savedSubtitleText = "1\n00:00:00,000 --> 00:00:01,000\nhello";
	const files: AudioPracticeFiles = {
		exists: () => true,
		mediaUrl: (p) => p,
		readText: vi.fn(async () => savedSubtitleText),
		writeSubtitle: vi.fn(async (_audioPath, content) => {
			savedSubtitleText = content;
			return "a.srt";
		}),
	};

	let genSnapshot: GenerationSnapshot = {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		notice: null,
		taskKey: null,
		...options.generationSnapshot,
	};
	const genListeners = new Set<() => void>();
	const publishGen = (patch: Partial<GenerationSnapshot>) => {
		genSnapshot = { ...genSnapshot, ...patch };
		for (const listener of genListeners) listener();
	};

	const generation = {
		getSnapshot: () => genSnapshot,
		subscribe: (listener: () => void) => {
			genListeners.add(listener);
			return () => genListeners.delete(listener);
		},
		generate: vi.fn(async () => {}),
		cancel: vi.fn(() => {
			publishGen({ status: "cancelled", failure: null });
		}),
		restore: vi.fn(async () => true),
		matchesSource: vi.fn(options.matchesSource ?? (async () => true)),
		validatedCues: vi.fn(() => savedCues.map((c) => ({ ...c }))),
		editCue: vi.fn((id, patch) => {
			publishGen({
				cues: genSnapshot.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
			});
		}),
		addCue: vi.fn(() => {
			const cue = { id: "new-cue", start: null, end: null, text: "", needsReview: true };
			publishGen({ cues: [...genSnapshot.cues, cue] });
			return cue.id;
		}),
		removeCue: vi.fn((id) => {
			publishGen({ cues: genSnapshot.cues.filter((c) => c.id !== id) });
		}),
		confirmAllCues: vi.fn(() => {
			publishGen({ cues: genSnapshot.cues.map((c) => ({ ...c, needsReview: false })) });
		}),
	} as unknown as SubtitleGeneration;

	const remainingStats = [...(options.sourceStats ?? [])];
	const defaultStat: AudioSourceStat | null =
		options.sourceStat === undefined ? { size: 1024, mtime: 10 } : options.sourceStat;
	const source: AudioSourceFiles = {
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
		generation,
	});

	return {
		runtime,
		generation,
		source,
		settingsReader,
		files,
		publishGen,
	};
}

describe("audio practice runtime subtitle generation admission", () => {
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
});

describe("audio practice runtime subtitle draft editing", () => {
	it("edits, adds, removes, and confirms draft cues through runtime", () => {
		const h = draftHarness({
			generationSnapshot: {
				taskKey: "a",
				status: "review",
				cues: [{ id: "cue-1", start: 0, end: 1, text: "original", needsReview: true }],
			},
		});
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(1);

		h.runtime.editSubtitleDraftCue("cue-1", { text: "updated" });
		expect(h.runtime.getSnapshot().draft.cues[0]?.text).toBe("updated");

		h.runtime.addSubtitleDraftCue();
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(2);

		h.runtime.confirmAllSubtitleDraftCues();
		expect(h.runtime.getSnapshot().draft.cues.every((c) => !c.needsReview)).toBe(true);

		h.runtime.removeSubtitleDraftCue("cue-1");
		expect(h.runtime.getSnapshot().draft.cues).toHaveLength(1);
	});
});
