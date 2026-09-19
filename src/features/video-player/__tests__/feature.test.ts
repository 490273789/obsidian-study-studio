import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import {
	createVideoPlayerFeature,
	VIDEO_PLAYER_SECTION_ID,
	VIEW_TYPE_VIDEO_PLAYER,
} from "../feature";
import { videoPlayerStrings } from "../strings/videoPlayer";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	Platform: { resourcePathPrefix: "app://vault/" },
}));

describe("video player feature", () => {
	beforeEach(() => vi.mocked(Notice).mockClear());

	it("registers a main-tab catalog entry, view, and settings section", async () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const feature = createVideoPlayerFeature();

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([VIEW_TYPE_VIDEO_PLAYER]);
		const entry = fake.catalog.get("video-player")!;
		expect(entry.title("zh")).toBe(videoPlayerStrings("zh").title);
		expect(entry.openCommandId).toBe("open-local-video-player");
		expect(entry.openHotkeys).toEqual([{ modifiers: ["Alt"], key: "1" }]);
		expect(entry.settingsSectionId).toBe(VIDEO_PLAYER_SECTION_ID);
		expect(entry.available()).toBe(true);
		expect(fake.ribbons).toEqual([]);
		expect(fake.sections.get(VIDEO_PLAYER_SECTION_ID)!.order).toBe(4);

		entry.open();
		await vi.waitFor(() => {
			expect(fake.activateView).toHaveBeenCalledWith(VIEW_TYPE_VIDEO_PLAYER, {
				mainTab: true,
			});
		});

		feature.stop();
	});

	it("hides its catalog entry when disabled", () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost(
			"videoPlayer",
			{
				...DEFAULT_SETTINGS,
				videoPlayer: { ...DEFAULT_SETTINGS.videoPlayer, enabled: false },
			},
			app,
		);
		const feature = createVideoPlayerFeature();

		feature.render(fake.host);
		expect(fake.catalog.get("video-player")!.available()).toBe(false);

		feature.stop();
	});
});
