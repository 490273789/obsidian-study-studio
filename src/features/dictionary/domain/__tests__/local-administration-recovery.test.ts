import { describe, expect, it, vi } from "vitest";
import {
	LocalDictionaryAdministrationModule,
	type LocalDictionarySnapshot,
} from "../local-administration";
import {
	LocalDictionaryStorageError,
	type LocalDictionaryStorageAdapter,
	type LocalDictionaryStorageImport,
	type LocalDictionaryStorageImportTransaction,
	type LocalDictionaryStorageProgressListener,
	type LocalDictionaryStorageRemoval,
} from "../local-storage";
import type {
	CompiledDictionarySettings,
	DictionarySettings,
	DictionarySettingsStore,
	LocalDictionaryAdministrationState,
	LocalDictionarySettings,
} from "../types";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

const compiled: CompiledDictionarySettings = {
	engineVersion: "2.0.6",
	entryCount: 1,
	fileCount: 1,
	formatVersion: 2,
	manifestPath: "compiled-v2/manifest.json",
	manifestSha256: "manifest",
	sourceFingerprint: "source",
	totalBytes: 1,
};

function file(name = "new.eudic"): File {
	return { name, size: 1 } as File;
}

function localDictionary(id = "old-dictionary"): LocalDictionarySettings {
	return {
		compiled: { ...compiled },
		directory: id,
		files: [{ name: `${id}.eudic`, size: 1 }],
		id,
		name: "Old dictionary",
	};
}

function initialState(): LocalDictionaryAdministrationState {
	const dictionary = localDictionary();
	return {
		localDictionaries: [dictionary],
		sources: [
			{ enabled: true, id: "youdao", kind: "youdao", label: "Youdao" },
			{ enabled: true, id: dictionary.id, kind: "local", label: dictionary.name },
		],
	};
}

class FakeSettingsStore implements DictionarySettingsStore {
	readonly setStates: LocalDictionaryAdministrationState[] = [];
	readonly save = vi.fn(async () => this.saveAction());
	private state: LocalDictionaryAdministrationState;

	constructor(
		state: LocalDictionaryAdministrationState = initialState(),
		private readonly saveAction: () => Promise<void> = async () => undefined,
	) {
		this.state = structuredClone(state);
	}

	getDictionarySettings(): Readonly<DictionarySettings> {
		return {
			ai: { configId: null },
			enabled: true,
			favoritePath: "",
			history: [],
			localDictionaries: this.state.localDictionaries,
			sources: this.state.sources,
			youdao: {
				accessMode: "official",
				appKeySecretId: "",
				appSecretSecretId: "",
				dictionaries: [],
			},
		};
	}

	async updateDictionarySettings(): Promise<boolean> {
		return true;
	}

	getLocalDictionaryAdministrationState(): Readonly<LocalDictionaryAdministrationState> {
		return this.state;
	}

	setLocalDictionaryAdministrationState(state: LocalDictionaryAdministrationState): void {
		this.state = structuredClone(state);
		this.setStates.push(structuredClone(state));
	}
}

class FakeStorageAdapter implements LocalDictionaryStorageAdapter {
	readonly stageImport = vi.fn(this.stageImportNow.bind(this));
	readonly stageRemoval = vi.fn(async (): Promise<LocalDictionaryStorageRemoval> => {
		throw new Error("Unexpected removal");
	});
	cancelActive(): void {}

	constructor(
		private readonly stageImportNow: (
			imports: readonly LocalDictionaryStorageImport[],
			onProgress?: LocalDictionaryStorageProgressListener,
			signal?: AbortSignal,
		) => Promise<LocalDictionaryStorageImportTransaction>,
	) {}
}

function transaction(
	packages: LocalDictionaryStorageImportTransaction["packages"],
	rollback = vi.fn(async () => undefined),
	commit = vi.fn(),
): LocalDictionaryStorageImportTransaction {
	return { commit, packages, rollback };
}

function packageFor(imports: readonly LocalDictionaryStorageImport[]) {
	return imports.map((item) => ({ compiled: { ...compiled }, id: item.id }));
}

function expectUnchanged(
	settings: FakeSettingsStore,
	before: LocalDictionaryAdministrationState,
): void {
	expect(settings.getLocalDictionaryAdministrationState()).toEqual(before);
	expect(settings.getLocalDictionaryAdministrationState().sources).toEqual(before.sources);
}

