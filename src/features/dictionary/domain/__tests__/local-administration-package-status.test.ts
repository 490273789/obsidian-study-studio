import type { DataAdapter } from "obsidian";
import { describe, expect, it, vi } from "vite-plus/test";
import {
	describeCompiledPackage,
	parseCompiledPackageManifest,
} from "../compiled-package/manifest";
import { LocalDictionaryAdministrationModule } from "../local-administration";
import type { LocalDictionaryStorageAdapter } from "../local-storage";
import type {
	CompiledDictionarySettings,
	DictionarySettingsStore,
	LocalDictionaryAdministrationState,
	LocalDictionarySettings,
} from "../types";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

async function finishAdapterMicrotasks(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function packageFixture(): Promise<{
	readonly bytes: Uint8Array;
	readonly compiled: CompiledDictionarySettings;
}> {
	const bytes = new TextEncoder().encode(
		JSON.stringify({
			engineVersion: "2.0.6",
			entryCount: 1,
			files: { "blocks/data.bin": { sha256: "a".repeat(64), size: 1 } },
			formatVersion: 2,
			indexes: [],
			recordFrames: [],
			resources: [],
			sources: [],
		}),
	);
	const facts = await describeCompiledPackage(bytes, parseCompiledPackageManifest(bytes));
	const { manifest: _manifest, ...compiled } = facts;
	return { bytes, compiled };
}

function local(compiled: CompiledDictionarySettings): LocalDictionarySettings {
	return {
		compiled,
		directory: "sample",
		files: [{ name: "sample.mdx", size: 1 }],
		id: "sample",
		name: "Sample",
	};
}

function setup(
	compiled: CompiledDictionarySettings,
	bytes: Uint8Array,
	stat: (path: string) => Promise<{ size: number } | null>,
) {
	let state: LocalDictionaryAdministrationState = {
		localDictionaries: [local(compiled)],
		sources: [{ enabled: true, id: "sample", kind: "local", label: "Sample" }],
	};
	const settings = {
		getLocalDictionaryAdministrationState: () => state,
	} as DictionarySettingsStore;
	const adapter = {
		stat,
		readBinary: async () => bytes.slice().buffer,
	} as unknown as DataAdapter;
	const storage = { cancelActive: () => undefined } as LocalDictionaryStorageAdapter;
	const administration = new LocalDictionaryAdministrationModule(settings, storage, undefined, {
		adapter,
		dictionaryRoot: "dictionaries",
	});
	return {
		administration,
		setCatalog: (dictionaries: LocalDictionarySettings[]) => {
			state = { localDictionaries: dictionaries, sources: state.sources };
		},
	};
}

describe("local dictionary compiled sync inspection", () => {
	it("reports checking and then the verified package status through the catalog snapshot", async () => {
		const { bytes, compiled } = await packageFixture();
		const manifest = deferred<{ size: number } | null>();
		const stat = vi.fn((path: string) =>
			path.endsWith("manifest.json") ? manifest.promise : Promise.resolve({ size: 1 }),
		);
		const { administration } = setup(compiled, bytes, stat);
		const changed = vi.fn();
		const release = administration.watchCompiledPackages(changed);
		expect(administration.list()[0]?.compiledSyncStatus).toBe("checking");
		manifest.resolve({ size: bytes.length });
		await vi.waitFor(() => expect(administration.list()[0]?.compiledSyncStatus).toBe("ready"));
		expect(stat).toHaveBeenCalledWith("dictionaries/sample/compiled-v2/manifest.json");
		expect(changed).toHaveBeenCalled();
		release();
	});

	it.each([
		[null, "incomplete"],
		[{ size: 2 }, "corrupt"],
	] as const)("maps an absent or wrong-size package file to %s", async (file, expected) => {
		const { bytes, compiled } = await packageFixture();
		const { administration } = setup(compiled, bytes, async (path) =>
			path.endsWith("manifest.json") ? { size: bytes.length } : file,
		);
		const release = administration.watchCompiledPackages(() => undefined);
		await vi.waitFor(() => expect(administration.list()[0]?.compiledSyncStatus).toBe(expected));
		release();
	});

	it("rechecks on reopening and ignores a completion from the previous settings lease", async () => {
		const { bytes, compiled } = await packageFixture();
		const firstManifest = deferred<{ size: number } | null>();
		let manifestReads = 0;
		const { administration } = setup(compiled, bytes, async (path) => {
			if (!path.endsWith("manifest.json")) return { size: 1 };
			manifestReads += 1;
			return manifestReads === 1 ? firstManifest.promise : { size: bytes.length };
		});
		const releaseFirst = administration.watchCompiledPackages(() => undefined);
		releaseFirst();
		const releaseSecond = administration.watchCompiledPackages(() => undefined);
		await vi.waitFor(() => expect(administration.list()[0]?.compiledSyncStatus).toBe("ready"));
		firstManifest.resolve(null);
		await finishAdapterMicrotasks();
		expect(administration.list()[0]?.compiledSyncStatus).toBe("ready");
		expect(manifestReads).toBe(2);
		releaseSecond();
	});

	it("restarts for changed package identity and discards removed dictionary results", async () => {
		const { bytes, compiled } = await packageFixture();
		const firstManifest = deferred<{ size: number } | null>();
		const thirdManifest = deferred<{ size: number } | null>();
		let manifestReads = 0;
		const { administration, setCatalog } = setup(compiled, bytes, async (path) => {
			if (!path.endsWith("manifest.json")) return { size: 1 };
			manifestReads += 1;
			if (manifestReads === 1) return firstManifest.promise;
			if (manifestReads === 3) return thirdManifest.promise;
			return { size: bytes.length };
		});
		const release = administration.watchCompiledPackages(() => undefined);
		setCatalog([local({ ...compiled, manifestSha256: "b".repeat(64) })]);
		await administration.refreshCatalog();
		await vi.waitFor(() =>
			expect(administration.list()[0]?.compiledSyncStatus).toBe("corrupt"),
		);
		firstManifest.resolve(null);
		await finishAdapterMicrotasks();
		expect(administration.list()[0]?.compiledSyncStatus).toBe("corrupt");
		setCatalog([local({ ...compiled, manifestSha256: "c".repeat(64) })]);
		await administration.refreshCatalog();
		expect(administration.list()[0]?.compiledSyncStatus).toBe("checking");
		setCatalog([]);
		await administration.refreshCatalog();
		thirdManifest.resolve({ size: bytes.length });
		await finishAdapterMicrotasks();
		expect(administration.list()).toEqual([]);
		release();
	});

	it("waits for a catalog transaction before reconciling a settings notification", async () => {
		const { compiled } = await packageFixture();
		const enteredSave = deferred<void>();
		const finishSave = deferred<void>();
		let state: LocalDictionaryAdministrationState = {
			localDictionaries: [local(compiled)],
			sources: [{ enabled: true, id: "sample", kind: "local", label: "Sample" }],
		};
		const settings = {
			getLocalDictionaryAdministrationState: () => state,
			updateDictionarySettings: async (
				mutate: (draft: LocalDictionaryAdministrationState) => void,
			) => {
				enteredSave.resolve();
				await finishSave.promise;
				const next = structuredClone(state);
				mutate(next);
				state = next;
				return true;
			},
		} as unknown as DictionarySettingsStore;
		const administration = new LocalDictionaryAdministrationModule(settings, {
			cancelActive: () => undefined,
		} as LocalDictionaryStorageAdapter);
		const rename = administration.rename("sample", "Renamed");
		await enteredSave.promise;
		let refreshed = false;
		const refresh = administration.refreshCatalog().then(() => {
			refreshed = true;
		});
		await Promise.resolve();
		expect(refreshed).toBe(false);
		expect(administration.list()[0]?.name).toBe("Sample");
		finishSave.resolve();
		expect((await rename).ok).toBe(true);
		await refresh;
		expect(administration.list()[0]?.name).toBe("Renamed");
	});
});
