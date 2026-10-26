import { describe, expect, it, vi } from "vite-plus/test";
import { ObsidianDictionaryFavoriteStore } from "../favoriteStore";
import { FavoriteSaveError, formatDictionaryFavorite } from "../../domain/favorite-file";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import type {
	CardSourceMutation,
	CardSourcePreparation,
} from "../../../../core/shared/cardSourceMutation";

vi.mock("obsidian", () => ({
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) => path,
}));

function entry(word: string, meaning = "释义", note = "笔记") {
	return { word, meaning, note, path: "word.md" };
}

function fileSetup(source: string, preparation: CardSourcePreparation = { kind: "unmanaged" }) {
	const file = Object.assign(new TFile(), { path: "word.md" });
	let content = source;
	const process = vi.fn(async (_file, update: (current: string) => string) => {
		content = update(content);
	});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => content),
			process,
			create: vi.fn(),
		},
	} as unknown as App;
	const sourceEdits = {
		prepare: vi.fn(async () => preparation),
		change: vi.fn<CardSourceMutation["change"]>(async () => ({ kind: "applied" })),
	} satisfies CardSourceMutation;
	return {
		app,
		process,
		sourceEdits,
		favorite: new ObsidianDictionaryFavoriteStore(app, sourceEdits),
		content: () => content,
		replace: (next: string) => {
			content = next;
		},
	};
}

