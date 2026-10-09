import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_PRACTICE_MESSAGES, getDefaultPracticeMessages } from "../../strings/index";
import { DEFAULT_FLASHCARD_STUDY_SETTINGS, flashcardSettingsSlice } from "../slice";

/**
 * The 闪卡 slice owns the settings keys that used to be normalized inline in
 * `DataStore.normalizeSettings`, including the legacy top-level tag and the
 * language-dependent practice-message defaults.
 */
describe("flashcard settings slice", () => {
	it("migrates the legacy single tag when no tag list was stored", () => {
		const normalized = flashcardSettingsSlice.normalize({ flashcardTag: "#legacy" });

		expect(normalized.flashcardTags).toEqual(["#legacy"]);
	});

	it("keeps a stored tag list over the legacy single tag", () => {
		const normalized = flashcardSettingsSlice.normalize({
			flashcardTag: "#legacy",
			flashcardTags: ["#kept"],
		});

		expect(normalized.flashcardTags).toEqual(["#kept"]);
	});

	it("dedupes deck order and drops non-string entries", () => {
		const normalized = flashcardSettingsSlice.normalize({
			deckOrder: ["a", "b", "a", 7, null, "c"],
		});

		expect(normalized.deckOrder).toEqual(["a", "b", "c"]);
	});

	it("merges stored FSRS parameters over the defaults", () => {
		const normalized = flashcardSettingsSlice.normalize({
			fsrsParameters: { requestRetention: 0.75 },
		});

		expect(normalized.fsrsParameters).toEqual({
			requestRetention: 0.75,
			maximumInterval: DEFAULT_FLASHCARD_STUDY_SETTINGS.fsrsParameters.maximumInterval,
		});
	});

	it("applies the language defaults while messages stay uncustomized", () => {
		const normalized = flashcardSettingsSlice.normalize({ language: "en" });

		expect(normalized.practiceMessagesCustomized).toBe(false);
		expect(normalized.practicePerfectMessages).toEqual(
			getDefaultPracticeMessages("en").perfect,
		);
	});

	it("infers customization from stored messages that differ from the Chinese defaults", () => {
		const normalized = flashcardSettingsSlice.normalize({
			practicePerfectMessages: ["custom"],
		});

		expect(normalized.practiceMessagesCustomized).toBe(true);
		expect(normalized.practicePerfectMessages).toEqual(["custom"]);
		expect(normalized.practiceErrorMessages).toEqual(getDefaultPracticeMessages("zh").error);
	});

	it("honours an explicit uncustomized flag by resetting to the language defaults", () => {
		const normalized = flashcardSettingsSlice.normalize({
			language: "en",
			practiceMessagesCustomized: false,
			practicePerfectMessages: ["stale"],
			practiceErrorMessages: ["stale"],
		});

		expect(normalized.practiceMessagesCustomized).toBe(false);
		expect(normalized.practicePerfectMessages).toEqual(DEFAULT_PRACTICE_MESSAGES.en.perfect);
		expect(normalized.practiceErrorMessages).toEqual(DEFAULT_PRACTICE_MESSAGES.en.error);
	});

	it("clones the mutable containers without sharing them", () => {
		const source = flashcardSettingsSlice.normalize({
			flashcardTags: ["#a"],
			deckOrder: ["deck-1"],
			wordLearningDecks: { "deck-1": true },
			deckStudySettings: { "deck-1": { dailyNewCards: 5 } },
		});
		const clone = flashcardSettingsSlice.clone(source);

		clone.flashcardTags.push("#b");
		clone.deckOrder.push("deck-2");
		clone.wordLearningDecks["deck-2"] = true;
		clone.deckStudySettings["deck-1"]!.dailyNewCards = 9;

		expect(source.flashcardTags).toEqual(["#a"]);
		expect(source.deckOrder).toEqual(["deck-1"]);
		expect(source.wordLearningDecks).toEqual({ "deck-1": true });
		expect(source.deckStudySettings["deck-1"]!.dailyNewCards).toBe(5);
	});
});
