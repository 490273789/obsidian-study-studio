import { describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import {
	createCardIdentityContinuity,
	type CardIdentityContinuityState,
	type ContinuitySourceDocument,
} from "../cardIdentityContinuity";
import { parseFlashcards } from "../../cards/parser";
import { formatCardIdentityMarker } from "../../cards/cardFormat";

const PATH = "words.md";
const IDS = [
	"550e8400-e29b-41d4-a716-446655440000",
	"7d444840-9dc0-11d1-b245-5ffdce74fad2",
	"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
	"16fd2706-8baf-433b-82eb-8c7fada847da",
] as const;

function block(identity: string, word = "apple") {
	return `${formatCardIdentityMarker(identity)}\n## ${word}\n??\n旧释义\n::\n笔记\n;;\n`;
}

function fixture(content: string, indexed = true) {
	const documents: ContinuitySourceDocument[] = [{ path: PATH, basename: "words", content }];
	let state: CardIdentityContinuityState = {
		configuredTags: ["#单词"],
		decks: new Map(
			indexed
				? [
						[
							PATH,
							{
								id: PATH,
								filePath: PATH,
								name: "words",
								tag: "#单词",
								studyCount: 4,
								lastStudied: null,
								cards: parseFlashcards(content, PATH).map((card, index) => ({
									...card,
									fsrsCard: { ...createEmptyCard(), reps: index + 5 },
								})),
							},
						],
					]
				: [],
		),
		continuity: { sources: {}, issues: [], journal: null },
	};
	const replace = vi.fn(async (path: string, expected: string, next: string) => {
		const source = documents.find((document) => document.path === path);
		if (!source || source.content !== expected) return "stale" as const;
		source.content = next;
		return "written" as const;
	});
	const continuity = createCardIdentityContinuity({
		sources: {
			list: async () => documents.map((document) => ({ ...document })),
			read: async (path) => documents.find((document) => document.path === path) ?? null,
			replaceIfUnchanged: replace,
		},
		state: {
			load: async () => state,
			commit: async (next) => {
				state = next;
			},
		},
		createIdentity: () => IDS[3],
	});
	return { continuity, documents, replace, state: () => state };
}

describe("managed source mutations", () => {
	it("protects stable markers outside configured decks until configuration or identity is repaired", async () => {
		const content = block(IDS[0]) + "\n" + block(IDS[1]);
		const f = fixture(content, false);
		expect(await f.continuity.sourceEdits.prepare(PATH, content)).toEqual({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [{ kind: "delete", identity: IDS[0] }],
			}),
		).toEqual({ kind: "blocked", reason: "source-needs-repair" });
		expect(f.replace).not.toHaveBeenCalled();
		expect(f.documents[0]!.content).toBe(content);
	});

	it("atomically deletes earlier duplicates and edits the last while preserving learning and outside bytes", async () => {
		const content = (
			"#单词\n\n" +
			block(IDS[0]) +
			"\n" +
			block(IDS[1]) +
			"\n" +
			block(IDS[2]) +
			"\n尾部正文\n\n"
		).replaceAll("\n", "\r\n");
		const f = fixture(content);
		expect(await f.continuity.sourceEdits.prepare(PATH, content)).toMatchObject({
			kind: "ready",
			cards: [{ identity: IDS[0] }, { identity: IDS[1] }, { identity: IDS[2] }],
		});
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [
					{ kind: "delete", identity: IDS[0] },
					{ kind: "delete", identity: IDS[1] },
					{
						kind: "edit",
						identity: IDS[2],
						content: { front: "## Apple", back: "新释义", explanation: "" },
					},
				],
			}),
		).toEqual({ kind: "applied" });
		expect(f.replace).toHaveBeenCalledTimes(1);
		const next = f.documents[0]!.content;
		expect(next.startsWith("#单词\r\n\r\n")).toBe(true);
		expect(next.endsWith("\r\n尾部正文\r\n\r\n")).toBe(true);
		expect(next).toContain(`${formatCardIdentityMarker(IDS[2])}\r\n## Apple`);
		expect(next).not.toMatch(/(?<!\r)\n/);
		expect(f.state().decks.get(PATH)?.cards).toMatchObject([
			{ id: IDS[2], fsrsCard: { reps: 7 } },
		]);
	});

	it("adds a stable card and retains other cards' learning", async () => {
		const content = "#单词\n" + block(IDS[0]) + "\n尾部正文\n\n";
		const f = fixture(content);
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [
					{ kind: "add", content: { front: "## banana", back: "香蕉", explanation: "" } },
				],
			}),
		).toEqual({ kind: "applied" });
		expect(f.replace).toHaveBeenCalledTimes(1);
		expect(f.documents[0]!.content.endsWith("\n尾部正文\n\n")).toBe(true);
		expect(f.state().decks.get(PATH)?.cards).toMatchObject([
			{ id: IDS[0], fsrsCard: { reps: 5 } },
			{ id: IDS[3], fsrsCard: { reps: 0 } },
		]);
	});

	it("protects an empty configured source's first added card", async () => {
		const f = fixture("#单词\n", false);
		expect(await f.continuity.sourceEdits.prepare(PATH, "#单词\n")).toEqual({
			kind: "ready",
			cards: [],
		});
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: "#单词\n",
				changes: [{ kind: "add", content: { front: "## apple", back: "苹果" } }],
			}),
		).toEqual({ kind: "applied" });
		expect(f.state().decks.get(PATH)?.cards[0]?.id).toBe(IDS[3]);
	});

	it("blocks a previously learned source whose markers were removed after indexing", async () => {
		const f = fixture("#单词\n" + block(IDS[0]));
		f.documents[0]!.content = "#单词\n## apple\n??\n苹果\n;;\n";
		expect(await f.continuity.sourceEdits.prepare(PATH, f.documents[0]!.content)).toEqual({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(f.replace).not.toHaveBeenCalled();
	});

	it("blocks legacy cards even if persisted continuity conditions are absent", async () => {
		const content = "#单词\n## apple\n??\n苹果\n;;\n";
		const f = fixture(content);
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [{ kind: "add", content: { front: "## banana", back: "香蕉" } }],
			}),
		).toEqual({ kind: "blocked", reason: "migration-required" });
		expect(f.replace).not.toHaveBeenCalled();
	});

	it("blocks fresh identity conflicts in another source", async () => {
		const content = "#单词\n" + block(IDS[0]);
		const f = fixture(content);
		f.documents.push({ path: "copy.md", basename: "copy", content });
		expect(await f.continuity.sourceEdits.prepare(PATH, content)).toEqual({
			kind: "blocked",
			reason: "source-needs-repair",
		});
		expect(f.replace).not.toHaveBeenCalled();
	});

	it("rechecks freshness and validates every operation before any write", async () => {
		const content = "#单词\n" + block(IDS[0]) + block(IDS[1]);
		const f = fixture(content);
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [
					{ kind: "delete", identity: IDS[0] },
					{ kind: "edit", identity: IDS[1], content: { front: "## apple", back: "" } },
				],
			}),
		).toEqual({ kind: "validation-failed", error: { type: "missing-back" } });
		f.documents[0]!.content += "外部变更";
		expect(
			await f.continuity.sourceEdits.change({
				path: PATH,
				expectedContent: content,
				changes: [{ kind: "delete", identity: IDS[0] }],
			}),
		).toEqual({ kind: "source-changing" });
		expect(f.replace).not.toHaveBeenCalled();
	});
});
