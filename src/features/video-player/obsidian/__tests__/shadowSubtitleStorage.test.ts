import { describe, expect, it } from "vite-plus/test";
import { ObsidianShadowSubtitleStore } from "../shadowSubtitleStorage";
import { emptyShadowDocument } from "../../domain/shadowSubtitles";

function fixture() {
	const files = new Map<string, string>();
	const directories = new Set<string>();
	const local = new Map<string, unknown>();
	const app = {
		loadLocalStorage: (key: string) => local.get(key),
		saveLocalStorage: (key: string, value: unknown) => {
			local.set(key, value);
		},
		vault: {
			adapter: {
				exists: async (path: string) => files.has(path) || directories.has(path),
				read: async (path: string) => files.get(path)!,
				write: async (path: string, text: string) => {
					files.set(path, text);
				},
				mkdir: async (path: string) => {
					directories.add(path);
				},
				list: async () => ({
					files: [...files.keys()],
					folders: [...directories].filter((path) => path.split("/").length === 3),
				}),
			},
		},
	};
	return { files, store: new ObsidianShadowSubtitleStore(app) };
}
describe("shadow subtitle vault storage", () => {
	it("writes revision history and preserves both sides of external conflicts", async () => {
		const { files, store } = fixture();
		const document = emptyShadowDocument("video");
		await store.load("video");
		await store.save(document);
		expect([...files.keys()].some((path) => path.includes("revision-0-"))).toBe(true);
		files.set("Study Studio/影子跟读/video/subtitles.json", '{"external":true}');
		document.revision++;
		await expect(store.save(document)).rejects.toThrow("外部修改");
		expect(files.get("Study Studio/影子跟读/video/subtitles.json")).toBe('{"external":true}');
		expect([...files.keys()].some((path) => path.includes("conflict-"))).toBe(true);
	});
	it("rebuilds a missing or corrupt active index from immutable versions", async () => {
		const { files, store } = fixture();
		await store.load("video");
		const document = emptyShadowDocument("video");
		await store.save(document);
		document.revision = 1;
		await store.save(document);
		files.set("Study Studio/影子跟读/video/subtitles.json", "bad json");
		expect((await store.load("video"))!.revision).toBe(1);
		files.delete("Study Studio/影子跟读/video/subtitles.json");
		expect((await store.load("video"))!.revision).toBe(1);
	});

	it("lists persisted sources independently of the player queue", async () => {
		const { store } = fixture();
		await store.load("video");
		await store.save(emptyShadowDocument("video"));
		expect(await store.listSourceIds()).toEqual(["video"]);
	});
	it("checkpoints progress without writing a full history copy for every translated cue", async () => {
		const { files, store } = fixture();
		await store.load("video");
		const document = emptyShadowDocument("video");
		for (let revision = 0; revision <= 25; revision++) {
			document.revision = revision;
			await store.save(document);
		}
		const versions = [...files.keys()].filter((path) => path.includes("/revision-"));
		expect(versions).toHaveLength(4);
		expect(files.get("Study Studio/影子跟读/video/subtitles.json")).toContain('"revision": 25');
	});
});
