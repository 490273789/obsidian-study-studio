import { describe, expect, it, vi } from "vite-plus/test";
import {
	emptyShadowDocument,
	makeShadowCue,
	type ShadowSubtitleDocument,
} from "../../domain/shadowSubtitles";
import { VideoSubtitleJobs, type ShadowSubtitleStore } from "../../domain/shadowSubtitlesJobs";
import type { ShadowingWorkspaceState, VideoPlayerSnapshot } from "../../domain/types";
import { SubtitleEditingSession } from "../subtitleEditingSession";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function setup() {
	const documents = new Map<string, ShadowSubtitleDocument>();
	for (const sourceId of ["one", "two"]) {
		const document = emptyShadowDocument(sourceId);
		document.cues = [makeShadowCue("cue", { start: 1, end: 3, text: sourceId })];
		documents.set(sourceId, document);
	}
	const save = vi.fn(async (document: ShadowSubtitleDocument) => {
		documents.set(document.sourceId, structuredClone(document));
	});
	const store: ShadowSubtitleStore = {
		load: async (id) => structuredClone(documents.get(id)!),
		save,
		loadCheckpoints: () => [],
		saveCheckpoints: () => undefined,
	};
	const jobs = new VideoSubtitleJobs({ store, extract: vi.fn(), transcribe: vi.fn() });
	await jobs.restore("one");
	await jobs.restore("two");
	let sourceId = "one";
	const listeners = new Set<() => void>();
	const reportDetachedFailure = vi.fn();
	const session = new SubtitleEditingSession({
		runtime: {
			getSnapshot: () => ({ currentSourceId: sourceId, duration: 10 }) as VideoPlayerSnapshot,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			seekTo: vi.fn(),
		},
		workspace: {
			getSnapshot: () =>
				({ cues: jobs.getCues(sourceId) }) as unknown as ShadowingWorkspaceState,
			subscribe: jobs.subscribe,
			act: vi.fn(async () => undefined),
		},
		edits: jobs,
		reportDetachedFailure,
	});
	return {
		jobs,
		session,
		save,
		documents,
		reportDetachedFailure,
		open() {
			session.choose("cue", false);
			session.toggleEditor();
		},
		switchSource(id: string) {
			sourceId = id;
			for (const listener of listeners) listener();
		},
		dispose() {
			session.dispose();
			jobs.dispose();
		},
	};
}

describe("subtitle editor and document authority", () => {
	it("retains a failed correction locally, then closes only after the real owner commits its retry", async () => {
		const h = await setup();
		h.open();
		h.session.setField("text", "Corrected");
		h.save.mockRejectedValueOnce(new Error("disk unavailable"));
		await h.session.submit();
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "Corrected",
			failure: "disk unavailable",
			canSave: true,
		});
		expect(h.jobs.getCues("one")[0]?.text).toBe("one");
		expect(h.documents.get("one")?.cues[0]?.text).toBe("one");
		await h.session.submit();
		expect(h.jobs.getCues("one")[0]?.text).toBe("Corrected");
		expect(h.session.getSnapshot().editor).toBeNull();
		h.dispose();
	});

	it("finishes the original source's editor without disturbing a draft opened on another source", async () => {
		const h = await setup();
		h.open();
		h.session.setField("text", "Saved on one");
		const pending = deferred();
		h.save.mockImplementationOnce(async (document) => {
			await pending.promise;
			h.documents.set(document.sourceId, structuredClone(document));
		});
		const accepted = h.session.submit();
		await vi.waitFor(() => expect(h.save).toHaveBeenCalledOnce());
		h.switchSource("two");
		h.open();
		h.session.setField("text", "Unsaved on two");
		pending.resolve();
		await accepted;
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "Unsaved on two",
			conflict: false,
		});
		expect(h.jobs.getCues("one")[0]?.text).toBe("Saved on one");
		h.switchSource("one");
		expect(h.session.getSnapshot().editor).toBeNull();
		h.dispose();
	});

	it("rejects a draft invalidated by the real document owner and requires confirmed reload", async () => {
		const h = await setup();
		h.open();
		h.session.setField("text", "Local draft");
		await h.jobs.saveCueEdit(h.jobs.getCueEditTarget("one", "cue")!, {
			translation: "New translation",
		});
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "Local draft",
			conflict: true,
			canSave: false,
		});
		await h.session.submit();
		expect(h.save).toHaveBeenCalledTimes(1);
		h.session.requestReload();
		expect(h.session.getSnapshot().editor?.text).toBe("Local draft");
		await h.session.confirmReload();
		expect(h.session.getSnapshot().editor).toMatchObject({
			text: "one",
			translation: "New translation",
			conflict: false,
		});
		h.dispose();
	});
});
