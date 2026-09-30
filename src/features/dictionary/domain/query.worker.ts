import { fst_exact, fst_fuzzy, fst_prefix, inflate_zlib } from "./engine/dictionary_engine.js";
import { ensureDictionaryEngine } from "./engine-loader";
import {
	isCompiledResourceMime,
	normalizeCompiledLookupKey,
	normalizeCompiledResourceKey,
	type CompiledDictionaryManifest,
	type CompiledFrameDescriptor,
	type CompiledIndexDescriptor,
	type CompiledJsonIndexDescriptor,
} from "./compiled-package/internal";
import { readCompiledPackageQueryPlan } from "./compiled-package/manifest";
import type { CompiledPackageQueryPlan } from "./compiled-package/types";
import { resolveLinkedDefinitions, type RecordValue } from "./linked-definitions";

interface WorkerContext {
	addEventListener(type: "message", listener: (event: MessageEvent<QueryInput>) => void): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

interface OpenInput {
	readonly cacheBytes: number;
	readonly queryPlan: CompiledPackageQueryPlan;
	readonly type: "open";
}

interface LookupInput {
	readonly id: number;
	readonly type: "lookup";
	readonly word: string;
}

interface ResourceInput {
	readonly id: number;
	readonly path: string;
	readonly type: "resource";
}

interface ReadResultInput {
	readonly data?: ArrayBuffer;
	readonly error?: string;
	readonly id: number;
	readonly type: "read-result";
}

type QueryInput = LookupInput | OpenInput | ReadResultInput | ResourceInput;

interface RecordLocator {
	readonly frame: number;
	readonly item: number;
}

interface ResourceLocator {
	readonly frames: readonly CompiledFrameDescriptor[];
	readonly mime: string;
}

const context = self as unknown as WorkerContext;
const pendingReads = new Map<
	number,
	{ reject(error: Error): void; resolve(data: Uint8Array): void }
>();
const inflightBytes = new Map<string, Promise<Uint8Array>>();
const inflightJson = new Map<string, Promise<unknown>>();

async function coalesce<T>(
	pending: Map<string, Promise<T>>,
	key: string,
	read: () => Promise<T>,
): Promise<T> {
	const existing = pending.get(key);
	if (existing) return existing;
	const promise = read();
	pending.set(key, promise);
	try {
		return await promise;
	} finally {
		pending.delete(key);
	}
}

let nextReadId = 1;
let manifest: CompiledDictionaryManifest | null = null;
let cache: ByteLru;

context.addEventListener("message", (event) => {
	const message = event.data;
	if (message.type === "open") {
		manifest = readCompiledPackageQueryPlan(message.queryPlan);
		cache = new ByteLru(message.cacheBytes);
		return;
	}
	if (message.type === "read-result") {
		const pending = pendingReads.get(message.id);
		if (!pending) return;
		pendingReads.delete(message.id);
		if (message.data) pending.resolve(new Uint8Array(message.data));
		else pending.reject(new Error(message.error ?? "Dictionary package read failed."));
		return;
	}
	if (message.type !== "lookup" && message.type !== "resource") return;
	void run(message).catch((error: unknown) => {
		context.postMessage({
			error: error instanceof Error ? error.message : "Dictionary query failed.",
			id: message.id,
			type: "error",
		});
	});
});

async function run(message: LookupInput | ResourceInput): Promise<void> {
	await ensureDictionaryEngine();
	if (!manifest) throw new Error("Compiled dictionary is not open.");
	if (message.type === "lookup") {
		const result = await lookup(message.word);
		context.postMessage({ id: message.id, result, type: "lookup-result" });
		return;
	}
	const result = await resolveResource(message.path);
	if (!result) {
		context.postMessage({ id: message.id, result: null, type: "resource-result" });
		return;
	}
	const transfer = result.data.buffer.slice(
		result.data.byteOffset,
		result.data.byteOffset + result.data.byteLength,
	);
	context.postMessage(
		{ id: message.id, result: { data: transfer, mime: result.mime }, type: "resource-result" },
		[transfer],
	);
}

async function lookup(word: string): Promise<{
	definitions: RecordValue[];
	suggestions: string[];
}> {
	const normalized = normalizeCompiledLookupKey(word);
	if (!normalized || normalized.length > 512) return { definitions: [], suggestions: [] };
	const definitions = await resolveLinkedDefinitions(normalized, exactDefinitions);
	if (definitions.length > 0) return { definitions, suggestions: [] };
	const prefix = await prefixSuggestions(normalized, 12);
	const suggestions = prefix.length > 0 ? prefix : await fuzzySuggestions(normalized, 12);
	return { definitions: [], suggestions };
}

async function exactDefinitions(key: string): Promise<RecordValue[]> {
	const current = requiredManifest();
	const shard = current.indexes.find(
		(candidate) => candidate.firstKey <= key && candidate.lastKey >= key,
	);
	if (!shard) return [];
	const fst = await readCached(shard.fstFile);
	const postingIndex = fst_exact(fst, key);
	if (postingIndex === undefined) return [];
	const postings = await readJsonCached<readonly (readonly RecordLocator[])[]>(
		shard.postingsFile,
	);
	const locators = postings[postingIndex];
	if (!locators) throw new Error("Compiled dictionary posting is missing.");
	const values = await Promise.all(locators.slice(0, 64).map((locator) => readRecord(locator)));
	return values;
}

async function readRecord(locator: RecordLocator): Promise<RecordValue> {
	const frame = requiredManifest().recordFrames[locator.frame];
	if (!frame) throw new Error("Compiled dictionary record frame is missing.");
	const values = await readFrameJson<readonly RecordValue[]>(frame, `record:${locator.frame}`);
	const value = values[locator.item];
	if (
		!value ||
		typeof value.definition !== "string" ||
		typeof value.keyText !== "string" ||
		value.definition.length > 8_388_608
	) {
		throw new Error("Compiled dictionary record is corrupt.");
	}
	return value;
}

async function prefixSuggestions(prefix: string, limit: number): Promise<string[]> {
	const values: string[] = [];
	for (const shard of relevantPrefixShards(requiredManifest().indexes, prefix)) {
		// oxlint-disable-next-line no-await-in-loop -- stop after the first shards satisfy the read limit.
		const fst = await readCached(shard.fstFile);
		const keys = JSON.parse(fst_prefix(fst, prefix, limit - values.length)) as unknown;
		if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
			throw new Error("Compiled dictionary prefix index is corrupt.");
		}
		values.push(...keys);
		if (values.length >= limit) break;
	}
	return unique(values, limit);
}

