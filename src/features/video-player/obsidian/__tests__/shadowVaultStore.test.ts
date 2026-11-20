import { describe, expect, it, vi } from "vite-plus/test";
import { emptyShadowDocument } from "../../domain/shadowSubtitles";
import type { ShadowPracticeRecord, ShadowingTake } from "../../domain/types";
import {
	ObsidianShadowVaultStore,
	type ShadowVaultAdapter,
	type ShadowVaultApp,
} from "../shadowVaultStore";

const directory = "Study Studio/影子跟读/video";
const subtitlePath = `${directory}/subtitles.json`;
const indexPath = `${directory}/practice-records.json`;

function fixture(preferredRoot?: string | (() => string)) {
	const files = new Map<string, string>();
	const binaries = new Map<string, ArrayBuffer>();
	const directories = new Set<string>();
	const local = new Map<string, unknown>();
	const baseWrite = async (path: string, text: string) => {
		files.set(path, text);
	};
	const baseList = async (path: string) => ({
		files: [...files.keys()].filter(
			(file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/"),
		),
		folders: [...directories].filter(
			(dir) => dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes("/"),
		),
	});
	const write = vi.fn(baseWrite);
	const list = vi.fn(baseList);
	const writeBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		binaries.set(path, data);
	});
	const readBinary = vi.fn(async (path: string) => binaries.get(path)!);
	const remove = vi.fn(async (path: string) => {
		binaries.delete(path);
		files.delete(path);
	});
	const adapter: ShadowVaultAdapter = {
		exists: async (path: string) =>
			files.has(path) || binaries.has(path) || directories.has(path),
		read: async (path: string) => files.get(path)!,
		write,
		mkdir: async (path: string) => {
			directories.add(path);
		},
		list,
		writeBinary,
		readBinary,
		remove,
	};
	const app: ShadowVaultApp = {
		loadLocalStorage: (key: string) => local.get(key) ?? null,
		saveLocalStorage: (key: string, value: unknown) => {
			local.set(key, value);
		},
		vault: { adapter },
	};
	return {
		app,
		baseWrite,
		baseList,
		write,
		list,
		writeBinary,
		readBinary,
		remove,
		files,
		binaries,
		local,
		store: new ObsidianShadowVaultStore(app, preferredRoot),
	};
}

function take(id = "take-1", sourceId = "video"): ShadowingTake {
	return {
		id,
		range: { sourceId, start: 1, end: 3, text: "Hello" },
		mode: "shadow",
		playbackRate: 0.75,
		createdAt: 123,
		mimeType: "audio/webm",
		blob: new Blob(["recorded audio"], { type: "audio/webm" }),
	};
}

function indexedRecord(audioPath: string): ShadowPracticeRecord {
	return {
		id: "take-1",
		sourceId: "video",
		kind: "recording",
		start: 1,
		end: 3,
		text: "Hello",
		createdAt: 123,
		audioPath,
	};
}

