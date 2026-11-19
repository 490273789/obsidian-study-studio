import { describe, expect, it, vi } from "vite-plus/test";
import type { VideoPlayerRuntime } from "../videoPlayerRuntime";
import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
	type VideoSubtitleJobs,
} from "../shadowSubtitlesJobs";
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
	let jobsListener: (() => void) | null = null;
	let resolveRead!: (data: ArrayBuffer) => void;
	const readTake = vi.fn(
		() =>
			new Promise<ArrayBuffer>((resolve) => {
				resolveRead = resolve;
			}),
	);
	const reloadSource = vi.fn(async (): Promise<void> => undefined);
	const restore = vi.fn(async () => undefined);
	const play = vi.fn(async (): Promise<void> => undefined);
	const leave = vi.fn();
	const retrySave = vi.fn(async () => undefined);
	const seekTo = vi.fn();
	const selectRange = vi.fn();
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

	const runtime = {
		getSnapshot: () => ({ currentSourceId: sourceId, playing, duration: 30 }),
		subscribe: (listener: () => void) => {
			runtimeListener = listener;
			return () => {
				runtimeListener = null;
			};
		},
		seekTo,
		play,
	} as unknown as VideoPlayerRuntime;
	const jobs = {
		getSnapshot: () => ({ documents, tasks: [], translationFailures: {} }),
		subscribe: (listener: () => void) => {
			jobsListener = listener;
			return () => {
				jobsListener = null;
			};
		},
		restore,
		reloadSource,
		getCueEditTarget,
		saveCueEdit,
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
		selectRange,
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
		seekTo,
		selectRange,
		saveCueEdit,
		getCueEditTarget,
		editTargets,
		cues,
		documents,
		record,
		finishRead(data: ArrayBuffer) {
			resolveRead(data);
		},
		setSource(id: string) {
			sourceId = id;
			runtimeListener?.();
		},
		notifyJobsChanged() {
			jobsListener?.();
		},
		setPracticeActive() {
			playing = true;
			practiceRange = { sourceId, start: 4, end: 6 };
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
		state.setSource("two");
		expect(state.session.getSnapshot().enabled).toBe(false);
		expect(state.restore).not.toHaveBeenCalledWith("two");

		await state.session.setEnabled(true);
		await vi.waitFor(() => expect(state.restore).toHaveBeenCalledWith("two"));
		state.setSource("one");
		expect(state.session.getSnapshot().enabled).toBe(true);

		await state.session.setEnabled(false);
		expect(state.writeEnabled).toHaveBeenLastCalledWith("one", false);
		expect(state.session.getSnapshot().enabled).toBe(false);
		state.session.dispose();
	});

	it("turning shadowing off keeps the current video time and resumes playback", async () => {
		const state = setup();
		state.setPracticeActive();
		await state.session.setEnabled(false);
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
		await state.session.stopForPresenterLoss();
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

	it("waits for continue-watching playback before publishing its failure", async () => {
		const state = setup();
		let rejectPlay!: (error: Error) => void;
		state.play.mockImplementationOnce(
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

	it("creates and manages ShadowingSession internally when recorder is provided", async () => {
		const recorder = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(async () => new Blob()),
			cancel: vi.fn(),
			play: vi.fn(async () => undefined),
			dispose: vi.fn(),
		};
		const runtime = {
			getSnapshot: () => ({
				currentSourceId: "one",
				playbackRate: 1,
				playing: false,
				duration: 30,
			}),
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
		expect(state.seekTo).toHaveBeenCalledWith(1);

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
		expect(state.selectRange).toHaveBeenCalledWith("one", 0.5, 6.5, "first second");
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
		expect(snap.editor?.canSave).toBe(true);

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
			translation: "第一",
		});
		// Editor is closed and draft cleared after successful save
		expect(state.session.getSnapshot().editor).toBeNull();

		// Open editor again and simulate conflict
		await state.session.act({ type: "toggle-cue-editor" });
		snap = state.session.getSnapshot();
		state.saveCueEdit.mockRejectedValueOnce(new ShadowSubtitleEditConflict());

		await state.session.act({
			type: "save-cue-edit",
			expectedEditor: snap.editor,
		});
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
			canSave: true,
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
				canSave: !externalEdit,
				busy: false,
			});
			if (!externalEdit) {
				await state.session.act({ type: "save-cue-edit" });
				expect(state.saveCueEdit).toHaveBeenLastCalledWith(receipt, {
					text: "My correction",
					translation: "第一",
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
		state.setSource("two");
		expect(state.session.getSnapshot().deletedDrafts).toEqual([]);
		await state.session.act({
			type: "discard-deleted-draft",
			draft: snapshot.deletedDrafts[0]!,
		});
		state.setSource("one");
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
		state.setSource("two");
		expect(state.session.getSnapshot().selectedCueIds).toEqual([]);
		expect(state.session.getSnapshot().editor).toBeNull();

		// Switch back to source one: draft and selection are preserved!
		state.setSource("one");
		const snap = state.session.getSnapshot();
		expect(snap.selectedCueIds).toEqual(["c1"]);
		expect(snap.editor?.text).toBe("uncommitted work");
		state.session.dispose();
	});
});
