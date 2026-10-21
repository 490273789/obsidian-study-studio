import { describe, expect, it, vi } from "vite-plus/test";
import { audioFailure } from "../../domain/failures";
import type { AudioPracticeCatalog, AudioPracticeFileCatalog } from "../../domain/types";
import { MaterialEditSession } from "../materialEditSession";

const material = {
	id: "material",
	title: "Original",
	audioPath: "old.mp3",
	subtitlePath: "old.srt",
	originalText: "Original text",
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup() {
	let catalog: AudioPracticeFileCatalog = {
		audioPaths: ["first.mp3", "second.mp3"],
		subtitlePaths: ["first.srt"],
		textPaths: ["note.md"],
	};
	const listeners = new Set<() => void>();
	const catalogPort: AudioPracticeCatalog = {
		list: () => catalog,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const readText = vi.fn(async () => "file text");
	const addMaterial = vi.fn(async () => "new-id");
	const editMaterial = vi.fn(async () => undefined);
	const session = new MaterialEditSession({
		runtime: { addMaterial, editMaterial },
		files: { readText },
		catalog: catalogPort,
	});
	return {
		session,
		readText,
		addMaterial,
		editMaterial,
		refresh(next: Partial<AudioPracticeFileCatalog>) {
			catalog = { ...catalog, ...next };
			for (const listener of listeners) listener();
		},
	};
}

describe("MaterialEditSession", () => {
	it("opens an add dialog with the first candidate and submits the typed fields", async () => {
		const h = setup();
		h.session.openAdd();
		let snapshot = h.session.getSnapshot();
		expect(snapshot).toMatchObject({
			open: true,
			mode: "add",
			expectedMaterial: null,
			fields: { title: "", audioPath: "first.mp3", subtitlePath: null, text: "" },
			canSubmit: true,
		});

		h.session.setField("title", "  New audio  ");
		h.session.setField("subtitlePath", "first.srt");
		h.session.setText("Reference");
		snapshot = h.session.getSnapshot();
		expect(snapshot.fields).toMatchObject({
			title: "  New audio  ",
			audioPath: "first.mp3",
			subtitlePath: "first.srt",
			text: "Reference",
		});

		await h.session.submit();
		expect(h.addMaterial).toHaveBeenCalledExactlyOnceWith({
			title: "New audio",
			audioPath: "first.mp3",
			subtitlePath: "first.srt",
			originalText: "Reference",
		});
		expect(h.session.getSnapshot().open).toBe(false);
	});

	it("captures the edit material and keeps candidates merged with its current values", async () => {
		const h = setup();
		h.session.openEdit(material);
		const snapshot = h.session.getSnapshot();
		expect(snapshot).toMatchObject({
			open: true,
			mode: "edit",
			expectedMaterial: material,
			fields: {
				title: "Original",
				audioPath: "old.mp3",
				subtitlePath: "old.srt",
				text: "Original text",
			},
		});
		expect(snapshot.candidates.audioPaths).toEqual(["old.mp3", "first.mp3", "second.mp3"]);
		expect(snapshot.candidates.subtitlePaths).toEqual(["old.srt", "first.srt"]);

		await h.session.submit();
		expect(h.editMaterial).toHaveBeenCalledExactlyOnceWith(
			"material",
			{
				title: "Original",
				audioPath: "old.mp3",
				subtitlePath: "old.srt",
				originalText: "Original text",
			},
			material,
		);
	});

	it("falls back to the audio file name when the title is empty", async () => {
		const h = setup();
		h.session.openAdd();
		h.session.setField("title", "   ");
		await h.session.submit();
		expect(h.addMaterial).toHaveBeenCalledWith(expect.objectContaining({ title: "first.mp3" }));
	});

	it("reads a text file, keeps a draft typed during the read, and reports failures", async () => {
		const h = setup();
		const pending = deferred<string>();
		h.readText.mockReturnValueOnce(pending.promise);
		h.session.openAdd();
		void h.session.readTextFile("note.md");
		expect(h.session.getSnapshot().readingText).toBe(true);

		h.session.setText("typed draft");
		expect(h.session.getSnapshot().readingText).toBe(false);
		pending.resolve("late file text");
		await pending.promise;
		await Promise.resolve();
		expect(h.session.getSnapshot().fields.text).toBe("typed draft");

		h.readText.mockRejectedValueOnce(audioFailure({ kind: "missing-file" }));
		await h.session.readTextFile("missing.md");
		expect(h.session.getSnapshot().readFailure).toEqual({ kind: "missing-file" });
		expect(h.session.getSnapshot().readingText).toBe(false);
	});

	it("ignores an earlier read when a later file wins", async () => {
		const h = setup();
		const first = deferred<string>();
		const second = deferred<string>();
		h.readText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		h.session.openAdd();
		void h.session.readTextFile("first.md");
		void h.session.readTextFile("second.md");
		second.resolve("second text");
		await second.promise;
		await Promise.resolve();
		first.resolve("first text");
		await first.promise;
		await Promise.resolve();
		expect(h.session.getSnapshot().fields.text).toBe("second text");
	});

	it("keeps the dialog open with a typed failure and allows retrying", async () => {
		const h = setup();
		const failure = deferred<undefined>();
		h.editMaterial.mockReturnValueOnce(failure.promise as Promise<undefined>);
		h.session.openEdit(material);
		h.session.setField("title", "Changed");
		const submitting = h.session.submit();
		expect(h.session.getSnapshot().busy).toBe(true);
		expect(h.session.getSnapshot().canSubmit).toBe(false);
		h.session.cancel();
		expect(h.session.getSnapshot().open).toBe(true);

		failure.reject(audioFailure({ kind: "stale-material" }));
		await submitting;
		const snapshot = h.session.getSnapshot();
		expect(snapshot.open).toBe(true);
		expect(snapshot.busy).toBe(false);
		expect(snapshot.failure).toEqual({ kind: "stale-material" });
		expect(snapshot.fields.title).toBe("Changed");

		h.editMaterial.mockResolvedValueOnce(undefined);
		await h.session.submit();
		expect(h.session.getSnapshot().open).toBe(false);
	});

	it("refreshes candidates from the catalog and keeps the current values", () => {
		const h = setup();
		h.session.openEdit(material);
		h.refresh({ audioPaths: ["third.mp3"], textPaths: ["next.md"] });
		const snapshot = h.session.getSnapshot();
		expect(snapshot.candidates.audioPaths).toEqual(["old.mp3", "third.mp3"]);
		expect(snapshot.candidates.textPaths).toEqual(["next.md"]);
	});

	it("cancels cleanly and refuses submission without an audio path", () => {
		const h = setup();
		h.session.openAdd();
		h.session.setField("audioPath", "");
		expect(h.session.getSnapshot().canSubmit).toBe(false);
		h.session.cancel();
		expect(h.session.getSnapshot().open).toBe(false);
	});

	it("stops updating after dispose", () => {
		const h = setup();
		h.session.openAdd();
		h.session.dispose();
		h.session.setField("title", "ignored");
		expect(h.session.getSnapshot().fields.title).toBe("");
	});
});
