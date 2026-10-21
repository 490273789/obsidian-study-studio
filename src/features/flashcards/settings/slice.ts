import { stringArrayEquals } from "../../../core/shared/utils";
import { normalizeLanguage } from "../../../core/i18n";
import { DEFAULT_PRACTICE_MESSAGES, getDefaultPracticeMessages } from "../strings/index";
import { settingsRecord, type SettingsSlice } from "../../../core/settings/slice";
import type { StudySettings } from "../../../core/shared/types";

/**
 * The 闪卡 feature's own settings keys: 题库 tags, deck order and per-题库 study
 * overrides, the FSRS study parameters, and the practice completion messages.
 */
export interface FlashcardStudySettings extends StudySettings {
	/** Tags to scan for flashcards (each tag represents a deck). */
	flashcardTags: string[];
	/** Decks explicitly enabled for English-word spelling practice, keyed by deck ID. */
	wordLearningDecks: Record<string, boolean>;
	/** User-defined deck display order, stored as stable deck IDs. */
	deckOrder: string[];
	/** Practice completion messages when all correct. */
	practicePerfectMessages: string[];
	/** Practice completion messages when there are errors. */
	practiceErrorMessages: string[];
	/** User has edited practice completion messages. */
	practiceMessagesCustomized?: boolean;
	/** Per-deck study setting overrides, keyed by deck ID. */
	deckStudySettings: Record<string, Partial<StudySettings>>;
}

/** Pre-题库-sync settings stored one tag at the top level. */
interface LegacyTagSettings {
	flashcardTag?: string;
}

export const DEFAULT_FLASHCARD_STUDY_SETTINGS: FlashcardStudySettings = {
	flashcardTags: ["#wordTag"],
	wordLearningDecks: {},
	deckOrder: [],
	dailyNewCards: 20,
	dailyReviewCards: 100,
	studyOrder: "random",
	fsrsParameters: {
		requestRetention: 0.9,
		maximumInterval: 365,
	},
	deckStudySettings: {},
	practicePerfectMessages: DEFAULT_PRACTICE_MESSAGES.zh.perfect,
	practiceErrorMessages: DEFAULT_PRACTICE_MESSAGES.zh.error,
	practiceMessagesCustomized: false,
};

const FLASHCARD_SLICE_KEYS = [
	"flashcardTags",
	"wordLearningDecks",
	"deckOrder",
	"dailyNewCards",
	"dailyReviewCards",
	"studyOrder",
	"fsrsParameters",
	"deckStudySettings",
	"practiceMessagesCustomized",
	"practicePerfectMessages",
	"practiceErrorMessages",
] as const;

export const flashcardSettingsSlice: SettingsSlice<FlashcardStudySettings> = {
	id: "flashcards",
	keys: FLASHCARD_SLICE_KEYS,

	defaults: () => structuredClone(DEFAULT_FLASHCARD_STUDY_SETTINGS),

	normalize: (raw) => {
		const document = settingsRecord(raw);
		const stored = document as Partial<FlashcardStudySettings> & LegacyTagSettings;
		const defaults = DEFAULT_FLASHCARD_STUDY_SETTINGS;

		// Legacy: a single top-level tag became the tag list during 题库 sync.
		const legacyTag = stored.flashcardTag;
		const storedTags = stored.flashcardTags;
		const flashcardTags =
			legacyTag && !storedTags?.length ? [legacyTag] : (storedTags ?? defaults.flashcardTags);

		const language = normalizeLanguage(document.language);
		const defaultMessages = getDefaultPracticeMessages(language);
		const messagesCustomized =
			stored.practiceMessagesCustomized ?? hasCustomPracticeMessages(stored);

		return {
			flashcardTags,
			wordLearningDecks: stored.wordLearningDecks ?? {},
			deckOrder: normalizeDeckOrder(stored.deckOrder),
			dailyNewCards: stored.dailyNewCards ?? defaults.dailyNewCards,
			dailyReviewCards: stored.dailyReviewCards ?? defaults.dailyReviewCards,
			studyOrder: stored.studyOrder ?? defaults.studyOrder,
			fsrsParameters: {
				...defaults.fsrsParameters,
				...stored.fsrsParameters,
			},
			deckStudySettings: stored.deckStudySettings ?? {},
			practiceMessagesCustomized: messagesCustomized,
			practicePerfectMessages: messagesCustomized
				? [...(stored.practicePerfectMessages ?? defaultMessages.perfect)]
				: defaultMessages.perfect,
			practiceErrorMessages: messagesCustomized
				? [...(stored.practiceErrorMessages ?? defaultMessages.error)]
				: defaultMessages.error,
		};
	},

	clone: (value) => ({
		...value,
		flashcardTags: [...value.flashcardTags],
		wordLearningDecks: { ...value.wordLearningDecks },
		deckOrder: [...value.deckOrder],
		practicePerfectMessages: [...value.practicePerfectMessages],
		practiceErrorMessages: [...value.practiceErrorMessages],
		fsrsParameters: { ...value.fsrsParameters },
		deckStudySettings: Object.fromEntries(
			Object.entries(value.deckStudySettings).map(([deckId, overrides]) => [
				deckId,
				{
					...overrides,
					fsrsParameters: overrides.fsrsParameters && {
						...overrides.fsrsParameters,
					},
				},
			]),
		),
	}),
};

function normalizeDeckOrder(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((deckId): deckId is string => typeof deckId === "string"))];
}

/**
 * A stored message list counts as customized when it differs from the default
 * Chinese messages, regardless of the interface language.
 */
function hasCustomPracticeMessages(settings: Partial<FlashcardStudySettings>): boolean {
	if (
		settings.practicePerfectMessages === undefined &&
		settings.practiceErrorMessages === undefined
	) {
		return false;
	}

	const defaultZh = DEFAULT_PRACTICE_MESSAGES.zh;
	return (
		!stringArrayEquals(
			settings.practicePerfectMessages ?? defaultZh.perfect,
			defaultZh.perfect,
		) || !stringArrayEquals(settings.practiceErrorMessages ?? defaultZh.error, defaultZh.error)
	);
}
