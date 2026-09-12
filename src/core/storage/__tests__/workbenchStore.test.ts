import { describe, expect, it, vi } from "vitest";
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
});
