import { dictionaryText } from "./messages";
import { DictionaryError } from "./types";
import { createDictionaryResourceUrl, revokeDictionaryResourceUrl } from "./resource-url";

export interface CompiledResource {
	readonly data: ArrayBuffer;
	readonly mime: string;
}

interface ResourceDependencies {
	read(path: string): Promise<CompiledResource | null>;
	canReadRemote(): boolean;
	remote: { resolve(path: string): Promise<string | null>; close(): void };
	budgetBytes: number;
}

interface CachedResource {
	value: string | null;
	bytes: number;
	url: boolean;
}

const MAX_NEGATIVE_ENTRIES = 256;
const MAX_TEXT_BYTES = 8 * 1_048_576;

/** Owns one compiled source's resource requests, cached results and URL lifetime. */
export class CompiledDictionaryResources {
	private closed = false;
	private bytes = 0;
	private readonly cache = new Map<string, CachedResource>();
	private readonly misses = new Map<string, CachedResource>();
	private readonly pending = new Map<
		string,
		{
			promise: Promise<unknown>;
			reject(error: Error): void;
		}
	>();

	constructor(private readonly dependencies: ResourceDependencies) {}

	resolve(path: string): Promise<string | null> {
		return this.run(`url\0${path}`, async () => {
			const key = `url\0${path}`;
			const cached = this.cached(key);
			if (cached) return cached.value;
			const result = await this.read(path);
			this.assertOpen();
			if (!result && this.dependencies.canReadRemote()) {
				const remote = await this.dependencies.remote.resolve(path);
				this.assertOpen();
				// Remote results are in-flight only, never retained or persisted.
				return remote;
			}
			if (!result || !safeMime(result.mime)) return null;
			// A blob URL must remain owned until eviction or close. Do not create
			// one that exceeds the budget and would immediately be revoked.
			if (
				result.mime.startsWith("font/") &&
				result.data.byteLength > this.dependencies.budgetBytes
			)
				return null;
			const url = createDictionaryResourceUrl(result.data, result.mime);
			this.remember(key, { value: url, bytes: result.data.byteLength, url: true });
			return url;
		});
	}

	resolveText(path: string, mime: "text/javascript" | "text/css"): Promise<string | null> {
		const key = `text\0${mime}\0${path}`;
		return this.run(key, async () => {
			const cached = this.cached(key);
			if (cached) return cached.value;
			const result = await this.read(path);
			this.assertOpen();
			let value: string | null = null;
			if (result?.mime === mime && result.data.byteLength <= MAX_TEXT_BYTES) {
				try {
					value = new TextDecoder("utf-8", { fatal: true }).decode(result.data);
				} catch {
					/* Invalid text is not executable. */
				}
			}
			this.remember(key, { value, bytes: value === null ? 0 : value.length * 2, url: false });
			return value;
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const entry of this.pending.values()) entry.reject(this.closedError());
		this.pending.clear();
		this.dependencies.remote.close();
		for (const entry of this.cache.values()) this.release(entry);
		this.cache.clear();
		this.misses.clear();
		this.bytes = 0;
	}

	private read(path: string): Promise<CompiledResource | null> {
		const key = `read\0${path}`;
		return this.run(key, async () => {
			if (this.cached(key)) return null;
			const result = await this.dependencies.read(path);
			this.assertOpen();
			if (!result) this.remember(key, { value: null, bytes: 0, url: false });
			return result;
		});
	}

	private run<T>(key: string, work: () => Promise<T>): Promise<T> {
		if (this.closed) return Promise.reject(this.closedError());
		const existing = this.pending.get(key);
		if (existing) return existing.promise as Promise<T>;
		let rejectPending!: (error: Error) => void;
		const promise = new Promise<T>((resolve, reject) => {
			rejectPending = reject;
			void Promise.resolve()
				.then(() => {
					this.assertOpen();
					return work();
				})
				.then(
					(value) => {
						this.pending.delete(key);
						if (this.closed) reject(this.closedError());
						else resolve(value);
					},
					(error) => {
						this.pending.delete(key);
						reject(error);
					},
				);
		});
		this.pending.set(key, { promise, reject: rejectPending });
		return promise;
	}

	private cached(key: string): CachedResource | undefined {
		const cache = this.cache.has(key) ? this.cache : this.misses;
		const entry = cache.get(key);
		if (entry) {
			cache.delete(key);
			cache.set(key, entry);
		}
		return entry;
	}

	private remember(key: string, entry: CachedResource): void {
		if (entry.value === null) {
			this.misses.delete(key);
			this.misses.set(key, entry);
			if (this.misses.size > MAX_NEGATIVE_ENTRIES) {
				this.misses.delete(this.misses.keys().next().value!);
			}
			return;
		}
		// Empty resources must not grow an unbounded zero-byte cache.
		if (entry.bytes === 0) return;
		if (entry.bytes > this.dependencies.budgetBytes) return;
		const previous = this.cache.get(key);
		if (previous) {
			this.bytes -= previous.bytes;
			this.release(previous);
		}
		this.cache.delete(key);
		this.cache.set(key, entry);
		this.bytes += entry.bytes;
		while (this.bytes > this.dependencies.budgetBytes) {
			const [oldestKey, oldest] = this.cache.entries().next().value!;
			this.cache.delete(oldestKey);
			this.bytes -= oldest.bytes;
			this.release(oldest);
		}
	}

	private release(entry: CachedResource): void {
		if (entry.url && entry.value) revokeDictionaryResourceUrl(entry.value);
	}

	private assertOpen(): void {
		if (this.closed) throw this.closedError();
	}
	private closedError(): DictionaryError {
		return new DictionaryError("request", dictionaryText().errors.request);
	}
}

function safeMime(value: string): boolean {
	return /^(?:text\/(?:css|html|javascript|plain|vtt)|application\/(?:json|manifest\+json|octet-stream|vnd\.ms-fontobject|wasm|xml)|image\/(?:apng|avif|bmp|gif|jpeg|png|svg\+xml|webp|x-icon)|audio\/(?:aac|flac|mp4|mpeg|ogg|opus|wav|webm)|video\/(?:mp4|ogg|quicktime|webm)|font\/(?:otf|ttf|woff|woff2))$/.test(
		value,
	);
}
