import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
	type VideoSubtitleJobs,
} from "../shadowSubtitlesJobs";
import { ShadowingWorkspaceSession } from "../shadowingWorkspaceSession";
import { VideoPlayerRuntime, emptyState } from "../videoPlayerRuntime";
import type {
	ShadowPracticeRecord,
	ShadowPracticeRecordsPort,
	ShadowRecorderPort,
	TakeAudioPlayerPort,
	VideoMediaPort,
} from "../types";

class FakeMedia extends EventTarget implements VideoMediaPort {
	currentTime = 0;
	duration = 100;
	paused = true;
	seeking = false;
	playbackRate = 1;
	src = "";
	play = vi.fn(async () => {
		this.paused = false;
		this.dispatchEvent(new Event("play"));
	});
	pause = vi.fn(() => {
		this.paused = true;
		this.dispatchEvent(new Event("pause"));
	});
	load = () => undefined;
	end(time: number) {
		this.currentTime = time;
		this.dispatchEvent(new Event("timeupdate"));
	}
}

function setup(initialEnabled: readonly string[] = ["one", "two"]) {
	const runtime = new VideoPlayerRuntime({
		store: { load: emptyState, save: () => undefined, clear: () => undefined },
		toMediaUrl: (path) => path,
	});
	runtime.addSources([
		{ id: "one", path: "one.mp4", name: "one" },
		{ id: "two", path: "two.mp4", name: "two" },
	]);
	const media = new FakeMedia();
	runtime.bindMedia(media);

	const enabled = new Set(initialEnabled);
	const writeEnabled = vi.fn((id: string, value: boolean) => {
		if (value) enabled.add(id);
		else enabled.delete(id);
	});

	let jobsListener: (() => void) | null = null;
	let resolveRead!: (data: ArrayBuffer) => void;
	const readTake = vi.fn(
		() =>
			new Promise<ArrayBuffer>((resolve) => {
				resolveRead = resolve;
			}),
	);
	const startJob = vi.fn(async () => undefined);
	const translateSubtitles = vi.fn(async () => undefined);
	const reloadSource = vi.fn(async (): Promise<void> => undefined);
	const restore = vi.fn(async () => undefined);
	const record: ShadowPracticeRecord = {
		id: "take-1",
		sourceId: "one",
		kind: "recording",
		start: 4,
		end: 6,
		text: "hello",
		createdAt: 1,
		mimeType: "audio/webm",
		audioPath: "Study Studio/one/take-take-1.webm",
	};
	const saveTake = vi.fn<ShadowPracticeRecordsPort["saveTake"]>(async () => record);
	const markDifficult = vi.fn<ShadowPracticeRecordsPort["markDifficult"]>(async () => record);
	const removeRecord = vi.fn(async () => undefined);
	const cues = [
		{ id: "c1", start: 1, end: 3, text: "first", translation: "第一" },
		{ id: "c2", start: 4, end: 6, text: "second", translation: "第二" },
	];
	const documents: Record<string, { cues: typeof cues }> = {
		one: { cues },
		two: { cues: [] },
	};
	const editTargets = new Map<string, ShadowSubtitleEditTarget>();
	editTargets.set("one:c1", {
		cueId: "c1",
		sourceId: "one",
		version: "initial",
		text: "first",
		translation: "第一",
	});
	editTargets.set("one:c2", {
		cueId: "c2",
		sourceId: "one",
		version: "initial",
		text: "second",
		translation: "第二",
	});
	const getCueEditTarget = vi.fn(
		(sid: string, cid: string) => editTargets.get(`${sid}:${cid}`) ?? null,
	);
	const saveCueEdit = vi.fn<VideoSubtitleJobs["saveCueEdit"]>(async (target, patch) => {
		const saved = { ...target, ...patch, version: target.version + "-saved" };
		editTargets.set(target.sourceId + ":" + target.cueId, saved);
		jobsListener?.();
		return saved;
	});

	const jobs = {
		getSnapshot: () => ({ documents, tasks: [], translationFailures: {} }),
		subscribe: (listener: () => void) => {
			jobsListener = listener;
			return () => {
				jobsListener = null;
			};
		},
		start: startJob,
		translateSubtitles,
		restore,
		reloadSource,
		getCueEditTarget,
		saveCueEdit,
	} as unknown as VideoSubtitleJobs;

	const reloadRecords = vi.fn(async () => [record]);
	const records: ShadowPracticeRecordsPort = {
		list: vi.fn(async () => [record]),
		reload: reloadRecords,
		readTake,
		saveTake,
		markDifficult,
		remove: removeRecord,
	};

	const recorder: ShadowRecorderPort = {
		start: vi.fn(async () => undefined),
		stop: vi.fn(async () => new Blob(["voice"], { type: "audio/webm" })),
		cancel: vi.fn(),
		play: vi.fn(async () => undefined),
		dispose: vi.fn(),
	};

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
		recorder,
		records,
		audioPlayer,
		readEnabled: (id) => enabled.has(id),
		writeEnabled,
	});

	return {
		session: workspaceSession,
		runtime,
		media,
		recorder,
		restore,
		startJob,
		translateSubtitles,
		writeEnabled,
		jobs,
		saveTake,
		reloadRecords,
		readTake,
		reloadSource,
		audioPlayer,
		playAudio,
		stopAudio,
		saveCueEdit,
		getCueEditTarget,
		editTargets,
		cues,
		documents,
		record,
		finishRead(data: ArrayBuffer) {
			resolveRead(data);
		},
		notifyJobsChanged() {
			jobsListener?.();
		},
	};
}

