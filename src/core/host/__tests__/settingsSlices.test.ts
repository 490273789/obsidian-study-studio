import { describe, expect, it } from "vitest";
import {
	cloneSettingsDocument,
	DEFAULT_SETTINGS,
	normalizeSettingsDocument,
	projectSettings,
	settingsOwnerKeys,
	settingsOwners,
	SHARED_SETTINGS_SLICES,
	SETTINGS_SLICES,
	validateSettingsOwnership,
} from "../settingsSlices";

/**
 * These invariants belong to the registry itself: the settings document is only
 * total because the slices tile it exactly, and the explicit compositions in
 * `settingsSlices.ts` must keep agreeing with `SETTINGS_SLICES`.
 */
describe("settings slices registry", () => {
	it("tiles the settings document exactly once", () => {
		const owned = SETTINGS_SLICES.flatMap((slice) => [...slice.keys]);

		expect(new Set(owned).size, "two slices claim the same key").toBe(owned.length);
		expect([...owned].sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});

	it("pins the on-disk settings contract", () => {
		// `data.json` compatibility: this list may only change deliberately.
		expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
			"ai",
			"dailyNewCards",
			"dailyReviewCards",
			"deckOrder",
			"deckStudySettings",
			"dictionary",
			"flashcardTags",
			"fsrsParameters",
			"language",
			"practiceErrorMessages",
			"practiceMessagesCustomized",
			"practicePerfectMessages",
			"pronunciation",
			"selectionPopup",
			"studyOrder",
			"translation",
			"wordLearningDecks",
		]);
	});

	it("gives every slice a unique id and the host the first position", () => {
		const ids = SETTINGS_SLICES.map((slice) => slice.id);

		expect(new Set(ids).size).toBe(ids.length);
		// The host slice normalizes `language`; the 闪卡 slice derives its
		// practice-message defaults from the same raw value independently, so
		// position is documentation rather than a runtime dependency.
		expect(ids[0]).toBe("host");
	});

	it("assigns every non-shared slice to one settings owner", () => {
		expect(() => validateSettingsOwnership()).not.toThrow();
		expect(SHARED_SETTINGS_SLICES.flatMap((slice) => slice.keys)).toEqual(["language"]);
		expect(settingsOwners()).toEqual([
			"workbench",
			"flashcards",
			"translation",
			"dictionary",
			"selectionHelper",
		]);
		expect(settingsOwnerKeys("flashcards")).toContain("pronunciation");
		expect(settingsOwnerKeys("translation")).toEqual(["translation"]);
	});

	it("projects detached runtime snapshots instead of hiding a full document with types", () => {
		const translation = projectSettings("translation", DEFAULT_SETTINGS);
		expect(Object.keys(translation).sort()).toEqual(["language", "translation"]);

		translation.translation.profiles[0]!.name = "changed";
		expect(projectSettings("translation", DEFAULT_SETTINGS).translation).toEqual(
			DEFAULT_SETTINGS.translation,
		);
	});

	it("treats each slice's own defaults as already normalized", () => {
		for (const slice of SETTINGS_SLICES) {
			expect(slice.normalize(undefined), `${slice.id} defaults`).toEqual(slice.defaults());
		}
		expect(normalizeSettingsDocument(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
	});

	it("falls back to defaults for an absent or unusable document", () => {
		expect(normalizeSettingsDocument(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettingsDocument(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettingsDocument({})).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettingsDocument("garbage")).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettingsDocument(42)).toEqual(DEFAULT_SETTINGS);
	});

	it("normalizes each slice in isolation when the document is partial", () => {
		const normalized = normalizeSettingsDocument({
			language: "en",
			ai: { configs: [{ id: "engine" }], defaultConfigId: "engine" },
		});

		expect(normalized.language).toBe("en");
		// Every other slice keeps its own defaults.
		expect(normalized.translation).toEqual(DEFAULT_SETTINGS.translation);
		expect(normalized.dictionary).toEqual(DEFAULT_SETTINGS.dictionary);
		expect(normalized.pronunciation).toEqual(DEFAULT_SETTINGS.pronunciation);
		expect(normalized.flashcardTags).toEqual(DEFAULT_SETTINGS.flashcardTags);
	});

	it("clones without sharing mutable state with the source", () => {
		const source = normalizeSettingsDocument({
			language: "en",
			flashcardTags: ["#a"],
			deckOrder: ["deck-1"],
			wordLearningDecks: { "deck-1": true },
			practicePerfectMessages: ["custom"],
			practiceErrorMessages: ["custom"],
			fsrsParameters: { requestRetention: 0.8, maximumInterval: 100 },
			deckStudySettings: { "deck-1": { dailyNewCards: 5 } },
			dictionary: { favoritePath: "words.md", history: ["word"] },
		});

		const clone = cloneSettingsDocument(source);
		expect(clone).toEqual(source);

		clone.flashcardTags.push("#b");
		clone.deckOrder.push("deck-2");
		clone.wordLearningDecks["deck-2"] = true;
		clone.practicePerfectMessages.push("extra");
		clone.practiceErrorMessages.push("extra");
		clone.fsrsParameters.requestRetention = 0.5;
		clone.deckStudySettings["deck-1"]!.dailyNewCards = 9;
		clone.dictionary.history.push("second");

		expect(source.flashcardTags).toEqual(["#a"]);
		expect(source.deckOrder).toEqual(["deck-1"]);
		expect(source.wordLearningDecks).toEqual({ "deck-1": true });
		expect(source.practicePerfectMessages).toEqual(["custom"]);
		expect(source.practiceErrorMessages).toEqual(["custom"]);
		expect(source.fsrsParameters.requestRetention).toBe(0.8);
		expect(source.deckStudySettings["deck-1"]!.dailyNewCards).toBe(5);
		expect(source.dictionary.history).toEqual(["word"]);
	});
});
