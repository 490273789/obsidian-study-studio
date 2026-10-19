import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import type { ChallengeProgress } from "../../sessions/challengeSessionEngine";
import type { SessionPersistenceReceipt } from "../../sessions/sessionPersistence";
import type { CardIndexLocation } from "../cardLocation";
import { FlashcardPersistenceError } from "../persistenceTypes";
import { SessionCommitter } from "../sessionCommitter";
import { answerCommit, challengeCommit, recordCommit } from "./sessionCommitBuilders";

const RECEIPT: SessionPersistenceReceipt = { challengeProgressRevision: 0 };

function deck(): Deck {
	return {
		id: "deck",
		name: "Deck",
		filePath: "deck.md",
		tag: "#deck",
		studyCount: 0,
		lastStudied: null,
		cards: [
			{
				id: "a",
				front: "apple",
				back: "苹果",
				fsrsCard: createEmptyCard(),
				sourceFile: "deck.md",
				indexInFile: 0,
			},
		],
	};
}

function fixture(options: { challenge?: ChallengeProgress | null } = {}) {
	const decks = new Map([["deck", deck()]]);
	const cardIndex = new Map<string, CardIndexLocation>([["a", { deckId: "deck", cardIndex: 0 }]]);
	const host = {
		loadDeckIndex: vi.fn(async () => {}),
		enqueueOperation: vi.fn(async (operation: () => Promise<void>) => {
			await operation();
		}),
		getDecks: () => decks,
		getCardIndex: () => cardIndex,
		getChallengeProgress: () => options.challenge ?? null,
		canAppendJournal: () => true,
		appendJournal: vi.fn(async () => RECEIPT),
		commitDocument: vi.fn(async () => RECEIPT),
		mergeJournalBeforeWrite: vi.fn(async () => {}),
	};
	return { committer: new SessionCommitter(host), host };
}

describe("SessionCommitter", () => {
	it("appends a pure answer through the journal without a document commit", async () => {
		const { committer, host } = fixture();

		const result = await committer.commit(
			answerCommit({ deckId: "deck", cardId: "a", fsrsCard: createEmptyCard() }),
		);

		expect(result).toEqual({ kind: "applied", receipt: RECEIPT });
		expect(host.enqueueOperation).toHaveBeenCalledOnce();
		expect(host.appendJournal).toHaveBeenCalledOnce();
		expect(host.commitDocument).not.toHaveBeenCalled();
		expect(host.mergeJournalBeforeWrite).not.toHaveBeenCalled();
	});

	it("merges the journal before a full document commit for record writes", async () => {
		const { committer, host } = fixture();

		const result = await committer.commit(
			recordCommit({
				mode: "study",
				deckId: "deck",
				deckName: "Deck",
				occurredAt: 1,
				activity: { completion: "completed", answerCount: 1, durationSeconds: 10 },
				history: null,
			}),
		);

		expect(result).toEqual({ kind: "applied", receipt: RECEIPT });
		expect(host.mergeJournalBeforeWrite).toHaveBeenCalledOnce();
		expect(host.commitDocument).toHaveBeenCalledOnce();
		expect(host.appendJournal).not.toHaveBeenCalled();
	});

	it("rejects a commit whose card left the index", async () => {
		const { committer } = fixture();

		const result = await committer.commit(
			answerCommit({ deckId: "deck", cardId: "missing", fsrsCard: createEmptyCard() }),
		);

		expect(result).toMatchObject({ kind: "rejected", reason: "card-missing", retryable: true });
	});

	it("rejects a moved challenge revision", async () => {
		const progress: ChallengeProgress = { version: 1, lastMode: "random", round: null };
		const { committer, host } = fixture({ challenge: progress });
		host.canAppendJournal = () => false;

		const result = await committer.commit(
			challengeCommit({ progress, expectedProgress: null }),
		);

		expect(result).toMatchObject({
			kind: "rejected",
			reason: "challenge-progress-changed",
			retryable: true,
		});
		expect(host.commitDocument).not.toHaveBeenCalled();
	});

	it("maps a typed persistence failure to its retryability", async () => {
		const { committer, host } = fixture();
		host.appendJournal.mockRejectedValueOnce(
			new FlashcardPersistenceError("authority-write-failed", "disk full", true),
		);

		const result = await committer.commit(
			answerCommit({ deckId: "deck", cardId: "a", fsrsCard: createEmptyCard() }),
		);

		expect(result).toEqual({
			kind: "failed",
			message: "disk full",
			retryable: true,
		});
	});

	it("maps an unexpected failure to a non-retryable failure", async () => {
		const { committer, host } = fixture();
		host.appendJournal.mockRejectedValueOnce(new Error("boom"));

		const result = await committer.commit(
			answerCommit({ deckId: "deck", cardId: "a", fsrsCard: createEmptyCard() }),
		);

		expect(result).toEqual({ kind: "failed", message: "boom", retryable: false });
	});
});
