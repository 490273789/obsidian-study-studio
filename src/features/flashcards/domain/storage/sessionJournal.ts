import { isRecord } from "../../../../core/shared/isRecord";
import { finiteNumberOrNull as finiteNumber } from "../../../../core/shared/utils";
import type { SerializedFSRSCard } from "./persistenceTypes";

/**
 * One scheduled card state appended to the local session journal. The journal
 * stores the same serialized FSRS shape as `data.json` so a merge is a direct
 * record replacement.
 */
interface SessionJournalCardUpdate {
	readonly deckId: string;
	readonly cardId: string;
	readonly fsrsCard: SerializedFSRSCard;
}

/** One counted spelling attempt; replay must count it exactly once. */
interface SessionJournalSpellingAttempt {
	readonly cardId: string;
	readonly correct: boolean;
	readonly attemptedAt: number;
}

interface SessionJournalEntryBase {
	/** Monotonic, starts at 1, and only advances across journal appends. */
	readonly seq: number;
	/** Wall-clock append time used for ordering diagnostics. */
	readonly at: number;
}

export type SessionJournalEntry =
	| (SessionJournalEntryBase & {
			readonly kind: "card-update";
			readonly cardUpdate: SessionJournalCardUpdate;
	  })
	| (SessionJournalEntryBase & {
			readonly kind: "spelling-attempt";
			readonly spellingAttempt: SessionJournalSpellingAttempt;
	  });

/** Timer seam for the idle journal merge; tests inject a manual clock. */
export interface SessionJournalTimer {
	setTimeout(handler: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const realSessionJournalTimer: SessionJournalTimer = {
	setTimeout: (handler, milliseconds) => setTimeout(handler, milliseconds),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Local write-ahead log for per-answer durability. Implementations must make
 * `append` durable before resolving: the repository publishes the next card
 * only after it succeeds. `load` never throws, so a damaged journal cannot
 * block startup; it returns the longest parsable prefix.
 */
export interface SessionJournalStore {
	load(): Promise<SessionJournalEntry[]>;
	append(entries: readonly SessionJournalEntry[]): Promise<void>;
	clear(): Promise<void>;
}

/** One line per entry; the adapter appends these to the JSONL file. */
export function serializeSessionJournalEntry(entry: SessionJournalEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

/** Parses one JSONL line. Returns `null` for a damaged line. */
export function parseSessionJournalLine(line: string): SessionJournalEntry | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(value)) return null;
	const seq = positiveInteger(value.seq);
	const at = finiteNumber(value.at);
	if (seq === null || at === null) return null;
	if (value.kind === "card-update") {
		const update = value.cardUpdate;
		if (!isRecord(update) || typeof update.deckId !== "string" || !update.deckId) return null;
		if (typeof update.cardId !== "string" || !update.cardId) return null;
		if (!isSerializedFSRSCard(update.fsrsCard)) return null;
		return {
			seq,
			at,
			kind: "card-update",
			cardUpdate: {
				deckId: update.deckId,
				cardId: update.cardId,
				fsrsCard: update.fsrsCard,
			},
		};
	}
	if (value.kind === "spelling-attempt") {
		const attempt = value.spellingAttempt;
		if (!isRecord(attempt)) return null;
		const attemptedAt = finiteNumber(attempt.attemptedAt);
		if (typeof attempt.cardId !== "string" || !attempt.cardId) return null;
		if (typeof attempt.correct !== "boolean" || attemptedAt === null) return null;
		return {
			seq,
			at,
			kind: "spelling-attempt",
			spellingAttempt: {
				cardId: attempt.cardId,
				correct: attempt.correct,
				attemptedAt,
			},
		};
	}
	return null;
}

/**
 * Parses a whole journal. Empty lines are tolerated; the first damaged line
 * ends the result so a truncated tail is dropped and everything already
 * written before it stays recoverable.
 */
export function parseSessionJournal(content: string): SessionJournalEntry[] {
	const entries: SessionJournalEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		const entry = parseSessionJournalLine(line);
		if (!entry) break;
		entries.push(entry);
	}
	return entries;
}

function isSerializedFSRSCard(value: unknown): value is SerializedFSRSCard {
	if (!isRecord(value) || typeof value.due !== "string") return false;
	const fields = [
		value.stability,
		value.difficulty,
		value.elapsed_days,
		value.scheduled_days,
		value.reps,
		value.lapses,
		value.state,
	] as const;
	if (fields.some((field) => finiteNumber(field) === null)) return false;
	const learningSteps = value.learning_steps;
	if (learningSteps !== undefined && finiteNumber(learningSteps) === null) return false;
	const lastReview = value.last_review;
	if (lastReview !== undefined && lastReview !== null && typeof lastReview !== "string") {
		return false;
	}
	return true;
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
