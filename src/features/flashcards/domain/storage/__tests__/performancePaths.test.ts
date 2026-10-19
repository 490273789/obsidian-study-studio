import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import type { Deck } from "../../../../../core/shared/types";
import type { DeckIndexCache } from "../../../../../core/storage/deckIndexCache";
import { WorkbenchStore } from "../../../../../core/storage/workbenchStore";
import { WorkbenchFlashcardAuthority } from "../../../obsidian/workbenchFlashcardAuthority";
import { createCardIdentityContinuity } from "../../identity/cardIdentityContinuity";
import { createDeckHome } from "../../decks/deckHome";
import { createSessionLifecycle } from "../../sessions/sessionLifecycle";
import {
	FlashcardRepository,
	type SerializedDeck,
	type SessionJournalTimer,
} from "../flashcardRepository";
import type { SessionJournalStore } from "../sessionJournal";
import { MemorySessionJournal, createManualJournalTimer } from "./memorySessionJournal";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

const NOW = new Date(2026, 9, 14, 12).getTime();
const SAMPLES = 20;
const WARMUP = 3;

interface FixtureOptions {
	sessionJournal?: SessionJournalStore;
	journalTimer?: SessionJournalTimer;
}

async function fixture(options: FixtureOptions = {}) {
	const journal =
		options.sessionJournal instanceof MemorySessionJournal ? options.sessionJournal : null;
	const journalTimer = options.journalTimer ? null : createManualJournalTimer();
	const timer = options.journalTimer ?? journalTimer!.timer;
	const paths = ["notes/words-a.md", "notes/words-b.md"];
	const settings = {
		...structuredClone(DEFAULT_SETTINGS),
		dailyReviewCards: 1000,
		wordLearningDecks: Object.fromEntries(paths.map((path) => [path, true])),
	};
	let json = JSON.stringify({ schemaVersion: 2, settings });
	let writes = 0;
	const store = new WorkbenchStore({
		loadData: async () => JSON.parse(json),
		saveData: async (data: unknown) => {
			json = JSON.stringify(data);
			writes++;
		},
	});
	let cached: DeckIndexCache<SerializedDeck> | null = null;
	const repo = new FlashcardRepository({
		authority: new WorkbenchFlashcardAuthority({ store }),
		deckIndexCache: {
			load: async () => structuredClone(cached),
			save: async (next) => {
				cached = structuredClone(next);
			},
			loadOrRebuild: vi.fn(),
			invalidateSource: vi.fn(),
			clear: vi.fn(),
		},
		...(options.sessionJournal
			? { sessionJournal: options.sessionJournal, journalTimer: timer }
			: {}),
	});
	const state = await repo.createContinuityStateStore().load();
	const sources = paths.map((path, deckIndex) => {
		const deck: Deck = {
			id: path,
			name: path,
			filePath: path,
			tag: settings.flashcardTags[0]!,
			studyCount: 0,
			lastStudied: null,
			cards: Array.from({ length: deckIndex === 0 ? 1207 : 1206 }, (_, index) => ({
				id: `550e8400-e29b-41d4-a716-${String(deckIndex * 1207 + index).padStart(12, "0")}`,
				front: "word",
				back: "释义",
				sourceFile: path,
				indexInFile: index,
				fsrsCard: { ...createEmptyCard(new Date(NOW)), state: State.Review, reps: 1 },
			})),
		};
		state.decks.set(path, deck);
		return {
			path,
			basename: path,
			content: `${deck.tag}\n${deck.cards.map((card) => `<!-- wsr-card-id: ${card.id} -->\n${card.front}\n??\n${card.back}\n;;`).join("\n")}`,
		};
	});
	await repo.createContinuityStateStore().commit(state);
	const identity = createCardIdentityContinuity({
		state: repo.createContinuityStateStore(),
		sources: { list: async () => sources, replaceIfUnchanged: vi.fn() },
		createIdentity: () => {
			throw new Error("Stable identities are already present");
		},
	});
	await identity.synchronize();
	const home = createDeckHome({
		repository: repo,
		identity,
		saveSettingsPatch: vi.fn(),
		exportDeck: vi.fn(),
		report: vi.fn(),
		clock: { now: () => new Date(NOW), setTimeout: () => 0, clearTimeout: () => {} },
	});
	const { lifecycle } = createSessionLifecycle(repo, {
		now: () => NOW,
		shuffle: (cards) => [...cards],
	});
	return {
		repo,
		store,
		home,
		lifecycle,
		journal,
		journalTimer: journalTimer!,
		writes: () => writes,
		path: paths[0]!,
	};
}

