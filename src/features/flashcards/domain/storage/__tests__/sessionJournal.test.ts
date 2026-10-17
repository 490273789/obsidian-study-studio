import { describe, expect, it } from "vite-plus/test";
import type { SessionJournalEntry } from "../sessionJournal";
import {
	parseSessionJournal,
	parseSessionJournalLine,
	serializeSessionJournalEntry,
} from "../sessionJournal";

const CARD_UPDATE: SessionJournalEntry = {
	seq: 1,
	at: 1_700_000_000_000,
	kind: "card-update",
	cardUpdate: {
		deckId: "notes/words.md",
		cardId: "550e8400-e29b-41d4-a716-446655440000",
		fsrsCard: {
			due: "2026-10-18T00:00:00.000Z",
			stability: 1.5,
			difficulty: 6.4,
			elapsed_days: 0,
			scheduled_days: 1,
			reps: 2,
			lapses: 0,
			state: 2,
			last_review: "2026-10-17T00:00:00.000Z",
			learning_steps: 0,
		},
	},
};

const SPELLING_ATTEMPT: SessionJournalEntry = {
	seq: 2,
	at: 1_700_000_000_001,
	kind: "spelling-attempt",
	spellingAttempt: { cardId: "c1", correct: true, attemptedAt: 1_700_000_000_001 },
};

describe("session journal format", () => {
	it("round-trips card updates and spelling attempts through one JSONL line each", () => {
		for (const entry of [CARD_UPDATE, SPELLING_ATTEMPT]) {
			const line = serializeSessionJournalEntry(entry);
			expect(line.endsWith("\n")).toBe(true);
			expect(parseSessionJournalLine(line.trim())).toEqual(entry);
		}
		expect(
			parseSessionJournal(
				`${serializeSessionJournalEntry(CARD_UPDATE)}${serializeSessionJournalEntry(SPELLING_ATTEMPT)}`,
			),
		).toEqual([CARD_UPDATE, SPELLING_ATTEMPT]);
	});

	it("returns an empty list for empty content and tolerates blank lines", () => {
		expect(parseSessionJournal("")).toEqual([]);
		expect(parseSessionJournal("\n\n")).toEqual([]);
		expect(parseSessionJournal(`\n${serializeSessionJournalEntry(CARD_UPDATE)}\n\n`)).toEqual([
			CARD_UPDATE,
		]);
	});

	it("returns the parsable prefix for a damaged or truncated tail", () => {
		const content = `${serializeSessionJournalEntry(CARD_UPDATE)}{"seq":3,"at":`;
		expect(parseSessionJournal(content)).toEqual([CARD_UPDATE]);
		expect(parseSessionJournal("not json at all\n")).toEqual([]);
	});

	it("rejects structurally invalid entries instead of throwing", () => {
		const invalidLines = [
			JSON.stringify({
				seq: 0,
				at: 1,
				kind: "spelling-attempt",
				spellingAttempt: { cardId: "c", correct: true, attemptedAt: 1 },
			}),
			JSON.stringify({
				seq: 1,
				at: 1,
				kind: "card-update",
				cardUpdate: {
					deckId: "",
					cardId: "c",
					fsrsCard:
						CARD_UPDATE.kind === "card-update" ? CARD_UPDATE.cardUpdate.fsrsCard : null,
				},
			}),
			JSON.stringify({
				seq: 1,
				at: 1,
				kind: "card-update",
				cardUpdate: { deckId: "d", cardId: "c", fsrsCard: { due: 5 } },
			}),
			JSON.stringify({
				seq: 1,
				at: 1,
				kind: "spelling-attempt",
				spellingAttempt: { cardId: "c", correct: "yes", attemptedAt: 1 },
			}),
			JSON.stringify({ seq: 1, at: 1, kind: "unknown", cardUpdate: {} }),
		];
		for (const line of invalidLines) expect(parseSessionJournalLine(line)).toBeNull();
	});
});
