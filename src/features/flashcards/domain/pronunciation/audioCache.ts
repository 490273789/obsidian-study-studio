import type {
	CachedPronunciationAudio,
	PronunciationAudioCache,
	PronunciationRequestDescriptor,
} from "./types";
import { PRONUNCIATION_CACHE_LIMIT_BYTES } from "./types";

interface AudioCacheMetadata {
	key: string;
	size: number;
	lastAccess: number;
}

interface AudioCacheRecord extends CachedPronunciationAudio, AudioCacheMetadata {}

const AUDIO_CACHE_DATABASE_VERSION = 2;
const AUDIO_CACHE_METADATA_INDEX = "lastAccessAndSize";

export class MemoryPronunciationAudioCache implements PronunciationAudioCache {
	private records = new Map<string, AudioCacheRecord>();
	private usageBytes = 0;

	constructor(
		private readonly limitBytes = PRONUNCIATION_CACHE_LIMIT_BYTES,
		private readonly now: () => number = Date.now,
	) {}

	async get(key: string): Promise<CachedPronunciationAudio | null> {
		const record = this.records.get(key);
		if (!record) return null;
		record.lastAccess = this.now();
		return {
			data: record.data.slice(0),
			mimeType: record.mimeType,
		};
	}

	async put(key: string, audio: CachedPronunciationAudio): Promise<void> {
		const size = audio.data.byteLength;
		const previous = this.records.get(key);
		if (previous) this.usageBytes -= previous.size;
		this.records.set(key, {
			key,
			data: audio.data.slice(0),
			mimeType: audio.mimeType,
			size,
			lastAccess: this.now(),
		});
		this.usageBytes += size;
		this.evict();
	}

	async getUsageBytes(): Promise<number> {
		return this.usageBytes;
	}

	async clear(): Promise<void> {
		this.records.clear();
		this.usageBytes = 0;
	}

	private evict(): void {
		if (this.usageBytes <= this.limitBytes) return;
		const records = Array.from(this.records.values()).sort(
			(left, right) => left.lastAccess - right.lastAccess,
		);
		for (const record of records) {
			if (this.usageBytes <= this.limitBytes) break;
			this.records.delete(record.key);
			this.usageBytes -= record.size;
		}
	}
}

