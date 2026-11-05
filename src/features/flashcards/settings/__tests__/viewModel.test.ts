import { describe, expect, it, vi } from "vite-plus/test";
import type {
	SettingsControlSnapshot,
	SettingsPresentation,
	SettingsRowSnapshot,
} from "../../../../core/settings/presentation";
import type { FlashcardSettings } from "../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../core/host/settingsSlices";
import type { PronunciationSnapshot } from "../../domain/pronunciation";
import { buildSettingsViewModel, type SettingsViewModelActions } from "../viewModel";

function makeSettings(overrides: Partial<FlashcardSettings> = {}): FlashcardSettings {
	return {
		...DEFAULT_SETTINGS,
		...overrides,
		fsrsParameters: { ...DEFAULT_SETTINGS.fsrsParameters, ...overrides.fsrsParameters },
		pronunciation: { ...DEFAULT_SETTINGS.pronunciation, ...overrides.pronunciation },
		deckStudySettings: overrides.deckStudySettings ?? {},
	};
}

const DEFAULT_PRONUNCIATION_STATE = {
	pronunciation: {
		revision: 0,
		settings: { ...DEFAULT_SETTINGS.pronunciation },
		management: "idle",
		hasLocalEnglishVoice: false,
		voicesLoaded: true,
		speakingText: null,
		cacheUsage: { status: "ready", bytes: 0 },
	},
} as const;

function makeActions(): SettingsViewModelActions {
	return {
		refreshTags: vi.fn(),
		updateFlashcardTag: vi.fn(),
		addFlashcardTag: vi.fn(),
		removeFlashcardTag: vi.fn(),
		addDiscoveredTag: vi.fn(),
		setLanguage: vi.fn(),
		setDailyNewCards: vi.fn(),
		setDailyReviewCards: vi.fn(),
		setStudyOrder: vi.fn(),
		setRequestRetention: vi.fn(),
		setMaximumInterval: vi.fn(),
		setPronunciationAutoPlay: vi.fn(),
		setPronunciationAccent: vi.fn(),
		setPronunciationRate: vi.fn(),
		setOnlinePronunciationProvider: vi.fn(),
		setAzureCloud: vi.fn(),
		setAzureRegion: vi.fn(),
		setAzureSecretId: vi.fn(),
		setOpenAiSecretId: vi.fn(),
		testOnlinePronunciation: vi.fn(),
		clearPronunciationCache: vi.fn(),
	};
}

function build(
	actions = makeActions(),
	settings: Partial<FlashcardSettings> = {},
	pronunciation: PronunciationSnapshot = DEFAULT_PRONUNCIATION_STATE.pronunciation,
): SettingsPresentation {
	return buildSettingsViewModel(
		{
			settings: makeSettings(settings),
			availableTags: ["#word", "#phrase"],
			isLoadingTags: false,
			hasLoadedTags: true,
			language: "en",
			pronunciation,
		},
		actions,
	);
}

function row(
	presentation: SettingsPresentation,
	groupKey: string,
	rowKey: string,
): SettingsRowSnapshot {
	const found = presentation.snapshot.groups
		.find((group) => group.key === groupKey)
		?.rows.find((candidate) => candidate.key === rowKey);
	if (!found) throw new Error(`Missing row ${groupKey}/${rowKey}`);
	return found;
}

function control(rowSnapshot: SettingsRowSnapshot, key: string): SettingsControlSnapshot {
	const found = rowSnapshot.controls.find((candidate) => candidate.key === key);
	if (!found) throw new Error(`Missing control ${rowSnapshot.key}/${key}`);
	return found;
}

