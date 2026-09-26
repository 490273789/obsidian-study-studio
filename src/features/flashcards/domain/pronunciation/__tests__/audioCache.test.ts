import { afterEach, describe, expect, it, vi } from "vitest";
import {
	IndexedDbPronunciationAudioCache,
	MemoryPronunciationAudioCache,
	createPronunciationCacheKey,
} from "../audioCache";
import type { PronunciationRequestDescriptor } from "../types";
import { PRONUNCIATION_CACHE_LIMIT_BYTES } from "../types";

function makeDescriptor(
	overrides: Partial<PronunciationRequestDescriptor> = {},
): PronunciationRequestDescriptor {
	return {
		provider: "azure",
		text: "hello",
		accent: "en-US",
		rate: "normal",
		variant: "china:chinaeast2:en-US-JennyNeural:normal",
		...overrides,
	};
}

interface FakeAudioRecord {
	key: string;
	data: ArrayBuffer;
	mimeType: string;
	size: number;
	lastAccess: number;
}

interface FakeDatabaseState {
	version: number;
	hasAudioStore: boolean;
	indexes: Map<string, string[]>;
	records: Map<string, FakeAudioRecord>;
}

class FakeIndexedDbFactory {
	private readonly databases = new Map<string, FakeDatabaseState>();
	payloadReads = 0;
	metadataReads = 0;

	seedLegacy(name: string, records: FakeAudioRecord[]): void {
		this.databases.set(name, {
			version: 1,
			hasAudioStore: true,
			indexes: new Map(),
			records: new Map(records.map((record) => [record.key, cloneFakeRecord(record)!])),
		});
	}

	open(name: string, version = 1): IDBOpenDBRequest {
		const state = this.databases.get(name) ?? {
			version: 0,
			hasAudioStore: false,
			indexes: new Map<string, string[]>(),
			records: new Map<string, FakeAudioRecord>(),
		};
		this.databases.set(name, state);
		const request = {} as IDBOpenDBRequest;
		const createTransaction = () => {
			const transaction = {} as IDBTransaction;
			let pending = 0;
			const makeRequest = <T>(read: () => T): IDBRequest<T> => {
				const result = {} as IDBRequest<T>;
				pending++;
				queueMicrotask(() => {
					Object.defineProperty(result, "result", { value: read(), configurable: true });
					result.onsuccess?.({} as Event);
					pending--;
					if (pending === 0) transaction.oncomplete?.({} as Event);
				});
				return result;
			};
			const objectStore = {
				indexNames: { contains: (index: string) => state.indexes.has(index) },
				createIndex: (index: string, keys: string[]) => state.indexes.set(index, keys),
				index: (index: string) => {
					const fields = state.indexes.get(index);
					if (!fields) throw new Error("Missing metadata index");
					return {
						openKeyCursor: () => {
							const entries = Array.from(state.records.values(), (record) => ({
								key: fields.map((field) => record[field as "size" | "lastAccess"]),
								primaryKey: record.key,
							}));
							entries.sort(
								(a, b) =>
									a.key[0]! - b.key[0]! ||
									a.key[1]! - b.key[1]! ||
									a.primaryKey.localeCompare(b.primaryKey),
							);
							const cursorRequest = {} as IDBRequest<IDBCursor | null>;
							let offset = 0;
							const advance = () =>
								queueMicrotask(() => {
									const entry = entries[offset++];
									if (entry) this.metadataReads++;
									Object.defineProperty(cursorRequest, "result", {
										value: entry ? { ...entry, continue: advance } : null,
										configurable: true,
									});
									cursorRequest.onsuccess?.({} as Event);
								});
							advance();
							return cursorRequest;
						},
					};
				},
				get: (key: string) =>
					makeRequest(() => {
						this.payloadReads++;
						return cloneFakeRecord(state.records.get(key));
					}),
				getAll: () => {
					throw new Error("Cache statistics must not read audio payloads");
				},
				put: (record: FakeAudioRecord) =>
					makeRequest(() => {
						state.records.set(record.key, cloneFakeRecord(record)!);
						return record.key;
					}),
				delete: (key: string) =>
					makeRequest(() => {
						state.records.delete(key);
					}),
				clear: () =>
					makeRequest(() => {
						state.records.clear();
					}),
			} as unknown as IDBObjectStore;
			transaction.objectStore = () => objectStore;
			return transaction;
		};
		const database = {
			objectStoreNames: {
				contains: (store: string) => store === "audio" && state.hasAudioStore,
			},
			createObjectStore: () => {
				state.hasAudioStore = true;
				return createTransaction().objectStore("audio");
			},
			transaction: createTransaction,
			close: () => undefined,
		} as unknown as IDBDatabase;
		queueMicrotask(() => {
			Object.defineProperty(request, "result", { value: database });
			if (state.version < version) {
				Object.defineProperty(request, "transaction", { value: createTransaction() });
				request.onupgradeneeded?.({
					oldVersion: state.version,
					newVersion: version,
				} as IDBVersionChangeEvent);
				state.version = version;
			}
			request.onsuccess?.({} as Event);
		});
		return request;
	}
}

