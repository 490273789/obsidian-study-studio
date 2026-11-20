import { expect, it, vi } from "vite-plus/test";
import type { AiService } from "../../../../core/ai";
import { DEFAULT_DICTIONARY_SETTINGS } from "../../domain/configuration";
import type { DictionaryRuntime } from "../../domain/dictionaryRuntime";
import type { DictionarySettings } from "../../domain/types";
import { DictionarySettingsEditor } from "../settingsEditor";

vi.mock("obsidian", () => ({
	Platform: { isDesktopApp: true },
	Modal: class {},
	AbstractInputSuggest: class {},
}));

it.each([
	{ removed: "youdao", expected: ["hujiang", "cambridge", "ai"] },
	{ removed: "hujiang", expected: ["youdao", "cambridge", "ai"] },
])("applies a displayed move after the queue removes $removed", async ({ removed, expected }) => {
	const displayed = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
	const current = structuredClone(displayed);
	const runtime = {
		settings: { getDictionarySettings: () => displayed },
		administration: { list: () => [] },
		updateSettings: async (mutate: (draft: DictionarySettings) => void) => {
			current.sources = current.sources.filter((source) => source.id !== removed);
			mutate(current);
			return true;
		},
	} as unknown as DictionaryRuntime;
	const ai = {
		getSnapshot: () => ({ settings: { engines: [] } }),
	} as unknown as AiService;
	const editor = new DictionarySettingsEditor(
		runtime,
		ai,
		() => "en",
		() => {},
	);
	const presentation = editor.presentation();
	const control = presentation.snapshot.groups
		.flatMap((group) => group.rows)
		.flatMap((row) => row.controls)
		.find((item) => item.kind === "reorderable");
	if (control?.kind !== "reorderable") throw new Error("Expected reorderable source list");

	await presentation.invoke({ action: control.moveAction, value: { fromIndex: 1, toIndex: 2 } });
	expect(current.sources.map((source) => source.id)).toEqual(expected);
});
