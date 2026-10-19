import type { Deck } from "../../../../core/shared/types";
import type { ChallengeProgress } from "../sessions/challengeSessionEngine";
import type {
	SessionCommit,
	SessionCommitResult,
	SessionPersistenceReceipt,
} from "../sessions/sessionPersistence";
import { findCardLocation, type CardIndexLocation } from "./cardLocation";
import { FlashcardPersistenceError } from "./persistenceTypes";
import {
	formatSessionCommit,
	isPureJournalWriteSet,
	type SessionWriteSet,
} from "./sessionCommitFormat";

export interface SessionCommitHost {
	/** Hydrates the rebuildable deck index before validation. */
	loadDeckIndex(): Promise<void>;
	enqueueOperation(operation: () => Promise<void>): Promise<void>;
	getDecks(): ReadonlyMap<string, Deck>;
	getCardIndex(): ReadonlyMap<string, CardIndexLocation>;
	getChallengeProgress(): ChallengeProgress | null;
	canAppendJournal(): boolean;
	appendJournal(transition: SessionWriteSet): Promise<SessionPersistenceReceipt>;
	commitDocument(
		transition: SessionWriteSet,
		adoptJournalSeq?: number,
	): Promise<SessionPersistenceReceipt>;
	mergeJournalBeforeWrite(): Promise<void>;
}

/**
 * The semantic session-commit entry: formats one `SessionCommit`, validates it
 * against the current learner state, chooses the journal or full-document
 * durability path, and maps failures to a truthful outcome. Document building
 * and memory installation stay with the persistence host.
 */
export class SessionCommitter {
	constructor(private readonly host: SessionCommitHost) {}

	async commit(commit: SessionCommit): Promise<SessionCommitResult> {
		await this.host.loadDeckIndex();
		const writeSet = formatSessionCommit(commit);
		const missing = writeSet.cardUpdates.find(
			(update) =>
				!findCardLocation(
					this.host.getDecks(),
					update.deckId,
					update.cardId,
					this.host.getCardIndex(),
				),
		);
		if (missing) {
			return {
				kind: "rejected",
				reason: "card-missing",
				message: `Card ${missing.cardId} is no longer part of deck ${missing.deckId}`,
				retryable: true,
			};
		}
		if (
			writeSet.challengeProgress !== undefined &&
			JSON.stringify(this.host.getChallengeProgress()) !==
				JSON.stringify(writeSet.expectedChallengeProgress ?? null)
		) {
			return {
				kind: "rejected",
				reason: "challenge-progress-changed",
				message: "Challenge progress changed; reopen the challenge to continue.",
				retryable: true,
			};
		}
		try {
			let receipt!: SessionPersistenceReceipt;
			await this.host.enqueueOperation(async () => {
				if (this.host.canAppendJournal() && isPureJournalWriteSet(writeSet)) {
					receipt = await this.host.appendJournal(writeSet);
					return;
				}
				await this.host.mergeJournalBeforeWrite();
				receipt = await this.host.commitDocument(writeSet);
			});
			return { kind: "applied", receipt };
		} catch (error) {
			if (error instanceof FlashcardPersistenceError) {
				return { kind: "failed", message: error.message, retryable: error.retryable };
			}
			return {
				kind: "failed",
				message: error instanceof Error ? error.message : "Session commit failed",
				retryable: false,
			};
		}
	}
}
