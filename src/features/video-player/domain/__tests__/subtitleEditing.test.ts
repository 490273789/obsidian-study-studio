import { describe, expect, it, vi } from "vite-plus/test";
import {
	emptyShadowDocument,
	makeShadowCue,
	type ShadowSubtitleDocument,
} from "../shadowSubtitles";
import {
	ShadowSubtitleEditConflict,
	VideoSubtitleJobs,
	type ShadowAudioChunk,
	type ShadowSubtitleStore,
	type VideoSubtitleJobsPorts,
} from "../shadowSubtitlesJobs";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
	await vi.waitFor(() => expect(predicate()).toBe(true));
}
const source = { id: "video", path: "/video.mp4" };
const config = { sourceSignature: "signature", serviceSignature: "service" };
const imported = "1\n00:00:00,000 --> 00:00:01,000\nOriginal";
function initialDocument() {
	const document = emptyShadowDocument(source.id);
	document.cues = [
		makeShadowCue("import-0", { start: 0, end: 1, text: "Original" }),
		makeShadowCue("import-1", { start: 1, end: 2, text: "Second" }),
	];
	return document;
}
function fixture(
	initial = initialDocument(),
	ports: Partial<Omit<VideoSubtitleJobsPorts, "store">> = {},
) {
	const documents = new Map([[initial.sourceId, structuredClone(initial)]]);
	const writes: ShadowSubtitleDocument[] = [];
	const publications: ShadowSubtitleDocument[][] = [];
	let nextSave: Promise<void> | null = null;
	const store: ShadowSubtitleStore = {
		load: async (id) => structuredClone(documents.get(id) ?? null),
		save: vi.fn(async (document) => {
			const snapshot = structuredClone(document);
			writes.push(snapshot);
			const waiting = nextSave;
			nextSave = null;
			await waiting;
			documents.set(document.sourceId, snapshot);
		}),
		loadCheckpoints: () => [],
		saveCheckpoints: vi.fn(),
	};
	const jobs = new VideoSubtitleJobs({ store, extract: vi.fn(), transcribe: vi.fn(), ...ports });
	jobs.subscribe(() => publications.push(Object.values(jobs.getSnapshot().documents)));
	return {
		jobs,
		store,
		documents,
		writes,
		publications,
		holdNextSave: () => {
			const save = deferred<void>();
			nextSave = save.promise;
			return save;
		},
	};
}

