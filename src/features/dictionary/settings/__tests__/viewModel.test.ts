import { describe, expect, it, vi } from "vite-plus/test";
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
		desktop: true,
		importing: false,
		saving: false,
		testing: false,
	};
	const actions: DictionarySettingsEditorActions = {
		setEnabled: vi.fn(),
		setFavoritePath: vi.fn(),
		setFavoriteOpenMode: vi.fn(),
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
		renameLocalDictionary: vi.fn(),
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

describe("favorite open mode settings", () => {
	it.each(["zh", "en"] as const)(
		"presents localized modal and sidebar options in %s",
		(language) => {
			const { state, actions } = setup();
			const t = dictionaryStrings(language);
			const presentation = buildDictionarySettingsViewModel(state, actions, language);
			const row = presentation.snapshot.groups
				.flatMap((group) => group.rows)
				.find((item) => item.name === t.favoriteOpenMode);
			const select = row?.controls[0];
			if (select?.kind !== "select") throw new Error("Expected favorite open mode select");
			expect(select.value).toBe("modal");
			expect(select.options).toEqual([
				{ value: "modal", label: t.favoriteOpenModeModal },
				{ value: "sidebar", label: t.favoriteOpenModeSidebar },
			]);
		},
	);

	it("dispatches selection and disables changes during saving", async () => {
		const { state, actions } = setup();
		state.settings.favoriteOpenMode = "sidebar";
		const presentation = buildDictionarySettingsViewModel(state, actions, "en");
		const findSelect = (model: ReturnType<typeof buildDictionarySettingsViewModel>) => {
			const row = model.snapshot.groups
				.flatMap((group) => group.rows)
				.find((item) => item.name === dictionaryStrings("en").favoriteOpenMode);
			const select = row?.controls[0];
			if (select?.kind !== "select") throw new Error("Expected favorite open mode select");
			return select;
		};
		const select = findSelect(presentation);
		expect(select.value).toBe("sidebar");
		await presentation.invoke({ action: select.action, value: "modal" });
		expect(actions.setFavoriteOpenMode).toHaveBeenCalledWith("modal");
		state.saving = true;
		expect(findSelect(buildDictionarySettingsViewModel(state, actions, "en")).disabled).toBe(
			true,
		);
	});
});

describe("local dictionary settings", () => {
	it("renders mobile package status in the current language", () => {
		const { state, actions } = setup();
		state.desktop = false;
		state.localDictionaries = [
			{
				compiled: {
					engineVersion: "2.0.6",
					entryCount: 1,
					fileCount: 2,
					formatVersion: 2,
					manifestPath: "compiled-v2/manifest.json",
					manifestSha256: "a".repeat(64),
					sourceFingerprint: "b".repeat(64),
					status: "ready",
					totalBytes: 1024,
				},
				compiledSyncStatus: "checking",
				files: [],
				id: "sample",
				name: "Sample",
				requiresReimport: false,
			},
		];
		const description = (language: "zh" | "en") =>
			buildDictionarySettingsViewModel(state, actions, language)
				.snapshot.groups.flatMap((group) => group.rows)
				.find((row) => row.name === "Sample")?.description;
		expect(description("zh")).toContain(dictionaryStrings("zh").compiledChecking);
		expect(description("en")).toContain(dictionaryStrings("en").compiledChecking);
		state.localDictionaries = [
			{ ...state.localDictionaries[0]!, compiledSyncStatus: "incomplete" },
		];
		expect(description("zh")).toContain(dictionaryStrings("zh").compiledIncomplete);
		expect(description("en")).toContain(dictionaryStrings("en").compiledIncomplete);
	});

	it("offers rename and delete actions for each imported desktop dictionary", async () => {
		const { state, actions } = setup();
		state.localDictionaries = [
			{
				files: [{ name: "sample.eudic", size: 1024 }],
				id: "sample",
				name: "Sample dictionary",
				requiresReimport: true,
			},
		];
		const presentation = buildDictionarySettingsViewModel(state, actions, "zh");
		const row = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.find((item) => item.name === "Sample dictionary");
		expect(row?.description).toContain("sample.eudic");
		const [rename, remove] = row?.controls ?? [];
		if (rename?.kind !== "button" || remove?.kind !== "button")
			throw new Error("Expected rename and delete buttons");
		expect(rename.label).toBe(dictionaryStrings("zh").localRename);
		expect(remove.label).toBe(dictionaryStrings("zh").localDelete);
		await presentation.invoke({ action: rename.action, value: undefined });
		expect(actions.renameLocalDictionary).toHaveBeenCalledWith("sample");
		state.saving = true;
		const busyRow = buildDictionarySettingsViewModel(state, actions, "zh")
			.snapshot.groups.flatMap((group) => group.rows)
			.find((item) => item.name === "Sample dictionary");
		expect(busyRow?.controls.every((control) => control.disabled)).toBe(true);
	});
});

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
