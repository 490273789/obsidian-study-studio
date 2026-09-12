import type { State } from "ts-fsrs";
import type { SpellingCardProgress, StudyHistoryEntry } from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import type { PersistedCardIdentityContinuityState } from "../identity/cardIdentityContinuity";

export interface SerializedFSRSCard {
	due: string;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	reps: number;
	lapses: number;
	state: State;
	last_review: string | null | undefined;
	learning_steps: number;
}

export interface SerializedCard {
	id: string;
	front: string;
	back: string;
	explanation?: string;
	fsrsCard: SerializedFSRSCard;
	sourceFile: string;
	indexInFile: number;
}

export interface SerializedDeck {
	id: string;
	name: string;
	filePath: string;
	tag: string;
	cards: SerializedCard[];
	studyCount: number;
	lastStudied: string | null;
}

export interface PersistedCardLearningState {
	fsrsCard: SerializedFSRSCard;
	sourceFile?: string;
}

export interface PersistedDeckLearningState {
	studyCount: number;
	lastStudied: string | null;
}

export interface LearningStateDocument {
	cards: Record<string, PersistedCardLearningState>;
	decks: Record<string, PersistedDeckLearningState>;
	studyHistory: StudyHistoryEntry[];
	spellingProgress: Record<string, SpellingCardProgress>;
	continuity: PersistedCardIdentityContinuityState;
}

export interface LegacyFlashcardDocument {
	decks: Record<string, SerializedDeck>;
	studyHistory?: StudyHistoryEntry[];
	spellingProgress?: Record<string, SpellingCardProgress>;
	continuity?: PersistedCardIdentityContinuityState;
	availableTags?: string[];
}

export type FlashcardAuthorityContent =
	| { readonly kind: "current"; readonly learning?: LearningStateDocument }
	| { readonly kind: "legacy"; readonly document: LegacyFlashcardDocument };

export interface FlashcardAuthoritySnapshot {
	readonly version: number;
	readonly settings: FlashcardStudySettings;
	readonly content: FlashcardAuthorityContent;
}

export interface FlashcardAuthorityChange {
	readonly version: number;
	readonly kind: "settings" | "learning" | "external";
}

export interface FlashcardAuthorityCommit {
	readonly learning: LearningStateDocument;
	readonly discardLegacy?: boolean;
}

export interface FlashcardAuthority {
	read(): Promise<FlashcardAuthoritySnapshot>;
	commit(
		expectedVersion: number,
		commit: FlashcardAuthorityCommit,
	): Promise<{ readonly version: number }>;
	subscribe(listener: (change: FlashcardAuthorityChange) => void | Promise<void>): () => void;
	dispose?(): void;
}

export class FlashcardAuthorityConflictError extends Error {
	constructor(
		readonly expectedVersion: number,
		readonly actualVersion: number,
	) {
		super(`Flashcard authority changed from version ${expectedVersion} to ${actualVersion}`);
		this.name = "FlashcardAuthorityConflictError";
	}
}

export class FlashcardPersistenceError extends Error {
	constructor(
		readonly code:
			| "not-loaded"
			| "disposed"
			| "authority-read-failed"
			| "authority-write-failed"
			| "migration-failed"
			| "conflict-exhausted"
			| "invariant-violated",
		message: string,
		readonly retryable: boolean,
		options?: { cause?: unknown },
	) {
		super(message);
		if (options?.cause !== undefined) Object.assign(this, { cause: options.cause });
		this.name = "FlashcardPersistenceError";
	}
}