describe("subtitle editing commits", () => {
	it("never publishes a pending or failed edit, including through a later background save", async () => {
		const { jobs, documents, writes, publications, holdNextSave } = fixture(undefined, {
			translate: async (text) => `后台 ${text}`,
		});
		await jobs.restore(source.id);
		const gate = holdNextSave();
		const save = jobs.saveCueEdit(jobs.getCueEditTarget(source.id, "import-0")!, {
			text: "Failed draft",
		});
		const rejected = expect(save).rejects.toThrow("disk unavailable");
		await until(() => writes.length === 1);
		await jobs.restore("other");
		expect(jobs.getCues(source.id)[0]?.text).toBe("Original");
		expect(documents.get(source.id)?.cues[0]?.text).toBe("Original");
		gate.reject(new Error("disk unavailable"));
		await rejected;
		await jobs.translateSubtitles(source, config);
		expect(jobs.getCues(source.id)[0]).toMatchObject({
			text: "Original",
			translation: "后台 Original",
		});
		expect(documents.get(source.id)?.cues[0]?.text).toBe("Original");
		expect(writes.slice(1).every((document) => document.cues[0]?.text === "Original")).toBe(
			true,
		);
		expect(
			publications.every((documents) =>
				documents.every((document) =>
					document.cues.every((cue) => cue.text !== "Failed draft"),
				),
			),
		).toBe(true);
		jobs.dispose();
	});
	it("keeps the detached target valid after a failed write so the same input can be retried", async () => {
		const { jobs, documents, writes, holdNextSave } = fixture();
		await jobs.restore(source.id);
		const target = jobs.getCueEditTarget(source.id, "import-0")!;
		expect(Object.isFrozen(target)).toBe(true);
		const gate = holdNextSave();
		const save = jobs.saveCueEdit(target, { text: "Corrected", translation: "人工译文" });
		const rejected = expect(save).rejects.toThrow("disk unavailable");
		await until(() => writes.length === 1);
		gate.reject(new Error("disk unavailable"));
		await rejected;
		expect(jobs.getCueEditTarget(source.id, target.cueId)).toEqual(target);
		await jobs.saveCueEdit(target, { text: "Corrected", translation: "人工译文" });
		expect(documents.get(source.id)?.cues[0]).toMatchObject({
			text: "Corrected",
			translation: "人工译文",
			textEdited: true,
			translationEdited: true,
		});
		expect(target.text).toBe("Original");
		expect(jobs.getCueEditTarget(source.id, target.cueId)?.version).not.toBe(target.version);
		jobs.dispose();
	});
	it("accepts only the first of two views saving the same cue snapshot", async () => {
		const { jobs, writes, holdNextSave } = fixture();
		await jobs.restore(source.id);
		const first = jobs.getCueEditTarget(source.id, "import-0")!;
		const second = jobs.getCueEditTarget(source.id, "import-0")!;
		const gate = holdNextSave();
		const firstSave = jobs.saveCueEdit(first, { text: "First view" });
		const secondSave = jobs.saveCueEdit(second, { text: "Second view" });
		const conflict = expect(secondSave).rejects.toBeInstanceOf(ShadowSubtitleEditConflict);
		await until(() => writes.length === 1);
		gate.resolve(undefined);
		await firstSave;
		await conflict;
		expect(writes).toHaveLength(1);
		expect(jobs.getCues(source.id)[0]?.text).toBe("First view");
		jobs.dispose();
	});
	it("allows a target to save after another cue changes", async () => {
		const { jobs, documents } = fixture();
		await jobs.restore(source.id);
		const first = jobs.getCueEditTarget(source.id, "import-0")!;
		const second = jobs.getCueEditTarget(source.id, "import-1")!;
		await jobs.saveCueEdit(second, { translation: "第二句修正" });
		expect(jobs.getCueEditTarget(source.id, first.cueId)?.version).toBe(first.version);
		await jobs.saveCueEdit(first, { text: "First corrected" });
		expect(documents.get(source.id)?.cues.map((cue) => [cue.text, cue.translation])).toEqual([
			["First corrected", ""],
			["Second", "第二句修正"],
		]);
		jobs.dispose();
	});
	it.each(["adopt", "restore", "reload"] as const)(
		"rejects an old target after %s even when the cue id and content are reused",
		async (replacement) => {
			const initial = initialDocument();
			initial.previous = structuredClone(initial.cues);
			const { jobs, writes } = fixture(initial);
			await jobs.restore(source.id);
			const target = jobs.getCueEditTarget(source.id, "import-0")!;
			if (replacement === "adopt") {
				await jobs.importSubtitles(source.id, imported, "srt");
				await jobs.adoptCandidate(source.id);
			} else if (replacement === "restore") await jobs.restorePrevious(source.id);
			else await jobs.reloadSource(source.id);
			const count = writes.length;
			await expect(jobs.saveCueEdit(target, { text: "Stale" })).rejects.toBeInstanceOf(
				ShadowSubtitleEditConflict,
			);
			expect(writes).toHaveLength(count);
			expect(jobs.getCues(source.id)[0]?.text).toBe("Original");
			jobs.dispose();
		},
	);
	it("rejects a target after background translation changes that cue", async () => {
		const translation = deferred<string>();
		const translate = vi.fn(() => translation.promise);
		const { jobs, documents } = fixture(undefined, { translate });
		await jobs.restore(source.id);
		const target = jobs.getCueEditTarget(source.id, "import-0")!;
		const translating = jobs.translateSubtitles(source, config);
		await until(() => translate.mock.calls.length === 1);
		translation.resolve("后台译文");
		await translating;
		await expect(jobs.saveCueEdit(target, { text: "Stale" })).rejects.toBeInstanceOf(
			ShadowSubtitleEditConflict,
		);
		expect(documents.get(source.id)?.cues[0]).toMatchObject({
			text: "Original",
			translation: "后台译文",
		});
		jobs.dispose();
	});
	it("lets a successful correction win over a translation already in flight", async () => {
		const translation = deferred<string>();
		let returned = false;
		const initial = initialDocument();
		initial.cues = [initial.cues[0]!];
		const translate = vi.fn(async () => {
			const result = await translation.promise;
			returned = true;
			return result;
		});
		const { jobs, documents, writes, holdNextSave } = fixture(initial, { translate });
		await jobs.restore(source.id);
		const target = jobs.getCueEditTarget(source.id, "import-0")!;
		const translating = jobs.translateSubtitles(source, config);
		await until(() => translate.mock.calls.length === 1);
		const gate = holdNextSave();
		const saving = jobs.saveCueEdit(target, { text: "Corrected", translation: "人工译文" });
		await until(() => writes.length === 1);
		translation.resolve("过期自动译文");
		await until(() => returned);
		expect(writes).toHaveLength(1);
		expect(jobs.getCues(source.id)[0]?.text).toBe("Original");
		gate.resolve(undefined);
		await saving;
		await translating;
		expect(writes).toHaveLength(1);
		expect(documents.get(source.id)?.cues[0]).toMatchObject({
			text: "Corrected",
			translation: "人工译文",
		});
		jobs.dispose();
	});
	it.each([true, false])(
		"merges another cue's translation after a held edit (save success: %s)",
		async (succeeds) => {
			const translation = deferred<string>();
			let returned = false;
			const initial = initialDocument();
			initial.cues[0]!.translation = "保留人工翻译";
			initial.cues[0]!.translationEdited = true;
			const translate = vi.fn(async () => {
				const result = await translation.promise;
				returned = true;
				return result;
			});
			const { jobs, documents, writes, holdNextSave } = fixture(initial, { translate });
			await jobs.restore(source.id);
			const target = jobs.getCueEditTarget(source.id, "import-0")!;
			const translating = jobs.translateSubtitles(source, config);
			await until(() => translate.mock.calls.length === 1);
			const gate = holdNextSave();
			const saving = jobs.saveCueEdit(target, { text: "Corrected" });
			const result = succeeds ? saving : expect(saving).rejects.toThrow("disk unavailable");
			await until(() => writes.length === 1);
			translation.resolve("第二句后台译文");
			await until(() => returned);
			if (succeeds) gate.resolve(undefined);
			else gate.reject(new Error("disk unavailable"));
			await result;
			await translating;
			expect(
				documents.get(source.id)?.cues.map((cue) => [cue.text, cue.translation]),
			).toEqual([
				[succeeds ? "Corrected" : "Original", "保留人工翻译"],
				["Second", "第二句后台译文"],
			]);
			expect(writes[1]?.cues[0]?.text).toBe(succeeds ? "Corrected" : "Original");
			jobs.dispose();
		},
	);
	it("keeps an accepted save bound to its original source while another source is restored and edited", async () => {
		const { jobs, documents, writes, holdNextSave } = fixture();
		const other = initialDocument();
		other.sourceId = "other";
		other.cues[0]!.text = "Other source";
		documents.set(other.sourceId, other);
		await jobs.restore(source.id);
		const target = jobs.getCueEditTarget(source.id, "import-0")!;
		const gate = holdNextSave();
		const saving = jobs.saveCueEdit(target, { text: "Original source corrected" });
		await until(() => writes.length === 1);
		await jobs.restore(other.sourceId);
		await jobs.saveCueEdit(jobs.getCueEditTarget(other.sourceId, "import-0")!, {
			text: "Other corrected",
		});
		expect(documents.get(source.id)?.cues[0]?.text).toBe("Original");
		gate.resolve(undefined);
		await saving;
		expect(documents.get(source.id)?.cues[0]?.text).toBe("Original source corrected");
		expect(documents.get(other.sourceId)?.cues[0]?.text).toBe("Other corrected");
		jobs.dispose();
	});
	it.each([true, false])(
		"continues transcription without losing or leaking a held edit (save success: %s)",
		async (succeeds) => {
			const secondChunk = deferred<ShadowAudioChunk>();
			let extracted = 0;
			const extract = vi.fn(async () => {
				extracted++;
				return extracted === 1
					? {
							audio: new ArrayBuffer(0),
							duration: 2,
							totalDuration: 4,
							sourceSignature: "signature",
						}
					: secondChunk.promise;
			});
			let transcribed = 0;
			const transcribe = vi.fn(async () => {
				transcribed++;
				return transcribed === 1
					? [{ start: 0, end: 1, text: "Original" }]
					: [{ start: 1, end: 2, text: "Generated later" }];
			});
			const { jobs, documents, writes, holdNextSave } = fixture(
				emptyShadowDocument(source.id),
				{
					extract,
					transcribe,
				},
			);
			await jobs.start(source, config);
			await until(() => extracted === 2 && jobs.getCues(source.id).length === 1);
			const target = jobs.getCueEditTarget(source.id, jobs.getCues(source.id)[0]!.id)!;
			const count = writes.length;
			const gate = holdNextSave();
			const saving = jobs.saveCueEdit(target, { text: "Corrected" });
			const result = succeeds ? saving : expect(saving).rejects.toThrow("disk unavailable");
			await until(() => writes.length === count + 1);
			secondChunk.resolve({
				audio: new ArrayBuffer(0),
				duration: 3,
				totalDuration: 4,
				sourceSignature: "signature",
			});
			await until(() => transcribed === 2);
			expect(writes).toHaveLength(count + 1);
			if (succeeds) gate.resolve(undefined);
			else gate.reject(new Error("disk unavailable"));
			await result;
			await until(() => jobs.getSnapshot().tasks[0]?.status === "complete");
			expect(documents.get(source.id)?.cues.map((cue) => cue.text)).toEqual([
				succeeds ? "Corrected" : "Original",
				"Generated later",
			]);
			jobs.dispose();
		},
	);
	it("resolves a committed save and notifies healthy subscribers when checkpoint and another listener throw", async () => {
		const reportError = vi.fn();
		const { jobs, store, documents } = fixture(undefined, { reportError });
		await jobs.restore(source.id);
		const checkpointError = new Error("checkpoint unavailable");
		const listenerError = new Error("listener failed");
		store.saveCheckpoints = () => {
			throw checkpointError;
		};
		jobs.subscribe(() => {
			throw listenerError;
		});
		const healthy = vi.fn();
		jobs.subscribe(healthy);
		await expect(
			jobs.saveCueEdit(jobs.getCueEditTarget(source.id, "import-0")!, { text: "Committed" }),
		).resolves.toBeUndefined();
		expect(documents.get(source.id)?.cues[0]?.text).toBe("Committed");
		expect(jobs.getCues(source.id)[0]?.text).toBe("Committed");
		expect(healthy).toHaveBeenCalledOnce();
		expect(reportError.mock.calls.map(([error]) => error)).toEqual([
			checkpointError,
			listenerError,
		]);
	});
	it("preserves successful saves and other listeners when error reporting also throws", async () => {
		const reportError = vi.fn(() => {
			throw new Error("report failed");
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { jobs } = fixture(undefined, { reportError });
		await jobs.restore(source.id);
		jobs.subscribe(() => {
			throw new Error("listener failed");
		});
		const healthy = vi.fn();
		jobs.subscribe(healthy);
		try {
			await jobs.saveCueEdit(jobs.getCueEditTarget(source.id, "import-0")!, {
				text: "Committed",
			});
			expect(jobs.getCues(source.id)[0]?.text).toBe("Committed");
			expect(healthy).toHaveBeenCalledOnce();
			expect(reportError).toHaveBeenCalledOnce();
			expect(consoleError).toHaveBeenCalledOnce();
		} finally {
			consoleError.mockRestore();
		}
	});
});