describe("ObsidianDictionaryFavoriteStore persistence", () => {
	it("suggests existing Markdown files and folders without reading their contents", () => {
		const folder = Object.assign(new TFolder(), { path: "Words/Grammar" });
		const markdown = Object.assign(new TFile(), {
			path: "Words/Grammar/verbs.md",
			extension: "md",
		});
		const image = Object.assign(new TFile(), {
			path: "Words/Grammar/image.png",
			extension: "png",
		});
		const getAllLoadedFiles = vi.fn(() => [folder, markdown, image]);
		const read = vi.fn();
		const favorite = new ObsidianDictionaryFavoriteStore({
			vault: { getAllLoadedFiles, read },
		} as unknown as App);
		expect(favorite.pathSuggestions("grammar")).toEqual([
			"Words/Grammar/",
			"Words/Grammar/verbs.md",
		]);
		expect(read).not.toHaveBeenCalled();
	});

	it("does not roll back a replacement file placed at the same path", async () => {
		const files = new Map<string, TFile>();
		const created = Object.assign(new TFile(), { path: "new.md", extension: "md" });
		const replacement = Object.assign(new TFile(), { path: "new.md", extension: "md" });
		const remove = vi.fn(async (file: TFile) => {
			files.delete(file.path);
		});
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => files.get(path) ?? null,
				getFileByPath: (path: string) => files.get(path) ?? null,
				create: vi.fn(async () => {
					files.set("new.md", created);
					return created;
				}),
				read: vi.fn(async () => ""),
				delete: remove,
			},
		} as unknown as App;
		const undo = await new ObsidianDictionaryFavoriteStore(app).ensureFile("new.md");
		files.set("new.md", replacement);
		await expect(undo()).rejects.toThrow("changed");
		expect(remove).not.toHaveBeenCalled();
		expect(files.get("new.md")).toBe(replacement);
	});

	it("does not move a replacement file during rollback", async () => {
		const old = Object.assign(new TFile(), { path: "old.md", extension: "md" });
		const replacement = Object.assign(new TFile(), { path: "new.md", extension: "md" });
		const files = new Map<string, TFile>([["old.md", old]]);
		const renameFile = vi.fn(async (file: TFile, path: string) => {
			files.delete(file.path);
			file.path = path;
			files.set(path, file);
		});
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => files.get(path) ?? null,
				getFileByPath: (path: string) => files.get(path) ?? null,
			},
			fileManager: { renameFile },
		} as unknown as App;
		const undo = await new ObsidianDictionaryFavoriteStore(app).moveFile("old.md", "new.md");
		files.set("new.md", replacement);
		await expect(undo()).rejects.toThrow("restore");
		expect(renameFile).toHaveBeenCalledTimes(1);
		expect(files.get("new.md")).toBe(replacement);
	});
	it("passes the complete note to card validation instead of truncating it at a reserved marker", async () => {
		const source = formatDictionaryFavorite(entry("apple"));
		const setup = fileSetup(source, {
			kind: "ready",
			cards: [{ identity: "last", front: "## apple", back: "释义", explanation: "笔记" }],
		});
		setup.sourceEdits.change.mockResolvedValueOnce({
			kind: "validation-failed",
			error: { type: "reserved-marker", marker: ";;" },
		});
		await expect(
			setup.favorite.save(entry("apple", "new", "before\n;;\nafter")),
		).rejects.toMatchObject({ reason: "invalid-card-content" });
		expect(setup.sourceEdits.change.mock.calls[0]?.[0].changes[0]).toEqual({
			kind: "edit",
			identity: "last",
			content: { front: "## apple", back: "new", explanation: "before\n;;\nafter" },
		});
		expect(setup.content()).toBe(source);
		expect(setup.process).not.toHaveBeenCalled();
	});

	it("writes only the selected target using an authoritative snapshot", async () => {
		const original = formatDictionaryFavorite(entry("apple"));
		const setup = fileSetup(original);
		await expect(setup.favorite.save(entry("APPLE", "new"))).resolves.toBe("word.md");
		expect(setup.sourceEdits.prepare).toHaveBeenCalledWith("word.md", original);
		expect(setup.content()).toBe(formatDictionaryFavorite(entry("APPLE", "new")));
		expect(setup.sourceEdits.change).not.toHaveBeenCalled();
	});

	it("does not overwrite edits arriving after source preparation", async () => {
		const setup = fileSetup(formatDictionaryFavorite(entry("apple")));
		setup.sourceEdits.prepare.mockImplementationOnce(async () => {
			setup.replace("externally changed");
			return { kind: "unmanaged" };
		});
		await expect(setup.favorite.save(entry("apple", "new"))).rejects.toMatchObject({
			reason: "source-changing",
		});
		expect(setup.content()).toBe("externally changed");
	});

	it.each(["migration-required", "source-needs-repair"] as const)(
		"blocks %s without changing the file",
		async (reason) => {
			const source = formatDictionaryFavorite(entry("apple"));
			const setup = fileSetup(source, { kind: "blocked", reason });
			await expect(setup.favorite.save(entry("apple", "new"))).rejects.toEqual(
				new FavoriteSaveError(reason),
			);
			expect(setup.process).not.toHaveBeenCalled();
			expect(setup.sourceEdits.change).not.toHaveBeenCalled();
			expect(setup.content()).toBe(source);
		},
	);

	it("submits one identity-aware update and deletes only earlier same-word cards", async () => {
		const source =
			formatDictionaryFavorite(entry("apple", "old")) +
			formatDictionaryFavorite(entry("banana")) +
			formatDictionaryFavorite(entry("APPLE", "last"));
		const setup = fileSetup(source, {
			kind: "ready",
			cards: [
				{ identity: "first", front: "## apple", back: "old", explanation: "笔记" },
				{ identity: "other", front: "## banana", back: "释义", explanation: "笔记" },
				{ identity: "last", front: "## APPLE", back: "last", explanation: "笔记" },
			],
		});
		await setup.favorite.save(entry("apple", "new", ""));
		expect(setup.sourceEdits.change).toHaveBeenCalledExactlyOnceWith({
			path: "word.md",
			expectedContent: source,
			changes: [
				{
					kind: "edit",
					identity: "last",
					content: { front: "## apple", back: "new", explanation: "" },
				},
				{ kind: "delete", identity: "first" },
			],
		});
		expect(setup.process).not.toHaveBeenCalled();
	});

	it("adds a new word through the identity owner when the target is a deck", async () => {
		const setup = fileSetup("#deck\n", { kind: "ready", cards: [] });
		await setup.favorite.save(entry("banana"));
		expect(setup.sourceEdits.change).toHaveBeenCalledWith({
			path: "word.md",
			expectedContent: "#deck\n",
			changes: [
				{ kind: "add", content: { front: "## banana", back: "释义", explanation: "笔记" } },
			],
		});
		expect(setup.process).not.toHaveBeenCalled();
	});
});
