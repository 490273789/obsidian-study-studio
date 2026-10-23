import type { App } from "obsidian";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ShadowingTake } from "../../domain/shadowingSession";
import { ShadowPracticeRecords, type ShadowPracticeRecord } from "../shadowPracticeRecords";

const directory = "Study Studio/影子跟读/video";
const indexPath = `${directory}/practice-records.json`;

function fixture() {
	const files = new Map<string, string>();
	const binaries = new Map<string, ArrayBuffer>();
	const directories = new Set<string>();
	const adapter = {
		exists: async (path: string) =>
			files.has(path) || binaries.has(path) || directories.has(path),
		read: async (path: string) => files.get(path)!,
		write: async (path: string, text: string) => {
			files.set(path, text);
		},
		mkdir: async (path: string) => {
			directories.add(path);
		},
		writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
			binaries.set(path, data);
		}),
		readBinary: vi.fn(async (path: string) => binaries.get(path)!),
		remove: vi.fn(async (path: string) => {
			binaries.delete(path);
			files.delete(path);
		}),
	};
	const store = new ShadowPracticeRecords(adapter as unknown as App["vault"]["adapter"]);
	return { files, binaries, adapter, store };
}

function take(id = "take-1"): ShadowingTake {
	return {
		id,
		range: { sourceId: "video", start: 1, end: 3, text: "Hello" },
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

describe("shadow practice vault records", () => {
	it("saves an immutable recording with its range and reads its bytes", async () => {
		const { store, adapter, binaries } = fixture();
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
		expect(adapter.writeBinary).toHaveBeenCalledTimes(1);
		expect(binaries.size).toBe(1);
		expect(await store.list("video")).toHaveLength(1);
	});

	it("serializes concurrent difficult marks and removes only the selected record", async () => {
		const { store, adapter } = fixture();
		const [first, second] = await Promise.all([
			store.markDifficult("video", 1, 3, "first"),
			store.markDifficult("video", 4, 6, "second"),
		]);
		expect(await store.list("video")).toEqual([first, second]);
		await store.remove("video", first.id);
		expect(await store.list("video")).toEqual([second]);
		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("deletes the indexed recording file when its record is removed", async () => {
		const { store, binaries, adapter } = fixture();
		const record = await store.saveTake(take());
		await store.remove("video", record.id);
		expect(await store.list("video")).toEqual([]);
		expect(binaries.size).toBe(0);
		expect(adapter.remove).toHaveBeenCalledExactlyOnceWith(record.audioPath);
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
		const { store, files, adapter } = fixture();
		const record = indexedRecord(audioPath);
		files.set(indexPath, JSON.stringify([record]));
		files.set("Private/note.md", "keep me");
		await expect(store.list("video")).rejects.toThrow("格式无效");
		await expect(store.remove("video", record.id)).rejects.toThrow("格式无效");
		await expect(store.readTake(record)).rejects.toThrow("有效的录音文件");
		expect(adapter.remove).not.toHaveBeenCalled();
		expect(adapter.readBinary).not.toHaveBeenCalled();
		expect(files.get("Private/note.md")).toBe("keep me");
	});
});