async function fuzzySuggestions(word: string, limit: number): Promise<string[]> {
	if (Array.from(word).length > 48) return prefixSuggestions(word, limit);
	const candidates: string[] = [];
	for (const shard of requiredManifest().indexes) {
		// oxlint-disable-next-line no-await-in-loop -- stop once ordered FST shards satisfy the limit.
		const fst = await readCached(shard.fstFile);
		const values = JSON.parse(fst_fuzzy(fst, word, 2, limit - candidates.length)) as unknown;
		if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
			throw new Error("Compiled dictionary fuzzy index is corrupt.");
		}
		candidates.push(...values);
		if (candidates.length >= limit) break;
	}
	return unique(candidates, limit);
}

async function resolveResource(path: string): Promise<{ data: Uint8Array; mime: string } | null> {
	const key = normalizeCompiledResourceKey(path);
	for (const shard of matchingJsonShards(requiredManifest().resources, key)) {
		// oxlint-disable-next-line no-await-in-loop -- only the first matching resource shard is needed.
		const values = await readJsonCached<Record<string, readonly ResourceLocator[]>>(shard.file);
		const locator = values[key]?.[0];
		if (!locator) continue;
		if (
			!Array.isArray(locator.frames) ||
			locator.frames.length === 0 ||
			locator.frames.length > 16 ||
			!locator.frames.every(validResourceFrame) ||
			!isCompiledResourceMime(locator.mime)
		) {
			throw new Error("Compiled resource index is corrupt.");
		}
		// oxlint-disable-next-line no-await-in-loop -- resource chunks are read only after a locator hit.
		const parts = await Promise.all(
			locator.frames.map((frame) =>
				readFrame(frame, `resource:${frame.file}:${frame.offset}:${frame.length}`),
			),
		);
		const totalBytes = parts.reduce((total, part) => total + part.byteLength, 0);
		if (totalBytes > 21_000_000) throw new Error("Compiled resource is too large.");
		const data = new Uint8Array(totalBytes);
		let offset = 0;
		for (const part of parts) {
			data.set(part, offset);
			offset += part.byteLength;
		}
		return { data, mime: locator.mime };
	}
	return null;
}

async function readFrameJson<T>(frame: CompiledFrameDescriptor, key: string): Promise<T> {
	const cached = cache.getJson<T>(key);
	if (cached) return cached;
	return coalesce(inflightJson, key, async () => {
		const bytes = await readFrame(frame, `${key}:bytes`);
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		const value = JSON.parse(text) as T;
		cache.setJson(key, value, bytes.byteLength);
		return value;
	}) as Promise<T>;
}

