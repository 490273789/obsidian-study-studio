import { fsrs, generatorParameters, Rating, Card, State, RecordLogItem } from "ts-fsrs";
import { StudySettings } from "../../../../core/shared/types";

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
