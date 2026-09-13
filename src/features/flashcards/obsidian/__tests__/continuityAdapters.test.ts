import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { createObsidianContinuitySourceStore } from "../continuityAdapters";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
	type ContinuityStateStore,
} from "../../domain/identity/cardIdentityContinuity";
import type { Deck } from "../../../../core/shared/types";

vi.mock("obsidian", () => ({
	TFile: class MockTFile {
		constructor(
			public readonly path: string,
			public readonly basename: string,
		) {}
	},
}));

const CARD_ID = "550e8400-e29b-41d4-a716-446655440000";

class MemoryStateStore implements ContinuityStateStore {
	constructor(public state: CardIdentityContinuityState) {}

	async load(): Promise<CardIdentityContinuityState> {
		return this.state;
	}

	async commit(state: CardIdentityContinuityState): Promise<void> {
		this.state = state;
	}
}

describe("Obsidian continuity source store", () => {
	it("discovers unconfigured flashcard tags without treating cached files as live sources", async () => {
		const configuredPath = "notes/words.md";
		const discoveredPath = "notes/phrases.md";
		const configuredFile = Object.assign(new TFile(), {
			path: configuredPath,
			basename: "words",
		});
		const discoveredFile = Object.assign(new TFile(), {
			path: discoveredPath,
			basename: "phrases",
		});
		const contents = new Map([
			[
				configuredPath,
				`#单词
<!-- wsr-card-id: ${CARD_ID} -->
apple
??
苹果
;;`,
			],
			[
				discoveredPath,
				`#短语
good morning
??
早上好
;;`,
			],
		]);
		const read = vi.fn(async (file: TFile) => contents.get(file.path) ?? "");
		const cachedRead = vi.fn(async (file: TFile) => contents.get(file.path) ?? "");
		const app = {
			vault: {
				getMarkdownFiles: () => [configuredFile, discoveredFile],
				read,
				cachedRead,
				getAbstractFileByPath: () => null,
				process: vi.fn(),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({
					tags: [{ tag: file === configuredFile ? "#单词" : "#短语" }],
				}),
			},
		} as unknown as App;
		const state = new MemoryStateStore({
			configuredTags: ["#单词"],
			availableTags: [],
			decks: new Map(),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const continuity = createCardIdentityContinuity({
			sources: createObsidianContinuitySourceStore(app),
			state,
			createIdentity: () => CARD_ID,
		});

		expect(await continuity.synchronize()).toMatchObject({
			kind: "current",
		});
		expect(state.state.availableTags).toEqual(["#单词", "#短语"]);
		expect(state.state.decks.has(configuredPath)).toBe(true);
		expect(state.state.decks.has(discoveredPath)).toBe(false);
		expect(read).toHaveBeenCalledWith(configuredFile);
		expect(read).not.toHaveBeenCalledWith(discoveredFile);
		expect(cachedRead).toHaveBeenCalledWith(discoveredFile);
	});

	it("skips files that are indexed with no tags when pre-filtering", async () => {
		const configuredFile = Object.assign(new TFile(), {
			path: "notes/words.md",
			basename: "words",
		});
		const untaggedFile = Object.assign(new TFile(), {
			path: "notes/journal.md",
			basename: "journal",
		});
		const unindexedFile = Object.assign(new TFile(), {
			path: "notes/new.md",
			basename: "new",
		});
		const read = vi.fn(async () => "");
		const cachedRead = vi.fn(async () => "");
		const app = {
			vault: {
				getMarkdownFiles: () => [configuredFile, untaggedFile, unindexedFile],
				read,
				cachedRead,
				getAbstractFileByPath: () => null,
				process: vi.fn(),
			},
			metadataCache: {
				getFileCache: (file: TFile) => {
					if (file === configuredFile) return { tags: [{ tag: "#单词" }] };
					if (file === untaggedFile) return { tags: [] };
					return null; // unindexedFile
				},
			},
		} as unknown as App;

		const store = createObsidianContinuitySourceStore(app);
		const docs = await store.list(["#单词"]);

		// configuredFile and unindexedFile should be read
		expect(read).toHaveBeenCalledWith(configuredFile);
		expect(read).toHaveBeenCalledWith(unindexedFile);
		// untaggedFile should be completely skipped
		expect(read).not.toHaveBeenCalledWith(untaggedFile);
		expect(cachedRead).not.toHaveBeenCalledWith(untaggedFile);
		expect(docs.map((d) => d.path)).toEqual(["notes/words.md", "notes/new.md"]);
	});

	it("uses an uncached read so migration previews match atomic writes", async () => {
		const path = "notes/legacy.md";
		const currentContent = `#单词
苹果
??
apple
;;`;
		const staleCachedContent = `${currentContent}\n\n<!-- stale cache -->`;
		const file = Object.assign(new TFile(), { path, basename: "legacy" });
		let diskContent = currentContent;
		const read = vi.fn(async () => diskContent);
		const cachedRead = vi.fn(async () => staleCachedContent);
		const vault = {
			getMarkdownFiles: () => [file],
			read,
			cachedRead,
			getAbstractFileByPath: () => file,
			process: async (_file: TFile, transform: (content: string) => string) => {
				diskContent = transform(diskContent);
				return diskContent;
			},
		};
		const app = {
			vault,
			metadataCache: undefined,
		} as unknown as App;
		const legacyDeck: Deck = {
			id: path,
			name: "legacy",
			filePath: path,
			tag: "#单词",
			cards: [
				{
					id: `${path}::0`,
					front: "苹果",
					back: "apple",
					fsrsCard: {
						...createEmptyCard(),
						state: State.Review,
						reps: 7,
					},
					sourceFile: path,
					indexInFile: 0,
				},
			],
			studyCount: 0,
			lastStudied: null,
		};
		const state = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, legacyDeck]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const continuity = createCardIdentityContinuity({
			sources: createObsidianContinuitySourceStore(app),
			state,
			createIdentity: () => CARD_ID,
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(read).toHaveBeenCalled();
		expect(cachedRead).not.toHaveBeenCalled();
		expect(diskContent).toContain(`<!-- wsr-card-id: ${CARD_ID} -->`);
		expect(state.state.decks.get(path)?.cards[0]).toMatchObject({
			id: CARD_ID,
			fsrsCard: { reps: 7 },
		});
	});

	it("recognizes configured tags defined in frontmatter tags or tag property", async () => {
		const frontmatterFile = Object.assign(new TFile(), {
			path: "notes/fm.md",
			basename: "fm",
		});
		const read = vi.fn(async () => "");
		const app = {
			vault: {
				getMarkdownFiles: () => [frontmatterFile],
				read,
				cachedRead: vi.fn(),
				getAbstractFileByPath: () => null,
				process: vi.fn(),
			},
			metadataCache: {
				getFileCache: () => ({
					frontmatter: { tags: ["单词"] },
				}),
			},
		} as unknown as App;

		const store = createObsidianContinuitySourceStore(app);
		const docs = await store.list(["#单词"]);

		expect(read).toHaveBeenCalledWith(frontmatterFile);
		expect(docs).toHaveLength(1);
	});
});
