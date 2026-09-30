import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DICTIONARY_SETTINGS } from "../../domain/configuration";
import { dictionaryStrings } from "../../strings/dictionary";
import {
	buildDictionarySettingsViewModel,
	type DictionarySettingsEditorActions,
	type DictionarySettingsEditorState,
} from "../viewModel";

function setup() {
	const state: DictionarySettingsEditorState = {
		settings: structuredClone(DEFAULT_DICTIONARY_SETTINGS),
		aiSnapshot: {
			settings: {
				configs: [
					{
						id: "engine",
						name: "Favorite engine",
						provider: "deepseek",
						baseUrl: "https://api.deepseek.com",
						secretId: "key",
						model: "deepseek-chat",
					},
				],
				defaultConfigId: "engine",
			},
			models: {},
			loadingModels: [],
			testing: [],
		},
		localDictionaries: [],
		compiledStatus: {},
		desktop: true,
		importing: false,
		saving: false,
		testing: false,
	};
	const actions: DictionarySettingsEditorActions = {
		setEnabled: vi.fn(),
		setFavoritePath: vi.fn(),
		setFavoriteAiConfigId: vi.fn(),
		setYoudaoAccessMode: vi.fn(),
		setYoudaoDictionary: vi.fn(),
		setYoudaoSecretId: vi.fn(),
		testYoudao: vi.fn(),
		moveSource: vi.fn(),
		toggleSource: vi.fn(),
		setAiConfigId: vi.fn(),
		pickLocalDictionaryFiles: vi.fn(),
		pickLocalDictionaryFolder: vi.fn(),
		deleteLocalDictionary: vi.fn(),
	};
	return { state, actions };
}

function favoriteSelect(
	state: DictionarySettingsEditorState,
	actions: DictionarySettingsEditorActions,
) {
	const presentation = buildDictionarySettingsViewModel(state, actions, "en");
	const row = presentation.snapshot.groups
		.flatMap((group) => group.rows)
		.find((item) => item.name === dictionaryStrings("en").favoriteAiEngine);
	const select = row?.controls[0];
	if (select?.kind !== "select") throw new Error("Expected favorite engine select");
	return { presentation, select };
}

describe("favorite words AI settings", () => {
	it("keeps an unset favorite engine independent of dictionary and default engines", () => {
		const { state, actions } = setup();
		state.settings.ai.configId = "engine";
		state.settings.favoriteAiConfigId = null;
		const { select } = favoriteSelect(state, actions);
		expect(select.value).toBe("");
		expect(select.options).toEqual([
			{ value: "", label: "Not configured" },
			{ value: "engine", label: "Favorite engine" },
		]);
	});

	it("retains a missing configuration and lets the user clear it with no available engines", async () => {
		const { state, actions } = setup();
		state.settings.favoriteAiConfigId = "deleted";
		state.aiSnapshot = {
			...state.aiSnapshot,
			settings: { ...state.aiSnapshot.settings, configs: [] },
		};
		const { presentation, select } = favoriteSelect(state, actions);
		expect(select.value).toBe("deleted");
		expect(select.options).toContainEqual({
			value: "deleted",
			label: "Missing configuration (deleted)",
		});
		expect(select.disabled).toBe(false);
		await presentation.invoke({ action: select.action, value: "" });
		expect(actions.setFavoriteAiConfigId).toHaveBeenCalledWith(null);
		expect(actions.setAiConfigId).not.toHaveBeenCalled();
	});

	it("dispatches a selected engine and disables selection during saving", async () => {
		const { state, actions } = setup();
		const { presentation, select } = favoriteSelect(state, actions);
		await presentation.invoke({ action: select.action, value: "engine" });
		expect(actions.setFavoriteAiConfigId).toHaveBeenCalledWith("engine");
		state.saving = true;
		expect(favoriteSelect(state, actions).select.disabled).toBe(true);
	});
});
