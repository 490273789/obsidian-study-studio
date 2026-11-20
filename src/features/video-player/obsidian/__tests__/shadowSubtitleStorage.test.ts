import { describe, expect, it, vi } from "vite-plus/test";
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
	return { app, files, store: new ObsidianShadowSubtitleStore(app) };
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
	it("preserves external changes arriving during backup verification", async () => {
		const { app, files, store } = fixture();
		const document = emptyShadowDocument("video");
		await store.save(document);
		const reopened = new ObsidianShadowSubtitleStore(app);
		await reopened.load("video");
		const path = "Study Studio/影子跟读/video/subtitles.json";
		const external = JSON.stringify({ ...document, revision: 5 });
		const list = app.vault.adapter.list;
		vi.spyOn(app.vault.adapter, "list").mockImplementationOnce(async () => {
			files.set(path, external);
			return list();
		});
		await expect(reopened.save({ ...document, revision: 1 })).rejects.toThrow("外部修改");
		expect(files.get(path)).toBe(external);
		expect([...files.keys()].some((file) => file.includes("/conflict-"))).toBe(true);
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

	it("recovers the last committed revision after a failed active index write", async () => {
		const { app, files, store } = fixture();
		await store.save(emptyShadowDocument("video"));
		const path = "Study Studio/影子跟读/video/subtitles.json";
		const adapter = app.vault.adapter;
		const write = adapter.write;
		vi.spyOn(adapter, "write").mockImplementation(async (destination, text) => {
			if (destination === path) {
				files.set(path, "incomplete document");
				throw new Error("disk full");
			}
			await write(destination, text);
		});

		await expect(store.save({ ...emptyShadowDocument("video"), revision: 1 })).rejects.toThrow(
			"disk full",
		);
		const reopened = new ObsidianShadowSubtitleStore(app);
		expect(await reopened.load("video")).toMatchObject({ revision: 0 });
	});

	it("keeps the active document and rejects a subsequent overwrite until history is protected", async () => {
		const { app, store } = fixture();
		const adapter = app.vault.adapter;
		const write = adapter.write;
		vi.spyOn(adapter, "write").mockImplementation(async (path, text) => {
			if (path.includes("/revision-") || path.endsWith("/recovery.json"))
				throw new Error("history storage unavailable");
			await write(path, text);
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await store.save(emptyShadowDocument("video"));
			await expect(
				store.save({ ...emptyShadowDocument("video"), revision: 1 }),
			).rejects.toThrow("history storage unavailable");
			const reopened = new ObsidianShadowSubtitleStore(app);
			expect(await reopened.load("video")).toMatchObject({ revision: 0 });
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it.each([false, true])(
		"protects a committed revision after its history write failed (reopened: %s)",
		async (reopen) => {
			const { app, files, store } = fixture();
			const adapter = app.vault.adapter;
			const write = adapter.write;
			const path = "Study Studio/影子跟读/video/subtitles.json";
			const document = emptyShadowDocument("video");
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			try {
				vi.spyOn(adapter, "write").mockImplementation(async (destination, text) => {
					if (destination.includes("/revision-")) throw new Error("history unavailable");
					await write(destination, text);
				});
				await store.save(document);
				const committedText = files.get(path);
				const writer = reopen ? new ObsidianShadowSubtitleStore(app) : store;
				if (reopen) await writer.load("video");
				vi.mocked(adapter.write).mockImplementation(async (destination, text) => {
					if (destination === path) {
						files.set(path, "incomplete document");
						throw new Error("active write failed");
					}
					await write(destination, text);
				});

				await expect(writer.save({ ...document, revision: 1 })).rejects.toThrow(
					"active write failed",
				);
				const recovered = await new ObsidianShadowSubtitleStore(app).load("video");
				expect(recovered).toEqual(document);
				expect([...files.values()]).toContain(committedText);
			} finally {
				warn.mockRestore();
			}
		},
	);

	it("prefers the last active document over a different history file at the same revision", async () => {
		const { app, files, store } = fixture();
		const directory = "Study Studio/影子跟读/video";
		const active = { ...emptyShadowDocument("video"), revision: 1 };
		await store.save(active);
		const revisionPath = [...files.keys()].find((file) => file.includes("/revision-1-"))!;
		files.set(revisionPath, JSON.stringify({ ...active, candidate: [] }));
		const writer = new ObsidianShadowSubtitleStore(app);
		await writer.load("video");
		const adapter = app.vault.adapter;
		const write = adapter.write;
		vi.spyOn(adapter, "write").mockImplementation(async (path, text) => {
			if (path === `${directory}/subtitles.json`) {
				files.set(path, "incomplete document");
				throw new Error("active write failed");
			}
			await write(path, text);
		});

		await expect(writer.save({ ...active, revision: 2 })).rejects.toThrow(
			"active write failed",
		);
		expect(await new ObsidianShadowSubtitleStore(app).load("video")).toEqual(active);
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
