import { describe, expect, it, vi } from "vite-plus/test";
import type {
	SettingsPresentation,
	SettingsRowSnapshot,
} from "../../../../core/settings/presentation";
import { videoPlayerStrings } from "../../strings/videoPlayer";
import { normalizeVideoPlayerSettings } from "../slice";
import {
	buildVideoPlayerSettingsViewModel,
	type ShadowingSettingsChoices,
	type VideoPlayerSettingsActions,
} from "../viewModel";

const t = videoPlayerStrings("zh");

function makeActions(): VideoPlayerSettingsActions {
	return {
		setEnabled: vi.fn(),
		setSkipInterval: vi.fn(),
		setShortcut: vi.fn(),
		clearLocalData: vi.fn(),
		setShadowTranscriptionEngineId: vi.fn(),
		setShadowTranslationProfileId: vi.fn(),
		setShadowVaultFolder: vi.fn(),
		setShadowFfmpegPath: vi.fn(),
	};
}

function makeChoices(overrides: Partial<ShadowingSettingsChoices> = {}): ShadowingSettingsChoices {
	return {
		transcriptionEngines: [
			{ id: "engine-a", name: "Bailian ASR" },
			{ id: "engine-b", name: "Compatible ASR" },
		],
		translationProfiles: [],
		ffmpegPath: "",
		...overrides,
	};
}

function shadowingRow(
	presentation: SettingsPresentation,
	rowKey: string,
): SettingsRowSnapshot | undefined {
	return presentation.snapshot.groups
		.find((group) => group.key === "shadowing")
		?.rows.find((row) => row.key === rowKey);
}

function build(settingsEngineId: string, choices: ShadowingSettingsChoices) {
	const actions = makeActions();
	const presentation = buildVideoPlayerSettingsViewModel(
		normalizeVideoPlayerSettings({ shadowTranscriptionEngineId: settingsEngineId }),
		actions,
		"zh",
		choices,
	);
	return { actions, presentation };
}

describe("video player settings presentation", () => {
	it("offers the shared ASR engine list instead of a provider enum", () => {
		const { presentation } = build("engine-b", makeChoices());
		const select = shadowingRow(presentation, "transcription-engine")?.controls[0];
		if (select?.kind !== "select") throw new Error("Expected ASR engine select");
		expect(select.value).toBe("engine-b");
		expect(select.options).toEqual([
			{ value: "", label: t.shadowProviderDefault },
			{ value: "engine-a", label: "Bailian ASR" },
			{ value: "engine-b", label: "Compatible ASR" },
		]);
		const values = select.options.map((option) => option.value);
		expect(values).not.toContain("bailian");
		expect(values).not.toContain("openai-compatible");
	});

	it("dispatches the selected engine id", async () => {
		const { actions, presentation } = build("", makeChoices());
		const select = shadowingRow(presentation, "transcription-engine")?.controls[0];
		if (select?.kind !== "select") throw new Error("Expected ASR engine select");
		await presentation.invoke({ action: select.action, value: "engine-a" });
		expect(actions.setShadowTranscriptionEngineId).toHaveBeenCalledWith("engine-a");
	});

	it("keeps a deleted engine id visible for repair", () => {
		const { presentation } = build("engine-deleted", makeChoices());
		const select = shadowingRow(presentation, "transcription-engine")?.controls[0];
		if (select?.kind !== "select") throw new Error("Expected ASR engine select");
		expect(select.value).toBe("engine-deleted");
		expect(select.options[0]).toEqual({
			value: "engine-deleted",
			label: t.shadowProviderMissing,
		});
	});

	it("opens the AI engine settings from the shadowing group", async () => {
		const openAiSettings = vi.fn();
		const { presentation } = build("", makeChoices({ openAiSettings }));
		const button = shadowingRow(presentation, "open-ai-settings")?.controls[0];
		if (button?.kind !== "button") throw new Error("Expected AI settings button");
		expect(button.label).toBe(t.openAiSettings);
		await presentation.invoke({ action: button.action, value: undefined });
		expect(openAiSettings).toHaveBeenCalledOnce();
	});

	it("omits the AI settings link when the opener is unavailable", () => {
		const { presentation } = build("", makeChoices());
		expect(shadowingRow(presentation, "open-ai-settings")).toBeUndefined();
	});

	it("hides the shadowing group when shadowing services are unavailable", () => {
		const presentation = buildVideoPlayerSettingsViewModel(
			normalizeVideoPlayerSettings({}),
			makeActions(),
			"zh",
		);
		const groupKeys = presentation.snapshot.groups.map((group) => group.key);
		expect(groupKeys).not.toContain("shadowing");
		expect(groupKeys).toEqual(["general", "keyboard", "local-data"]);
	});
});
