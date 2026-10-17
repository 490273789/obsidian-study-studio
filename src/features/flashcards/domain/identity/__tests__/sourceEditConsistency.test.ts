import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import { formatCardIdentityMarker } from "../../cards/cardFormat";
import { parseFlashcards } from "../../cards/parser";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
	type ContinuitySourceDocument,
} from "../cardIdentityContinuity";

const PATH = "words.md";
const OTHER = "other.md";
const APPLE = "550e8400-e29b-41d4-a716-446655440000";
const PEAR = "7d444840-9dc0-11d1-b245-5ffdce74fad2";

function block(identity: string, word: string): string {
	return `${formatCardIdentityMarker(identity)}\n## ${word}\n??\n释义\n::\n笔记\n;;\n`;
}

function deckFor(content: string): Deck {
	return {
		id: PATH,
		filePath: PATH,
		name: "words",
		tag: "#单词",
		studyCount: 1,
		lastStudied: null,
		cards: parseFlashcards(content, PATH).map((card) => ({
			...card,
			fsrsCard: createEmptyCard(),
		})),
	};
}

function fixture(
	options: {
		source?: string;
		otherSource?: string;
		journal?: CardIdentityContinuityState["continuity"]["journal"];
		condition?: CardIdentityContinuityState["continuity"]["sources"][string];
		configuredTags?: string[];
		deckContent?: string;
	} = {},
) {
	const source = options.source ?? `#单词\n${block(APPLE, "apple")}`;
	const documents: ContinuitySourceDocument[] = [
		{ path: PATH, basename: "words", content: source },
	];
	if (options.otherSource) {
		documents.push({ path: OTHER, basename: "other", content: options.otherSource });
	}
	let state: CardIdentityContinuityState = {
		configuredTags: options.configuredTags ?? ["#单词"],
		decks: new Map([[PATH, deckFor(options.deckContent ?? source)]]),
		continuity: {
			sources: options.condition ? { [PATH]: options.condition } : {},
			issues: [],
			journal: options.journal ?? null,
		},
	};
	const continuity = createCardIdentityContinuity({
		sources: {
			list: async () => documents.map((document) => ({ ...document })),
			read: async (path) => documents.find((document) => document.path === path) ?? null,
			replaceIfUnchanged: async (path, expected, next) => {
				const target = documents.find((document) => document.path === path);
				if (!target || target.content !== expected) return "stale";
				target.content = next;
				return "written";
			},
		},
		state: {
			load: async () => state,
			commit: async (next) => {
				state = next;
			},
		},
		createIdentity: () => PEAR,
	});
	return { continuity, source };
}

const journal: NonNullable<CardIdentityContinuityState["continuity"]["journal"]> = {
	id: "journal",
	type: "migration",
	completedSources: [],
	pendingSources: [],
	sources: [],
};

describe("shared source-edit decision", () => {
	it("answers a pending journal the same way for both entries", async () => {
		const { continuity, source } = fixture({ journal });

		expect(await continuity.sourceEdits.prepare(PATH, source)).toEqual({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(await continuity.prepareEdit(PATH, APPLE)).toEqual({
			kind: "blocked",
			reason: "source-needs-repair",
		});
	});

	it("answers legacy sources the same way for both entries", async () => {
		const { continuity } = fixture({ condition: { type: "legacy", cardCount: 1 } });

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "blocked",
			reason: "migration-required",
		});
	});

	it("answers last-known-good sources with the same repair issue", async () => {
		const { continuity, source } = fixture({
			condition: { type: "last-known-good", reason: "source-failure" },
		});

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(await continuity.sourceEdits.prepare(PATH, source)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
	});

	it("blocks a duplicate identity found in another fresh source for both entries", async () => {
		const { continuity, source } = fixture({
			otherSource: `#单词\n${block(APPLE, "apple")}`,
		});

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(await continuity.sourceEdits.prepare(PATH, source)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
	});

	it("blocks prepareEdit when the configured tag disappears from the fresh source", async () => {
		const { continuity } = fixture({
			source: block(APPLE, "apple"),
			configuredTags: ["#单词"],
		});

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
	});

	it("blocks prepareEdit when the card no longer exists in the fresh source", async () => {
		const { continuity } = fixture({
			source: `#单词\n${block(PEAR, "pear")}`,
			deckContent: `#单词\n${block(APPLE, "apple")}`,
		});

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "blocked",
			reason: "source-needs-repair",
		});
	});

	it("recovers a pending journal before a source batch edit", async () => {
		const { continuity, source } = fixture({ journal });

		await expect(
			continuity.sourceEdits.change({ path: PATH, expectedContent: source, changes: [] }),
		).resolves.toEqual({ kind: "applied" });
	});

	it("keeps both entries ready for a current managed source", async () => {
		const { continuity, source } = fixture();

		expect(await continuity.prepareEdit(PATH, APPLE)).toMatchObject({
			kind: "ready",
			card: { id: APPLE },
		});
		expect(await continuity.sourceEdits.prepare(PATH, source)).toMatchObject({
			kind: "ready",
			cards: [{ identity: APPLE }],
		});
	});
});
