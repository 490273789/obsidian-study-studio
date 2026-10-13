import { describe, expect, it, vi } from "vite-plus/test";
import { WorkbenchStore, type StorageBackend } from "../workbenchStore";
import { DEFAULT_SETTINGS } from "../../host/settingsSlices";

function createMockBackend(initialData: unknown = null): StorageBackend & {
	data: unknown;
	loadCalls: number;
	saveCalls: number;
	failNextSave: boolean;
} {
	return {
		data: initialData,
		loadCalls: 0,
		saveCalls: 0,
		failNextSave: false,
		async loadData() {
			this.loadCalls++;
			return this.data;
		},
		async saveData(nextData: unknown) {
			this.saveCalls++;
			if (this.failNextSave) {
				this.failNextSave = false;
				throw new Error("disk unavailable");
			}
			this.data = JSON.parse(JSON.stringify(nextData));
		},
	};
}

describe("WorkbenchStore", () => {
	it("initializes with default settings and empty document", () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);

		expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
		expect(store.getRevision()).toBe(0);
		expect(store.getPartition("learning")).toBeUndefined();
	});

	it("loads settings from backend and normalizes them", async () => {
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: { language: "zh-CN", dailyNewCards: 25 },
			learning: { cards: { c1: { fsrsCard: {} } } },
		});
		const store = new WorkbenchStore(backend);

		const settings = await store.loadSettings();
		expect(settings.language).toBe("zh");
		expect(settings.dailyNewCards).toBe(25);
		expect(backend.loadCalls).toBe(1);

		// Partition is preserved in memory
		expect(store.getPartition("learning")).toEqual({ cards: { c1: { fsrsCard: {} } } });
	});

	it("saves settings and publishes a revision update", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const listener = vi.fn();
		store.subscribe(listener);

		await store.saveSettings({ ...DEFAULT_SETTINGS, language: "en" });

		expect(store.getSettings().language).toBe("en");
		expect(store.getRevision()).toBe(1);
		expect(listener).toHaveBeenCalledTimes(1);
		expect((backend.data as any).settings.language).toBe("en");
		expect((backend.data as any).schemaVersion).toBe(2);
	});

	it("saves and reads partitions independently of settings", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const listener = vi.fn();
		store.subscribe(listener);

		await store.savePartition("learning", { cards: { "card-1": { stability: 2 } } });

		expect(store.getPartition("learning")).toEqual({ cards: { "card-1": { stability: 2 } } });
		expect(store.getRevision()).toBe(1);
		expect(listener).toHaveBeenCalledTimes(1);
		expect((backend.data as any).learning).toEqual({ cards: { "card-1": { stability: 2 } } });
	});

	it("sequences concurrent writes through the atomic write tail", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const order: string[] = [];

		const p1 = store.savePartition("part1", "val1").then(() => order.push("p1"));
		const p2 = store
			.saveSettings({ ...DEFAULT_SETTINGS, language: "en" })
			.then(() => order.push("p2"));
		const p3 = store.savePartition("part2", "val2").then(() => order.push("p3"));

		await Promise.all([p1, p2, p3]);

		expect(order).toEqual(["p1", "p2", "p3"]);
		expect(store.getRevision()).toBe(3);
		expect(backend.saveCalls).toBe(1);
		expect((backend.data as any).part1).toBe("val1");
		expect((backend.data as any).part2).toBe("val2");
		expect((backend.data as any).settings.language).toBe("en");
	});

	it("reloads externally synchronized data and publishes revision", async () => {
		const backend = createMockBackend({
			schemaVersion: 2,
			settings: { language: "zh-CN" },
		});
		const store = new WorkbenchStore(backend);
		await store.loadSettings();

		const listener = vi.fn();
		store.subscribe(listener);

		// External sync updates backend data
		backend.data = {
			schemaVersion: 2,
			settings: { language: "en" },
			learning: { cards: { synced: true } },
		};

		await store.reloadExternalSettings();

		expect(store.getSettings().language).toBe("en");
		expect(store.getPartition("learning")).toEqual({ cards: { synced: true } });
		expect(store.getRevision()).toBe(1);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("mutates document atomically with mutateDocument", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);

		await store.mutateDocument((doc) => {
			doc.cache = { deckIndexVersion: 1 };
			(doc as any).customField = 42;
		});

		expect(store.getPartition("cache")).toEqual({ deckIndexVersion: 1 });
		expect(store.getPartition("customField")).toBe(42);
		expect((backend.data as any).customField).toBe(42);
	});

	it("rejects stale versioned writes without changing the document", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		await store.savePartition("learning", { cards: {} });

		await expect(
			store.savePartition("learning", { cards: { newer: true } }, { expectedRevision: 0 }),
		).rejects.toMatchObject({ name: "WorkbenchStoreConflictError" });

		expect(store.getPartition("learning")).toEqual({ cards: {} });
		expect(store.getRevision()).toBe(1);
	});

	it("publishes the write source with its committed revision", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const source = {};
		const listener = vi.fn();
		store.subscribe(listener);

		await store.savePartition("learning", { cards: {} }, { source });

		expect(listener).toHaveBeenCalledWith({
			kind: "partition",
			partitionKey: "learning",
			revision: 1,
			source,
		});
	});

	it("keeps memory and revisions unchanged when the durable write fails", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const listener = vi.fn();
		store.subscribe(listener);
		backend.failNextSave = true;

		await expect(store.savePartition("learning", { cards: { failed: true } })).rejects.toThrow(
			"disk unavailable",
		);

		expect(store.getPartition("learning")).toBeUndefined();
		expect(store.getRevision()).toBe(0);
		expect(listener).not.toHaveBeenCalled();
	});
	it("keeps a merged batch invisible until its durable write succeeds", async () => {
		const backend = createMockBackend();
		let release!: () => void;
		const saved = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = backend.saveData.bind(backend);
		const saveData = vi.fn(async (document: unknown) => {
			await saved;
			await save(document);
		});
		backend.saveData = saveData;
		const store = new WorkbenchStore(backend);
		const source = {};
		const listener = vi.fn();
		store.subscribe(listener);
		const first = store.savePartition("learning", { cards: {} }, { source });
		const second = store.saveSettings({ ...DEFAULT_SETTINGS, language: "en" });
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		expect(store.getPartition("learning")).toBeUndefined();
		expect(store.getSettings().language).toBe(DEFAULT_SETTINGS.language);
		expect(store.getRevision()).toBe(0);
		expect(listener).not.toHaveBeenCalled();
		release();
		await Promise.all([first, second]);
		expect(listener.mock.calls.map(([change]) => change)).toEqual([
			{ kind: "partition", partitionKey: "learning", source, revision: 1 },
			{ kind: "settings", source: undefined, revision: 2 },
		]);
	});

	it("rolls back every member of a failed batch and allows a later retry", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		backend.failNextSave = true;
		const outcomes = await Promise.allSettled([
			store.savePartition("learning", { cards: {} }),
			store.saveSettings({ ...DEFAULT_SETTINGS, language: "en" }),
		]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
		expect(backend.saveCalls).toBe(1);
		expect(store.getPartition("learning")).toBeUndefined();
		expect(store.getSettings().language).toBe(DEFAULT_SETTINGS.language);
		expect(store.getRevision()).toBe(0);
		await store.savePartition("learning", { cards: { retry: true } });
		expect(store.getRevision()).toBe(1);
	});

	it("keeps overlapping keys and revision-checked writes as separate durable boundaries", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const first = store.savePartition("learning", 1);
		const second = store.savePartition("learning", 2);
		const guarded = store.savePartition("other", 3, { expectedRevision: 2 });
		const stale = store.savePartition("stale", 4, { expectedRevision: 2 });
		const outcomes = await Promise.allSettled([first, second, guarded, stale]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			"fulfilled",
			"fulfilled",
			"fulfilled",
			"rejected",
		]);
		expect(store.getPartition("learning")).toBe(2);
		expect(store.getPartition("other")).toBe(3);
		expect(store.getPartition("stale")).toBeUndefined();
		expect(store.getRevision()).toBe(3);
		expect(backend.saveCalls).toBe(3);
	});

	it("flushes preceding writes before full-document mutations and external reloads", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const first = store.savePartition("count", 1);
		const mutation = store.mutateDocument((document) => {
			document.count = Number(document.count) + 1;
		});
		const reload = store.reloadExternalSettings();
		await Promise.all([first, mutation, reload]);
		expect(store.getPartition("count")).toBe(2);
		expect(store.getRevision()).toBe(3);
		expect(backend.saveCalls).toBe(2);
		expect(backend.loadCalls).toBe(1);
	});

	it("skips unchanged settings and unchanged primitive partitions while preserving revision echoes", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const partition = 1;
		await store.savePartition("learning", partition);
		await Promise.all([
			store.savePartition("learning", partition),
			store.saveSettings(store.getSettings()),
		]);
		expect(backend.saveCalls).toBe(1);
		expect(store.getRevision()).toBe(3);
	});
	it("merges a guarded learning write with a following unguarded settings write", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		await Promise.all([
			store.savePartition("learning", { cards: {} }, { expectedRevision: 0 }),
			store.saveSettings({ ...DEFAULT_SETTINGS, language: "en" }),
		]);
		expect(backend.saveCalls).toBe(1);
		expect(store.getRevision()).toBe(2);
	});

	it("still persists a mutable partition when the caller saves the same reference again", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const partition = { count: 1 };
		await store.savePartition("learning", partition);
		partition.count = 2;
		await store.savePartition("learning", partition);
		expect(backend.saveCalls).toBe(2);
		expect((backend.data as any).learning.count).toBe(2);
	});

	it("does not add requests to an in-flight batch and serializes reentrant writes", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		let release!: () => void;
		const pendingDisk = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = backend.saveData.bind(backend);
		const saveData = vi.fn(async (document: unknown) => {
			await pendingDisk;
			await save(document);
		});
		backend.saveData = saveData;
		const events: number[] = [];
		let reentrant!: Promise<void>;
		store.subscribe((change) => {
			events.push(change.revision);
			if (change.revision === 1) {
				reentrant = store.savePartition("reentrant", true, { expectedRevision: 1 });
			}
		});
		const first = store.savePartition("first", true);
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		const second = store.savePartition("second", true);
		release();
		await Promise.all([first, second]);
		await expect(reentrant).rejects.toMatchObject({
			name: "WorkbenchStoreConflictError",
			expectedRevision: 1,
			actualRevision: 2,
		});
		expect(backend.saveCalls).toBe(2);
		expect(events).toEqual([1, 2]);
		expect(store.getPartition("reentrant")).toBeUndefined();
	});

	it("does not discard a following independent write when the first guard is stale", async () => {
		const backend = createMockBackend();
		const store = new WorkbenchStore(backend);
		const outcomes = await Promise.allSettled([
			store.savePartition("learning", {}, { expectedRevision: 1 }),
			store.saveSettings({ ...DEFAULT_SETTINGS, language: "en" }),
		]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "fulfilled"]);
		expect(store.getPartition("learning")).toBeUndefined();
		expect(store.getSettings().language).toBe("en");
		expect(store.getRevision()).toBe(1);
		expect(backend.saveCalls).toBe(1);
	});
});
