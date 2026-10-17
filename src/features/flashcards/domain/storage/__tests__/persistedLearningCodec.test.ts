import { State } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import {
	PERSISTED_LEARNING_CARDS_FORMAT,
	decodePersistedLearning,
	encodePersistedLearning,
	isCompactPersistedLearning,
} from "../persistedLearningCodec";
import type {
	LearningStateDocument,
	PersistedCardLearningState,
	SerializedFSRSCard,
} from "../persistenceTypes";

const DUE = "2026-10-16T01:40:23.805Z";
const REVIEWED_AT = "2026-10-15T01:40:23.805Z";

function fsrsCard(overrides: Partial<SerializedFSRSCard> = {}): SerializedFSRSCard {
	return {
		due: DUE,
		stability: 0.212,
		difficulty: 6.4133,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 1,
		lapses: 0,
		state: State.New,
		last_review: null,
		learning_steps: 0,
		...overrides,
	};
}

function learningDocument(
	cards: Record<string, PersistedCardLearningState> = {},
): LearningStateDocument {
	return {
		cards,
		decks: { "deck-1": { studyCount: 3, lastStudied: "2026-10-01T00:00:00.000Z" } },
		studyHistory: [
			{
				date: "2026-10-01",
				deckId: "deck-1",
				deckName: "Deck",
				mode: "study",
				cardCount: 2,
				duration: 10,
				timestamp: 1,
			},
		],
		dailyLearningActivities: [
			{
				date: "2026-10-01",
				answers: { study: 2, practice: 0, spelling: 0, challenge: 0 },
				seconds: { study: 10, practice: 0, spelling: 0, "word-list": 0, challenge: 0 },
				completedAnswers: { study: 2, practice: 0, spelling: 0, challenge: 0 },
				completedSessions: { study: 1, practice: 0, spelling: 0, challenge: 0 },
			},
		],
		spellingProgress: {
			card: { attempts: 2, correctAttempts: 1, correctStreak: 1, lastAttemptAt: 2 },
		},
		challengeProgress: { version: 1, lastMode: "normal", round: null },
		continuity: { sources: {}, issues: [], journal: null },
	};
}

function emptyLearningDocument(): LearningStateDocument {
	return {
		cards: {},
		decks: {},
		studyHistory: [],
		spellingProgress: {},
		continuity: { sources: {}, issues: [], journal: null },
	};
}

