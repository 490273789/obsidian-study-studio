import { describe, expect, it, vi } from "vite-plus/test";
import { commitLocalCatalogTransaction } from "../local-catalog-transaction";
import type {
	DictionarySettings,
	DictionarySettingsStore,
	LocalDictionaryAdministrationState,
} from "../types";

const before: LocalDictionaryAdministrationState = {
	localDictionaries: [],
	sources: [{ enabled: true, id: "youdao", kind: "youdao", label: "Youdao" }],
};
const next: LocalDictionaryAdministrationState = {
	...before,
	sources: [...before.sources, { enabled: true, id: "local", kind: "local", label: "Local" }],
};

function settingsStore(save: () => Promise<void>) {
	let state = structuredClone(before);
	const saveMock = vi.fn(save);
	const store: DictionarySettingsStore = {
		getDictionarySettings: () => ({}) as Readonly<DictionarySettings>,
		getLocalDictionaryAdministrationState: () => state,
		setLocalDictionaryAdministrationState: (value) => {
			state = structuredClone(value);
		},
		save: saveMock,
		updateDictionarySettings: async () => true,
	};
	return { state: () => state, store, save: saveMock };
}

function stage(options: { commit?: () => Promise<void>; rollback?: () => Promise<void> } = {}) {
	return {
		commit: vi.fn(options.commit ?? (async () => undefined)),
		rollback: vi.fn(options.rollback ?? (async () => undefined)),
	};
}

describe("local catalog transaction", () => {
	it("persists the next catalog before committing the staged sources", async () => {
		const s = settingsStore(async () => undefined);
		const staged = stage();
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(staged.commit).toHaveBeenCalledOnce();
		expect(staged.rollback).not.toHaveBeenCalled();
		expect(s.state()).toEqual(next);
	});

	it("restores the previous catalog and rolls back when persistence fails", async () => {
		const s = settingsStore(async () => {
			throw new Error("save failed");
		});
		const staged = stage();
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({
			kind: "failed",
			code: "persistence-failed",
			recovery: "complete",
		});
		expect(staged.rollback).toHaveBeenCalledOnce();
		expect(staged.commit).not.toHaveBeenCalled();
		expect(s.state()).toEqual(before);
	});

	it("reports recovery-incomplete when the persistence rollback fails", async () => {
		const s = settingsStore(async () => {
			throw new Error("save failed");
		});
		const staged = stage({
			rollback: async () => {
				throw new Error("rollback failed");
			},
		});
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({
			kind: "failed",
			code: "recovery-incomplete",
			recovery: "incomplete",
		});
	});

	it("rolls back and restores the catalog when commit fails", async () => {
		const s = settingsStore(async () => undefined);
		const staged = stage({
			commit: async () => {
				throw new Error("commit failed");
			},
		});
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({
			kind: "failed",
			code: "storage-failed",
			recovery: "complete",
		});
		expect(staged.rollback).toHaveBeenCalledOnce();
		expect(s.save).toHaveBeenCalledTimes(2);
		expect(s.state()).toEqual(before);
	});

	it("reports recovery-incomplete when a failed commit cannot roll back", async () => {
		const s = settingsStore(async () => undefined);
		const staged = stage({
			commit: async () => {
				throw new Error("commit failed");
			},
			rollback: async () => {
				throw new Error("rollback failed");
			},
		});
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({
			kind: "failed",
			code: "recovery-incomplete",
			recovery: "incomplete",
		});
	});

	it("reports recovery-incomplete when restoring the catalog after a failed commit cannot persist", async () => {
		let saves = 0;
		const s = settingsStore(async () => {
			saves += 1;
			if (saves === 2) throw new Error("restore save failed");
		});
		const staged = stage({
			commit: async () => {
				throw new Error("commit failed");
			},
		});
		const outcome = await commitLocalCatalogTransaction({
			settings: s.store,
			before,
			next,
			stage: staged,
		});

		expect(outcome).toEqual({
			kind: "failed",
			code: "recovery-incomplete",
			recovery: "incomplete",
		});
	});
});
