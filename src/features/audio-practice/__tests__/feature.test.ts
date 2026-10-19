import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Headphones } from "lucide-react";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import { WorkbenchStore } from "../../../core/storage/workbenchStore";
import { AUDIO_PRACTICE_VIEW, createAudioPracticeFeature } from "../feature";
import { audioPracticeStrings } from "../strings/audioPractice";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	TFile: class {},
}));

vi.mock("../../../core/host/reactItemView", () => ({
	createReactItemView: vi.fn((definition: unknown) => definition),
}));

function createApp() {
	return {
		workspace: { getLeavesOfType: () => [] },
		vault: {
			getFiles: () => [],
			getAbstractFileByPath: () => null,
			getResourcePath: () => "",
			on: () => ({}),
			offref: () => {},
			read: async () => "",
			readBinary: async () => new ArrayBuffer(0),
			create: async () => {},
		},
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

function createFeature() {
	const store = new WorkbenchStore({
		loadData: async () => null,
		saveData: async () => {},
	});
	const feature = createAudioPracticeFeature({
		store,
		net: { readSecret: vi.fn(() => null) } as never,
	});
	return { feature, app: createApp() };
}

function audioSettings(enabled: boolean) {
	return {
		...DEFAULT_SETTINGS,
		audioPractice: { ...DEFAULT_SETTINGS.audioPractice, enabled },
	};
}

describe("audio practice feature", () => {
	beforeEach(() => {
		vi.stubGlobal("window", {});
	});

	it("registers its view, catalog entry, and settings section", () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(true), app);

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([AUDIO_PRACTICE_VIEW]);
		const entry = fake.catalog.get("audio-practice")!;
		expect(entry.title("zh")).toBe(audioPracticeStrings("zh").title);
		expect(entry.icon).toBe(Headphones);
		expect(entry.openCommandId).toBe("open-audio-practice");
		expect(entry.shortcutKey).toBe("audioPractice");
		expect(entry.settingsSectionId).toBe("audio-practice");
		expect(entry.available()).toBe(true);
		expect(fake.sections.get("audio-practice")!.order).toBe(5);

		entry.open();
		expect(fake.activateView).toHaveBeenCalledWith(AUDIO_PRACTICE_VIEW, { mainTab: true });

		feature.stop();
	});

	it("hides its catalog entry when the feature is disabled", () => {
		const { feature, app } = createFeature();
		const fake = createFakeWorkbenchHost("audioPractice", audioSettings(false), app);

		feature.render(fake.host);

		expect(fake.catalog.get("audio-practice")!.available()).toBe(false);
		feature.stop();
	});
});