describe("LocalDictionaryAdministrationModule import recovery", () => {
	it("restores the previous catalog and sources, then rolls back when settings persistence fails", async () => {
		const before = initialState();
		const rollback = vi.fn(async () => undefined);
		const settings = new FakeSettingsStore(before, async () => {
			throw new Error("save failed");
		});
		const storage = new FakeStorageAdapter(async (imports) =>
			transaction(packageFor(imports), rollback),
		);
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		const result = await administration.importFiles([file()]);

		expect(result).toMatchObject({
			error: { code: "persistence-failed", recovery: "complete" },
			ok: false,
		});
		expect(rollback).toHaveBeenCalledOnce();
		expect(settings.setStates).toHaveLength(2);
		expect(settings.setStates[0]?.localDictionaries).toHaveLength(2);
		expectUnchanged(settings, before);
		expect(administration.list()).toEqual<LocalDictionarySnapshot>([
			expect.objectContaining({ id: "old-dictionary" }),
		]);
	});

	it("enters recovery-incomplete mode when rollback after a failed save also fails", async () => {
		const rollback = vi.fn(async () => {
			throw new Error("rollback failed");
		});
		const settings = new FakeSettingsStore(initialState(), async () => {
			throw new Error("save failed");
		});
		const storage = new FakeStorageAdapter(async (imports) =>
			transaction(packageFor(imports), rollback),
		);
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		expect(await administration.importFiles([file()])).toMatchObject({
			error: { code: "recovery-incomplete", recovery: "incomplete" },
			ok: false,
		});
		expect(await administration.importFiles([file("retry.eudic")])).toMatchObject({
			error: { code: "recovery-incomplete", recovery: "incomplete" },
			ok: false,
		});
		expect(await administration.remove("old-dictionary")).toMatchObject({
			error: { code: "recovery-incomplete", recovery: "incomplete" },
			ok: false,
		});
		expect(storage.stageImport).toHaveBeenCalledOnce();
		expect(storage.stageRemoval).not.toHaveBeenCalled();
	});

	it("does not alter the catalog when staging is cancelled, and retries a collision with a fresh plan", async () => {
		const before = initialState();
		let calls = 0;
		const settings = new FakeSettingsStore(before);
		const storage = new FakeStorageAdapter(async (imports) => {
			calls += 1;
			if (calls === 1) throw new LocalDictionaryStorageError("cancelled");
			if (calls === 2) {
				expectUnchanged(settings, before);
				throw new LocalDictionaryStorageError("collision");
			}
			return transaction(packageFor(imports));
		});
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		expect(await administration.importFiles([file()])).toMatchObject({
			error: { code: "cancelled", recovery: "complete" },
			ok: false,
		});
		expectUnchanged(settings, before);

		const result = await administration.importFiles([file("retry.eudic")]);

		expect(result.ok).toBe(true);
		expect(storage.stageImport).toHaveBeenCalledTimes(3);
		const [collisionPlan, retryPlan] = storage.stageImport.mock.calls.slice(1);
		expect(collisionPlan?.[0]?.[0]?.id).not.toBe(retryPlan?.[0]?.[0]?.id);
		expect(settings.getLocalDictionaryAdministrationState().localDictionaries).toHaveLength(2);
	});

	it("commits staging only after settings save succeeds", async () => {
		let committed = false;
		const commit = vi.fn(() => {
			committed = true;
		});
		const settings = new FakeSettingsStore(initialState(), async () => {
			expect(committed).toBe(false);
		});
		const storage = new FakeStorageAdapter(async (imports) =>
			transaction(
				packageFor(imports),
				vi.fn(async () => undefined),
				commit,
			),
		);
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		const result = await administration.importFiles([file()]);

		expect(result.ok).toBe(true);
		expect(settings.save).toHaveBeenCalledOnce();
		expect(commit).toHaveBeenCalledOnce();
	});

	it("rolls back staged output and preserves the catalog when the package list is malformed", async () => {
		const before = initialState();
		const rollback = vi.fn(async () => undefined);
		const settings = new FakeSettingsStore(before);
		const storage = new FakeStorageAdapter(async () => transaction([], rollback));
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		const result = await administration.importFiles([file()]);

		expect(result).toMatchObject({
			error: { code: "storage-failed", recovery: "complete" },
			ok: false,
		});
		expect(rollback).toHaveBeenCalledOnce();
		expect(settings.save).not.toHaveBeenCalled();
		expect(settings.setStates).toHaveLength(0);
		expectUnchanged(settings, before);
	});
});