export class IndexedDbPronunciationAudioCache implements PronunciationAudioCache {
	private readonly memoryFallback: MemoryPronunciationAudioCache;
	private disabled = false;
	private databasePromise: Promise<IDBDatabase> | null = null;
	// In-memory usage bookkeeping so hot paths never touch the full table.
	private memoryUsageBytes = 0;
	private memoryRecordSizes = new Map<string, number>();
	private usageSynced = false;
	// Pending lastAccess touches, flushed to IndexedDB on a throttle.
	private pendingTouches = new Map<string, number>();
	private touchFlushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly databaseName = "wsr-flash-card-pronunciation-cache",
		private readonly limitBytes = PRONUNCIATION_CACHE_LIMIT_BYTES,
		private readonly indexedDb: IDBFactory | null = typeof indexedDB === "undefined"
			? null
			: indexedDB,
	) {
		this.memoryFallback = new MemoryPronunciationAudioCache(limitBytes);
		if (!indexedDb) this.disabled = true;
	}

	async get(key: string): Promise<CachedPronunciationAudio | null> {
		if (this.disabled) return this.memoryFallback.get(key);
		try {
			const database = await this.open();
			const record = await getRecord(database, key);
			if (!record) return this.memoryFallback.get(key);
			// Throttle lastAccess writebacks: accumulate in memory and flush in
			// one batch so cache hits do not each open a write transaction.
			const now = Date.now();
			this.pendingTouches.set(key, now);
			this.scheduleTouchFlush();
			return {
				data: record.data.slice(0),
				mimeType: record.mimeType,
			};
		} catch {
			this.disabled = true;
			return this.memoryFallback.get(key);
		}
	}

	async put(key: string, audio: CachedPronunciationAudio): Promise<void> {
		if (this.disabled) {
			await this.memoryFallback.put(key, audio);
			return;
		}
		try {
			const database = await this.open();
			await this.ensureUsageSynced(database);
			const size = audio.data.byteLength;
			const previousSize = this.memoryRecordSizes.get(key) ?? 0;
			await putRecord(database, {
				key,
				data: audio.data.slice(0),
				mimeType: audio.mimeType,
				size,
				lastAccess: Date.now(),
			});
			this.pendingTouches.delete(key);
			this.memoryUsageBytes += size - previousSize;
			this.memoryRecordSizes.set(key, size);
			// Only scan the full table when our in-memory accounting says we are
			// over the limit, avoiding a getAll+sort on every single write.
			if (this.memoryUsageBytes > this.limitBytes) {
				await this.evict(database);
			}
		} catch {
			this.disabled = true;
			await this.memoryFallback.put(key, audio);
		}
	}

	async getUsageBytes(): Promise<number> {
		if (this.disabled) return this.memoryFallback.getUsageBytes();
		try {
			await this.ensureUsageSynced(await this.open());
			return this.memoryUsageBytes;
		} catch {
			this.disabled = true;
			return this.memoryFallback.getUsageBytes();
		}
	}

	async clear(): Promise<void> {
		await this.memoryFallback.clear();
		this.pendingTouches.clear();
		if (this.touchFlushTimer !== null) {
			clearTimeout(this.touchFlushTimer);
			this.touchFlushTimer = null;
		}
		this.memoryUsageBytes = 0;
		this.memoryRecordSizes.clear();
		this.usageSynced = false;
		if (this.disabled) return;
		try {
			await clearRecords(await this.open());
			this.usageSynced = true;
		} catch {
			this.disabled = true;
		}
	}

	private open(): Promise<IDBDatabase> {
		if (this.databasePromise) return this.databasePromise;
		if (!this.indexedDb) return Promise.reject(new Error("IndexedDB is unavailable"));
		this.databasePromise = new Promise((resolve, reject) => {
			const request = this.indexedDb!.open(this.databaseName, AUDIO_CACHE_DATABASE_VERSION);
			let blocked = false;
			request.onupgradeneeded = () => {
				const database = request.result;
				const store = database.objectStoreNames.contains("audio")
					? request.transaction!.objectStore("audio")
					: database.createObjectStore("audio", { keyPath: "key" });
				// IndexedDB populates the index for existing records without sending
				// their audio buffers to JavaScript. Preserve v1 offline audio.
				if (!store.indexNames.contains(AUDIO_CACHE_METADATA_INDEX)) {
					store.createIndex(AUDIO_CACHE_METADATA_INDEX, ["lastAccess", "size"]);
				}
			};
			request.onblocked = () => {
				blocked = true;
				reject(new Error("Audio cache upgrade is blocked"));
			};
			request.onsuccess = () => {
				const database = request.result;
				if (blocked) {
					database.close();
					return;
				}
				database.onversionchange = () => {
					database.close();
					this.databasePromise = null;
					this.usageSynced = false;
				};
				resolve(database);
			};
			request.onerror = () =>
				reject(request.error ?? new Error("Failed to open audio cache"));
		});
		return this.databasePromise;
	}

	private scheduleTouchFlush(): void {
		if (this.touchFlushTimer !== null) return;
		// Batch all touches that arrive within one throttle window into a
		// single read-write transaction when the window elapses.
		this.touchFlushTimer = setTimeout(() => {
			this.touchFlushTimer = null;
			const touches = this.pendingTouches;
			this.pendingTouches = new Map();
			if (touches.size === 0 || this.disabled) return;
			void (async () => {
				try {
					const database = await this.open();
					await touchRecords(database, touches);
				} catch {
					// Touches are best-effort LRU metadata; a failed flush does
					// not break playback, only slightly stale eviction order.
				}
			})();
		}, TOUCH_FLUSH_INTERVAL_MS);
	}

	private async ensureUsageSynced(database: IDBDatabase): Promise<void> {
		if (this.usageSynced) return;
		const records = await getAllMetadata(database);
		this.memoryUsageBytes = records.reduce((total, record) => total + record.size, 0);
		this.memoryRecordSizes = new Map(records.map((record) => [record.key, record.size]));
		this.usageSynced = true;
	}

	private async evict(database: IDBDatabase): Promise<void> {
		// Re-sync usage from the store so eviction matches what is really
		// persisted even if the in-memory accounting drifted.
		const records = await getAllMetadata(database);
		let usage = records.reduce((total, record) => total + record.size, 0);
		this.memoryRecordSizes = new Map(records.map((record) => [record.key, record.size]));
		if (usage <= this.limitBytes) {
			this.memoryUsageBytes = usage;
			this.usageSynced = true;
			return;
		}
		records.sort(
			(left, right) =>
				(this.pendingTouches.get(left.key) ?? left.lastAccess) -
				(this.pendingTouches.get(right.key) ?? right.lastAccess),
		);
		for (const record of records) {
			if (usage <= this.limitBytes) break;
			await deleteRecord(database, record.key);
			usage -= record.size;
			this.memoryRecordSizes.delete(record.key);
			this.pendingTouches.delete(record.key);
		}
		this.memoryUsageBytes = usage;
		this.usageSynced = true;
	}
}

