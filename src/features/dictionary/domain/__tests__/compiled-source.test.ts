import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompiledPackageReader } from "../compiled-package";
import type { LocalDictionarySettings } from "../types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, reject, resolve };
}

const mocks = vi.hoisted(() => {
	class MockQueryWorker {
		readonly postMessage = vi.fn();
		readonly terminate = vi.fn();
		private readonly listeners = new Map<string, ((event: MessageEvent<unknown>) => void)[]>();

		constructor() {
			mocks.workers.push(this);
		}

		addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
			this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
		}

		emit(data: unknown): void {
			for (const listener of this.listeners.get("message") ?? [])
				listener({ data } as MessageEvent);
		}
	}
	return {
		MockQueryWorker,
		openCompiledPackage: vi.fn(),
		prepareDictionarySandboxDocument: vi.fn(),
		storage: { close: vi.fn(), snapshot: vi.fn(async () => ({})), update: vi.fn() },
		workers: [] as MockQueryWorker[],
	};
});

vi.mock("obsidian", () => ({
	Platform: { isMobile: false },
	normalizePath: (value: string) => value,
}));
vi.mock("../dictionary.worker?worker&inline", () => ({ default: mocks.MockQueryWorker }));
vi.mock("../compiled-package", async () => ({
	...(await import("../compiled-package/types")),
	openCompiledPackage: mocks.openCompiledPackage,
}));
vi.mock("../sandbox-document", () => ({
	prepareDictionarySandboxDocument: mocks.prepareDictionarySandboxDocument,
}));
vi.mock("../sandbox-storage", () => ({
	LocalDictionarySandboxStorage: class {
		close = mocks.storage.close;
		snapshot = mocks.storage.snapshot;
		update = mocks.storage.update;
	},
}));

import { CompiledDictionarySource } from "../compiled-source";

const metadata: LocalDictionarySettings = {
	compiled: {
		engineVersion: "2.0.6",
		entryCount: 1,
		fileCount: 1,
		formatVersion: 2,
		manifestPath: "compiled-v2/manifest.json",
		manifestSha256: "manifest",
		sourceFingerprint: "source",
		totalBytes: 1,
	},
	directory: "dictionaries/test",
	files: [],
	id: "local:test",
	name: "Test dictionary",
};

function reader(overrides: Partial<CompiledPackageReader> = {}): CompiledPackageReader {
	return {
		close: vi.fn(),
		queryPlan: {} as CompiledPackageReader["queryPlan"],
		readFile: vi.fn(),
		remoteResourceKind: null,
		script: "",
		stylesheet: "",
		...overrides,
	};
}

function source(): CompiledDictionarySource {
	return new CompiledDictionarySource(metadata, {} as never, "dictionaries/test", {
		requestHostPinned: vi.fn(),
	});
}

function worker() {
	const current = mocks.workers[0];
	if (!current) throw new Error("Expected a query worker");
	return current;
}

async function waitForPost(type: string) {
	await vi.waitFor(() =>
		expect(worker().postMessage.mock.calls.some(([message]) => message.type === type)).toBe(
			true,
		),
	);
	return worker().postMessage.mock.calls.find(([message]) => message.type === type)?.[0] as {
		id: number;
		type: string;
	};
}

beforeEach(() => {
	mocks.workers.length = 0;
	mocks.openCompiledPackage.mockReset();
	mocks.prepareDictionarySandboxDocument.mockReset();
	mocks.storage.close.mockReset();
	mocks.storage.snapshot.mockReset().mockResolvedValue({});
	mocks.storage.update.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("CompiledDictionarySource", () => {
	it("coalesces repeated definition resources through its worker and releases their URL on close", async () => {
		mocks.openCompiledPackage.mockResolvedValue(reader());
		const resourceUrls: string[] = [];
		mocks.prepareDictionarySandboxDocument.mockImplementation(
			async (_html: string, resolveResource: (path: string) => Promise<string | null>) => {
				const [first, second] = await Promise.all([
					resolveResource("shared.woff"),
					resolveResource("shared.woff"),
				]);
				resourceUrls.push(first!, second!);
				return {};
			},
		);
		const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const dictionary = source();
		const lookup = dictionary.lookup({ text: "word" });
		const open = await waitForPost("open");
		expect(open).toBeDefined();
		const query = await waitForPost("lookup");
		worker().emit({
			id: query.id,
			result: {
				definitions: [
					{ definition: "one", keyText: "one" },
					{ definition: "two", keyText: "two" },
				],
				suggestions: [],
			},
			type: "lookup-result",
		});
		const resource = await waitForPost("resource");
		expect(
			worker().postMessage.mock.calls.filter(([message]) => message.type === "resource"),
		).toHaveLength(1);
		worker().emit({
			id: resource.id,
			result: { data: new Uint8Array([1]).buffer, mime: "font/woff" },
			type: "resource-result",
		});

		await lookup;
		expect(resourceUrls).toEqual(["blob:shared", "blob:shared", "blob:shared", "blob:shared"]);
		expect(create).toHaveBeenCalledOnce();
		dictionary.close();
		expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:shared");
	});

	it("does not answer a worker read after closing while the package read is pending", async () => {
		const pendingRead = deferred<Uint8Array>();
		const readFile = vi.fn(() => pendingRead.promise);
		const packageReader = reader({ readFile });
		mocks.openCompiledPackage.mockResolvedValue(packageReader);
		const dictionary = source();
		const lookup = dictionary.lookup({ text: "word" });
		await waitForPost("open");
		worker().emit({ id: 91, path: "resource.bin", type: "read" });
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
		dictionary.close();
		pendingRead.resolve(new Uint8Array([1]));
		await Promise.resolve();
		await Promise.resolve();

		expect(
			worker().postMessage.mock.calls.some(([message]) => message.type === "read-result"),
		).toBe(false);
		await expect(lookup).rejects.toMatchObject({ code: "request" });
	});
});
