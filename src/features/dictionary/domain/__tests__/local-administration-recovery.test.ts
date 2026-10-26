import { describe, expect, it, vi } from "vite-plus/test";
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
			favoriteCategories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedFavoriteCategoryId: "default",
			favoriteOpenMode: "modal",
			favoriteAiConfigId: null,
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

	async updateDictionarySettings(mutate: (draft: DictionarySettings) => void): Promise<boolean> {
		const draft = structuredClone(this.getDictionarySettings()) as DictionarySettings;
		mutate(draft);
		try {
			await this.saveAction();
		} catch {
			return false;
		}
		this.state = {
			localDictionaries: draft.localDictionaries,
			sources: draft.sources,
		};
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
	readonly stageRemoval = vi.fn(this.stageRemovalNow.bind(this));
	cancelActive(): void {}

	constructor(
		private readonly stageImportNow: (
			imports: readonly LocalDictionaryStorageImport[],
			onProgress?: LocalDictionaryStorageProgressListener,
			signal?: AbortSignal,
		) => Promise<LocalDictionaryStorageImportTransaction>,
		private readonly stageRemovalNow = async (): Promise<LocalDictionaryStorageRemoval> => {
			throw new Error("Unexpected removal");
		},
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

	it("turns an import commit failure into a storage failure and restores the catalog", async () => {
		const before = initialState();
		const settings = new FakeSettingsStore(before);
		const rollback = vi.fn(async () => undefined);
		const storage = new FakeStorageAdapter(async (imports) =>
			transaction(
				packageFor(imports),
				rollback,
				vi.fn(async () => {
					throw new Error("commit failed");
				}),
			),
		);
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		expect(await administration.importFiles([file()])).toMatchObject({
			error: { code: "storage-failed", recovery: "complete" },
			ok: false,
		});
		expect(rollback).toHaveBeenCalledOnce();
		expect(settings.save).toHaveBeenCalledTimes(2);
		expectUnchanged(settings, before);
	});

	it("latches degraded state when import commit and rollback both fail", async () => {
		const storage = new FakeStorageAdapter(async (imports) =>
			transaction(
				packageFor(imports),
				vi.fn(async () => {
					throw new Error("rollback failed");
				}),
				vi.fn(async () => {
					throw new Error("commit failed");
				}),
			),
		);
		const administration = new LocalDictionaryAdministrationModule(
			new FakeSettingsStore(),
			storage,
		);

		expect(await administration.importFiles([file()])).toMatchObject({
			error: { code: "recovery-incomplete", recovery: "incomplete" },
			ok: false,
		});
		expect(await administration.importFiles([file("retry.eudic")])).toMatchObject({
			error: { code: "recovery-incomplete", recovery: "incomplete" },
			ok: false,
		});
	});

	it("turns a remove commit failure into a storage failure and restores the catalog", async () => {
		const before = initialState();
		const settings = new FakeSettingsStore(before);
		const rollback = vi.fn(async () => undefined);
		const storage = new FakeStorageAdapter(
			async () => {
				throw new Error("Unexpected import");
			},
			async () => ({
				commit: async () => {
					throw new Error("commit failed");
				},
				rollback,
			}),
		);
		const administration = new LocalDictionaryAdministrationModule(settings, storage);

		expect(await administration.remove("old-dictionary")).toMatchObject({
			error: { code: "storage-failed", recovery: "complete" },
			ok: false,
		});
		expect(rollback).toHaveBeenCalledOnce();
		expect(settings.save).toHaveBeenCalledTimes(2);
		expectUnchanged(settings, before);
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

describe("local dictionary rename", () => {
	const storage = () =>
		new FakeStorageAdapter(async () => {
			throw new Error("Rename must not stage files");
		});

	it("persists the display name and lookup source label without changing identity or files", async () => {
		const before = initialState();
		const settings = new FakeSettingsStore(before);
		const files = storage();
		const invalidate = vi.fn();
		const administration = new LocalDictionaryAdministrationModule(settings, files, invalidate);

		const result = await administration.rename("old-dictionary", "  我的英语词典  ");

		expect(result).toMatchObject({ ok: true });
		expect(administration.list()[0]).toMatchObject({
			id: "old-dictionary",
			name: "我的英语词典",
			files: before.localDictionaries[0]?.files,
		});
		expect(settings.getDictionarySettings().sources[1]).toMatchObject({
			enabled: true,
			id: "old-dictionary",
			label: "我的英语词典",
		});
		expect(invalidate).toHaveBeenCalledOnce();
		expect(files.stageImport).not.toHaveBeenCalled();
		expect(files.stageRemoval).not.toHaveBeenCalled();
	});

	it("rejects empty and missing names without changing the catalog", async () => {
		const settings = new FakeSettingsStore();
		const administration = new LocalDictionaryAdministrationModule(settings, storage());

		expect(await administration.rename("old-dictionary", "  ")).toMatchObject({
			ok: false,
			error: { code: "invalid-selection" },
		});
		expect(await administration.rename("missing", "Other")).toMatchObject({
			ok: false,
			error: { code: "not-found" },
		});
		expect(settings.getDictionarySettings().localDictionaries[0]?.name).toBe("Old dictionary");
	});

	it("keeps the original name and snapshot when saving fails", async () => {
		const settings = new FakeSettingsStore(initialState(), async () => {
			throw new Error("save failed");
		});
		const invalidate = vi.fn();
		const administration = new LocalDictionaryAdministrationModule(
			settings,
			storage(),
			invalidate,
		);

		expect(await administration.rename("old-dictionary", "Other")).toMatchObject({
			ok: false,
			error: { code: "persistence-failed" },
		});
		expect(administration.list()[0]?.name).toBe("Old dictionary");
		expect(settings.getDictionarySettings().sources[1]?.label).toBe("Old dictionary");
		expect(invalidate).not.toHaveBeenCalled();
	});
});