const TOUCH_FLUSH_INTERVAL_MS = 5000;

export async function createPronunciationCacheKey(
	descriptor: PronunciationRequestDescriptor,
	cryptoProvider: Crypto | null = typeof crypto === "undefined" ? null : crypto,
): Promise<string> {
	if (!cryptoProvider?.subtle) {
		throw new Error("Web Crypto is unavailable");
	}
	const payload = JSON.stringify({
		version: 1,
		provider: descriptor.provider,
		variant: descriptor.variant,
		accent: descriptor.accent,
		rate: descriptor.rate,
		text: descriptor.text,
	});
	const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(payload));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function getRecord(database: IDBDatabase, key: string): Promise<AudioCacheRecord | null> {
	return new Promise((resolve, reject) => {
		const request = database.transaction("audio", "readonly").objectStore("audio").get(key);
		request.onsuccess = () => resolve((request.result as AudioCacheRecord | undefined) ?? null);
		request.onerror = () => reject(request.error ?? new Error("Failed to read audio cache"));
	});
}

function getAllMetadata(database: IDBDatabase): Promise<AudioCacheMetadata[]> {
	return new Promise((resolve, reject) => {
		const records: AudioCacheMetadata[] = [];
		const transaction = database.transaction("audio", "readonly");
		const request = transaction
			.objectStore("audio")
			.index(AUDIO_CACHE_METADATA_INDEX)
			.openKeyCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve(records);
				return;
			}
			const [lastAccess, size] = cursor.key as [number, number];
			records.push({ key: cursor.primaryKey as string, size, lastAccess });
			cursor.continue();
		};
		request.onerror = () => reject(request.error ?? new Error("Failed to list audio cache"));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("Failed to list audio cache"));
	});
}

function putRecord(database: IDBDatabase, record: AudioCacheRecord): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = database.transaction("audio", "readwrite").objectStore("audio").put(record);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error("Failed to write audio cache"));
	});
}

/**
 * Updates `lastAccess` for many keys in a single read-write transaction,
 * re-reading each record so the whole record is preserved.
 */
function touchRecords(database: IDBDatabase, touches: ReadonlyMap<string, number>): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction("audio", "readwrite");
		const store = transaction.objectStore("audio");
		for (const [key, lastAccess] of touches) {
			const getRequest = store.get(key);
			getRequest.onsuccess = () => {
				const record = getRequest.result as AudioCacheRecord | undefined;
				if (!record) return;
				record.lastAccess = lastAccess;
				store.put(record);
			};
			getRequest.onerror = () =>
				reject(getRequest.error ?? new Error("Failed to touch audio cache"));
		}
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("Failed to touch audio cache"));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("Failed to touch audio cache"));
	});
}

function deleteRecord(database: IDBDatabase, key: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = database.transaction("audio", "readwrite").objectStore("audio").delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error("Failed to evict audio cache"));
	});
}

function clearRecords(database: IDBDatabase): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = database.transaction("audio", "readwrite").objectStore("audio").clear();
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error("Failed to clear audio cache"));
	});
}