describe("persisted learning codec", () => {
	it("encodes the fixed prefix and truncates trailing default slots", () => {
		const document = learningDocument({
			fresh: { fsrsCard: fsrsCard({ stability: 0.1, difficulty: 2.5 }) },
			reviewed: { fsrsCard: fsrsCard({ last_review: REVIEWED_AT }) },
			relearning: { fsrsCard: fsrsCard({ learning_steps: 2 }) },
			learning: { fsrsCard: fsrsCard({ last_review: REVIEWED_AT, learning_steps: 1 }) },
			sourced: { fsrsCard: fsrsCard(), sourceFile: "notes/source.md" },
		});

		const encoded = encodePersistedLearning(document);

		expect(encoded.cardsFormat).toBe(PERSISTED_LEARNING_CARDS_FORMAT);
		expect(isCompactPersistedLearning(encoded)).toBe(true);
		expect(encoded.cards.fresh).toEqual([DUE, 0.1, 2.5, 0, 0, 1, 0, State.New]);
		expect(encoded.cards.reviewed).toEqual([
			DUE,
			0.212,
			6.4133,
			0,
			0,
			1,
			0,
			State.New,
			REVIEWED_AT,
		]);
		// `learning_steps` needs the last_review slot to exist, so a null placeholder
		// is written when the card has never been reviewed.
		expect(encoded.cards.relearning).toEqual([
			DUE,
			0.212,
			6.4133,
			0,
			0,
			1,
			0,
			State.New,
			null,
			2,
		]);
		expect(encoded.cards.learning).toEqual([
			DUE,
			0.212,
			6.4133,
			0,
			0,
			1,
			0,
			State.New,
			REVIEWED_AT,
			1,
		]);
		expect(encoded.cards.sourced).toEqual([
			DUE,
			0.212,
			6.4133,
			0,
			0,
			1,
			0,
			State.New,
			null,
			0,
			"notes/source.md",
		]);
	});

	it("round-trips every card shape through JSON without changing the document", () => {
		const document = learningDocument({
			fresh: { fsrsCard: fsrsCard() },
			reviewed: { fsrsCard: fsrsCard({ last_review: REVIEWED_AT, state: State.Review }) },
			relearning: { fsrsCard: fsrsCard({ learning_steps: 2, elapsed_days: 1 }) },
			sourced: {
				fsrsCard: fsrsCard({ last_review: REVIEWED_AT }),
				sourceFile: "notes/source.md",
			},
		});
		const before = JSON.stringify(document);

		const encoded = encodePersistedLearning(document);
		const decoded = decodePersistedLearning(JSON.parse(JSON.stringify(encoded)));

		expect(JSON.stringify(document)).toBe(before);
		expect(document).not.toHaveProperty("cardsFormat");
		expect(decoded).toEqual(document);
	});

	it("decodes the legacy object layout with the repository field defaults", () => {
		const legacy = {
			cards: {
				complete: {
					sourceFile: "notes/source.md",
					fsrsCard: {
						due: DUE,
						stability: 2,
						difficulty: 3,
						elapsed_days: 1,
						scheduled_days: 2,
						reps: 4,
						lapses: 1,
						state: State.Review,
						last_review: REVIEWED_AT,
						learning_steps: 1,
					},
				},
				unknownReview: {
					fsrsCard: {
						due: DUE,
						stability: 0.5,
						difficulty: 5,
						elapsed_days: 0,
						scheduled_days: 0,
						reps: 0,
						lapses: 0,
						state: State.New,
						last_review: undefined,
					},
				},
				missingFields: { fsrsCard: { due: DUE } },
			},
			decks: { "deck-1": { studyCount: 3, lastStudied: null } },
			studyHistory: [],
			spellingProgress: {},
			continuity: { sources: {}, issues: [], journal: null },
		};

		const decoded = decodePersistedLearning(JSON.parse(JSON.stringify(legacy)));

		expect(decoded.cards.complete).toEqual({
			fsrsCard: legacy.cards.complete.fsrsCard,
			sourceFile: "notes/source.md",
		});
		// Missing optional fields normalize to the repository deserializer defaults.
		expect(decoded.cards.unknownReview?.fsrsCard).toMatchObject({
			last_review: null,
			learning_steps: 0,
		});
		expect(decoded.cards.missingFields?.fsrsCard).toEqual({
			due: DUE,
			stability: 0,
			difficulty: 0,
			elapsed_days: 0,
			scheduled_days: 0,
			reps: 0,
			lapses: 0,
			state: State.New,
			last_review: null,
			learning_steps: 0,
		});
		expect(decoded.decks).toEqual(legacy.decks);
	});

	it("preserves every non-card learning field through encode and decode", () => {
		const document = learningDocument({ card: { fsrsCard: fsrsCard() } });

		expect(decodePersistedLearning(encodePersistedLearning(document))).toEqual(document);
	});

	it("preserves the merged session-journal sequence through encode and decode", () => {
		const document = {
			...learningDocument({ card: { fsrsCard: fsrsCard() } }),
			journalSeq: 42,
		};

		const encoded = encodePersistedLearning(document);
		expect(encoded.journalSeq).toBe(42);
		expect(decodePersistedLearning(encoded).journalSeq).toBe(42);
		expect(decodePersistedLearning({ journalSeq: 0 }).journalSeq).toBeUndefined();
		expect(decodePersistedLearning({ journalSeq: -3 }).journalSeq).toBeUndefined();
		expect(decodePersistedLearning({ journalSeq: 2.5 }).journalSeq).toBeUndefined();
		expect(decodePersistedLearning({ journalSeq: "7" }).journalSeq).toBeUndefined();
	});

	it("returns an empty document for missing, non-object, or unknown-format input", () => {
		const empty = emptyLearningDocument();

		for (const value of [undefined, null, "data.json", 42, [], {}]) {
			expect(decodePersistedLearning(value)).toEqual(empty);
		}

		const future = decodePersistedLearning({
			cardsFormat: PERSISTED_LEARNING_CARDS_FORMAT + 1,
			cards: { card: [DUE, 1, 2, 3, 4, 5, 6, State.New] },
			decks: { "deck-1": { studyCount: 1, lastStudied: null } },
			studyHistory: [],
			spellingProgress: {},
			continuity: { sources: {}, issues: [], journal: null },
		});
		expect(future.cards).toEqual({});
		expect(future.decks).toEqual({ "deck-1": { studyCount: 1, lastStudied: null } });
	});

	it("ignores corrupt card entries instead of throwing", () => {
		const decoded = decodePersistedLearning({
			cardsFormat: PERSISTED_LEARNING_CARDS_FORMAT,
			cards: {
				tuple: [DUE, 1, 2, 3, 4, 5, 6, State.Review],
				object: { fsrsCard: fsrsCard({ reps: 9 }) },
				shortTuple: [DUE, 1, 2],
				nullCard: null,
				text: "corrupt",
				badDue: [123, 1, 2, 3, 4, 5, 6, State.New],
				badNumber: [DUE, "1", 2, 3, 4, 5, 6, State.New],
				badFsrsCard: { fsrsCard: { stability: 1 } },
			},
			decks: { "deck-1": { studyCount: 1, lastStudied: null } },
			studyHistory: "corrupt",
			spellingProgress: [],
			continuity: null,
		});

		expect(Object.keys(decoded.cards).sort()).toEqual(["object", "tuple"]);
		expect(decoded.cards.object?.fsrsCard.reps).toBe(9);
		expect(decoded.decks).toEqual({ "deck-1": { studyCount: 1, lastStudied: null } });
		expect(decoded.studyHistory).toEqual([]);
		expect(decoded.spellingProgress).toEqual({});
		expect(decoded.continuity).toEqual({ sources: {}, issues: [], journal: null });
	});

	it("decodes tuples even without the format marker", () => {
		const decoded = decodePersistedLearning({
			cards: { card: [DUE, 1, 2, 3, 4, 5, 6, State.Review] },
		});

		expect(decoded.cards.card?.fsrsCard).toMatchObject({
			due: DUE,
			reps: 5,
			state: State.Review,
			last_review: null,
			learning_steps: 0,
		});
	});
});
