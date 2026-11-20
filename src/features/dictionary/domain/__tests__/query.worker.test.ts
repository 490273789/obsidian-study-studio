import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CompiledDictionaryManifest } from "../compiled-package/internal";
import { DICTIONARY_ENGINE_VERSION } from "../compiled-package/internal";

vi.mock("../engine-loader", () => ({ ensureDictionaryEngine: async () => undefined }));
vi.mock("../engine/dictionary_engine.js", () => ({
	fst_exact: (_fst: Uint8Array, key: string) => (key === "𠀀" ? 0 : undefined),
	fst_fuzzy: () => "[]",
	fst_prefix: (_fst: Uint8Array, prefix: string) => JSON.stringify([`${prefix}𠀀`]),
	inflate_zlib: vi.fn(),
}));

interface Reply {
	id: number;
	type: string;
	path?: string;
	result?: unknown;
}

const manifest: CompiledDictionaryManifest = {
	engineVersion: DICTIONARY_ENGINE_VERSION,
	entryCount: 1,
	files: {},
	formatVersion: 2,
	indexes: [{ firstKey: "﨎", lastKey: "𠀀", fstFile: "keys", postingsFile: "postings" }],
	recordFrames: [],
	resources: [],
	sources: [],
};

let receive: (message: object) => void;
const postMessage = vi.fn<(message: Reply) => void>();

beforeEach(async () => {
	vi.resetModules();
	postMessage.mockClear();
	vi.stubGlobal("self", {
		addEventListener: (_type: string, listener: (event: { data: object }) => void) => {
			receive = (data) => listener({ data });
		},
		postMessage,
	});
	await import("../query.worker");
});

afterEach(() => vi.unstubAllGlobals());

function open(queryPlan = manifest): void {
	receive({ cacheBytes: 1024, dictionaryId: "dictionary", queryPlan, type: "open" });
}

function lookup(id: number, word: string): void {
	receive({ dictionaryId: "dictionary", id, type: "lookup", word });
}

function messages(type: string): Reply[] {
	return postMessage.mock.calls.map(([message]) => message).filter((item) => item.type === type);
}

async function flushQuery(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("compiled dictionary query worker", () => {
	it("routes supplementary CJK exact lookup to its Rust-ordered shard", async () => {
		open();
		lookup(100, "𠀀");
		await flushQuery();
		const read = messages("read")[0]!;
		expect(read.path).toBe("keys");
		receive({ data: new Uint8Array([1]).buffer, id: read.id, type: "read-result" });
		await flushQuery();
		expect(messages("read").map((message) => message.path)).toEqual(["keys", "postings"]);
	});

	it("finds supplementary prefix matches before falling back to fuzzy lookup", async () => {
		open({
			...manifest,
			indexes: [{ ...manifest.indexes[0]!, firstKey: "﨎𠀀", lastKey: "﨎𠀀" }],
		});
		lookup(100, "﨎");
		await flushQuery();
		const read = messages("read")[0]!;
		receive({ data: new Uint8Array([1]).buffer, id: read.id, type: "read-result" });
		await flushQuery();
		expect(messages("lookup-result")).toMatchObject([
			{ id: 100, result: { suggestions: ["﨎𠀀"] } },
		]);
	});

	it("cancels reads on close and starts a fresh read when the same dictionary reopens", async () => {
		open();
		lookup(100, "﨎");
		await flushQuery();
		expect(messages("read")).toHaveLength(1);

		receive({ dictionaryId: "dictionary", type: "close" });
		open();
		lookup(101, "﨎");
		await flushQuery();

		expect(messages("error")).toMatchObject([{ id: 100 }]);
		expect(messages("read")).toHaveLength(2);
		expect(messages("read")[1]?.id).not.toBe(messages("read")[0]?.id);
	});
});
