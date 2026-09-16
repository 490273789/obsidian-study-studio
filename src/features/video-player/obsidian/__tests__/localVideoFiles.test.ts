import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ Platform: { resourcePathPrefix: "app://default/" } }));

import { localVideoMediaUrl, resolveLocalVideoSources } from "../localVideoFiles";

describe("localVideoMediaUrl", () => {
	it("joins the Obsidian resource prefix and encodes unsafe path characters", () => {
		expect(localVideoMediaUrl("/Users/me/a video.mp4", "app://vault/")).toBe(
			"app://vault/Users/me/a%20video.mp4",
		);
		expect(localVideoMediaUrl("/home/me/a#b.webm", "app://vault/")).toBe(
			"app://vault/home/me/a%23b.webm",
		);
		expect(localVideoMediaUrl("C:\\Videos\\lesson 1.mp4", "app://vault/")).toBe(
			"app://vault/C:/Videos/lesson%201.mp4",
		);
	});
});

describe("resolveLocalVideoSources", () => {
	it("canonicalizes readable files, requests R_OK, and removes duplicate paths", async () => {
		const access = vi.fn(async () => undefined);
		const sources = await resolveLocalVideoSources(
			[new File([], "first.mp4"), new File([], "duplicate.mp4"), new File([], "missing.mp4")],
			{
				webUtils: {
					getPathForFile: (file) => `/chosen/${file.name}`,
				},
				fileSystem: {
					realpath: async (path) => {
						if (path.endsWith("missing.mp4")) throw new Error("missing");
						return "/real/video.mp4";
					},
					access,
				},
				createId: () => "video-id",
			},
		);

		expect(sources).toEqual([{ id: "video-id", path: "/real/video.mp4", name: "first.mp4" }]);
		expect(access).toHaveBeenCalledWith("/real/video.mp4", 4);
	});

	it("rejects when desktop path APIs are unavailable", async () => {
		await expect(
			resolveLocalVideoSources([], { webUtils: null, fileSystem: null }),
		).rejects.toThrow("桌面版");
	});
});
