import { fsrs, generatorParameters, Rating, Card, State } from "ts-fsrs";
import { StudyRating, StudySettings } from "../../../../core/shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_INTERVAL_DAYS: Record<StudyRating, number> = {
	1: 0,
	2: 1,
	3: 3,
	4: 12,
	5: 36,
};

/**
 * Study Scheduler - schedules study ratings onto fixed spaced-repetition tiers
 * (repeat in session / 1d / 3d / 12d / 36d) while preserving valid serialized ts-fsrs card fields.
 */
export class FSRSScheduler {
	private f: ReturnType<typeof fsrs>;

	constructor(settings: Pick<StudySettings, "fsrsParameters">) {
		const params = generatorParameters({
			request_retention: settings.fsrsParameters.requestRetention,
			maximum_interval: settings.fsrsParameters.maximumInterval,
		});
		this.f = fsrs(params);
	}

	/**
	 * Rate a card (1-4) and return the updated card state.
	 */
	rateCard(card: Card, rating: Rating): { card: Card; repeatInSession: boolean } {
		const now = new Date();
		const normalized = this.normalizeSchedulableCard(card);
		const studyRating = fromFSRSRating(rating);
		if (!studyRating) {
			return { card, repeatInSession: false };
		}
		if (studyRating === 1) {
			return {
				card: {
					...normalized,
					due: now,
					stability: normalized.stability || 1,
					difficulty:
						normalized.difficulty === 0
							? this.initialMasteredDifficulty()
							: normalized.difficulty,
					scheduled_days: 0,
					reps: normalized.reps + 1,
					lapses:
						normalized.state === State.New ? normalized.lapses : normalized.lapses + 1,
					state: normalized.state === State.New ? State.Learning : State.Relearning,
					last_review: now,
					learning_steps: 0,
				},
				repeatInSession: true,
			};
		}
		return {
			card: this.scheduleFixedDays(normalized, FIXED_INTERVAL_DAYS[studyRating], now),
			repeatInSession: false,
		};
	}

	/**
	 * Rating 5 ("轻松") - schedules card 36 days later.
	 */
	rateAsGarbage(card: Card): Card {
		const now = new Date();
		return this.scheduleFixedDays(
			this.normalizeSchedulableCard(card),
			FIXED_INTERVAL_DAYS[5],
			now,
		);
	}

	private scheduleFixedDays(card: Card, days: number, now: Date): Card {
		const dueDate = new Date(now.getTime() + days * DAY_MS);
		return {
			...card,
			due: dueDate,
			stability: card.stability || days,
			difficulty: card.difficulty === 0 ? this.initialMasteredDifficulty() : card.difficulty,
			scheduled_days: days,
			reps: card.reps + 1,
			lapses: card.lapses,
			state: State.Review,
			last_review: now,
			learning_steps: 0,
		};
	}

	private normalizeSchedulableCard(card: Card): Card {
		// Older custom mastered ratings set stability but left new-card difficulty at zero.
		return card.difficulty === 0 && card.stability > 0
			? { ...card, difficulty: this.initialMasteredDifficulty() }
			: card;
	}

	private initialMasteredDifficulty(): number {
		// Easy is the closest FSRS grade for initializing valid difficulty bounds.
		return this.f.model.step({ memoryState: null, rating: Rating.Easy, elapsedDays: 0 })
			.difficulty;
	}
}

function fromFSRSRating(rating: Rating): 1 | 2 | 3 | 4 | null {
	switch (rating) {
		case Rating.Again:
			return 1;
		case Rating.Hard:
			return 2;
		case Rating.Good:
			return 3;
		case Rating.Easy:
			return 4;
		default:
			return null;
	}
}

/**
 * Convert rating number to FSRS Rating enum
 */
export function toFSRSRating(rating: 1 | 2 | 3 | 4): Rating {
	switch (rating) {
		case 1:
			return Rating.Again;
		case 2:
			return Rating.Hard;
		case 3:
			return Rating.Good;
		case 4:
			return Rating.Easy;
	}
}
