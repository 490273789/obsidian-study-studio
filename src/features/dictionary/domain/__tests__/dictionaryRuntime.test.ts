import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DictionaryRuntime } from "../dictionaryRuntime";
import { DEFAULT_DICTIONARY_SETTINGS } from "../configuration";
import type { DictionarySettingsStore } from "../types";

vi.mock("../compiled-source", () => ({ CompiledDictionarySource: class {} }));
vi.mock("../importer", () => ({ LocalDictionaryImporter: class {} }));
vi.mock("../local-administration", () => ({
	LocalDictionaryAdministrationModule: class {
		cancelActiveOperations() {}
	},
}));
vi.mock("../favorite-controller", () => ({
	DictionaryFavoriteController: class {
		refreshSettings() {}
		dispose() {}
	},
}));
const lookup = vi.hoisted(() => vi.fn());
vi.mock("../cambridge", () => ({
	CambridgeDictionarySource: class {
		lookup = lookup;
	},
}));
afterEach(() => vi.restoreAllMocks());

describe("dictionary selection settings", () => {
	it("copies source configuration once and preserves isolated settings with live history", async () => {
		let dictionary = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
		dictionary.sources = [
			{ id: "first", kind: "cambridge", label: "First", enabled: true },
			{ id: "second", kind: "cambridge", label: "Second", enabled: true },
		];
		let release!: () => void;
		const saving = new Promise<void>((resolve) => {
			release = resolve;
		});
		const store: DictionarySettingsStore = {
			getDictionarySettings: () => dictionary,
			updateDictionarySettings: async (mutate) => {
				await saving;
				const draft = structuredClone(dictionary);
				mutate(draft);
				dictionary = draft;
				return true;
			},
			getLocalDictionaryAdministrationState: () => dictionary,
			setLocalDictionaryAdministrationState: () => {},
			save: async () => {},
		};
		lookup.mockImplementation(async ({ text }: { text: string }) => ({
			word: text,
			sourceId: "first",
			sourceLabel: "First",
			attribution: "",
			pronunciations: [],
			sections: [],
			suggestions: [],
		}));
		const runtime = new DictionaryRuntime({
			settings: store,
			language: () => "zh",
			notify: vi.fn(),
			app: { vault: { configDir: ".obsidian" } },
			plugin: { manifest: { id: "test" } },
			ai: { subscribe: () => () => {} },
			net: {},
		} as never);
		const clone = vi.spyOn(globalThis, "structuredClone");
		const session = runtime.createSelectionLookupSession("word", [
			"second",
			"first",
			"second",
			"missing",
		])!;
		expect(dictionary.sources.map((source) => source.id)).toEqual(["first", "second"]);
		// A committed catalog change must not retarget this already accepted lookup.
		dictionary.sources[0]!.label = "Changed";
		dictionary.sources[0]!.enabled = false;
		dictionary.history = ["external"];
		release();
		await vi.waitFor(() => expect(session.getSnapshot().status).toBe("ready"));
		expect(session.getSnapshot().sources.map((source) => source.id)).toEqual([
			"second",
			"first",
		]);
		await session.send({ type: "settings-changed" });
		expect(session.getSnapshot().sources.map((source) => source.label)).toEqual([
			"Second",
			"First",
		]);
		expect(session.getSnapshot().history).toEqual(["word", "external"]);
		console.info(
			`dictionary selection benchmark: two sources + refresh: ${clone.mock.calls.length} structuredClone calls (includes 1 history persistence clone)`,
		);
		expect(clone.mock.calls.length).toBe(2);
		clone.mockRestore();
		session.dispose();
		runtime.dispose();
	});
});
