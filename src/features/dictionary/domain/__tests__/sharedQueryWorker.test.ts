import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
	class MockWorker {
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

		emitError(message: string): void {
			for (const listener of this.listeners.get("error") ?? [])
				listener({ message } as unknown as MessageEvent);
		}
	}
	return {
		MockWorker,
		workers: [] as MockWorker[],
	};
});

vi.mock("../dictionary.worker?worker&inline", () => ({ default: mocks.MockWorker }));

import {
	SharedDictionaryQueryWorker,
	resetSharedDictionaryQueryWorker,
} from "../sharedQueryWorker";

beforeEach(() => {
	mocks.workers.length = 0;
	resetSharedDictionaryQueryWorker();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SharedDictionaryQueryWorker", () => {
	it("lazily creates the worker on first usage, not on instantiation", () => {
		const manager = new SharedDictionaryQueryWorker();
		expect(mocks.workers).toHaveLength(0);
		expect(manager.activeWorkerCount).toBe(0);

		manager.register("dict1", { readPackageFile: vi.fn() });
		expect(mocks.workers).toHaveLength(0);

		manager.open("dict1", {} as never, 1024);
		expect(mocks.workers).toHaveLength(1);
		expect(manager.activeWorkerCount).toBe(1);
		expect(mocks.workers[0]!.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "open", dictionaryId: "dict1" }),
		);
	});

	it("multiplexes multiple dictionaries across a single shared worker", async () => {
		const manager = new SharedDictionaryQueryWorker();
		manager.register("dict1", { readPackageFile: vi.fn() });
		manager.register("dict2", { readPackageFile: vi.fn() });

		manager.open("dict1", {} as never, 1024);
		manager.open("dict2", {} as never, 2048);

		expect(mocks.workers).toHaveLength(1);
		const worker = mocks.workers[0]!;

		const lookup1 = manager.lookup("dict1", "apple");
		const lookup2 = manager.lookup("dict2", "banana");

		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "lookup", dictionaryId: "dict1", word: "apple" }),
		);
		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "lookup", dictionaryId: "dict2", word: "banana" }),
		);

		const calls = worker.postMessage.mock.calls;
		const call1 = calls.find(([m]) => m.type === "lookup" && m.dictionaryId === "dict1")![0];
		const call2 = calls.find(([m]) => m.type === "lookup" && m.dictionaryId === "dict2")![0];

		worker.emit({
			id: call1.id,
			type: "lookup-result",
			result: { definitions: [{ definition: "fruit", keyText: "apple" }], suggestions: [] },
		});
		worker.emit({
			id: call2.id,
			type: "lookup-result",
			result: { definitions: [{ definition: "yellow", keyText: "banana" }], suggestions: [] },
		});

		const res1 = await lookup1;
		const res2 = await lookup2;

		expect(res1.definitions[0]?.definition).toBe("fruit");
		expect(res2.definitions[0]?.definition).toBe("yellow");
	});

	it("unregisters a single dictionary without killing worker if others remain", async () => {
		const manager = new SharedDictionaryQueryWorker();
		manager.register("dict1", { readPackageFile: vi.fn() });
		manager.register("dict2", { readPackageFile: vi.fn() });
		manager.open("dict1", {} as never, 1024);
		manager.open("dict2", {} as never, 2048);

		const worker = mocks.workers[0]!;
		const pending1 = manager.lookup("dict1", "apple");

		manager.unregister("dict1");

		expect(worker.postMessage).toHaveBeenCalledWith({ type: "close", dictionaryId: "dict1" });
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(manager.registeredDictionaryCount).toBe(1);
		expect(manager.activeWorkerCount).toBe(1);

		await expect(pending1).rejects.toMatchObject({ code: "request" });

		// dict2 can still lookup
		const lookup2 = manager.lookup("dict2", "orange");
		const call2 = worker.postMessage.mock.calls.find(
			([m]) => m.type === "lookup" && m.dictionaryId === "dict2",
		)![0];
		worker.emit({
			id: call2.id,
			type: "lookup-result",
			result: { definitions: [], suggestions: ["orange"] },
		});
		const res2 = await lookup2;
		expect(res2.suggestions).toEqual(["orange"]);
	});

	it("terminates the worker when all dictionaries unregister and respawns on new demand", async () => {
		const manager = new SharedDictionaryQueryWorker();
		manager.register("dict1", { readPackageFile: vi.fn() });
		manager.open("dict1", {} as never, 1024);

		expect(mocks.workers).toHaveLength(1);
		const firstWorker = mocks.workers[0]!;

		manager.unregister("dict1");
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(manager.activeWorkerCount).toBe(0);

		// Now re-register and re-open
		manager.register("dict3", { readPackageFile: vi.fn() });
		manager.open("dict3", {} as never, 4096);

		expect(mocks.workers).toHaveLength(2);
		expect(manager.activeWorkerCount).toBe(1);
		const secondWorker = mocks.workers[1]!;
		expect(secondWorker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "open", dictionaryId: "dict3" }),
		);
	});

	it("routes package read requests from worker to the correct registered dictionary", async () => {
		const manager = new SharedDictionaryQueryWorker();
		const readFile1 = vi.fn(async () => new Uint8Array([1, 2, 3]));
		const readFile2 = vi.fn(async () => new Uint8Array([4, 5, 6]));

		manager.register("dict1", { readPackageFile: readFile1 });
		manager.register("dict2", { readPackageFile: readFile2 });
		manager.open("dict1", {} as never, 1024);

		const worker = mocks.workers[0]!;

		worker.emit({
			id: 77,
			type: "read",
			path: "dict1.bin",
			dictionaryId: "dict1",
		});

		await vi.waitFor(() => expect(readFile1).toHaveBeenCalledWith("dict1.bin"));
		expect(readFile2).not.toHaveBeenCalled();

		await vi.waitFor(() =>
			expect(worker.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ id: 77, type: "read-result", dictionaryId: "dict1" }),
				expect.any(Array),
			),
		);
	});

	it("handles worker error events by rejecting all pending requests", async () => {
		const manager = new SharedDictionaryQueryWorker();
		manager.register("dict1", { readPackageFile: vi.fn() });
		manager.open("dict1", {} as never, 1024);

		const worker = mocks.workers[0]!;
		const pending = manager.lookup("dict1", "apple");

		worker.emitError("WASM out of memory");

		await expect(pending).rejects.toMatchObject({
			code: "invalid-response",
			message: "WASM out of memory",
		});
	});
});
