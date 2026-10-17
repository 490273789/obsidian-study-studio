import type { State } from "ts-fsrs";
import type {
	LearningStateDocument,
	PersistedCardLearningState,
	SerializedFSRSCard,
} from "./persistenceTypes";

/**
 * Version marker written on the persisted learning partition alongside the
 * compact card map. Absent (or `undefined`) means the legacy object layout.
 */
export const PERSISTED_LEARNING_CARDS_FORMAT = 1;

/**
 * One persisted card learning entry in the version-1 compact layout:
 *
 * `[due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state,
 * last_review?, learning_steps?, sourceFile?]`
 *
 * The eight fixed fields always exist. Trailing entries are omitted when they
 * hold their default value, so a brand-new card serializes as an 8-item array.
 * `learning_steps` is only appended non-zero and needs the `last_review` slot to
 * be present, so a null placeholder is written when the review date is unset.
 * `sourceFile` only appears for legacy entries that still carry it.
 */
export type CompactCardTuple = [
	due: string,
	stability: number,
	difficulty: number,
	elapsed_days: number,
	scheduled_days: number,
	reps: number,
	lapses: number,
	state: State,
	last_review?: string | null,
	learning_steps?: number,
	sourceFile?: string,
];

/** Persisted representation of the learning document; in-memory shape is unchanged. */
export interface PersistedLearningState extends Omit<LearningStateDocument, "cards"> {
	readonly cards: Record<string, CompactCardTuple>;
	readonly cardsFormat: typeof PERSISTED_LEARNING_CARDS_FORMAT;
}

/**
 * Converts the in-memory learning document into its persisted, compact form.
 * The input document is never mutated and the returned document is a fresh
 * object graph for the card map; other partitions keep their existing values.
 */
export function encodePersistedLearning(learning: LearningStateDocument): PersistedLearningState {
	const cards: Record<string, CompactCardTuple> = {};
	for (const [cardId, persistedCard] of Object.entries(learning.cards)) {
		cards[cardId] = encodePersistedCard(persistedCard);
	}
	return { ...learning, cards, cardsFormat: PERSISTED_LEARNING_CARDS_FORMAT };
}

/**
 * Reads either the compact layout or the legacy `{ fsrsCard: {...} }` object
 * layout. Missing, malformed, or unknown-format input must never throw: the
 * document falls back to defaults and individual corrupt card entries are
 * skipped so a damaged `data.json` cannot block startup.
 */
export function decodePersistedLearning(value: unknown): LearningStateDocument {
	const source = isRecord(value) ? value : {};
	const learning: LearningStateDocument = {
		cards: decodePersistedCards(source.cards, source.cardsFormat),
		decks: isRecord(source.decks) ? (source.decks as LearningStateDocument["decks"]) : {},
		studyHistory: Array.isArray(source.studyHistory)
			? (source.studyHistory as LearningStateDocument["studyHistory"])
			: [],
		spellingProgress: isRecord(source.spellingProgress)
			? (source.spellingProgress as LearningStateDocument["spellingProgress"])
			: {},
		continuity: isRecord(source.continuity)
			? (source.continuity as unknown as LearningStateDocument["continuity"])
			: emptyContinuity(),
	};
	if (source.dailyLearningActivities !== undefined) {
		learning.dailyLearningActivities =
			source.dailyLearningActivities as LearningStateDocument["dailyLearningActivities"];
	}
	if (source.challengeProgress !== undefined) {
		learning.challengeProgress =
			source.challengeProgress as LearningStateDocument["challengeProgress"];
	}
	return learning;
}

/** True when the raw partition already uses the compact tuple layout. */
export function isCompactPersistedLearning(value: unknown): boolean {
	return isRecord(value) && value.cardsFormat === PERSISTED_LEARNING_CARDS_FORMAT;
}