describe("ObsidianShadowVaultStore", () => {
	describe("subtitle documents & checkpoints", () => {
		it("writes revision history and preserves both sides of external conflicts", async () => {
			const { files, store } = fixture();
			const document = emptyShadowDocument("video");
			await store.load("video");
			await store.save(document);
			expect([...files.keys()].some((path) => path.includes("revision-0-"))).toBe(true);
			files.set(subtitlePath, '{"external":true}');
			document.revision++;
			await expect(store.save(document)).rejects.toThrow("外部修改");
			expect(files.get(subtitlePath)).toBe('{"external":true}');
			expect([...files.keys()].some((path) => path.includes("conflict-"))).toBe(true);
		});

		it("preserves external changes arriving during backup verification", async () => {
			const { app, baseList, list, files, store } = fixture();
			const document = emptyShadowDocument("video");
			await store.save(document);
			const reopened = new ObsidianShadowVaultStore(app);
			await reopened.load("video");
			const external = JSON.stringify({ ...document, revision: 5 });
			list.mockImplementationOnce(async (path) => {
				files.set(subtitlePath, external);
				return baseList(path);
			});
			await expect(reopened.save({ ...document, revision: 1 })).rejects.toThrow("外部修改");
			expect(files.get(subtitlePath)).toBe(external);
			expect([...files.keys()].some((file) => file.includes("/conflict-"))).toBe(true);
		});

		it("rebuilds a missing or corrupt active index from immutable versions", async () => {
			const { files, store } = fixture();
			await store.load("video");
			const document = emptyShadowDocument("video");
			await store.save(document);
			document.revision = 1;
			await store.save(document);
			files.set(subtitlePath, "bad json");
			expect((await store.load("video"))!.revision).toBe(1);
			files.delete(subtitlePath);
			expect((await store.load("video"))!.revision).toBe(1);
		});

		it("recovers the last committed revision after a failed active index write", async () => {
			const { app, baseWrite, write, files, store } = fixture();
			await store.save(emptyShadowDocument("video"));
			write.mockImplementation(async (destination, text) => {
				if (destination === subtitlePath) {
					files.set(subtitlePath, "incomplete document");
					throw new Error("disk full");
				}
				await baseWrite(destination, text);
			});

			await expect(
				store.save({ ...emptyShadowDocument("video"), revision: 1 }),
			).rejects.toThrow("disk full");
			const reopened = new ObsidianShadowVaultStore(app);
			expect(await reopened.load("video")).toMatchObject({ revision: 0 });
		});

		it("keeps the active document and rejects a subsequent overwrite until history is protected", async () => {
			const { app, baseWrite, write, store } = fixture();
			write.mockImplementation(async (path, text) => {
				if (path.includes("/revision-") || path.endsWith("/recovery.json")) {
					throw new Error("history storage unavailable");
				}
				await baseWrite(path, text);
			});
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			try {
				await store.save(emptyShadowDocument("video"));
				await expect(
					store.save({ ...emptyShadowDocument("video"), revision: 1 }),
				).rejects.toThrow("history storage unavailable");
				const reopened = new ObsidianShadowVaultStore(app);
				expect(await reopened.load("video")).toMatchObject({ revision: 0 });
				expect(warn).toHaveBeenCalledTimes(1);
			} finally {
				warn.mockRestore();
			}
		});

		it.each([false, true])(
			"protects a committed revision after its history write failed (reopened: %s)",
			async (reopen) => {
				const { app, baseWrite, write, files, store } = fixture();
				const document = emptyShadowDocument("video");
				const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
				try {
					write.mockImplementation(async (destination, text) => {
						if (destination.includes("/revision-"))
							throw new Error("history unavailable");
						await baseWrite(destination, text);
					});
					await store.save(document);
					const committedText = files.get(subtitlePath);
					const writer = reopen ? new ObsidianShadowVaultStore(app) : store;
					if (reopen) await writer.load("video");
					write.mockImplementation(async (destination, text) => {
						if (destination === subtitlePath) {
							files.set(subtitlePath, "incomplete document");
							throw new Error("active write failed");
						}
						await baseWrite(destination, text);
					});

					await expect(writer.save({ ...document, revision: 1 })).rejects.toThrow(
						"active write failed",
					);
					const recovered = await new ObsidianShadowVaultStore(app).load("video");
					expect(recovered).toEqual(document);
					expect([...files.values()]).toContain(committedText);
				} finally {
					warn.mockRestore();
				}
			},
		);

		it("prefers the last active document over a different history file at the same revision", async () => {
			const { app, baseWrite, write, files, store } = fixture();
			const active = { ...emptyShadowDocument("video"), revision: 1 };
			await store.save(active);
			const revisionPath = [...files.keys()].find((file) => file.includes("/revision-1-"))!;
			files.set(revisionPath, JSON.stringify({ ...active, candidate: [] }));
			const writer = new ObsidianShadowVaultStore(app);
			await writer.load("video");
			write.mockImplementation(async (path, text) => {
				if (path === subtitlePath) {
					files.set(path, "incomplete document");
					throw new Error("active write failed");
				}
				await baseWrite(path, text);
			});

			await expect(writer.save({ ...active, revision: 2 })).rejects.toThrow(
				"active write failed",
			);
			expect(await new ObsidianShadowVaultStore(app).load("video")).toEqual(active);
		});

		it("checkpoints progress without writing a full history copy for every translated cue", async () => {
			const { files, store } = fixture();
			await store.load("video");
			const document = emptyShadowDocument("video");
			for (let revision = 0; revision <= 25; revision++) {
				document.revision = revision;
				await store.save(document);
			}
			const versions = [...files.keys()].filter((path) => path.includes("/revision-"));
			expect(versions).toHaveLength(4);
			expect(files.get(subtitlePath)).toContain('"revision": 25');
		});
	});

	describe("practice records & takes", () => {
		it("saves an immutable recording with its range and reads its bytes", async () => {
			const { store, writeBinary, binaries } = fixture();
			const recording = take();
			const record = await store.saveTake(recording);
			expect(record).toMatchObject({
				id: recording.id,
				start: 1,
				end: 3,
				playbackRate: 0.75,
				text: "Hello",
			});
			expect(record.audioPath).toBe(`${directory}/take-take-1.webm`);
			expect(await store.list("video")).toEqual([record]);
			expect(await store.readTake(record)).toEqual(await recording.blob.arrayBuffer());
			await store.saveTake({ ...recording, blob: new Blob(["replacement"]) });
			expect(writeBinary).toHaveBeenCalledTimes(1);
			expect(binaries.size).toBe(1);
			expect(await store.list("video")).toHaveLength(1);
		});

		it("serializes concurrent difficult marks and removes only the selected record", async () => {
			const { store, remove } = fixture();
			const [first, second] = await Promise.all([
				store.markDifficult("video", 1, 3, "first"),
				store.markDifficult("video", 4, 6, "second"),
			]);
			expect(await store.list("video")).toEqual([first, second]);
			await store.remove("video", first.id);
			expect(await store.list("video")).toEqual([second]);
			expect(remove).not.toHaveBeenCalled();
		});

		it("deletes the indexed recording file when its record is removed", async () => {
			const { store, binaries, remove } = fixture();
			const record = await store.saveTake(take());
			await store.remove("video", record.id);
			expect(await store.list("video")).toEqual([]);
			expect(binaries.size).toBe(0);
			expect(remove).toHaveBeenCalledExactlyOnceWith(record.audioPath);
		});

		it("preserves external index edits and a successfully written take on conflict", async () => {
			const { store, files, binaries } = fixture();
			await store.markDifficult("video", 1, 2, "initial");
			files.set(indexPath, "[]");
			await expect(store.saveTake(take())).rejects.toThrow("外部修改");
			expect(files.get(indexPath)).toBe("[]");
			expect(binaries.has(`${directory}/take-take-1.webm`)).toBe(true);
			expect(await store.reload("video")).toEqual([]);
			await store.saveTake(take());
			expect(await store.list("video")).toHaveLength(1);
		});

		it("requires reload after an external index deletion", async () => {
			const { store, files } = fixture();
			await store.markDifficult("video", 1, 2, "initial");
			files.delete(indexPath);
			await expect(store.markDifficult("video", 3, 4, "new")).rejects.toThrow("外部删除");
			expect(files.has(indexPath)).toBe(false);
			await store.reload("video");
			await store.markDifficult("video", 3, 4, "new");
			expect(await store.list("video")).toHaveLength(1);
		});

		it.each([
			"Private/note.md",
			`${directory}/../take-take-1.webm`,
			"Study Studio/影子跟读/other-video/take-take-1.webm",
			`${directory}/take-unrelated.webm`,
		])("rejects an index pointing outside the expected take: %s", async (audioPath) => {
			const { store, files, readBinary, remove } = fixture();
			const record = indexedRecord(audioPath);
			files.set(indexPath, JSON.stringify([record]));
			files.set("Private/note.md", "keep me");
			await expect(store.list("video")).rejects.toThrow("格式无效");
			await expect(store.remove("video", record.id)).rejects.toThrow("格式无效");
			await expect(store.readTake(record)).rejects.toThrow("有效的录音文件");
			expect(remove).not.toHaveBeenCalled();
			expect(readBinary).not.toHaveBeenCalled();
			expect(files.get("Private/note.md")).toBe("keep me");
		});
	});

	describe("folder pinning and validation", () => {
		it("pins each source to its initial folder across subtitles, takes, and default folder changes", async () => {
			let preferred = "Study Studio/Initial";
			const { app, files, store } = fixture(() => preferred);

			await store.load("video.one");
			await store.save(emptyShadowDocument("video.one"));
			const savedTake = await store.saveTake(take("take-1", "video.one"));
			expect(savedTake.audioPath).toBe("Study Studio/Initial/video%2Eone/take-take-1.webm");
			expect(files.has("Study Studio/Initial/video%2Eone/subtitles.json")).toBe(true);

			preferred = "Study Studio/Changed";
			const reopened = new ObsidianShadowVaultStore(app, () => preferred);
			expect(await reopened.load("video.one")).toMatchObject({ sourceId: "video.one" });
			expect(await reopened.list("video.one")).toHaveLength(1);

			await reopened.load("video-two");
			await reopened.save(emptyShadowDocument("video-two"));
			expect(files.has("Study Studio/Changed/video-two/subtitles.json")).toBe(true);
		});

		it("rejects invalid preferred and persisted vault folders", async () => {
			const invalidPreferred = fixture("../outside");
			await expect(invalidPreferred.store.load("video")).rejects.toThrow(
				"练习资料目录必须位于资料库内。",
			);

			const { app } = fixture();
			app.saveLocalStorage("study-studio.shadowing.source-folders.v1", {
				video: "../corrupted",
			});
			const corruptedStore = new ObsidianShadowVaultStore(app, "Study Studio/Safe");
			await expect(corruptedStore.list("video")).rejects.toThrow(
				"保存的练习目录无效，请检查本机设置。",
			);
		});
	});
});
