import { afterEach, describe, expect, it, vi } from "vitest";
import * as parser from "../../cards/parser";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
	type ContinuitySourceDocument,
} from "../cardIdentityContinuity";

const APPLE = "550e8400-e29b-41d4-a716-446655440000";
const BANANA = "7d444840-9dc0-11d1-b245-5ffdce74fad2";
function document(path: string, id: string, front = "word"): ContinuitySourceDocument {
	return {
		path,
		basename: path.replace(/\.md$/, ""),
		content: `#单词\n<!-- wsr-card-id: ${id} -->\n${front}\n??\nmeaning\n;;`,
	};
}
function setup(initial = [document("a.md", APPLE), document("b.md", BANANA)]) {
	let state: CardIdentityContinuityState = {
		configuredTags: ["#单词"],
		decks: new Map(),
		continuity: { sources: {}, issues: [], journal: null },
	};
	const documents = [...initial];
	const list = vi.fn(async () => documents.map((doc) => ({ ...doc })));
	const commit = vi.fn(async (next: CardIdentityContinuityState) => {
		state = next;
	});
	const continuity = createCardIdentityContinuity({
		state: { load: async () => state, commit },
		sources: {
			list,
			replaceIfUnchanged: async (path, before, after) => {
				const doc = documents.find((doc) => doc.path === path);
				if (!doc || doc.content !== before) return "stale";
				doc.content = after;
				return "written";
			},
		},
		createIdentity: () => BANANA,
	});
	return { continuity, documents, list, commit, state: () => state };
}
afterEach(() => vi.restoreAllMocks());

