import { describe, expect, it, vi } from "vitest";
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
			"interface",
			"study",
			"pronunciation",
			"fsrs",
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
		const refresh = control(configured, "refresh");
		const tags = control(configured, "tags");
		const discovered = control(row(presentation, "flashcards", "discovered-tags"), "tags");
		if (
			refresh.kind !== "button" ||
			tags.kind !== "editableList" ||
			discovered.kind !== "choiceButtons"
		) {
			throw new Error("Unexpected tag controls");
		}
		await presentation.invoke({ action: refresh.action, value: undefined });
		await presentation.invoke({
			action: tags.changeAction,
			value: { index: 0, value: "#updated" },
		});
		await presentation.invoke({ action: tags.addAction, value: undefined });
		await presentation.invoke({ action: tags.removeAction, value: 0 });
		await presentation.invoke({ action: discovered.action, value: "#phrase" });
		expect(actions.refreshTags).toHaveBeenCalledWith({ cleanConfiguredTags: true });
		expect(actions.updateFlashcardTag).toHaveBeenCalledWith(0, "#updated");
		expect(actions.addFlashcardTag).toHaveBeenCalledOnce();
		expect(actions.removeFlashcardTag).toHaveBeenCalledWith(0);
		expect(actions.addDiscoveredTag).toHaveBeenCalledWith("#phrase");
	});

	it("validates and dispatches language, study, and FSRS values", async () => {
		const actions = makeActions();
		const presentation = build(actions);
		const language = control(row(presentation, "interface", "language"), "control");
		const dailyNew = control(row(presentation, "study", "daily-new"), "control");
		const maximumInterval = control(row(presentation, "fsrs", "maximum-interval"), "control");
		if (
			language.kind !== "select" ||
			dailyNew.kind !== "slider" ||
			maximumInterval.kind !== "integer"
		) {
			throw new Error("Unexpected scalar controls");
		}
		expect(await presentation.invoke({ action: language.action, value: "zh" })).toEqual({
			status: "applied",
		});
		expect(await presentation.invoke({ action: dailyNew.action, value: 20 })).toEqual({
			status: "applied",
		});
		expect(await presentation.invoke({ action: maximumInterval.action, value: "365" })).toEqual(
			{ status: "applied" },
		);
		expect(actions.setLanguage).toHaveBeenCalledWith("zh");
		expect(actions.setDailyNewCards).toHaveBeenCalledWith(20);
		expect(actions.setMaximumInterval).toHaveBeenCalledWith(365);
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
});