describe("flashcard settings presentation", () => {
	it("builds the complete renderer-neutral settings tree", () => {
		const presentation = build();
		expect(presentation.snapshot.groups.map((group) => group.key)).toEqual([
			"flashcards",
			"study",
			"pronunciation",
			"fsrs",
			"maintenance",
			"help",
		]);
		expect(row(presentation, "help", "usage").description).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "code", text: expect.stringContaining("??") }),
			]),
		);
	});

	it("dispatches compound tag controls through opaque action references", async () => {
		const actions = makeActions();
		const presentation = build(actions, { flashcardTags: ["#word"] });
		const configured = row(presentation, "flashcards", "configured-tags");
		const scan = control(row(presentation, "flashcards", "discovered-tags"), "refresh");
		const cleanup = control(row(presentation, "maintenance", "clean-tags"), "control");
		const tags = control(configured, "tags");
		const discovered = control(row(presentation, "flashcards", "discovered-tags"), "tags");
		if (
			scan.kind !== "button" ||
			cleanup.kind !== "button" ||
			tags.kind !== "editableList" ||
			discovered.kind !== "choiceButtons"
		) {
			throw new Error("Unexpected tag controls");
		}
		await presentation.invoke({ action: scan.action, value: undefined });
		await presentation.invoke({ action: cleanup.action, value: undefined });
		await presentation.invoke({
			action: tags.changeAction,
			value: { index: 0, value: "#updated" },
		});
		await presentation.invoke({ action: tags.addAction, value: undefined });
		await presentation.invoke({ action: tags.removeAction, value: 0 });
		await presentation.invoke({ action: discovered.action, value: "#phrase" });
		expect(actions.refreshTags).toHaveBeenNthCalledWith(1, { cleanConfiguredTags: false });
		expect(actions.refreshTags).toHaveBeenNthCalledWith(2, { cleanConfiguredTags: true });
		expect(configured.controls.some((candidate) => candidate.key === "refresh")).toBe(false);
		expect(tags.removeAriaLabel).toBe("Remove deck tag");
		expect(actions.updateFlashcardTag).toHaveBeenCalledWith(0, "#updated");
		expect(actions.addFlashcardTag).toHaveBeenCalledOnce();
		expect(actions.removeFlashcardTag).toHaveBeenCalledWith(0);
		expect(actions.addDiscoveredTag).toHaveBeenCalledWith("#phrase");
	});

	it("supports precise daily counts within the existing study limits", async () => {
		const actions = makeActions();
		const presentation = build(actions);
		const dailyNew = control(row(presentation, "study", "daily-new"), "control");
		const dailyReview = control(row(presentation, "study", "daily-review"), "control");
		const maximumInterval = control(row(presentation, "fsrs", "maximum-interval"), "control");
		if (
			dailyNew.kind !== "integer" ||
			dailyReview.kind !== "integer" ||
			maximumInterval.kind !== "integer"
		) {
			throw new Error("Expected integer controls");
		}
		expect(dailyNew).toMatchObject({ min: 1, max: 200, step: 1 });
		expect(dailyReview).toMatchObject({ min: 1, max: 500, step: 1 });
		await presentation.invoke({ action: dailyNew.action, value: "20" });
		await presentation.invoke({ action: dailyReview.action, value: "100" });
		await presentation.invoke({ action: dailyReview.action, value: "101" });
		await presentation.invoke({ action: maximumInterval.action, value: "365" });
		expect(actions.setDailyNewCards).toHaveBeenCalledWith(20);
		expect(actions.setDailyReviewCards).toHaveBeenNthCalledWith(1, 100);
		expect(actions.setDailyReviewCards).toHaveBeenNthCalledWith(2, 101);
		expect(actions.setMaximumInterval).toHaveBeenCalledWith(365);
		expect(row(presentation, "study", "scope").name).toBe("");
	});

	it("rejects empty, fractional, and out-of-range daily counts without persisting them", async () => {
		const actions = makeActions();
		const presentation = build(actions);
		const dailyNew = control(row(presentation, "study", "daily-new"), "control");
		const dailyReview = control(row(presentation, "study", "daily-review"), "control");
		if (dailyNew.kind !== "integer" || dailyReview.kind !== "integer") {
			throw new Error("Expected integer controls");
		}
		for (const value of ["", "0", "201", "20.5"]) {
			expect(await presentation.invoke({ action: dailyNew.action, value })).toMatchObject({
				status: "failed",
			});
		}
		for (const value of ["0", "501", "100.5"]) {
			expect(await presentation.invoke({ action: dailyReview.action, value })).toMatchObject({
				status: "failed",
			});
		}
		expect(actions.setDailyNewCards).not.toHaveBeenCalled();
		expect(actions.setDailyReviewCards).not.toHaveBeenCalled();
	});

	it.each([
		{ loading: true, loaded: false, available: [], configured: [], expected: "Scanning tags…" },
		{
			loading: false,
			loaded: false,
			available: [],
			configured: [],
			expected: "Not scanned yet.",
		},
		{ loading: false, loaded: true, available: [], configured: [], expected: "No tags found." },
		{
			loading: false,
			loaded: true,
			available: ["#word"],
			configured: ["#word"],
			expected: "All discovered tags have been added.",
		},
	])(
		"distinguishes tag discovery state: $expected",
		({ loading, loaded, available, configured, expected }) => {
			const presentation = buildSettingsViewModel(
				{
					settings: makeSettings({ flashcardTags: configured }),
					availableTags: available,
					isLoadingTags: loading,
					hasLoadedTags: loaded,
					language: "en",
					pronunciation: DEFAULT_PRONUNCIATION_STATE.pronunciation,
				},
				makeActions(),
			);
			const discovered = control(row(presentation, "flashcards", "discovered-tags"), "tags");
			if (discovered.kind !== "choiceButtons") throw new Error("Expected tag choices");
			expect(discovered.emptyText).toContain(expected);
		},
	);

	it("does not suggest an already configured tag with different casing or surrounding whitespace", () => {
		const presentation = build(makeActions(), { flashcardTags: [" #WORD "] });
		const discovered = control(row(presentation, "flashcards", "discovered-tags"), "tags");
		if (discovered.kind !== "choiceButtons") throw new Error("Expected tag choices");
		expect(discovered.choices).toEqual([{ id: "#phrase", label: "#phrase" }]);
	});

	it("prevents tag edits and repeated actions while a scan is in progress", async () => {
		const actions = makeActions();
		const presentation = buildSettingsViewModel(
			{
				settings: makeSettings({ flashcardTags: ["#word"] }),
				availableTags: ["#phrase"],
				isLoadingTags: true,
				hasLoadedTags: true,
				language: "en",
				pronunciation: DEFAULT_PRONUNCIATION_STATE.pronunciation,
			},
			actions,
		);
		const tags = control(row(presentation, "flashcards", "configured-tags"), "tags");
		const scan = control(row(presentation, "flashcards", "discovered-tags"), "refresh");
		const cleanup = control(row(presentation, "maintenance", "clean-tags"), "control");
		const discovered = control(row(presentation, "flashcards", "discovered-tags"), "tags");
		if (
			tags.kind !== "editableList" ||
			scan.kind !== "button" ||
			cleanup.kind !== "button" ||
			discovered.kind !== "choiceButtons"
		) {
			throw new Error("Unexpected tag controls");
		}
		for (const [action, value] of [
			[tags.changeAction, { index: 0, value: "#changed" }],
			[tags.addAction, undefined],
			[tags.removeAction, 0],
			[scan.action, undefined],
			[cleanup.action, undefined],
			[discovered.action, "#phrase"],
		] as const) {
			expect(await presentation.invoke({ action, value })).toEqual({
				status: "ignored",
				reason: "disabled",
			});
		}
		expect(actions.refreshTags).not.toHaveBeenCalled();
		expect(actions.updateFlashcardTag).not.toHaveBeenCalled();
		expect(actions.addFlashcardTag).not.toHaveBeenCalled();
		expect(actions.removeFlashcardTag).not.toHaveBeenCalled();
		expect(actions.addDiscoveredTag).not.toHaveBeenCalled();
	});

	it("resolves provider visibility and cache status while building the snapshot", () => {
		const presentation = build(
			makeActions(),
			{},
			{
				...DEFAULT_PRONUNCIATION_STATE.pronunciation,
				settings: {
					...DEFAULT_SETTINGS.pronunciation,
					onlineProvider: "openai",
					openaiSecretId: "openai-flashcard",
				},
				cacheUsage: { status: "ready", bytes: 1024 * 1024 },
			},
		);
		expect(row(presentation, "pronunciation", "openai-secret")).toBeDefined();
		expect(
			presentation.snapshot.groups
				.find((group) => group.key === "pronunciation")
				?.rows.some((candidate) => candidate.key === "azure-secret"),
		).toBe(false);
		expect(control(row(presentation, "pronunciation", "cache"), "usage")).toMatchObject({
			kind: "status",
			text: "1.0 MB",
		});
	});

	it("marks pronunciation interactions disabled while management is busy", async () => {
		const actions = makeActions();
		const presentation = build(
			actions,
			{},
			{
				...DEFAULT_PRONUNCIATION_STATE.pronunciation,
				management: "configuring",
				cacheUsage: { status: "failed" },
			},
		);
		const autoPlay = control(row(presentation, "pronunciation", "auto-play"), "control");
		if (autoPlay.kind !== "toggle") throw new Error("Expected autoplay toggle");
		expect(await presentation.invoke({ action: autoPlay.action, value: true })).toEqual({
			status: "ignored",
			reason: "disabled",
		});
		expect(actions.setPronunciationAutoPlay).not.toHaveBeenCalled();
		expect(control(row(presentation, "pronunciation", "cache"), "usage")).toMatchObject({
			text: "Failed to read cache usage",
		});
	});

	it("collapses configured tags when more than three exist and toggles on action", async () => {
		const actions = makeActions();
		actions.toggleTagsCollapsed = vi.fn();
		const tags = ["#t1", "#t2", "#t3", "#t4", "#t5"];

		// Default for > 3 tags: collapsed
		const collapsedPres = buildSettingsViewModel(
			{
				settings: makeSettings({ flashcardTags: tags }),
				availableTags: [],
				isLoadingTags: false,
				hasLoadedTags: true,
				language: "zh",
				pronunciation: DEFAULT_PRONUNCIATION_STATE.pronunciation,
			},
			actions,
		);

		const collapsedRow = row(collapsedPres, "flashcards", "configured-tags");
		expect(collapsedRow.controls.some((c) => c.key === "tags")).toBe(false);
		expect(collapsedRow.description).toContain("5");
		const toggleBtn = control(collapsedRow, "toggle-collapse");
		expect(toggleBtn.kind).toBe("button");
		if (toggleBtn.kind === "button") {
			expect(toggleBtn.label).toContain("5");
			await collapsedPres.invoke({ action: toggleBtn.action, value: undefined });
		}
		expect(actions.toggleTagsCollapsed).toHaveBeenCalledOnce();

		// When expanded
		const expandedPres = buildSettingsViewModel(
			{
				settings: makeSettings({ flashcardTags: tags }),
				availableTags: [],
				isLoadingTags: false,
				hasLoadedTags: true,
				language: "zh",
				pronunciation: DEFAULT_PRONUNCIATION_STATE.pronunciation,
				tagsCollapsed: false,
			},
			actions,
		);

		const expandedRow = row(expandedPres, "flashcards", "configured-tags");
		expect(expandedRow.controls.some((c) => c.key === "tags")).toBe(true);
		const expandedToggle = control(expandedRow, "toggle-collapse");
		if (expandedToggle.kind === "button") {
			expect(expandedToggle.label).toBe("收起标签");
		}
	});
});
