import { describe, expect, it, vi } from "vite-plus/test";
import { SubtitleEditingSession } from "../subtitleEditingSession";
import {
	ShadowSubtitleEditConflict,
	type ShadowSubtitleEditTarget,
} from "../../domain/shadowSubtitlesJobs";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";
import type { ShadowingWorkspaceSession } from "../../domain/shadowingWorkspaceSession";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup() {
	let sourceId = "a";
	let duration: number | null = 30;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const targets = new Map<string, ShadowSubtitleEditTarget>();
	for (const source of ["a", "b"])
		for (const cue of ["1", "2", "3"]) {
			targets.set(`${source}:${cue}`, {
				sourceId: source,
				cueId: cue,
				text: `${source}${cue}`,
				translation: "译文",
				version: "v1",
			});
		}
	const runtime = {
		getSnapshot: () => ({ currentSourceId: sourceId, duration }),
		subscribe,
		seekTo: vi.fn(),
	} as unknown as Pick<VideoPlayerRuntime, "getSnapshot" | "subscribe" | "seekTo">;
	const workspace = {
		getSnapshot: () => ({
			cues: Array.from(targets.values())
				.filter((target) => target.sourceId === sourceId)
				.map((target) => ({
					id: target.cueId,
					text: target.text,
					start: Number(target.cueId) * 2,
					end: Number(target.cueId) * 2 + 1,
				})),
		}),
		subscribe,
		act: vi.fn(async () => {}),
	} as unknown as Pick<ShadowingWorkspaceSession, "getSnapshot" | "subscribe" | "act">;
	const edits = {
		getCueEditTarget: (source: string, cue: string) => targets.get(`${source}:${cue}`) ?? null,
		saveCueEdit: vi.fn(
			async (
				_target: ShadowSubtitleEditTarget,
				_patch: { text?: string; translation?: string },
			) => {},
		),
		reloadSource: vi.fn(async (_source: string) => {}),
	};
	const reportDetachedFailure = vi.fn();
	const options = { runtime, workspace, edits, reportDetachedFailure };
	const session = new SubtitleEditingSession(options);
	const open = (id = "1") => {
		session.choose(id, false);
		if (!session.getSnapshot().editor) session.toggleEditor();
	};
	const update = (cue = "1", source = sourceId) => {
		const key = `${source}:${cue}`;
		const old = targets.get(key)!;
		targets.set(key, { ...old, text: "updated", version: `${old.version}+` });
		notify();
	};
	return {
		session,
		options,
		open,
		targets,
		edits,
		notify,
		update,
		reportDetachedFailure,
		workspace,
		runtime,
		switchSource: (id: string) => {
			sourceId = id;
			notify();
		},
		setDuration: (value: number) => {
			duration = value;
			notify();
		},
	};
}