function pending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function editFirstCue(state: ReturnType<typeof setup>) {
	await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
	await state.session.act({ type: "toggle-cue-editor" });
	await state.session.act({ type: "set-cue-field", field: "text", value: "My correction" });
}

describe("ShadowingWorkspaceSession", () => {
	it("keeps subtitles opt-in per video and loads them only after enabling", async () => {
		const state = setup([]);
		expect(state.session.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalled();

		await state.session.setEnabled(true);
		expect(state.writeEnabled).toHaveBeenCalledWith("one", true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("one"));
		state.runtime.selectSource("two");
		expect(state.session.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalledWith("two");

		await state.session.setEnabled(true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("two"));
		state.runtime.selectSource("one");
		expect(state.session.getSnapshot().enabled).toBe(true);

		await state.session.setEnabled(false);
		expect(state.writeEnabled).toHaveBeenLastCalledWith("one", false);
		expect(state.session.getSnapshot().enabled).toBe(false);
		state.session.dispose();
	});

	it("turning shadowing off keeps the current video time and resumes playback", async () => {
		const state = setup();
		await state.session.act({ type: "select-range", start: 4, end: 6, text: "hello" });
		await state.session.act({ type: "start-loop" });
		state.media.currentTime = 5;
		await state.session.setEnabled(false);
		expect(state.media.currentTime).toBe(5);
		expect(state.session.getSnapshot().practiceStart).toBeNull();
		expect(state.session.getSnapshot().practicePhase).toBe("idle");
		expect(state.runtime.getSnapshot().playing).toBe(true);
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
		state.runtime.selectSource("two");
		state.finishRead(new ArrayBuffer(8));
		await openPromise;

		expect(state.playAudio).not.toHaveBeenCalled();
		state.session.dispose();
	});

	it("captures async errors into snapshot.taskError", async () => {
		const state = setup();
		state.reloadSource.mockRejectedValueOnce(new Error("Disk failed"));
		await state.session.act({ type: "reload-subtitles" });
		expect(state.session.getSnapshot().taskError).toBe("Disk failed");
		state.session.dispose();
	});

	it("waits for continue-watching playback before publishing its failure", async () => {
		const state = setup();
		let rejectPlay!: (error: Error) => void;
		state.media.play.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectPlay = reject;
				}),
		);
		let settled = false;
		const completion = state.session.act({ type: "continue-watching" });
		void completion.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		rejectPlay(new Error("Playback failed"));
		await completion;
		expect(settled).toBe(true);
		expect(state.session.getSnapshot().taskError).toBe("Playback failed");
		state.session.dispose();
	});

	it("starts generation and imported translation directly on jobs without host callbacks", async () => {
		const state = setup();
		const expectedSource = state.runtime.getSnapshot().sources[0]!;
		await state.session.act({ type: "generate" });
		await state.session.act({ type: "translate-imported" });
		expect(state.startJob).toHaveBeenCalledWith(expectedSource);
		expect(state.translateSubtitles).toHaveBeenCalledWith(expectedSource);
		state.session.dispose();
		expect(state.recorder.dispose).toHaveBeenCalledOnce();
	});

	it("manages cue selection, range editing, and triggers practice via act()", async () => {
		const state = setup();
		expect(state.session.getSnapshot().selectedCueIds).toEqual([]);
		expect(state.session.getSnapshot().canPractice).toBe(false);

		// Select first cue
		await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
		let snap = state.session.getSnapshot();
		expect(snap.selectedCueIds).toEqual(["c1"]);
		expect(snap.rangeStart).toBe(1);
		expect(snap.rangeEnd).toBe(3);
		expect(snap.canPractice).toBe(true);
		expect(state.media.currentTime).toBe(1);

		// Extend selection to second cue
		await state.session.act({ type: "choose-cue", cueId: "c2", extend: true });
		snap = state.session.getSnapshot();
		expect(snap.selectedCueIds).toEqual(["c1", "c2"]);
		expect(snap.rangeStart).toBe(1);
		expect(snap.rangeEnd).toBe(6);

		// Adjust range edges
		await state.session.act({ type: "set-cue-range", edge: "start", seconds: 0.5 });
		await state.session.act({ type: "set-cue-range", edge: "end", seconds: 6.5 });
		snap = state.session.getSnapshot();
		expect(snap.rangeStart).toBe(0.5);
		expect(snap.rangeEnd).toBe(6.5);

		// Start practice with selected cues
		await state.session.act({ type: "start-practice-selected" });
		snap = state.session.getSnapshot();
		expect(snap.practiceStart).toBe(0.5);
		expect(snap.practiceEnd).toBe(6.5);
		expect(snap.practicePhase).toBe("paused");
		state.session.dispose();
	});

	it("manages cue drafts, edit saving, and conflict resolution via act()", async () => {
		const state = setup();
		await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
		expect(state.session.getSnapshot().editor).toBeNull();

		// Open editor for c1
		await state.session.act({ type: "toggle-cue-editor" });
		let snap = state.session.getSnapshot();
		expect(snap.editor).not.toBeNull();
		expect(snap.editor?.cueId).toBe("c1");
		expect(snap.editor?.text).toBe("first");
		expect(snap.editor?.translation).toBe("第一");
		expect(snap.editor?.canSave).toBe(false);
		await state.session.act({ type: "save-cue-edit" });
		expect(state.saveCueEdit).not.toHaveBeenCalled();

		// Edit text field
		const initialEditor = snap.editor;
		await state.session.act({
			type: "set-cue-field",
			field: "text",
			value: "first edit",
			expectedEditor: initialEditor,
		});
		snap = state.session.getSnapshot();
		expect(snap.editor?.text).toBe("first edit");

		// Stale expectedEditor is ignored
		await state.session.act({
			type: "set-cue-field",
			field: "text",
			value: "stale value",
			expectedEditor: initialEditor,
		});
		expect(state.session.getSnapshot().editor?.text).toBe("first edit");

		// Save edit successfully
		await state.session.act({
			type: "save-cue-edit",
			expectedEditor: snap.editor,
		});
		expect(state.saveCueEdit).toHaveBeenCalledWith(expect.objectContaining({ cueId: "c1" }), {
			text: "first edit",
		});
		// Editor is closed and draft cleared after successful save
		expect(state.session.getSnapshot().editor).toBeNull();

		// Open editor again and simulate conflict
		await state.session.act({ type: "toggle-cue-editor" });
		await state.session.act({ type: "set-cue-field", field: "translation", value: "" });
		snap = state.session.getSnapshot();
		state.saveCueEdit.mockRejectedValueOnce(new ShadowSubtitleEditConflict());

		await state.session.act({
			type: "save-cue-edit",
			expectedEditor: snap.editor,
		});
		expect(state.saveCueEdit).toHaveBeenLastCalledWith(
			expect.objectContaining({ cueId: "c1" }),
			{ translation: "" },
		);
		snap = state.session.getSnapshot();
		expect(snap.editor?.conflict).toBe(true);
		expect(snap.editor?.canSave).toBe(false);

		// Request reload and confirm reload
		await state.session.act({
			type: "request-cue-reload",
			expectedEditor: snap.editor,
		});
		snap = state.session.getSnapshot();
		expect(snap.editor?.confirmingReload).toBe(true);

		await state.session.act({
			type: "cancel-cue-reload",
			expectedEditor: snap.editor,
		});
		snap = state.session.getSnapshot();
		expect(snap.editor?.confirmingReload).toBe(false);

		const replacement = {
			...state.editTargets.get("one:c1")!,
			version: "reloaded",
			text: "Vault edit",
			translation: "新译文",
		};
		state.reloadSource.mockImplementationOnce(async () => {
			state.editTargets.set("one:c1", replacement);
			state.notifyJobsChanged();
		});
		await state.session.act({
			type: "request-cue-reload",
			expectedEditor: snap.editor,
		});
		await state.session.act({
			type: "confirm-cue-reload",
			expectedEditor: state.session.getSnapshot().editor,
		});
		expect(state.reloadSource).toHaveBeenCalledWith("one", "c1");
		expect(state.session.getSnapshot().editor).toMatchObject({
			text: replacement.text,
			translation: replacement.translation,
			conflict: false,
			canSave: false,
		});
		state.session.dispose();
	});

	it.each([false, true])(
		"uses the committed version after reopening, subsequent edit = %s",
		async (externalEdit) => {
			const state = setup();
			await editFirstCue(state);
			const writing = pending<ShadowSubtitleEditTarget>();
			state.saveCueEdit.mockReturnValueOnce(writing.promise);
			const saving = state.session.act({ type: "save-cue-edit" });
			await state.session.act({ type: "choose-cue", cueId: "c2", extend: false });
			await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
			const receipt = {
				...state.editTargets.get("one:c1")!,
				text: "My correction",
				version: "saved",
			};
			state.editTargets.set("one:c1", receipt);
			state.notifyJobsChanged();
			expect(state.session.getSnapshot().editor).toMatchObject({
				busy: true,
				conflict: false,
			});
			if (externalEdit) {
				state.editTargets.set("one:c1", { ...receipt, version: "external" });
				state.notifyJobsChanged();
			}
			writing.resolve(receipt);
			await saving;
			expect(state.session.getSnapshot().editor).toMatchObject({
				text: "My correction",
				conflict: externalEdit,
				canSave: false,
				busy: false,
			});
			if (!externalEdit) {
				await state.session.act({
					type: "set-cue-field",
					field: "text",
					value: "Follow-up correction",
				});
				await state.session.act({ type: "save-cue-edit" });
				expect(state.saveCueEdit).toHaveBeenLastCalledWith(receipt, {
					text: "Follow-up correction",
				});
			}
			state.session.dispose();
		},
	);

	it("keeps a failed save with its original cue while another cue is being edited", async () => {
		const state = setup();
		await editFirstCue(state);
		const writing = pending<ShadowSubtitleEditTarget>();
		state.saveCueEdit.mockReturnValueOnce(writing.promise);
		const saving = state.session.act({ type: "save-cue-edit" });
		await state.session.act({ type: "choose-cue", cueId: "c2", extend: false });
		await state.session.act({ type: "toggle-cue-editor" });
		writing.reject(new Error("disk full"));
		await saving;
		expect(state.session.getSnapshot().editor).toMatchObject({ cueId: "c2", failure: null });
		await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
		expect(state.session.getSnapshot().editor).toMatchObject({
			text: "My correction",
			translation: "第一",
			failure: "disk full",
			canSave: true,
		});
		state.session.dispose();
	});

	it("recovers a deleted subtitle after a confirmed reload without disturbing the active editor", async () => {
		const state = setup();
		await editFirstCue(state);
		state.saveCueEdit.mockRejectedValueOnce(new ShadowSubtitleEditConflict());
		await state.session.act({ type: "save-cue-edit" });
		await state.session.act({ type: "request-cue-reload" });
		const reading = pending<void>();
		state.reloadSource.mockReturnValueOnce(reading.promise);
		const reload = state.session.act({ type: "confirm-cue-reload" });
		await state.session.act({ type: "choose-cue", cueId: "c2", extend: false });
		await state.session.act({ type: "toggle-cue-editor" });
		state.documents.one!.cues = state.cues.filter((cue) => cue.id !== "c1");
		state.editTargets.delete("one:c1");
		state.notifyJobsChanged();
		reading.resolve();
		await reload;
		const snapshot = state.session.getSnapshot();
		expect(snapshot.editor).toMatchObject({ cueId: "c2", conflict: false });
		expect(snapshot.deletedDrafts).toMatchObject([
			{ sourceId: "one", cueId: "c1", text: "My correction", translation: "第一" },
		]);
		state.runtime.selectSource("two");
		expect(state.session.getSnapshot().deletedDrafts).toEqual([]);
		await state.session.act({
			type: "discard-deleted-draft",
			draft: snapshot.deletedDrafts[0]!,
		});
		state.runtime.selectSource("one");
		const draft = state.session.getSnapshot().deletedDrafts[0]!;
		expect(draft.text).toBe("My correction");
		await state.session.act({ type: "discard-deleted-draft", draft });
		expect(state.session.getSnapshot().deletedDrafts).toEqual([]);
		expect(state.session.getSnapshot().editor?.cueId).toBe("c2");
		state.session.dispose();
	});

	it("releases drafts when the workspace closes, even with a save in flight", async () => {
		const state = setup();
		await editFirstCue(state);
		const writing = pending<ShadowSubtitleEditTarget>();
		state.saveCueEdit.mockReturnValueOnce(writing.promise);
		const saving = state.session.act({ type: "save-cue-edit" });
		state.session.clearSubtitleDrafts();
		await editFirstCue(state);
		await state.session.act({
			type: "set-cue-field",
			field: "text",
			value: "New workspace draft",
		});
		writing.reject(new Error("late failure"));
		await saving;
		expect(state.session.getSnapshot().editor).toMatchObject({
			text: "New workspace draft",
			failure: null,
		});
		state.session.dispose();
	});

	it("preserves selection and uncommitted drafts per source when switching sources", async () => {
		const state = setup();
		await state.session.act({ type: "choose-cue", cueId: "c1", extend: false });
		await state.session.act({ type: "toggle-cue-editor" });
		await state.session.act({
			type: "set-cue-field",
			field: "text",
			value: "uncommitted work",
			expectedEditor: state.session.getSnapshot().editor,
		});
		expect(state.session.getSnapshot().editor?.text).toBe("uncommitted work");

		// Switch to source two
		state.runtime.selectSource("two");
		expect(state.session.getSnapshot().selectedCueIds).toEqual([]);
		expect(state.session.getSnapshot().editor).toBeNull();

		// Switch back to source one: draft and selection are preserved!
		state.runtime.selectSource("one");
		const snap = state.session.getSnapshot();
		expect(snap.selectedCueIds).toEqual(["c1"]);
		expect(snap.editor?.text).toBe("uncommitted work");
		state.session.dispose();
	});

	it("steps across subtitle cues and replays the current sentence via act()", async () => {
		const state = setup();
		// Step forward from initial state selects the first cue after currentTime (0)
		await state.session.act({ type: "step-cue", direction: 1 });
		expect(state.session.getSnapshot().selectedCueIds).toEqual(["c1"]);
		expect(state.media.currentTime).toBe(1);

		// Step forward again moves to c2
		await state.session.act({ type: "step-cue", direction: 1 });
		expect(state.session.getSnapshot().selectedCueIds).toEqual(["c2"]);
		expect(state.media.currentTime).toBe(4);

		// Step backward moves back to c1
		await state.session.act({ type: "step-cue", direction: -1 });
		expect(state.session.getSnapshot().selectedCueIds).toEqual(["c1"]);
		expect(state.media.currentTime).toBe(1);

		// Replay current cue sets practice range and starts bounded playback
		await state.session.act({ type: "replay-current-cue" });
		expect(state.session.getSnapshot().practiceStart).toBe(1);
		expect(state.session.getSnapshot().practiceEnd).toBe(3);
		expect(state.session.getSnapshot().practicePhase).toBe("playing");
		state.session.dispose();
	});
});

