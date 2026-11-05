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
				engines: [
					{
						id: "engine",
						kind: "llm",
						name: "Favorite engine",
						provider: "deepseek",
						baseUrl: "https://api.deepseek.com",
						secretId: "key",
						model: "deepseek-chat",
					},
					{
						id: "speech",
						kind: "asr",
						name: "Speech engine",
						provider: "bailian",
						baseUrl: "",
						workspaceId: "workspace",
						workspaceSecretId: "",
						secretId: "key",
						model: "fun-asr-flash-2026-06-15",
					},
				],
				defaults: { llm: "engine", asr: "speech" },
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
		createFavoriteCategory: vi.fn(),
		editFavoriteCategory: vi.fn(),
		deleteFavoriteCategory: vi.fn(),
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
	it("exposes category create, edit and delete controls", async () => {
		const { state, actions } = setup();
		const presentation = buildDictionarySettingsViewModel(state, actions, "zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);
		const create = rows.find((row) => row.name === dictionaryStrings("zh").favoriteCategory)
			?.controls[0];
		const category = rows.find((row) => row.name === "默认收藏");
		expect(create?.kind).toBe("button");
		expect(category?.controls.map((control) => control.kind)).toEqual(["button", "button"]);
		if (create?.kind === "button")
			await presentation.invoke({ action: create.action, value: undefined });
		expect(actions.createFavoriteCategory).toHaveBeenCalledOnce();
	});
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
			settings: { ...state.aiSnapshot.settings, engines: [] },
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

describe("dictionary settings layout and progressive disclosure", () => {
	it("partitions settings into four structured groups", () => {
		const { state, actions } = setup();
		const presentation = buildDictionarySettingsViewModel(state, actions, "zh");
		const groupKeys = presentation.snapshot.groups.map((group) => group.key);
		expect(groupKeys).toEqual(["general", "favorites", "sources", "local"]);
	});

	it("uses deduplicated description for test connection", () => {
		const { state, actions } = setup();
		const presentation = buildDictionarySettingsViewModel(state, actions, "zh");
		const testRow = presentation.snapshot.groups
			.flatMap((group) => group.rows)
			.find((row) => row.name === dictionaryStrings("zh").testConnection);
		expect(testRow?.description).toBe(dictionaryStrings("zh").testConnectionDescription);
		expect(testRow?.description).not.toBe(dictionaryStrings("zh").freeModeDescription);
	});

	it("renders quiet neutral delete buttons for categories", () => {
		const { state, actions } = setup();
		state.settings.favoriteCategories = [
			{ id: "c1", name: "Cat 1", path: "cat1.md" },
			{ id: "c2", name: "Cat 2", path: "cat2.md" },
		];
		state.favoriteCategoriesCollapsed = false;
		const presentation = buildDictionarySettingsViewModel(state, actions, "zh");
		const rows = presentation.snapshot.groups.flatMap((group) => group.rows);
		const catRow = rows.find((row) => row.name === "Cat 1");
		const deleteButton = catRow?.controls[1];
		if (deleteButton?.kind !== "button") throw new Error("Expected button");
		expect(deleteButton.tone).toBe("neutral");
	});

	it("collapses categories when collapsed state is active and toggles on action", async () => {
		const { state, actions } = setup();
		actions.toggleFavoriteCategoriesCollapsed = vi.fn();
		state.settings.favoriteCategories = [
			{ id: "c1", name: "Cat 1", path: "cat1.md" },
			{ id: "c2", name: "Cat 2", path: "cat2.md" },
			{ id: "c3", name: "Cat 3", path: "cat3.md" },
			{ id: "c4", name: "Cat 4", path: "cat4.md" },
		];

		// Default for > 3 categories is collapsed
		const collapsedPres = buildDictionarySettingsViewModel(state, actions, "zh");
		const collapsedRows = collapsedPres.snapshot.groups.flatMap((group) => group.rows);
		expect(collapsedRows.some((row) => row.name === "Cat 1")).toBe(false);

		const headerRow = collapsedRows.find(
			(row) => row.name === dictionaryStrings("zh").favoriteCategory,
		);
		expect(headerRow?.controls).toHaveLength(2);
		const toggleBtn = headerRow?.controls[1];
		if (toggleBtn?.kind !== "button") throw new Error("Expected toggle button");
		expect(toggleBtn.label).toBe(dictionaryStrings("zh").expandCategories(4));

		await collapsedPres.invoke({ action: toggleBtn.action, value: undefined });
		expect(actions.toggleFavoriteCategoriesCollapsed).toHaveBeenCalledOnce();

		// When expanded
		state.favoriteCategoriesCollapsed = false;
		const expandedPres = buildDictionarySettingsViewModel(state, actions, "zh");
		const expandedRows = expandedPres.snapshot.groups.flatMap((group) => group.rows);
		expect(expandedRows.some((row) => row.name === "Cat 1")).toBe(true);
		expect(expandedRows.some((row) => row.name === "Cat 4")).toBe(true);
	});

	it("collapses local dictionaries when more than two are imported", async () => {
		const { state, actions } = setup();
		actions.toggleLocalDictionariesCollapsed = vi.fn();
		state.localDictionaries = [
			{
				files: [{ name: "d1.eudic", size: 100 }],
				id: "d1",
				name: "Dict 1",
				requiresReimport: false,
			},
			{
				files: [{ name: "d2.eudic", size: 200 }],
				id: "d2",
				name: "Dict 2",
				requiresReimport: false,
			},
			{
				files: [{ name: "d3.eudic", size: 300 }],
				id: "d3",
				name: "Dict 3",
				requiresReimport: false,
			},
		];
		state.localDictionariesCollapsed = true;

		const pres = buildDictionarySettingsViewModel(state, actions, "zh");
		const rows = pres.snapshot.groups.flatMap((group) => group.rows);
		expect(rows.some((row) => row.name === "Dict 1")).toBe(false);

		const headerRow = rows.find((row) => row.name === dictionaryStrings("zh").local);
		const toggleBtn = headerRow?.controls[0];
		if (toggleBtn?.kind !== "button") throw new Error("Expected toggle button");
		expect(toggleBtn.label).toBe(dictionaryStrings("zh").expandLocalDictionaries(3));

		await pres.invoke({ action: toggleBtn.action, value: undefined });
		expect(actions.toggleLocalDictionariesCollapsed).toHaveBeenCalledOnce();

		// When expanded
		state.localDictionariesCollapsed = false;
		const expandedPres = buildDictionarySettingsViewModel(state, actions, "zh");
		const expandedRows = expandedPres.snapshot.groups.flatMap((group) => group.rows);
		expect(expandedRows.some((row) => row.name === "Dict 1")).toBe(true);
		expect(expandedRows.some((row) => row.name === "Dict 3")).toBe(true);
	});
});