function cloneFakeRecord(record: FakeAudioRecord | undefined): FakeAudioRecord | undefined {
	return record
		? {
				...record,
				data: record.data.slice(0),
			}
		: undefined;
}

describe("pronunciation audio cache", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("upgrades legacy audio and reads only metadata for cold usage and eviction", async () => {
		vi.useFakeTimers();
		const factory = new FakeIndexedDbFactory();
		factory.seedLegacy("legacy", [
			{
				key: "older",
				size: 4,
				lastAccess: 1,
				data: new Uint8Array([1, 2, 3, 4]).buffer,
				mimeType: "audio/mpeg",
			},
			{
				key: "newer",
				size: 3,
				lastAccess: 2,
				data: new Uint8Array([5, 6, 7]).buffer,
				mimeType: "audio/mpeg",
			},
		]);
		const cache = new IndexedDbPronunciationAudioCache(
			"legacy",
			7,
			factory as unknown as IDBFactory,
		);
		expect(await cache.getUsageBytes()).toBe(7);
		expect(factory.metadataReads).toBe(2);
		expect(factory.payloadReads).toBe(0);
		await cache.put("latest", { data: new Uint8Array([8, 9]).buffer, mimeType: "audio/mpeg" });
		expect(await cache.getUsageBytes()).toBe(5);
		expect(factory.payloadReads).toBe(0);
		expect(await cache.get("older")).toBeNull();
		expect(await cache.get("newer")).toEqual({
			data: new Uint8Array([5, 6, 7]).buffer,
			mimeType: "audio/mpeg",
		});
		await cache.clear();
	});

	it("counts duplicate index keys and updates replacement sizes across reopen and clear", async () => {
		const factory = new FakeIndexedDbFactory();
		factory.seedLegacy(
			"sizes",
			["a", "b"].map((key) => ({
				key,
				size: 3,
				lastAccess: 1,
				data: new Uint8Array(3).buffer,
				mimeType: "audio/mpeg",
			})),
		);
		const cache = new IndexedDbPronunciationAudioCache(
			"sizes",
			100,
			factory as unknown as IDBFactory,
		);
		expect(await cache.getUsageBytes()).toBe(6);
		await cache.put("a", { data: new Uint8Array(5).buffer, mimeType: "audio/mpeg" });
		expect(await cache.getUsageBytes()).toBe(8);
		const reopened = new IndexedDbPronunciationAudioCache(
			"sizes",
			100,
			factory as unknown as IDBFactory,
		);
		expect(await reopened.getUsageBytes()).toBe(8);
		expect(factory.payloadReads).toBe(0);
		await reopened.clear();
		const empty = new IndexedDbPronunciationAudioCache(
			"sizes",
			100,
			factory as unknown as IDBFactory,
		);
		expect(await empty.getUsageBytes()).toBe(0);
	});

	it("preserves pending and flushed LRU touches when evicting from metadata", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100);
		const factory = new FakeIndexedDbFactory();
		factory.seedLegacy("lru", [
			{
				key: "a",
				size: 3,
				lastAccess: 1,
				data: new Uint8Array(3).buffer,
				mimeType: "audio/mpeg",
			},
			{
				key: "b",
				size: 2,
				lastAccess: 2,
				data: new Uint8Array(2).buffer,
				mimeType: "audio/mpeg",
			},
		]);
		const cache = new IndexedDbPronunciationAudioCache(
			"lru",
			5,
			factory as unknown as IDBFactory,
		);
		await cache.get("a");
		await cache.put("c", { data: new Uint8Array(2).buffer, mimeType: "audio/mpeg" });
		expect(await cache.get("b")).toBeNull();
		vi.setSystemTime(200);
		await cache.get("a");
		await vi.advanceTimersByTimeAsync(5000);
		const reopened = new IndexedDbPronunciationAudioCache(
			"lru",
			5,
			factory as unknown as IDBFactory,
		);
		expect(await reopened.getUsageBytes()).toBe(5);
		await reopened.put("d", { data: new Uint8Array(2).buffer, mimeType: "audio/mpeg" });
		expect(await reopened.get("c")).toBeNull();
		expect(await reopened.get("a")).not.toBeNull();
		await reopened.clear();
	});

	it("uses memory when an old connection blocks upgrade and closes a late connection", async () => {
		vi.useFakeTimers();
		const request = {} as IDBOpenDBRequest;
		const database = { close: vi.fn() };
		const factory = {
			open: () => {
				queueMicrotask(() => request.onblocked?.({} as IDBVersionChangeEvent));
				return request;
			},
		} as unknown as IDBFactory;
		const cache = new IndexedDbPronunciationAudioCache("blocked", 100, factory);
		const audio = { data: new Uint8Array([1, 2]).buffer, mimeType: "audio/mpeg" };
		await cache.put("a", audio);
		expect(await cache.getUsageBytes()).toBe(2);
		expect(await cache.get("a")).toEqual(audio);
		Object.defineProperty(request, "result", { value: database });
		request.onsuccess?.({} as Event);
		expect(database.close).toHaveBeenCalledOnce();
	});

	it("uses a 100 MB device cache limit", () => {
		expect(PRONUNCIATION_CACHE_LIMIT_BYTES).toBe(100 * 1024 * 1024);
	});

	it("evicts the least recently used audio at the configured limit", async () => {
		let now = 1;
		const cache = new MemoryPronunciationAudioCache(5, () => now++);
		await cache.put("first", {
			data: new Uint8Array([1, 2, 3]).buffer,
			mimeType: "audio/mpeg",
		});
		await cache.put("second", {
			data: new Uint8Array([4, 5]).buffer,
			mimeType: "audio/mpeg",
		});
		await cache.get("first");
		await cache.put("third", {
			data: new Uint8Array([6, 7]).buffer,
			mimeType: "audio/mpeg",
		});

		expect(await cache.get("first")).not.toBeNull();
		expect(await cache.get("second")).toBeNull();
		expect(await cache.get("third")).not.toBeNull();
		expect(await cache.getUsageBytes()).toBe(5);
	});

	it("replaces an in-memory entry without inflating cache usage", async () => {
		const cache = new MemoryPronunciationAudioCache(5);
		const audio = {
			data: new Uint8Array([1, 2, 3]).buffer,
			mimeType: "audio/mpeg",
		};

		await cache.put("same", audio);
		await cache.put("same", audio);

		expect(await cache.get("same")).not.toBeNull();
		expect(await cache.getUsageBytes()).toBe(3);
	});

	it("isolates cache keys by provider, voice variant, accent, rate, and text", async () => {
		const base = await createPronunciationCacheKey(makeDescriptor());
		const variants = await Promise.all([
			createPronunciationCacheKey(makeDescriptor({ provider: "openai" })),
			createPronunciationCacheKey(makeDescriptor({ variant: "different-voice" })),
			createPronunciationCacheKey(makeDescriptor({ accent: "en-GB" })),
			createPronunciationCacheKey(makeDescriptor({ rate: "slow" })),
			createPronunciationCacheKey(makeDescriptor({ text: "hello world" })),
		]);

		expect(new Set([base, ...variants])).toHaveLength(6);
		expect(base).toMatch(/^[a-f0-9]{64}$/);
	});

	it("falls back to memory when IndexedDB is unavailable", async () => {
		const cache = new IndexedDbPronunciationAudioCache("test", 100, null);
		await cache.put("hello", {
			data: new Uint8Array([1, 2, 3]).buffer,
			mimeType: "audio/mpeg",
		});

		expect(await cache.get("hello")).toMatchObject({ mimeType: "audio/mpeg" });
		expect(await cache.getUsageBytes()).toBe(3);
		await cache.clear();
		expect(await cache.getUsageBytes()).toBe(0);
	});

	it("enforces the cache limit against IndexedDB records from a previous instance", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100);
		const indexedDb = new FakeIndexedDbFactory() as unknown as IDBFactory;
		const firstInstance = new IndexedDbPronunciationAudioCache("persisted", 5, indexedDb);
		await firstInstance.put("older", {
			data: new Uint8Array([1, 2, 3, 4]).buffer,
			mimeType: "audio/mpeg",
		});

		const secondInstance = new IndexedDbPronunciationAudioCache("persisted", 5, indexedDb);
		vi.setSystemTime(200);
		await secondInstance.put("newer", {
			data: new Uint8Array([5, 6, 7]).buffer,
			mimeType: "audio/mpeg",
		});

		expect(await secondInstance.getUsageBytes()).toBe(3);
	});
});
