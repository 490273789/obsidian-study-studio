import {
	createTranslatorFactory,
	normalizeLanguage,
	type TranslationVars,
	type Translator,
} from "../../../core/i18n/translator";
import { sharedTranslations } from "../../../core/i18n/sharedStrings";
import type { Language, RatingButton } from "../../../core/shared/types";
import { flashcardTranslations } from "./translations";

/**
 * The 闪卡 feature's translation surface: its own entries merged over the shared
 * workbench strings, so a flashcard view can ask for both in one call.
 */
const dictionary = {
	zh: { ...sharedTranslations.zh, ...flashcardTranslations.zh },
	en: { ...sharedTranslations.en, ...flashcardTranslations.en },
};

export type TranslationKey = keyof typeof dictionary.zh;

const factory = createTranslatorFactory(dictionary);

export function translate(
	language: Language,
	key: TranslationKey,
	vars: TranslationVars = {},
): string {
	return factory.translate(language, key, vars);
}

export function createTranslator(
	language: Language,
): (key: TranslationKey, vars?: TranslationVars) => string {
	return (key, vars) => translate(language, key, vars);
}

/** The dictionary the flashcard workbench view injects into the shared i18n context. */
export const flashcardTranslator = (language: Language): Translator =>
	factory.createTranslator(language);

export const DEFAULT_PRACTICE_MESSAGES: Record<
	Language,
	{
		perfect: string[];
		error: string[];
	}
> = {
	zh: {
		perfect: [
			"沉浸式装 X🌟",
			"帅是一种常态💪",
			"优雅，实在是优雅💎",
			"Practice小能手🏆",
			"Practice界的扛把子🔥",
		],
		error: [
			"沉浸式翻车🌟",
			"错是一种常态❌",
			"拉胯，实在是拉胯💔",
			"错题小能手🏆",
			"翻车界的扛把子🔥",
		],
	},
	en: {
		perfect: [
			"Clean sweep 🎉",
			"Perfect run 🌟",
			"Fully locked in 💪",
			"Elegant work 💎",
			"Practice master 🏆",
			"Practice streak on fire 🔥",
		],
		error: [
			"Practice complete, review the misses 💩",
			"Some cards slipped through 🌟",
			"Mistakes are part of the loop ❌",
			"Patch the weak spots 💔",
			"Missed-card specialist 🏆",
			"Time for a focused retry 🔥",
			"Review list unlocked 🐔",
		],
	},
};

export function getDefaultPracticeMessages(language: Language): {
	perfect: string[];
	error: string[];
} {
	const defaults = DEFAULT_PRACTICE_MESSAGES[normalizeLanguage(language)];
	return {
		perfect: [...defaults.perfect],
		error: [...defaults.error],
	};
}

export function formatCompactDuration(language: Language, seconds: number): string {
	const t = createTranslator(language);
	if (seconds < 60) return t("time.seconds", { count: seconds });
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) {
		return remainingSeconds > 0
			? t("time.minutesSeconds", {
					minutes,
					seconds: remainingSeconds,
				})
			: t("time.minutes", { count: minutes });
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0
		? t("time.hoursMinutes", {
				hours,
				minutes: remainingMinutes,
			})
		: t("time.hours", { count: hours });
}

export function formatReviewInterval(
	language: Language,
	unit: "minute" | "hour" | "day",
	count: number,
): string {
	const t = createTranslator(language);
	switch (unit) {
		case "minute":
			return t("time.minute", { count });
		case "hour":
			return t("time.hour", { count });
		case "day":
			return t("time.day", { count });
	}
}

export function getLocalizedRatingButtons(language: Language): RatingButton[] {
	const t = createTranslator(language);
	return [
		{
			label: t("ratings.again"),
			shortcut: "1",
			rating: 1,
			intervalDesc: formatReviewInterval(language, "minute", 1),
		},
		{
			label: t("ratings.hard"),
			shortcut: `2/${t("common.space")}`,
			rating: 2,
			intervalDesc: formatReviewInterval(language, "day", 1),
		},
		{
			label: t("ratings.good"),
			shortcut: "3",
			rating: 3,
			intervalDesc: formatReviewInterval(language, "day", 3),
		},
		{
			label: t("ratings.easy"),
			shortcut: "4",
			rating: 4,
			intervalDesc: formatReviewInterval(language, "day", 10),
		},
		{
			label: t("ratings.trash"),
			shortcut: "5",
			rating: 5,
			intervalDesc: formatReviewInterval(language, "day", 21),
		},
	];
}

export function formatStudyOrder(language: Language, studyOrder: "sequential" | "random"): string {
	const t = createTranslator(language);
	return studyOrder === "random" ? t("order.random") : t("order.sequential");
}
