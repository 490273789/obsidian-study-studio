import type { StudySettings } from "../../../core/shared/types";

/**
 * Bounds, steps, and defaults for study settings and FSRS parameters.
 */
export const STUDY_SETTINGS_LIMITS = {
	dailyNewCards: {
		min: 1,
		max: 200,
		step: 1,
	},
	dailyReviewCards: {
		min: 1,
		max: 500,
		step: 10,
	},
	requestRetention: {
		min: 0.7,
		max: 0.99,
		step: 0.01,
	},
	maximumInterval: {
		min: 30,
		max: 3650,
		step: 1,
		default: 365,
	},
} as const;

export const STUDY_ORDER_OPTIONS: readonly StudySettings["studyOrder"][] = ["sequential", "random"];

/**
 * Estimate the number of days required to complete all new cards at the given pace.
 */
export function calculateEstimatedDays(totalCards: number, dailyNewCards: number): number {
	if (totalCards <= 0 || dailyNewCards <= 0) return 0;
	return Math.ceil(totalCards / dailyNewCards);
}

/**
 * Calculate the required daily new cards count given the total cards and desired days to complete,
 * clamped within the supported daily new cards range [1, 200].
 */
export function calculateDailyNewCardsFromDays(totalCards: number, daysToComplete: number): number {
	if (!Number.isFinite(daysToComplete) || daysToComplete < 1 || totalCards <= 0) {
		return STUDY_SETTINGS_LIMITS.dailyNewCards.min;
	}
	const computed = Math.ceil(totalCards / daysToComplete);
	return Math.max(
		STUDY_SETTINGS_LIMITS.dailyNewCards.min,
		Math.min(STUDY_SETTINGS_LIMITS.dailyNewCards.max, computed),
	);
}

/**
 * Parses raw input string into valid maximum interval integer, falling back if invalid.
 */
export function parseMaximumInterval(
	raw: string,
	fallback: number = STUDY_SETTINGS_LIMITS.maximumInterval.default,
): number {
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < STUDY_SETTINGS_LIMITS.maximumInterval.min) {
		return fallback;
	}
	return Math.min(STUDY_SETTINGS_LIMITS.maximumInterval.max, Math.round(parsed));
}

/**
 * Parses unknown or string value into valid study order ("sequential" | "random").
 */
export function parseStudyOrder(value: unknown): StudySettings["studyOrder"] {
	return value === "random" ? "random" : "sequential";
}