async function measure(action: (index: number) => Promise<void>) {
	const samples: number[] = [];
	for (let index = 0; index < WARMUP + SAMPLES; index++) {
		const start = performance.now();
		await action(index);
		if (index >= WARMUP) samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return {
		samples: samples.length,
		medianMs: Number(samples[Math.floor(samples.length / 2)]!.toFixed(3)),
		p95Ms: Number(samples[Math.ceil(samples.length * 0.95) - 1]!.toFixed(3)),
	};
}

describe("synthetic performance paths (2413 cards / two decks / JSON backend)", () => {
	it("measures durable answers, open refreshes, settings persistence, and local home publishes", async () => {
		const f = await fixture();
		try {
			const publish = await measure(async () => {
				await f.home.act({ kind: "release-owner", ownerId: "benchmark" });
			});
			const refreshStart = f.writes();
			const open = await measure(async () => {
				expect((await f.home.act({ kind: "refresh" })).kind).toBe("applied");
			});
			expect(f.writes()).toBe(refreshStart);
			expect(f.home.getSnapshot().totals.totalCards).toBe(2413);
			expect(
				(
					await f.lifecycle.start({
						mode: "study",
						deckId: f.path,
						studyOrder: "sequential",
						direction: "normal",
					})
				).kind,
			).toBe("applied");
			const answerStart = f.writes();
			const answer = await measure(async () => {
				const active = f.lifecycle.getSnapshot();
				if (active.kind !== "active" || active.mode !== "study")
					throw new Error("Expected study session");
				expect(
					(await f.lifecycle.act(active.reference, { kind: "answer", rating: 5 })).kind,
				).toBe("applied");
			});
			expect(f.writes() - answerStart).toBe(SAMPLES + WARMUP);
			const settings = await measure(async (index) => {
				let unsubscribe = () => {};
				const reconciled = new Promise<void>((resolve) => {
					unsubscribe = f.repo.subscribe(() => {
						unsubscribe();
						resolve();
					});
				});
				await f.store.saveSettings({
					...f.store.getSettings(),
					dailyReviewCards: 1001 + index,
				});
				await reconciled;
			});
			process.stdout.write(
				JSON.stringify({
					cards: 2413,
					decks: 2,
					warmup: WARMUP,
					answer,
					open,
					settings,
					publish,
				}) + "\n",
			);
		} finally {
			f.home.dispose();
			f.repo.dispose();
		}
	});

	it("answers through the session journal without rewriting data.json", async () => {
		const f = await fixture({ sessionJournal: new MemorySessionJournal() });
		try {
			expect(
				(
					await f.lifecycle.start({
						mode: "study",
						deckId: f.path,
						studyOrder: "sequential",
						direction: "normal",
					})
				).kind,
			).toBe("applied");
			const journal = f.journal!;
			const answerStart = f.writes();
			for (let index = 0; index < 5; index++) {
				const active = f.lifecycle.getSnapshot();
				if (active.kind !== "active" || active.mode !== "study")
					throw new Error("Expected study session");
				expect(
					(await f.lifecycle.act(active.reference, { kind: "answer", rating: 5 })).kind,
				).toBe("applied");
			}
			expect(f.writes()).toBe(answerStart);
			expect(journal.entries()).toHaveLength(5);

			f.journalTimer.runAll();
			await vi.waitFor(() => expect(f.writes()).toBe(answerStart + 1));
			expect(journal.entries()).toHaveLength(0);
		} finally {
			f.home.dispose();
			f.repo.dispose();
		}
	});
});
