import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
	type ContinuitySourceDocument,
	type ContinuitySourceStore,
	type ContinuitySessionChange,
	type ContinuitySessionAdapter,
	type ContinuityStateStore,
} from "../cardIdentityContinuity";
import type { Deck, FlashCard } from "../../../../../core/shared/types";

const APPLE_ID = "550e8400-e29b-41d4-a716-446655440000";
const BANANA_ID = "7d444840-9dc0-11d1-b245-5ffdce74fad2";

function makeCard(id: string, front: string, reps: number, sourceFile: string): FlashCard {
	return {
		id,
		front,
		back: `${front} back`,
		fsrsCard: {
			...createEmptyCard(),
			state: State.Review,
			reps,
		},
		sourceFile,
		indexInFile: 0,
	};
}

function makeDeck(path: string, cards: FlashCard[]): Deck {
	return {
		id: path,
		name: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
		filePath: path,
		tag: "#单词",
		cards: cards.map((card, indexInFile) => ({ ...card, indexInFile })),
		studyCount: 2,
		lastStudied: null,
	};
}

class MemorySourceStore implements ContinuitySourceStore {
	constructor(readonly documents: ContinuitySourceDocument[]) {}

	async list(): Promise<ContinuitySourceDocument[]> {
		return this.documents.map((document) => ({ ...document }));
	}

	async replaceIfUnchanged(
		path: string,
		expectedContent: string,
		nextContent: string,
	): Promise<"written" | "stale"> {
		const document = this.documents.find((candidate) => candidate.path === path);
		if (!document || document.content !== expectedContent) return "stale";
		document.content = nextContent;
		return "written";
	}
}

class MemoryStateStore implements ContinuityStateStore {
	constructor(public state: CardIdentityContinuityState) {}

	async load(): Promise<CardIdentityContinuityState> {
		return this.state;
	}

	async commit(state: CardIdentityContinuityState): Promise<void> {
		this.state = state;
	}
}

class FailingJournalStateStore extends MemoryStateStore {
	override async commit(state: CardIdentityContinuityState): Promise<void> {
		if (state.continuity.journal) throw new Error("journal unavailable");
		await super.commit(state);
	}
}

class StaleOnceSourceStore extends MemorySourceStore {
	private stale = true;

	override async replaceIfUnchanged(
		path: string,
		expectedContent: string,
		nextContent: string,
	): Promise<"written" | "stale"> {
		if (this.stale) {
			this.stale = false;
			return "stale";
		}
		return super.replaceIfUnchanged(path, expectedContent, nextContent);
	}
}