function encodePersistedCard(persistedCard: PersistedCardLearningState): CompactCardTuple {
	const card = persistedCard.fsrsCard;
	const tuple: CompactCardTuple = [
		card.due,
		card.stability,
		card.difficulty,
		card.elapsed_days,
		card.scheduled_days,
		card.reps,
		card.lapses,
		card.state,
	];
	const lastReview = card.last_review ?? null;
	const learningSteps = card.learning_steps ?? 0;
	const sourceFile = persistedCard.sourceFile;
	// Later slots only exist when a later value must be stored; `null` and `0`
	// placeholders keep the positions stable when a default sits in between.
	if (lastReview !== null || learningSteps !== 0 || sourceFile !== undefined) {
		tuple.push(lastReview);
	}
	if (learningSteps !== 0 || sourceFile !== undefined) {
		tuple.push(learningSteps);
	}
	if (sourceFile !== undefined) tuple.push(sourceFile);
	return tuple;
}

function decodePersistedCards(
	value: unknown,
	format: unknown,
): Record<string, PersistedCardLearningState> {
	const cards: Record<string, PersistedCardLearningState> = {};
	// An unknown numeric format is a newer writer than this build understands.
	// Skip its cards instead of misreading them as version 1 tuples.
	if (format !== undefined && format !== PERSISTED_LEARNING_CARDS_FORMAT) return cards;
	if (!isRecord(value)) return cards;
	for (const [cardId, entry] of Object.entries(value)) {
		const decoded = Array.isArray(entry) ? decodeCompactCard(entry) : decodeObjectCard(entry);
		if (decoded) cards[cardId] = decoded;
	}
	return cards;
}

function decodeCompactCard(value: readonly unknown[]): PersistedCardLearningState | null {
	if (value.length < 8) return null;
	const due = value[0];
	if (typeof due !== "string") return null;
	const stability = finiteNumber(value[1]);
	const difficulty = finiteNumber(value[2]);
	const elapsedDays = finiteNumber(value[3]);
	const scheduledDays = finiteNumber(value[4]);
	const reps = finiteNumber(value[5]);
	const lapses = finiteNumber(value[6]);
	const state = finiteNumber(value[7]);
	if (
		stability === null ||
		difficulty === null ||
		elapsedDays === null ||
		scheduledDays === null ||
		reps === null ||
		lapses === null ||
		state === null
	) {
		return null;
	}
	const lastReview = value[8];
	const learningSteps = value[9];
	const sourceFile = value[10];
	const fsrsCard: SerializedFSRSCard = {
		due,
		stability,
		difficulty,
		elapsed_days: elapsedDays,
		scheduled_days: scheduledDays,
		reps,
		lapses,
		state: state as State,
		last_review: typeof lastReview === "string" ? lastReview : null,
		learning_steps: finiteNumber(learningSteps) ?? 0,
	};
	return typeof sourceFile === "string" ? { fsrsCard, sourceFile } : { fsrsCard };
}

function decodeObjectCard(value: unknown): PersistedCardLearningState | null {
	if (!isRecord(value) || !isRecord(value.fsrsCard)) return null;
	const card = value.fsrsCard;
	const due = card.due;
	if (typeof due !== "string") return null;
	const fsrsCard: SerializedFSRSCard = {
		due,
		stability: finiteNumber(card.stability) ?? 0,
		difficulty: finiteNumber(card.difficulty) ?? 0,
		elapsed_days: finiteNumber(card.elapsed_days) ?? 0,
		scheduled_days: finiteNumber(card.scheduled_days) ?? 0,
		reps: finiteNumber(card.reps) ?? 0,
		lapses: finiteNumber(card.lapses) ?? 0,
		state: (finiteNumber(card.state) ?? 0) as State,
		last_review: typeof card.last_review === "string" ? card.last_review : null,
		learning_steps: finiteNumber(card.learning_steps) ?? 0,
	};
	return typeof value.sourceFile === "string"
		? { fsrsCard, sourceFile: value.sourceFile }
		: { fsrsCard };
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyContinuity(): LearningStateDocument["continuity"] {
	return { sources: {}, issues: [], journal: null };
}