describe("continuity source reuse", () => {
	it("reuses unchanged syntax but reads sources and merges latest learning state every time", async () => {
		const parse = vi.spyOn(parser, "parseFlashcards");
		const { continuity, state, list, documents } = setup();
		expect((await continuity.synchronize()).kind).toBe("current");
		expect(parse).toHaveBeenCalledTimes(2);
		const deck = state().decks.get("a.md")!;
		deck.cards[0] = {
			...deck.cards[0]!,
			fsrsCard: { ...deck.cards[0]!.fsrsCard, reps: 19, stability: 8 },
		};
		deck.studyCount = 7;
		expect((await continuity.synchronize()).kind).toBe("current");
		expect(parse).toHaveBeenCalledTimes(2);
		expect(list).toHaveBeenCalledTimes(2);
		expect(state().decks.get("a.md")?.cards[0]?.fsrsCard.reps).toBe(19);
		expect(state().decks.get("a.md")?.studyCount).toBe(7);
		// Same-length changes must invalidate even without a file-stat signal.
		documents[1]!.content = documents[1]!.content.replace("word", "term");
		await continuity.synchronize();
		expect(parse).toHaveBeenCalledTimes(3);
		expect(state().decks.get("b.md")?.cards[0]?.front).toBe("term");
	});

	it("still detects a global conflict between changed and reused sources", async () => {
		const parse = vi.spyOn(parser, "parseFlashcards");
		const { continuity, documents, state } = setup();
		await continuity.synchronize();
		documents[1]!.content = documents[1]!.content.replace(BANANA, APPLE);
		expect((await continuity.synchronize()).kind).toBe("attention-required");
		expect(parse).toHaveBeenCalledTimes(3);
		expect(state().continuity.issues[0]).toMatchObject({
			type: "identity-conflict",
			affectedSources: ["a.md", "b.md"],
		});
		expect(state().decks.get("b.md")?.cards[0]?.id).toBe(BANANA);
		documents[1]!.content = documents[1]!.content.replace(APPLE, BANANA);
		expect((await continuity.synchronize()).kind).toBe("current");
		expect(state().continuity.issues).toEqual([]);
	});

	it("drops deleted sources and never revives their cached learning state on re-add", async () => {
		const parse = vi.spyOn(parser, "parseFlashcards");
		const { continuity, documents, state } = setup();
		await continuity.synchronize();
		state().decks.get("a.md")!.cards[0]!.fsrsCard.reps = 40;
		const removed = documents.shift()!;
		await continuity.synchronize();
		expect(state().decks.has("a.md")).toBe(false);
		documents.push(removed);
		await continuity.synchronize();
		expect(parse).toHaveBeenCalledTimes(3);
		expect(state().decks.get("a.md")?.cards[0]?.fsrsCard.reps).toBe(0);
	});

	it("revalidates configured tags and discovery-only status even when text is unchanged", async () => {
		const { continuity, documents, state } = setup();
		documents[1]!.discoveryOnly = true;
		await continuity.synchronize();
		expect([...state().decks.keys()]).toEqual(["a.md"]);
		documents[1]!.discoveryOnly = false;
		await continuity.synchronize();
		expect([...state().decks.keys()]).toEqual(["a.md", "b.md"]);
		state().configuredTags = ["#其他"];
		await continuity.synchronize();
		expect(state().decks.size).toBe(0);
		expect(state().availableTags).toEqual(["#单词"]);
		state().configuredTags = ["#单词"];
		await continuity.synchronize();
		expect(state().decks.size).toBe(2);
	});

	it("does not retain failed-commit or externally replaced learning state", async () => {
		const { continuity, state, commit } = setup();
		await continuity.synchronize();
		commit.mockRejectedValueOnce(new Error("disk full"));
		expect((await continuity.synchronize()).kind).toBe("failed");
		const deck = state().decks.get("a.md")!;
		state().decks.set("a.md", {
			...deck,
			cards: [
				{
					...deck.cards[0]!,
					front: "outdated derived text",
					fsrsCard: { ...deck.cards[0]!.fsrsCard, reps: 51 },
				},
			],
		});
		expect((await continuity.synchronize()).kind).toBe("current");
		expect(state().decks.get("a.md")?.cards[0]?.front).toBe("word");
		expect(state().decks.get("a.md")?.cards[0]?.fsrsCard.reps).toBe(51);
	});

	it("reparses renamed paths but preserves stable-identity learning state", async () => {
		const { continuity, documents, state } = setup();
		await continuity.synchronize();
		state().decks.get("a.md")!.cards[0]!.fsrsCard.reps = 6;
		documents[0]!.path = "renamed.md";
		documents[0]!.basename = "renamed";
		await continuity.synchronize();
		expect(state().decks.has("a.md")).toBe(false);
		expect(state().decks.get("renamed.md")?.cards[0]).toMatchObject({
			sourceFile: "renamed.md",
			fsrsCard: { reps: 6 },
		});
	});

	it("reloads journal-written content instead of reusing the warm syntax snapshot", async () => {
		const { continuity, documents, state, list } = setup();
		await continuity.synchronize();
		state().decks.get("a.md")!.cards[0]!.fsrsCard.reps = 12;
		const expectedContent = documents[0]!.content;
		state().continuity.journal = {
			id: "repair-after-warm-sync",
			type: "repair",
			completedSources: [],
			pendingSources: ["a.md"],
			sources: [
				{
					path: "a.md",
					expectedContent,
					nextContent: expectedContent.replace("word", "repaired"),
					identityMap: {},
				},
			],
		};
		expect((await continuity.synchronize()).kind).toBe("current");
		expect(list).toHaveBeenCalledTimes(3);
		expect(state().continuity.journal).toBeNull();
		expect(state().decks.get("a.md")?.cards[0]).toMatchObject({
			front: "repaired",
			fsrsCard: { reps: 12 },
		});
		await continuity.synchronize();
		expect(state().decks.get("a.md")?.cards[0]?.front).toBe("repaired");
	});

	it("parses only excess sources without evicting the warm cache on a large scan", async () => {
		const parse = vi.spyOn(parser, "parseFlashcards");
		const docs = Array.from({ length: 2049 }, (_, index) =>
			document(
				`${index}.md`,
				`550e8400-e29b-41d4-a716-${index.toString().padStart(12, "0")}`,
			),
		);
		const { continuity, state } = setup(docs);
		await continuity.synchronize();
		parse.mockClear();
		await continuity.synchronize();
		expect(parse).toHaveBeenCalledTimes(1);
		expect(state().decks.size).toBe(2049);
	});
});
