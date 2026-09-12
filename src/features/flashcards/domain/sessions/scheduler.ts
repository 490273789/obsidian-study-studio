import {
	createEmptyCard,
	fsrs,
	generatorParameters,
	Rating,
	Card,
	State,
	RecordLogItem,
	IPreview,
} from "ts-fsrs";
import { Language, RatingButton, StudySettings } from "../../../../core/shared/types";
import { formatReviewInterval, getLocalizedRatingButtons } from "../../strings/index";

/**
 * FSRS Scheduler - handles spaced repetition scheduling using FSRS algorithm
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
	 * Create a new empty FSRS card
	 */
	createNewCard(): Card {
		return createEmptyCard();
	}

	/**
	 * Rate a card and get the updated card state
	 * @param card The current card
	 * @param rating The user's rating (1-4)
	 * @returns Updated card and whether it should repeat in this session
	 */
	rateCard(card: Card, rating: Rating): { card: Card; repeatInSession: boolean } {
		const now = new Date();
		const result = this.f.repeat(card, now);

		let ratingResult: RecordLogItem | undefined;
		switch (rating) {
			case Rating.Again:
				ratingResult = result[Rating.Again];
				break;
			case Rating.Hard:
				ratingResult = result[Rating.Hard];
				break;
			case Rating.Good:
				ratingResult = result[Rating.Good];
				break;
			case Rating.Easy:
				ratingResult = result[Rating.Easy];
				break;
			default:
				ratingResult = undefined;
		}

		if (!ratingResult) {
			return { card, repeatInSession: false };
		}

		const updatedCard = ratingResult.card;

		// If rating is "Again" (1), card should repeat in this session
		const repeatInSession = rating === Rating.Again;

		return { card: updatedCard, repeatInSession };
	}

	/**
	 * Get all scheduling options for a card
	 */
	getSchedulingOptions(card: Card): IPreview {
		const now = new Date();
		return this.f.repeat(card, now);
	}

	/**
	 * Check if a card is due for review
	 */
	isDue(card: Card): boolean {
		const now = new Date();
		return card.due <= now;
	}

	/**
	 * Check if a card is new (never studied)
	 */
	isNew(card: Card): boolean {
		return card.state === State.New;
	}

	/**
	 * Get the state of a card
	 */
	getState(card: Card): State {
		return card.state;
	}

	/**
	 * Calculate next review interval description
	 */
	getIntervalDescription(card: Card, rating: Rating, language: Language = "zh"): string {
		const options = this.getSchedulingOptions(card);

		let result: RecordLogItem | undefined;
		switch (rating) {
			case Rating.Again:
				result = options[Rating.Again];
				break;
			case Rating.Hard:
				result = options[Rating.Hard];
				break;
			case Rating.Good:
				result = options[Rating.Good];
				break;
			case Rating.Easy:
				result = options[Rating.Easy];
				break;
			default:
				result = undefined;
		}

		if (!result) return "";

		const interval = result.card.scheduled_days;
		if (interval === 0) {
			// Calculate minutes
			const diffMs = result.card.due.getTime() - new Date().getTime();
			const minutes = Math.round(diffMs / (1000 * 60));
			if (minutes < 60) {
				return formatReviewInterval(language, "minute", minutes);
			}
			const hours = Math.round(minutes / 60);
			return formatReviewInterval(language, "hour", hours);
		}
		return formatReviewInterval(language, "day", interval);
	}

	/**
	 * Custom rating for "garbage" - sets card to 21 days later
	 */
	rateAsGarbage(card: Card): Card {
		const now = new Date();
		const dueDate = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

		return {
			...card,
			due: dueDate,
			stability: card.stability || 21,
			difficulty: card.difficulty,
			elapsed_days: 0,
			scheduled_days: 21,
			reps: card.reps + 1,
			lapses: card.lapses,
			state: State.Review,
			last_review: now,
			learning_steps: 0,
		};
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

/**
 * Get rating buttons configuration
 */
export function getRatingButtons(language: Language = "zh"): RatingButton[] {
	return getLocalizedRatingButtons(language);
}
