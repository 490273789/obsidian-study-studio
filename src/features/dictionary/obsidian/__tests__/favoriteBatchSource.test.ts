import { describe, expect, it, vi } from "vite-plus/test";
import { TFile, type App } from "obsidian";
import { ObsidianFavoriteBatchSource } from "../favoriteBatchSource";

vi.mock("obsidian", () => ({ TFile: class {} }));

describe("vault batch word-list source", () => {
	it("suggests only vault text and Markdown files and reads the selected file fresh", async () => {
		const textFile = Object.assign(new TFile(), { path: "Lists/words.txt", extension: "txt" });
		const markdown = Object.assign(new TFile(), { path: "Lists/verbs.md", extension: "md" });
		const image = Object.assign(new TFile(), { path: "Lists/image.png", extension: "png" });
		const read = vi.fn(async () => "apple\nbanana\n");
		const source = new ObsidianFavoriteBatchSource({
			vault: {
				getFiles: () => [textFile, markdown, image],
				getAbstractFileByPath: (path: string) =>
					[textFile, markdown, image].find((file) => file.path === path) ?? null,
				read,
			},
		} as unknown as App);
		expect(source.pathSuggestions("lists/")).toEqual(["Lists/verbs.md", "Lists/words.txt"]);
		await expect(source.read("Lists/words.txt")).resolves.toBe("apple\nbanana\n");
		await expect(source.read("Lists/image.png")).rejects.toMatchObject({
			reason: "source-invalid",
		});
		await expect(source.read("missing.txt")).rejects.toMatchObject({
			reason: "source-missing",
		});
		expect(read).toHaveBeenCalledExactlyOnceWith(textFile);
	});
});