describe("CardIdentityContinuity", () => {
	it("deletes a card through change without exposing an identity map", async () => {
		const path = "notes/deck.md";
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([
				[
					path,
					makeDeck(path, [
						makeCard(APPLE_ID, "苹果", 7, path),
						makeCard(BANANA_ID, "香蕉", 3, path),
					]),
				],
			]),
			continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "deck",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果
??
apple
;;

<!-- wsr-card-id: ${BANANA_ID} -->
香蕉
??
banana
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => "16fd2706-8baf-433b-82eb-8c7fada847da",
		});

		const outcome = await continuity.change({ kind: "delete", cardIdentity: BANANA_ID });

		expect(outcome).toEqual({ kind: "applied" });
		expect(sourceStore.documents[0]?.content).not.toContain(BANANA_ID);
		expect(stateStore.state.decks.get(path)?.cards.map((card) => card.id)).toEqual([APPLE_ID]);
	});

	it("reconciles active sessions with deleted identities after sync", async () => {
		const path = "notes/deck.md";
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([
				[
					path,
					makeDeck(path, [
						makeCard(APPLE_ID, "苹果", 7, path),
						makeCard(BANANA_ID, "香蕉", 3, path),
					]),
				],
			]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "deck",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果
??
apple
;;`,
			},
		]);
		const reconciled: ContinuitySessionChange[] = [];
		const sessions: ContinuitySessionAdapter = {
			hasActiveSession: () => true,
			reconcile: async (change) => {
				reconciled.push(change);
			},
		};
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			sessions,
			createIdentity: () => "16fd2706-8baf-433b-82eb-8c7fada847da",
		});

		await continuity.synchronize();

		expect(Array.from(reconciled[0]?.availableIdentities ?? [])).toEqual([APPLE_ID]);
		expect(Array.from(reconciled[0]?.deletedIdentities ?? [])).toEqual([BANANA_ID]);
		expect(Array.from(reconciled[0]?.spellableIdentitiesByDeck?.get(path) ?? [])).toEqual([]);
	});

	it("blocks legacy migration while a session is active", async () => {
		const path = "notes/legacy.md";
		const originalContent = `#单词
苹果
??
apple
;;`;
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{ path, basename: "legacy", content: originalContent },
		]);
		const sessions: ContinuitySessionAdapter = {
			hasActiveSession: () => true,
			reconcile: async () => undefined,
		};
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			sessions,
			createIdentity: () => APPLE_ID,
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toEqual({ kind: "blocked", reason: "active-session" });
		expect(sourceStore.documents[0]?.content).toBe(originalContent);
		expect(stateStore.state.continuity.journal).toBeNull();
	});

	it("does not modify Markdown when the migration journal cannot be persisted", async () => {
		const path = "notes/legacy.md";
		const originalContent = `#单词
苹果
??
apple
;;`;
		const stateStore = new FailingJournalStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{ path, basename: "legacy", content: originalContent },
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => APPLE_ID,
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toMatchObject({ kind: "failed", retryable: true });
		expect(sourceStore.documents[0]?.content).toBe(originalContent);
	});

	it("resumes a persisted migration journal on the next synchronization", async () => {
		const path = "notes/legacy.md";
		const originalContent = `#单词
苹果
??
apple
;;`;
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new StaleOnceSourceStore([
			{ path, basename: "legacy", content: originalContent },
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => APPLE_ID,
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		const firstAttempt = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(firstAttempt).toMatchObject({ kind: "resumable", pendingDeckIds: [path] });
		expect(stateStore.state.continuity.journal).not.toBeNull();

		const recovery = await continuity.synchronize();

		expect(recovery).toMatchObject({ kind: "current" });
		expect(stateStore.state.continuity.journal).toBeNull();
		expect(stateStore.state.decks.get(path)?.cards[0]).toMatchObject({
			id: APPLE_ID,
			fsrsCard: { reps: 7 },
		});
		expect(sourceStore.documents[0]?.content).toContain(APPLE_ID);
	});

	it("repairs a duplicate identity by assigning its learning state to the chosen card", async () => {
		const pathA = "notes/a.md";
		const pathB = "notes/b.md";
		const oldDeckA = makeDeck(pathA, [makeCard(APPLE_ID, "苹果 old", 7, pathA)]);
		const oldDeckB = makeDeck(pathB, [makeCard(BANANA_ID, "香蕉 old", 3, pathB)]);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([
				[pathA, oldDeckA],
				[pathB, oldDeckB],
			]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path: pathA,
				basename: "a",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果 A
??
apple a
;;`,
			},
			{
				path: pathB,
				basename: "b",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果 B
??
apple b
;;`,
			},
		]);
		const freshIdentity = "16fd2706-8baf-433b-82eb-8c7fada847da";
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => freshIdentity,
		});

		await continuity.synchronize();
		const issue = continuity.inspect().issues[0];
		if (!issue || issue.type !== "identity-conflict") {
			throw new Error("Expected identity conflict");
		}
		const chosen = issue.candidates.find((candidate) => candidate.sourcePath === pathB);
		if (!chosen) throw new Error("Expected repair candidate");

		const outcome = await continuity.resolve({
			kind: "repair",
			ticket: issue.ticket,
			issueId: issue.id,
			successors: [{ cardIdentity: APPLE_ID, occurrence: chosen.token }],
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(stateStore.state.decks.get(pathB)?.cards[0]).toMatchObject({
			id: APPLE_ID,
			front: "苹果 B",
			fsrsCard: { reps: 7 },
		});
		expect(stateStore.state.decks.get(pathA)?.cards[0]).toMatchObject({
			id: freshIdentity,
			front: "苹果 A",
			fsrsCard: { reps: 0 },
		});
		expect(continuity.inspect().issues).toEqual([]);
	});

	it("migrates a legacy deck through an explicit preview ticket", async () => {
		const path = "notes/legacy.md";
		const legacyApple = makeCard(`${path}::0`, "苹果", 7, path);
		const legacyBanana = makeCard(`${path}::1`, "香蕉", 3, path);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [legacyApple, legacyBanana])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "legacy",
				content: `#单词
苹果
??
apple
;;

香蕉
??
banana
;;`,
			},
		]);
		const generated = [APPLE_ID, BANANA_ID];
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => generated.shift() ?? "unexpected",
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		expect(preview).toMatchObject({ sourceCount: 1, cardCount: 2 });
		if (!preview) throw new Error("Expected migration preview");

		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(sourceStore.documents[0]?.content).toContain(
			`<!-- wsr-card-id: ${APPLE_ID} -->\n苹果`,
		);
		expect(stateStore.state.decks.get(path)?.cards).toEqual([
			expect.objectContaining({
				id: APPLE_ID,
				fsrsCard: expect.objectContaining({ reps: 7 }),
			}),
			expect.objectContaining({
				id: BANANA_ID,
				fsrsCard: expect.objectContaining({ reps: 3 }),
			}),
		]);
		expect(stateStore.state.continuity.journal).toBeNull();
	});

	it("edits the same legacy card after its deck is explicitly migrated", async () => {
		const path = "notes/legacy.md";
		const legacyIdentity = `${path}::0`;
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(legacyIdentity, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "legacy",
				content: `#单词
苹果
??
apple
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => APPLE_ID,
		});

		await continuity.synchronize();
		expect(
			await continuity.change({
				kind: "edit",
				cardIdentity: legacyIdentity,
				content: { front: "青苹果", back: "green apple" },
			}),
		).toEqual({ kind: "blocked", reason: "migration-required" });

		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		expect(
			await continuity.resolve({
				kind: "migrate",
				ticket: preview.ticket,
				deckIds: [path],
			}),
		).toEqual({ kind: "applied" });

		const migratedCard = stateStore.state.decks.get(path)?.cards[0];
		if (!migratedCard) throw new Error("Expected migrated card");
		const outcome = await continuity.change({
			kind: "edit",
			cardIdentity: migratedCard.id,
			content: { front: "青苹果", back: "green apple" },
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(sourceStore.documents[0]?.content).toContain(
			`<!-- wsr-card-id: ${APPLE_ID} -->\n青苹果\n??\ngreen apple`,
		);
		expect(stateStore.state.decks.get(path)?.cards[0]).toMatchObject({
			id: APPLE_ID,
			front: "青苹果",
			back: "green apple",
			fsrsCard: { reps: 7 },
		});
	});

	it("migrates appended legacy cards while preserving the existing prefix state", async () => {
		const path = "notes/legacy-appended.md";
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "legacy-appended",
				content: `#单词
苹果
??
苹果 back
;;

香蕉
??
香蕉 back
;;`,
			},
		]);
		const generated = [APPLE_ID, BANANA_ID];
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => generated.shift() ?? "unexpected",
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		expect(preview).toMatchObject({ sourceCount: 1, cardCount: 2 });
		if (!preview) throw new Error("Expected migration preview");
		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toEqual({ kind: "applied" });
		expect(stateStore.state.decks.get(path)?.cards).toEqual([
			expect.objectContaining({
				id: APPLE_ID,
				front: "苹果",
				fsrsCard: expect.objectContaining({ reps: 7 }),
			}),
			expect.objectContaining({
				id: BANANA_ID,
				front: "香蕉",
				fsrsCard: expect.objectContaining({ reps: 0 }),
			}),
		]);
	});

	it("does not migrate appended legacy cards when the existing prefix moved", async () => {
		const path = "notes/legacy-inserted.md";
		const originalContent = `#单词
新增卡片
??
new back
;;

苹果
??
苹果 back
;;`;
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{ path, basename: "legacy-inserted", content: originalContent },
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => APPLE_ID,
		});

		await continuity.synchronize();
		const preview = continuity.inspect().migration;
		if (!preview) throw new Error("Expected migration preview");
		const outcome = await continuity.resolve({
			kind: "migrate",
			ticket: preview.ticket,
			deckIds: [path],
		});

		expect(outcome).toEqual({ kind: "blocked", reason: "legacy-source-mismatch" });
		expect(sourceStore.documents[0]?.content).toBe(originalContent);
		expect(stateStore.state.continuity.journal).toBeNull();
	});

	it("adopts an existing valid marker during explicit legacy migration", async () => {
		const path = "notes/legacy.md";
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [makeCard(`${path}::0`, "苹果", 7, path)])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "legacy",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果
??
apple
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => BANANA_ID,
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
		expect(stateStore.state.decks.get(path)?.cards[0]).toMatchObject({
			id: APPLE_ID,
			fsrsCard: { reps: 7 },
		});
	});

	it("does not guess when an old identity disappears beside an unmarked card", async () => {
		const path = "notes/ambiguous.md";
		const oldDeck = makeDeck(path, [
			makeCard(APPLE_ID, "苹果 old", 7, path),
			makeCard(BANANA_ID, "香蕉 old", 3, path),
		]);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, oldDeck]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "ambiguous",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果
??
apple
;;

未标记的新内容
??
unknown
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => "16fd2706-8baf-433b-82eb-8c7fada847da",
		});

		const outcome = await continuity.synchronize();

		expect(outcome).toMatchObject({ kind: "attention-required" });
		expect(continuity.inspect().issues).toEqual([
			expect.objectContaining({
				type: "identity-ambiguity",
				missingIdentities: [BANANA_ID],
				affectedSources: [path],
			}),
		]);
		expect(stateStore.state.decks.get(path)).toBe(oldDeck);
		expect(sourceStore.documents[0]?.content).not.toContain("16fd2706");
	});

	it("keeps every source with a duplicate identity last-known-good", async () => {
		const pathA = "notes/a.md";
		const pathB = "notes/b.md";
		const oldDeckA = makeDeck(pathA, [makeCard(APPLE_ID, "苹果 old", 7, pathA)]);
		const oldDeckB = makeDeck(pathB, [makeCard(BANANA_ID, "香蕉 old", 3, pathB)]);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([
				[pathA, oldDeckA],
				[pathB, oldDeckB],
			]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path: pathA,
				basename: "a",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果 changed
??
apple
;;`,
			},
			{
				path: pathB,
				basename: "b",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
复制的苹果
??
apple copy
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => "16fd2706-8baf-433b-82eb-8c7fada847da",
		});

		const outcome = await continuity.synchronize();

		expect(outcome).toMatchObject({ kind: "attention-required" });
		expect(continuity.inspect().issues).toEqual([
			expect.objectContaining({
				type: "identity-conflict",
				identity: APPLE_ID,
				affectedSources: [pathA, pathB],
			}),
		]);
		expect(stateStore.state.decks.get(pathA)).toBe(oldDeckA);
		expect(stateStore.state.decks.get(pathB)).toBe(oldDeckB);
		expect(continuity.inspect().sources[pathA]).toEqual({
			type: "last-known-good",
			reason: "identity-conflict",
		});
		expect(continuity.inspect().sources[pathB]).toEqual({
			type: "last-known-good",
			reason: "identity-conflict",
		});
	});

	it("keeps a legacy deck last-known-good until explicit migration", async () => {
		const path = "notes/legacy.md";
		const legacyCard = makeCard(`${path}::0`, "旧内容", 9, path);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[path, makeDeck(path, [legacyCard])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "legacy",
				content: `#单词
新内容
??
new back
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => APPLE_ID,
		});

		const outcome = await continuity.synchronize();

		expect(outcome).toMatchObject({ kind: "attention-required" });
		expect(continuity.inspect().sources[path]).toEqual({ type: "legacy", cardCount: 1 });
		expect(stateStore.state.decks.get(path)?.cards[0]).toEqual(legacyCard);
		expect(sourceStore.documents[0]?.content).not.toContain("wsr-card-id");
	});

	it("registers identities for an unambiguously new source document", async () => {
		const path = "notes/new.md";
		const generated = [APPLE_ID, BANANA_ID];
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map(),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path,
				basename: "new",
				content: `#单词
苹果
??
apple
;;

香蕉
??
banana
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => generated.shift() ?? "unexpected",
		});

		const outcome = await continuity.synchronize();

		expect(outcome).toMatchObject({ kind: "current" });
		expect(sourceStore.documents[0]?.content).toContain(
			`<!-- wsr-card-id: ${APPLE_ID} -->\n苹果`,
		);
		expect(sourceStore.documents[0]?.content).toContain(
			`<!-- wsr-card-id: ${BANANA_ID} -->\n香蕉`,
		);
		expect(stateStore.state.decks.get(path)?.cards.map((card) => card.id)).toEqual([
			APPLE_ID,
			BANANA_ID,
		]);
	});

	it("preserves learning state when cards reorder and move between decks", async () => {
		const oldPath = "notes/a.md";
		const newPath = "notes/b.md";
		const apple = makeCard(APPLE_ID, "苹果", 7, oldPath);
		const banana = makeCard(BANANA_ID, "香蕉", 3, oldPath);
		const stateStore = new MemoryStateStore({
			configuredTags: ["#单词"],
			decks: new Map([[oldPath, makeDeck(oldPath, [apple, banana])]]),
			continuity: { sources: {}, issues: [], journal: null },
		});
		const sourceStore = new MemorySourceStore([
			{
				path: oldPath,
				basename: "a",
				content: `#单词
<!-- wsr-card-id: ${BANANA_ID} -->
香蕉 updated
??
banana back
;;`,
			},
			{
				path: newPath,
				basename: "b",
				content: `#单词
<!-- wsr-card-id: ${APPLE_ID} -->
苹果 moved
??
apple back
;;`,
			},
		]);
		const continuity = createCardIdentityContinuity({
			sources: sourceStore,
			state: stateStore,
			createIdentity: () => "16fd2706-8baf-433b-82eb-8c7fada847da",
		});

		const outcome = await continuity.synchronize();

		expect(outcome).toMatchObject({ kind: "current" });
		expect(stateStore.state.decks.get(oldPath)?.cards[0]).toMatchObject({
			id: BANANA_ID,
			front: "香蕉 updated",
			sourceFile: oldPath,
			fsrsCard: { reps: 3 },
		});
		expect(stateStore.state.decks.get(newPath)?.cards[0]).toMatchObject({
			id: APPLE_ID,
			front: "苹果 moved",
			sourceFile: newPath,
			fsrsCard: { reps: 7 },
		});
	});

	describe("prepareEdit", () => {
		it("returns ready when card exists in a current deck", async () => {
			const path = "notes/deck.md";
			const card = makeCard(APPLE_ID, "苹果", 7, path);
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [card])]]),
				continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "deck",
					content: `#单词\n<!-- wsr-card-id: ${APPLE_ID} -->\n苹果\n??\napple\n;;`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const preparation = await continuity.prepareEdit(path, APPLE_ID);

			expect(preparation).toEqual({
				kind: "ready",
				card: expect.objectContaining({ id: APPLE_ID, front: "苹果" }),
			});
		});

		it("returns ready when card is resolved by file index", async () => {
			const path = "notes/deck.md";
			const card = makeCard(APPLE_ID, "苹果", 7, path);
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [card])]]),
				continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "deck",
					content: `#单词\n<!-- wsr-card-id: ${APPLE_ID} -->\n苹果\n??\napple\n;;`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const preparation = await continuity.prepareEdit(path, "0");

			expect(preparation).toEqual({
				kind: "ready",
				card: expect.objectContaining({ id: APPLE_ID, front: "苹果" }),
			});
		});

		it("returns blocked migration-required when deck is legacy", async () => {
			const path = "notes/legacy.md";
			const card = makeCard(`${path}::0`, "苹果", 7, path);
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [card])]]),
				continuity: {
					sources: { [path]: { type: "legacy", cardCount: 1 } },
					issues: [],
					journal: null,
				},
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "legacy",
					content: `#单词\n苹果\n??\napple\n;;`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const preparation = await continuity.prepareEdit(path, `${path}::0`);

			expect(preparation).toEqual({
				kind: "blocked",
				reason: "migration-required",
			});
		});

		it("returns not-found when card is absent", async () => {
			const path = "notes/deck.md";
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [])]]),
				continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "deck",
					content: `#单词\n`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const preparation = await continuity.prepareEdit(path, "missing-id");

			expect(preparation).toEqual({ kind: "not-found" });
		});
	});

	describe("change validation errors", () => {
		it("returns validation-failed when card contains reserved marker", async () => {
			const path = "notes/deck.md";
			const card = makeCard(APPLE_ID, "苹果", 7, path);
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [card])]]),
				continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "deck",
					content: `#单词\n<!-- wsr-card-id: ${APPLE_ID} -->\n苹果\n??\napple\n;;`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const outcome = await continuity.change({
				kind: "edit",
				deckId: path,
				cardIdentity: APPLE_ID,
				content: { front: "苹果\n??\n侵入", back: "apple" },
			});

			expect(outcome).toEqual({
				kind: "validation-failed",
				error: { type: "reserved-marker", marker: "??" },
			});
		});

		it("returns validation-failed when front is empty", async () => {
			const path = "notes/deck.md";
			const card = makeCard(APPLE_ID, "苹果", 7, path);
			const stateStore = new MemoryStateStore({
				configuredTags: ["#单词"],
				decks: new Map([[path, makeDeck(path, [card])]]),
				continuity: { sources: { [path]: { type: "current" } }, issues: [], journal: null },
			});
			const sourceStore = new MemorySourceStore([
				{
					path,
					basename: "deck",
					content: `#单词\n<!-- wsr-card-id: ${APPLE_ID} -->\n苹果\n??\napple\n;;`,
				},
			]);
			const continuity = createCardIdentityContinuity({
				sources: sourceStore,
				state: stateStore,
				createIdentity: () => "test-id",
			});

			const outcome = await continuity.change({
				kind: "edit",
				deckId: path,
				cardIdentity: APPLE_ID,
				content: { front: "   ", back: "apple" },
			});

			expect(outcome).toEqual({
				kind: "validation-failed",
				error: { type: "missing-front" },
			});
		});
	});
});