describe("shadowing playback and recordings", () => {
	function setupPractice() {
		vi.useFakeTimers();
		const state = setup();
		void state.session.act({ type: "select-range", start: 10, end: 14, text: "Hello" });
		return state;
	}

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("loops by media boundary and waits two seconds, with buffering consuming no rest time", async () => {
		const { session, media } = setupPractice();
		await session.act({ type: "start-loop" });
		await vi.advanceTimersByTimeAsync(6000);
		expect(session.getSnapshot().practicePhase).toBe("playing");
		media.end(14);
		await Promise.resolve();
		expect(session.getSnapshot().practicePhase).toBe("resting");
		await vi.advanceTimersByTimeAsync(1999);
		expect(media.currentTime).toBe(14);
		await vi.advanceTimersByTimeAsync(1);
		expect(media.currentTime).toBe(10);
		expect(session.getSnapshot().practicePhase).toBe("playing");
		session.dispose();
	});

	it("manual pause during rest cancels automatic continuation", async () => {
		const { runtime, session, media } = setupPractice();
		await session.act({ type: "start-loop" });
		media.end(14);
		await Promise.resolve();
		runtime.pause();
		await vi.advanceTimersByTimeAsync(5000);
		expect(session.getSnapshot().practicePhase).toBe("paused");
		expect(media.play).toHaveBeenCalledTimes(1);
		session.dispose();
	});

	it("finishes the rest window early when continue-early is dispatched", async () => {
		const { session, media } = setupPractice();
		await session.act({ type: "start-loop" });
		media.end(14);
		await Promise.resolve();
		expect(session.getSnapshot().practicePhase).toBe("resting");
		await session.act({ type: "continue-early" });
		await Promise.resolve();
		expect(media.currentTime).toBe(10);
		expect(session.getSnapshot().practicePhase).toBe("playing");
		session.dispose();
	});

	it("uses rate-adjusted duration plus one second for repeat-after", async () => {
		const { runtime, session, media } = setupPractice();
		runtime.setPlaybackRate(0.5);
		await session.act({ type: "set-mode", mode: "repeat-after" });
		await session.act({ type: "start-loop" });
		media.end(14);
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(8999);
		expect(session.getSnapshot().practicePhase).toBe("resting");
		await vi.advanceTimersByTimeAsync(1);
		expect(session.getSnapshot().practicePhase).toBe("playing");
		session.dispose();
	});

	it("records one pass after countdown, retains the Blob, and supports replay review", async () => {
		const { session, media, recorder } = setupPractice();
		await session.act({ type: "record-once" });
		expect(session.getSnapshot().countdown).toBe(3);
		await vi.advanceTimersByTimeAsync(3000);
		expect(recorder.start).toHaveBeenCalledOnce();
		expect(session.getSnapshot().practicePhase).toBe("recording");
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		expect(recorder.stop).toHaveBeenCalledOnce();
		expect(session.getSnapshot().practicePhase).toBe("review");
		expect(session.getSnapshot().hasTemporaryTake).toBe(true);
		await session.act({ type: "replay-take" });
		expect(recorder.play).toHaveBeenCalledWith(expect.objectContaining({ size: 5 }));
		await session.act({ type: "replay-original" });
		expect(session.getSnapshot().practicePhase).toBe("playing");
		media.end(14);
		await Promise.resolve();
		expect(session.getSnapshot().practicePhase).toBe("review");
		session.dispose();
	});

	it("records only the response window in repeat-after mode and saves the take metadata", async () => {
		const { session, media, recorder, saveTake } = setupPractice();
		await session.act({ type: "set-mode", mode: "repeat-after" });
		await session.act({ type: "record-once" });
		await vi.advanceTimersByTimeAsync(3000);
		expect(recorder.start).not.toHaveBeenCalled();
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		expect(recorder.start).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(5000);
		expect(session.getSnapshot().hasTemporaryTake).toBe(true);
		await session.act({ type: "save-take" });
		expect(saveTake).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "repeat-after",
				range: expect.objectContaining({ start: 10, end: 14 }),
			}),
		);
		session.dispose();
	});

	it("cancels countdown on rate changes and clears temporary recordings on source switch", async () => {
		const { runtime, session, recorder } = setupPractice();
		await session.act({ type: "record-once" });
		runtime.setPlaybackRate(1.5);
		await vi.advanceTimersByTimeAsync(5000);
		expect(recorder.start).not.toHaveBeenCalled();
		runtime.selectSource("two");
		expect(session.getSnapshot().practiceStart).toBeNull();
		expect(session.getSnapshot().hasTemporaryTake).toBe(false);
		session.dispose();
	});

	it("keeps an accepted failed save after leaving and retries the captured take", async () => {
		const { session, media, saveTake, reloadRecords, record } = setupPractice();
		saveTake.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(record);
		await session.act({ type: "record-once" });
		await vi.advanceTimersByTimeAsync(3000);
		media.end(14);
		await vi.advanceTimersByTimeAsync(0);
		const saving = session.act({ type: "save-take" });
		await session.act({ type: "continue-watching" });
		await saving;
		expect(session.getSnapshot().hasTemporaryTake).toBe(false);
		const failed = session.getSnapshot().failedSaves;
		expect(failed).toHaveLength(1);
		expect(session.getSnapshot().practiceError).toBe("disk full");
		await session.act({ type: "retry-save", takeId: failed[0]!.id });
		expect(saveTake).toHaveBeenCalledTimes(2);
		expect(reloadRecords).toHaveBeenCalled();
		expect(session.getSnapshot().failedSaves).toEqual([]);
		session.dispose();
	});

	it("dismisses practice without jumping ahead when shadowing is disabled", async () => {
		const { session, media } = setupPractice();
		media.currentTime = 11;
		await session.setEnabled(false);
		expect(media.currentTime).toBe(11);
		expect(session.getSnapshot().practiceStart).toBeNull();
		expect(session.getSnapshot().practicePhase).toBe("idle");
		session.dispose();
	});

	it("never advances the queue when a practice range ends at the video end", async () => {
		const { runtime, session, media } = setupPractice();
		await session.act({ type: "select-range", start: 95, end: 100 });
		await session.act({ type: "start-loop" });
		media.end(100);
		media.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		expect(runtime.getSnapshot().currentSourceId).toBe("one");
		expect(runtime.getSnapshot().completedSourceIds).toEqual([]);
		session.dispose();
	});

	it("stops active practice and audio on presenter relinquishment", async () => {
		const { session, stopAudio } = setupPractice();
		await session.act({ type: "start-loop" });
		expect(session.getSnapshot().practicePhase).toBe("playing");
		await session.stopForPresenterLoss();
		expect(session.getSnapshot().practicePhase).toBe("paused");
		expect(stopAudio).toHaveBeenCalledOnce();
		session.dispose();
	});
});
