import type { Card } from "ts-fsrs";
import type {
	Deck,
	FlashCard,
	SpellingProgressSnapshot,
	StudySettings,
} from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import type { ChallengeProgress } from "./challengeSessionEngine";
import type { StudyCardScheduler } from "./studySessionEngine";

/** One scheduled card state produced by a session engine, committed atomically. */
export interface SessionCardSchedule {
	readonly deckId: string;
	readonly cardId: string;
	readonly fsrsCard: Card;
}

export interface SessionSpellingAttempt {
	readonly cardId: string;
	readonly correct: boolean;
	readonly attemptedAt: number;
}

export interface SessionActivityFacts {
	readonly completion: "completed" | "partial";
	readonly answerCount: number;
	readonly completedAnswerCount?: number;
	readonly durationSeconds: number;
}

/** A finished (or partially exited) session, before any document formatting. */
export interface SessionRecord {
	readonly mode: "study" | "practice" | "spelling" | "challenge";
	readonly deckId: string;
	readonly deckName: string;
	readonly occurredAt: number;
	readonly activity: SessionActivityFacts;
	readonly history: { readonly cardCount: number; readonly durationSeconds: number } | null;
}

export interface SessionChallengeCommit {
	readonly progress: ChallengeProgress;
	readonly expectedProgress: ChallengeProgress | null;
	readonly record?: SessionRecord;
}

/**
 * What a session did, never how it is stored. The persistence authority derives
 * document write sets, history formatting, activity records and study counts.
 */
export interface SessionCommit {
	readonly cardSchedules?: readonly SessionCardSchedule[];
	readonly spellingAttempts?: readonly SessionSpellingAttempt[];
	readonly records?: readonly SessionRecord[];
	readonly challenge?: SessionChallengeCommit;
}

export interface SessionPersistenceReceipt {
	/** Captured by the repository before announcing the committed revision. */
	readonly challengeProgressRevision: number;
}

export type SessionCommitResult =
	| { readonly kind: "applied"; readonly receipt: SessionPersistenceReceipt }
	| {
			readonly kind: "rejected";
			readonly reason: "card-missing" | "challenge-progress-changed";
			readonly message: string;
			readonly retryable: boolean;
	  }
	| { readonly kind: "failed"; readonly message: string; readonly retryable: boolean };

/** The session lifecycle's whole view of persistence: reads, scheduling, one atomic commit. */
export interface SessionPersistencePort extends StudyCardScheduler {
	getRevision(): number;
	getDeck(id: string): Deck | undefined;
	getAllDecks(): readonly Deck[];
	getCard(deckId: string, cardId: string): FlashCard | undefined;
	getEffectiveStudySettings(deckId: string): StudySettings;
	getSettings(): Pick<FlashcardStudySettings, "wordLearningDecks">;
	getSpellingProgress(): SpellingProgressSnapshot;
	getChallengeProgress(): ChallengeProgress | null;
	getChallengeProgressRevision(): number;
	commitSession(commit: SessionCommit): Promise<SessionCommitResult>;
}
