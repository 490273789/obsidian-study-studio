import type { DataAdapter } from "obsidian";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SessionJournalEntry } from "../../domain/storage/sessionJournal";
import { SESSION_JOURNAL_FILE_NAME, createSessionJournalStore } from "../sessionJournalAdapter";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

const PLUGIN_DIRECTORY = ".obsidian/plugins/obsidian-study-studio";
const PATH = `${PLUGIN_DIRECTORY}/${SESSION_JOURNAL_FILE_NAME}`;

interface FakeAdapter {
	files: Map<string, string>;
	readError: Error | null;
	adapter: DataAdapter;
}

function fakeAdapter(): FakeAdapter {
	const files = new Map<string, string>();
	const state: FakeAdapter = {
		files,
		readError: null,
		adapter: undefined as unknown as DataAdapter,
	};
	state.adapter = {
		exists: async (path: string) => files.has(path),
		read: async (path: string) => {
			if (state.readError) throw state.readError;
			const content = files.get(path);
			if (content === undefined) throw new Error(`Missing ${path}`);
			return content;
		},
		append: async (path: string, data: string) => {
			files.set(path, (files.get(path) ?? "") + data);
		},
		remove: async (path: string) => {
			files.delete(path);
		},
		write: async (path: string, data: string) => {
			files.set(path, data);
		},
	} as unknown as DataAdapter;
	return state;
}

function cardUpdate(seq: number): SessionJournalEntry {
	return {
		seq,
		at: 1_700_000_000_000 + seq,
		kind: "card-update",
		cardUpdate: {
			deckId: "notes/words.md",
			cardId: `card-${seq}`,
			fsrsCard: {
				due: "2026-10-18T00:00:00.000Z",
				stability: 1,
				difficulty: 5,
				elapsed_days: 0,
				scheduled_days: 1,
				reps: seq,
				lapses: 0,
				state: 2,
				last_review: null,
				learning_steps: 0,
			},
		},
	};
}

describe("Obsidian session journal adapter", () => {
	it("is unavailable when the vault adapter or the plugin directory is missing", () => {
		expect(createSessionJournalStore(undefined, PLUGIN_DIRECTORY)).toBeNull();
		expect(createSessionJournalStore(fakeAdapter().adapter, undefined)).toBeNull();
		expect(createSessionJournalStore(fakeAdapter().adapter, "")).toBeNull();
	});

	it("appends JSONL batches to the plugin directory and loads them back", async () => {
		const fake = fakeAdapter();
		const journal = createSessionJournalStore(fake.adapter, PLUGIN_DIRECTORY)!;
		expect(await journal.load()).toEqual([]);

		await journal.append([cardUpdate(1)]);
		await journal.append([cardUpdate(2), cardUpdate(3)]);

		expect(await journal.load()).toEqual([cardUpdate(1), cardUpdate(2), cardUpdate(3)]);
		expect(fake.files.get(PATH)?.trim().split("\n")).toHaveLength(3);
	});

	it("clears by removing the journal file", async () => {
		const fake = fakeAdapter();
		const journal = createSessionJournalStore(fake.adapter, PLUGIN_DIRECTORY)!;
		await journal.append([cardUpdate(1)]);
		expect(fake.files.has(PATH)).toBe(true);

		await journal.clear();
		expect(fake.files.has(PATH)).toBe(false);
		expect(await journal.load()).toEqual([]);
		await journal.clear();
	});

	it("tolerates an empty file, a corrupt tail, and unreadable files", async () => {
		const fake = fakeAdapter();
		const journal = createSessionJournalStore(fake.adapter, PLUGIN_DIRECTORY)!;

		fake.files.set(PATH, "");
		expect(await journal.load()).toEqual([]);

		fake.files.set(PATH, `${JSON.stringify(cardUpdate(1))}\n{"seq":2,"at":`);
		expect(await journal.load()).toEqual([cardUpdate(1)]);

		fake.files.set(PATH, "definitely not json");
		expect(await journal.load()).toEqual([]);

		fake.readError = new Error("permission denied");
		expect(await journal.load()).toEqual([]);
	});

	it("skips the disk write for an empty batch", async () => {
		const fake = fakeAdapter();
		const journal = createSessionJournalStore(fake.adapter, PLUGIN_DIRECTORY)!;
		await journal.append([]);
		expect(fake.files.has(PATH)).toBe(false);
	});
});