async function readFrame(frame: CompiledFrameDescriptor, key: string): Promise<Uint8Array> {
	const cached = cache.getBytes(key);
	if (cached) return cached;
	return coalesce(inflightBytes, key, async () => {
		const pack = await readFile(frame.file);
		const end = frame.offset + frame.length;
		if (frame.offset < 0 || end > pack.byteLength)
			throw new Error("Compiled frame is out of range.");
		const packed = pack.subarray(frame.offset, end);
		const bytes =
			frame.codec === "deflate" ? inflate_zlib(packed, frame.unpackedSize) : packed.slice();
		if (bytes.byteLength !== frame.unpackedSize)
			throw new Error("Compiled frame size mismatch.");
		cache.setBytes(key, bytes);
		return bytes;
	});
}

async function readCached(path: string): Promise<Uint8Array> {
	const key = `file:${path}`;
	const cached = cache.getBytes(key);
	if (cached) return cached;
	return coalesce(inflightBytes, key, async () => {
		const bytes = await readFile(path);
		cache.setBytes(key, bytes);
		return bytes;
	});
}

async function readJsonCached<T>(path: string): Promise<T> {
	const key = `json:${path}`;
	const cached = cache.getJson<T>(key);
	if (cached) return cached;
	return coalesce(inflightJson, key, async () => {
		const bytes = await readFile(path);
		const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
		cache.setJson(key, value, bytes.byteLength);
		return value;
	}) as Promise<T>;
}

function readFile(path: string): Promise<Uint8Array> {
	return coalesce(inflightBytes, `read:${path}`, () => readFileNow(path));
}

function readFileNow(path: string): Promise<Uint8Array> {
	const id = nextReadId;
	nextReadId += 1;
	return new Promise((resolve, reject) => {
		pendingReads.set(id, { reject, resolve });
		context.postMessage({ id, path, type: "read" });
	});
}

function requiredManifest(): CompiledDictionaryManifest {
	if (!manifest) throw new Error("Compiled dictionary is not open.");
	return manifest;
}

function relevantPrefixShards(
	shards: readonly CompiledIndexDescriptor[],
	prefix: string,
): readonly CompiledIndexDescriptor[] {
	const upper = `${prefix}\u{10ffff}`;
	return shards.filter((shard) => shard.lastKey >= prefix && shard.firstKey <= upper);
}

function matchingJsonShards(
	shards: readonly CompiledJsonIndexDescriptor[],
	key: string,
): readonly CompiledJsonIndexDescriptor[] {
	return shards.filter((shard) => shard.firstKey <= key && shard.lastKey >= key);
}

function unique(values: readonly string[], limit: number): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		output.push(value);
		if (output.length >= limit) break;
	}
	return output;
}

function validResourceFrame(value: unknown): value is CompiledFrameDescriptor {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const frame = value as Record<string, unknown>;
	if (typeof frame.file !== "string") return false;
	const file = requiredManifest().files[frame.file];
	return (
		file !== undefined &&
		(frame.codec === "deflate" || frame.codec === "none") &&
		Number.isSafeInteger(frame.offset) &&
		Number(frame.offset) >= 0 &&
		Number.isSafeInteger(frame.length) &&
		Number(frame.length) > 0 &&
		Number.isSafeInteger(frame.unpackedSize) &&
		Number(frame.unpackedSize) >= 0 &&
		Number(frame.unpackedSize) <= 32 * 1_048_576 &&
		Number(frame.offset) + Number(frame.length) <= file.size
	);
}

class ByteLru {
	private bytes = 0;
	private readonly values = new Map<string, { bytes: number; value: unknown }>();

	constructor(private readonly budget: number) {}

	getBytes(key: string): Uint8Array | null {
		const value = this.take(key);
		return value instanceof Uint8Array ? value : null;
	}

	getJson<T>(key: string): T | null {
		const value = this.take(key);
		return value === null || value instanceof Uint8Array ? null : (value as T);
	}

	setBytes(key: string, value: Uint8Array): void {
		this.set(key, value, value.byteLength);
	}

	setJson(key: string, value: unknown, bytes: number): void {
		this.set(key, value, bytes);
	}

	private take(key: string): unknown {
		const item = this.values.get(key);
		if (!item) return null;
		this.values.delete(key);
		this.values.set(key, item);
		return item.value;
	}

	private set(key: string, value: unknown, bytes: number): void {
		const previous = this.values.get(key);
		if (previous) this.bytes -= previous.bytes;
		this.values.delete(key);
		this.values.set(key, { bytes, value });
		this.bytes += bytes;
		while (this.bytes > this.budget) {
			const oldest = this.values.entries().next().value as
				| [string, { bytes: number; value: unknown }]
				| undefined;
			if (!oldest) break;
			this.values.delete(oldest[0]);
			this.bytes -= oldest[1].bytes;
		}
	}
}
