import { describe, expect, it, vi } from "vite-plus/test";
import type { VideoPlayerRuntime } from "../videoPlayerRuntime";
import type { VideoSubtitleJobs } from "../shadowSubtitlesJobs";
import type { ShadowingSession } from "../shadowingSession";
import type { ShadowPracticeRecords } from "../../obsidian/shadowPracticeRecords";
import { ShadowingWorkspaceSession } from "../shadowingWorkspaceSession";
import type { TakeAudioPlayerPort } from "../types";

function setup(initialEnabled: readonly string[] = ["one", "two"]) {
	let sourceId = "one";
	let playing = false;
	let practiceRange: { sourceId: string; start: number; end: number } | null = null;
	const enabled = new Set(initialEnabled);
	const writeEnabled = vi.fn((id: string, value: boolean) => {
		if (value) enabled.add(id);
		else enabled.delete(id);
	});
	let runtimeListener: (() => void) | null = null;
	let resolveRead!: (data: ArrayBuffer) => void;
	const readTake = vi.fn(
		() =>
			new Promise<ArrayBuffer>((resolve) => {
				resolveRead = resolve;
			}),
	);
	const reloadSource = vi.fn(async () => undefined);
	const restore = vi.fn(async () => undefined);
	const play = vi.fn(async () => undefined);
	const leave = vi.fn();
	const retrySave = vi.fn(async () => undefined);
	const record = {
		id: "take-1",
		sourceId: "one",
		kind: "recording" as const,
		start: 4,
		end: 6,
		text: "hello",
		createdAt: 1,
		mimeType: "audio/webm",
		audioPath: "Study Studio/one/take-take-1.webm",
	};
	const runtime = {
		getSnapshot: () => ({ currentSourceId: sourceId, playing }),
		subscribe: (listener: () => void) => {
			runtimeListener = listener;
			return () => {
				runtimeListener = null;
			};
		},
		seekTo: vi.fn(),
		play,
	} as unknown as VideoPlayerRuntime;
	const jobs = {
		getSnapshot: () => ({ documents: {}, tasks: [], translationFailures: {} }),
		subscribe: () => () => undefined,
		restore,
		reloadSource,
	} as unknown as VideoSubtitleJobs;
	const session = {
		getSnapshot: () => ({
			phase: "idle",
			range: practiceRange,
			mode: "shadow",
			countdown: 0,
			restSeconds: 2,
			responseMultiplier: 1,
			take: null,
			error: null,
			saving: false,
			failedSaves: [
				{ id: "failed", range: { sourceId: "one", start: 1, end: 2, text: "retry" } },
			],
		}),
		subscribe: () => () => undefined,
		selectRange: vi.fn(),
		stop: vi.fn(),
		leave,
		retrySave,
		dispose: vi.fn(),
	} as unknown as ShadowingSession;
	const records = {
		list: vi.fn(async () => [record]),
		reload: vi.fn(async () => [record]),
		readTake,
	} as unknown as ShadowPracticeRecords;

	const playAudio = vi.fn(async () => undefined);
	const stopAudio = vi.fn();
	const audioPlayer: TakeAudioPlayerPort = {
		play: playAudio,
		stop: stopAudio,
		dispose: vi.fn(),
	};

	const workspaceSession = new ShadowingWorkspaceSession({
		runtime,
		jobs,
		session,
		records,
		audioPlayer,
		readEnabled: (id) => enabled.has(id),
		writeEnabled,
		startGeneration: async () => undefined,
		translateImported: async () => undefined,
	});

	return {
		session: workspaceSession,
		restore,
		play,
		leave,
		writeEnabled,
		jobs,
		innerSession: session,
		readTake,
		reloadSource,
		retrySave,
		audioPlayer,
		playAudio,
		stopAudio,
		record,
		finishRead(data: ArrayBuffer) {
			resolveRead(data);
		},
		setSource(id: string) {
			sourceId = id;
			runtimeListener?.();
		},
		setPracticeActive() {
			playing = true;
			practiceRange = { sourceId, start: 4, end: 6 };
		},
	};
}

