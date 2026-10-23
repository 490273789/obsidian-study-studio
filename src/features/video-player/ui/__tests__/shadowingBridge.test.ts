import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";
import type { VideoSubtitleJobs } from "../../domain/shadowSubtitlesJobs";
import type { ShadowingSession } from "../../domain/shadowingSession";
import type { ShadowPracticeRecords } from "../../obsidian/shadowPracticeRecords";
import { ShadowingBridge } from "../shadowingBridge";

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
	} as unknown as ShadowingSession;
	const records = {
		list: vi.fn(async () => [record]),
		reload: vi.fn(async () => [record]),
		readTake,
	} as unknown as ShadowPracticeRecords;
	const bridge = new ShadowingBridge({
		runtime,
		jobs,
		session,
		records,
		readEnabled: (id) => enabled.has(id),
		writeEnabled,
		startGeneration: async () => undefined,
		translateImported: async () => undefined,
	});
	return {
		bridge,
		restore,
		play,
		leave,
		writeEnabled,
		jobs,
		session,
		readTake,
		reloadSource,
		retrySave,
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

afterEach(() => vi.unstubAllGlobals());

describe("ShadowingBridge", () => {
	it("keeps subtitles opt-in per video and loads them only after enabling", async () => {
		const state = setup([]);
		expect(state.bridge.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalled();

		state.bridge.setEnabled(true);
		expect(state.writeEnabled).toHaveBeenCalledWith("one", true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("one"));
		state.setSource("two");
		expect(state.bridge.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalledWith("two");

		state.bridge.setEnabled(true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("two"));
		state.setSource("one");
		expect(state.bridge.getSnapshot().enabled).toBe(true);
		state.bridge.setEnabled(false);
		expect(state.writeEnabled).toHaveBeenLastCalledWith("one", false);
		expect(state.bridge.getSnapshot().enabled).toBe(false);
		state.bridge.dispose();
	});
	it("turning shadowing off keeps the current video time and resumes playback", () => {
		const state = setup();
		state.setPracticeActive();
		state.bridge.setEnabled(false);
		expect(state.leave).toHaveBeenCalledWith({ seekToEnd: false });
		expect(state.play).toHaveBeenCalledOnce();
		state.bridge.dispose();
	});

	it("does not play a saved recording after the source changes during its read", async () => {
		const audio = vi.fn();
		vi.stubGlobal("Audio", audio);
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:take"),
			revokeObjectURL: vi.fn(),
		});
		const state = setup();
		await vi.waitFor(() => expect(state.bridge.getSnapshot().records).toHaveLength(1));
		state.bridge.actions.openRecord(state.bridge.getSnapshot().records[0]!);
		await vi.waitFor(() => expect(state.readTake).toHaveBeenCalledOnce());
		state.setSource("two");
		state.finishRead(new ArrayBuffer(4));
		await Promise.resolve();
		expect(audio).not.toHaveBeenCalled();
		state.bridge.dispose();
	});

	it("exposes failed saves across source changes and can retry them", async () => {
		const state = setup();
		state.setSource("two");
		expect(state.bridge.getSnapshot().failedSaves).toEqual([
			{ id: "failed", sourceId: "one", start: 1, end: 2, text: "retry" },
		]);
		state.bridge.actions.retrySave("failed");
		await vi.waitFor(() => expect(state.retrySave).toHaveBeenCalledWith("failed"));
		state.bridge.actions.reloadSubtitles();
		await vi.waitFor(() => expect(state.reloadSource).toHaveBeenCalledWith("two"));
		state.bridge.dispose();
	});
});