describe("SubtitleEditingSession", () => {
	it("owns contiguous selection, seeking and validated semantic practice ranges", () => {
		const h = setup();
		h.session.choose("3", false);
		h.session.choose("1", true);
		expect(h.session.getSnapshot().selectedCueIds).toEqual(["1", "2", "3"]);
		expect(h.runtime.seekTo).toHaveBeenCalledTimes(1);
		h.session.practice();
		expect(h.workspace.act).toHaveBeenCalledWith({
			type: "select-range",
			start: 2,
			end: 7,
			text: "a1 a2 a3",
		});
		for (const value of [NaN, Infinity, -1, 8]) {
			h.session.setRange("start", value);
			expect(h.session.getSnapshot().canPractice).toBe(false);
		}
		h.session.setRange("start", 2);
		h.setDuration(6);
		expect(h.session.getSnapshot().canPractice).toBe(false);
	});

	it("preserves fields on failure and locks fields and duplicate submissions until settlement", async () => {
		const h = setup();
		h.open();
		h.session.setField("text", "draft");
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		await h.session.submit();
		h.session.setField("text", "ignored");
		expect(h.edits.saveCueEdit).toHaveBeenCalledTimes(1);
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "draft",
			busy: true,
			canSave: false,
		});
		pending.reject(new Error("disk unavailable"));
		await save;
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "draft",
			busy: false,
			failure: "disk unavailable",
			canSave: true,
		});
		await h.session.submit();
		expect(h.session.getSnapshot().editor).toBeNull();
	});

	it("creates the target only when opening and never overwrites an existing draft", () => {
		const h = setup();
		h.session.choose("1", false);
		h.update();
		h.session.toggleEditor();
		expect(h.session.getSnapshot().editor?.text).toBe("updated");
		h.session.setField("text", "dirty");
		h.update();
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "dirty",
			conflict: true,
			canSave: false,
		});
		h.session.toggleEditor();
		h.session.toggleEditor();
		expect(h.session.getSnapshot().editor?.text).toBe("dirty");
	});

	it("ignores other cue changes, restores drafts across cues and sources, and isolates views", () => {
		const h = setup();
		const other = new SubtitleEditingSession(h.options);
		h.open();
		h.session.setField("translation", "mine");
		h.update("2");
		expect(h.session.getSnapshot().editor?.conflict).toBe(false);
		h.open("2");
		h.session.setField("text", "second");
		h.open("1");
		expect(h.session.getSnapshot().editor?.translation).toBe("mine");
		h.switchSource("b");
		h.open();
		h.session.setField("text", "video b");
		h.switchSource("a");
		expect(h.session.getSnapshot().editor?.translation).toBe("mine");
		other.choose("1", false);
		other.toggleEditor();
		expect(other.getSnapshot().editor?.translation).toBe("译文");
		h.session.dispose();
		expect(other.getSnapshot().editor?.text).toBe("a1");
		other.dispose();
	});

	it("keeps an accepted save bound to its target and does not close a new editor", async () => {
		const h = setup();
		h.open();
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		h.switchSource("b");
		h.open("2");
		h.session.setField("text", "new editor");
		pending.resolve();
		await save;
		expect(h.edits.saveCueEdit.mock.calls[0]?.[0]).toMatchObject({ sourceId: "a", cueId: "1" });
		expect(h.session.getSnapshot().editor).toMatchObject({ cueId: "2", text: "new editor" });
	});

	it("does not close a same-cue editor reopened during its accepted save", async () => {
		const h = setup();
		h.open();
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		h.session.toggleEditor();
		h.session.toggleEditor();
		pending.resolve();
		await save;
		expect(h.session.getSnapshot().editor).toMatchObject({ cueId: "1", busy: false });
	});

	it("finishes the original source editor after switching away during successful save", async () => {
		const h = setup();
		h.open();
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		h.switchSource("b");
		h.open("2");
		h.update("1", "a");
		pending.resolve();
		await save;
		expect(h.session.getSnapshot().editor?.cueId).toBe("2");
		h.switchSource("a");
		expect(h.session.getSnapshot().editor).toBeNull();
		h.session.toggleEditor();
		expect(h.session.getSnapshot().editor).toMatchObject({ text: "updated", conflict: false });
	});

	it("cleans a vanished reloaded target after switching away", async () => {
		const h = setup();
		h.open();
		h.targets.delete("a:1");
		h.notify();
		const pending = deferred();
		h.edits.reloadSource.mockReturnValueOnce(pending.promise);
		h.session.requestReload();
		const reload = h.session.confirmReload();
		h.switchSource("b");
		pending.resolve();
		await reload;
		h.switchSource("a");
		expect(h.session.getSnapshot().editor).toBeNull();
	});

	it("keeps a reopened vanished target consistently cached after an old reload completes", async () => {
		const h = setup();
		h.open();
		h.update();
		const pending = deferred();
		h.edits.reloadSource.mockReturnValueOnce(pending.promise);
		h.session.requestReload();
		const reload = h.session.confirmReload();
		h.session.toggleEditor();
		h.session.toggleEditor();
		h.targets.delete("a:1");
		h.notify();
		pending.resolve();
		await reload;
		expect(h.session.getSnapshot().editor).toMatchObject({
			cueId: "1",
			conflict: true,
			busy: false,
		});
		h.switchSource("b");
		h.switchSource("a");
		expect(h.session.getSnapshot().editor).toMatchObject({ cueId: "1", conflict: true });
		h.session.requestReload();
		await h.session.confirmReload();
		expect(h.session.getSnapshot().editor).toBeNull();
	});

	it("reports a detached save failure after view disposal", async () => {
		const h = setup();
		h.open();
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		h.session.dispose();
		const error = new Error("failed later");
		pending.reject(error);
		await save;
		expect(h.reportDetachedFailure).toHaveBeenCalledWith(error);
	});

	it("treats backend conflicts as recoverable only through an explicit confirmed reload", async () => {
		const h = setup();
		h.open();
		h.session.setField("text", "keep until confirmed");
		h.edits.saveCueEdit.mockRejectedValueOnce(new ShadowSubtitleEditConflict());
		await h.session.submit();
		expect(h.session.getSnapshot().editor?.conflict).toBe(true);
		await h.session.confirmReload();
		expect(h.edits.reloadSource).not.toHaveBeenCalled();
		h.session.requestReload();
		h.session.cancelReload();
		expect(h.session.getSnapshot().editor?.text).toBe("keep until confirmed");
		h.update();
		h.session.requestReload();
		await h.session.confirmReload();
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "updated",
			conflict: false,
			confirmingReload: false,
		});
	});

	it("allows explicit reload after ordinary persistence failures", async () => {
		const h = setup();
		h.open();
		h.edits.saveCueEdit.mockRejectedValueOnce(new Error("external file conflict"));
		await h.session.submit();
		h.session.requestReload();
		expect(h.session.getSnapshot().editor?.confirmingReload).toBe(true);
		await h.session.confirmReload();
		expect(h.edits.reloadSource).toHaveBeenCalledWith("a");
	});

	it("restores a saved draft when choosing its cue without another editor click", () => {
		const h = setup();
		h.open();
		h.session.setField("text", "mine");
		h.session.choose("2", false);
		expect(h.session.getSnapshot().editor).toBeNull();
		h.session.choose("1", false);
		expect(h.session.getSnapshot().editor?.text).toBe("mine");
		h.session.choose("2", true);
		expect(h.session.getSnapshot().editor).toBeNull();
	});

	it("never rebases a reopened draft onto a later external edit after save", async () => {
		const h = setup();
		h.open();
		h.session.setField("text", "accepted");
		const pending = deferred();
		h.edits.saveCueEdit.mockReturnValueOnce(pending.promise);
		const save = h.session.submit();
		h.session.toggleEditor();
		h.session.toggleEditor();
		h.update();
		pending.resolve();
		await save;
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "accepted",
			conflict: true,
			canSave: false,
		});
	});

	it("rejects stale confirmation callbacks after another source has its own confirmation", async () => {
		const h = setup();
		h.open();
		h.update();
		h.session.requestReload();
		const a = h.session.getSnapshot().editor;
		h.switchSource("b");
		h.open();
		h.update();
		h.session.requestReload();
		const b = h.session.getSnapshot().editor;
		await h.session.confirmReload(a);
		h.session.cancelReload(a);
		expect(h.edits.reloadSource).not.toHaveBeenCalled();
		expect(h.session.getSnapshot().editor).toBe(b);
		expect(b?.confirmingReload).toBe(true);
		await h.session.confirmReload(b);
		expect(h.edits.reloadSource).toHaveBeenCalledWith("b");
	});

	it("rejects all editor actions captured before the same cue editor was reopened", async () => {
		const h = setup();
		h.open();
		const first = h.session.getSnapshot().editor;
		h.session.toggleEditor();
		h.session.toggleEditor();
		h.session.setField("text", "stale", first);
		await h.session.submit(first);
		expect(h.session.getSnapshot().editor?.text).toBe("a1");
		expect(h.edits.saveCueEdit).not.toHaveBeenCalled();
		h.update();
		const conflict = h.session.getSnapshot().editor;
		h.session.toggleEditor();
		h.session.toggleEditor();
		h.session.requestReload(conflict);
		expect(h.session.getSnapshot().editor?.confirmingReload).toBe(false);
		h.session.requestReload();
		const confirmation = h.session.getSnapshot().editor;
		h.session.toggleEditor();
		h.session.toggleEditor();
		await h.session.confirmReload(confirmation);
		h.session.cancelReload(confirmation);
		expect(h.edits.reloadSource).not.toHaveBeenCalled();
		expect(h.session.getSnapshot().editor?.confirmingReload).toBe(true);
	});

	it("retains a disappeared cue draft until confirmed reload closes it", async () => {
		const h = setup();
		h.open();
		h.session.setField("text", "vanished draft");
		h.targets.delete("a:1");
		h.notify();
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "vanished draft",
			conflict: true,
		});
		h.session.requestReload();
		await h.session.confirmReload();
		expect(h.session.getSnapshot().editor).toBeNull();
	});

	it("publishes deeply immutable snapshots only when observable state changes", () => {
		const h = setup();
		h.open();
		const snapshot = h.session.getSnapshot();
		const listener = vi.fn();
		h.session.subscribe(listener);
		h.notify();
		h.notify();
		expect(h.session.getSnapshot()).toBe(snapshot);
		expect(listener).not.toHaveBeenCalled();
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.editor)).toBe(true);
		expect(Object.isFrozen(snapshot.selectedCueIds)).toBe(true);
		h.session.setField("text", "changed");
		expect(snapshot.editor?.text).toBe("a1");
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