describe("ShadowingWorkspaceSession", () => {
	it("keeps subtitles opt-in per video and loads them only after enabling", async () => {
		const state = setup([]);
		expect(state.session.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalled();

		await state.session.act({ type: "set-enabled", enabled: true });
		expect(state.writeEnabled).toHaveBeenCalledWith("one", true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("one"));
		state.setSource("two");
		expect(state.session.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalledWith("two");

		await state.session.act({ type: "set-enabled", enabled: true });
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("two"));
		state.setSource("one");
		expect(state.session.getSnapshot().enabled).toBe(true);

		await state.session.act({ type: "set-enabled", enabled: false });
		expect(state.writeEnabled).toHaveBeenLastCalledWith("one", false);
		expect(state.session.getSnapshot().enabled).toBe(false);
		state.session.dispose();
	});

	it("turning shadowing off keeps the current video time and resumes playback", async () => {
		const state = setup();
		state.setPracticeActive();
		await state.session.act({ type: "set-enabled", enabled: false });
		expect(state.leave).toHaveBeenCalledWith({ seekToEnd: false });
		expect(state.play).toHaveBeenCalledOnce();
		state.session.dispose();
	});

	it("plays a saved recording through TakeAudioPlayerPort without DOM audio", async () => {
		const state = setup();
		await vi.waitFor(() => expect(state.session.getSnapshot().records).toHaveLength(1));

		const openPromise = state.session.act({
			type: "open-record",
			record: state.session.getSnapshot().records[0]!,
		});
		state.finishRead(new ArrayBuffer(8));
		await openPromise;

		expect(state.playAudio).toHaveBeenCalledWith(expect.any(ArrayBuffer), "audio/webm");
		state.session.dispose();
	});

	it("does not play a saved recording if the video source changes during take read", async () => {
		const state = setup();
		await vi.waitFor(() => expect(state.session.getSnapshot().records).toHaveLength(1));

		const openPromise = state.session.act({
			type: "open-record",
			record: state.session.getSnapshot().records[0]!,
		});
		state.setSource("two");
		state.finishRead(new ArrayBuffer(8));
		await openPromise;

		expect(state.playAudio).not.toHaveBeenCalled();
		state.session.dispose();
	});

	it("stops active practice and audio on presenter relinquishment", async () => {
		const state = setup();
		await state.session.act({ type: "relinquish-presenter" });
		expect(state.stopAudio).toHaveBeenCalled();
		state.session.dispose();
	});

	it("captures async errors into snapshot.taskError", async () => {
		const state = setup();
		state.reloadSource.mockRejectedValueOnce(new Error("Disk failed"));
		await state.session.act({ type: "reload-subtitles" });
		expect(state.session.getSnapshot().taskError).toBe("Disk failed");
		state.session.dispose();
	});

	it("creates and manages ShadowingSession internally when recorder is provided", async () => {
		const recorder = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(async () => new Blob()),
			cancel: vi.fn(),
			play: vi.fn(async () => undefined),
			dispose: vi.fn(),
		};
		const runtime = {
			getSnapshot: () => ({ currentSourceId: "one", playbackRate: 1, playing: false }),
			subscribe: () => () => undefined,
			subscribeInterruptions: () => () => undefined,
			seekTo: vi.fn(),
			stopRange: vi.fn(),
			pause: vi.fn(),
		} as unknown as VideoPlayerRuntime;
		const jobs = {
			getSnapshot: () => ({ documents: {}, tasks: [], translationFailures: {} }),
			subscribe: () => () => undefined,
		} as unknown as VideoSubtitleJobs;
		const records = {
			list: vi.fn(async () => []),
			saveTake: vi.fn(async () => undefined),
			reload: vi.fn(async () => []),
		} as unknown as ShadowPracticeRecords;

		const session = new ShadowingWorkspaceSession({
			runtime,
			jobs,
			records,
			recorder,
			readEnabled: () => true,
			writeEnabled: () => undefined,
			startGeneration: async () => undefined,
			translateImported: async () => undefined,
		});

		expect(session.getSnapshot().practicePhase).toBe("idle");
		await session.act({ type: "set-mode", mode: "repeat-after" });
		expect(session.getSnapshot().practiceMode).toBe("repeat-after");
		session.dispose();
		expect(recorder.dispose).toHaveBeenCalled();
	});
});
