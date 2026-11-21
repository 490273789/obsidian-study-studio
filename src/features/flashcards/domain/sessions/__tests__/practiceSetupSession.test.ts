import { describe, expect, it, vi } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import type { PracticeSetupPlan, SpellingSetupPlan } from "../sessionPlanner";
import { createMemoryPracticePreferenceStore, PracticeSetupSession } from "../practiceSetupSession";

const deck: Deck = {
	id: "deck-1",
	name: "Deck 1",
	tag: "#deck",
	filePath: "deck.md",
	cards: [],
	studyCount: 0,
	lastStudied: null,
};

const defaultPracticePlan: PracticeSetupPlan = {
	maxQuestions: 100,
	maxRangeStart: 99,
	defaultQuestionCount: 50,
	initialQuestionCount: 50,
	initialRangeStart: 1,
	initialRangeEnd: 50,
	initialSelectionMode: "random",
};

const defaultSpellingPlan: SpellingSetupPlan = {
	stats: { total: 40, unpracticed: 15 },
	maxQuestions: 40,
	defaultCount: 20,
	initialQuestionCount: 20,
	initialRangeStart: 1,
	initialRangeEnd: 20,
	initialSelectionMode: "smart",
};

const disabledSpellingSnapshot = {
	enabled: false,
	ready: false,
	valid: false,
	canStart: false,
	hasStableIdentities: false,
	issueCount: 2,
	ignoredCardCount: 0,
};

describe("PracticeSetupSession", () => {
	it("projects default flip setup state with precomputed quick counts and minutes", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		const snapshot = session.getSnapshot();
		expect(snapshot.practiceKind).toBe("flip");
		expect(snapshot.direction).toBe("normal");
		expect(snapshot.selectionMode).toBe("random");
		expect(snapshot.maxCount).toBe(100);
		expect(snapshot.count).toBe(50);
		expect(snapshot.countInput).toBe("50");
		expect(snapshot.activeCount).toBe(50);
		expect(snapshot.activeMinutes).toBe(6); // round(50 * 7.5 / 60) = 6
		expect(snapshot.allCountMinutes).toBe(13); // round(100 * 7.5 / 60) = 13
		expect(snapshot.quickCounts).toEqual([
			{ count: 20, minutes: 3 },
			{ count: 50, minutes: 6 },
		]);
		expect(snapshot.showCustomEstimate).toBe(false);
		expect(snapshot.isStartDisabled).toBe(false);
		expect(snapshot.showModeSelector).toBe(false);
		expect(snapshot.spellingEligible).toBe(false);
	});

	it("persists practice kind preference when injected and respects explicit initialKind", () => {
		const store = createMemoryPracticePreferenceStore();
		const first = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			preferenceStore: store,
		});

		expect(first.getSnapshot().practiceKind).toBe("flip");
		first.act({ type: "set-kind", kind: "spelling" });
		expect(first.getSnapshot().practiceKind).toBe("spelling");
		expect(store.getPreference(deck.id)).toBe("spelling");

		const second = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			preferenceStore: store,
		});
		expect(second.getSnapshot().practiceKind).toBe("spelling");
		expect(second.getSnapshot().quickCounts).toEqual([
			{ count: 10, minutes: 2 },
			{ count: 20, minutes: 4 },
		]);

		const overridden = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			initialKind: "flip",
			preferenceStore: store,
		});
		expect(overridden.getSnapshot().practiceKind).toBe("flip");
	});

	it("falls back to flip mode when spelling is unavailable initially or becomes unavailable", () => {
		const store = createMemoryPracticePreferenceStore();
		store.setPreference(deck.id, "spelling");

		const initiallyUnavailable = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			spellingSnapshot: disabledSpellingSnapshot,
			initialKind: "spelling",
			preferenceStore: store,
		});
		expect(initiallyUnavailable.getSnapshot()).toMatchObject({
			practiceKind: "flip",
			showModeSelector: true,
			spellingEligible: false,
			spellingUnavailableReason: { kind: "disabled" },
		});
		initiallyUnavailable.act({ type: "set-kind", kind: "spelling" });
		expect(initiallyUnavailable.getSnapshot().practiceKind).toBe("flip");

		const source = {
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			preferenceStore: store,
		};
		const dynamicSession = new PracticeSetupSession({ ...source, initialKind: "spelling" });
		dynamicSession.act({ type: "set-selection-mode", mode: "range" });
		dynamicSession.act({ type: "edit-range-start", value: "5" });
		dynamicSession.act({ type: "edit-range-end", value: "8" });
		dynamicSession.act({ type: "commit-range" });

		dynamicSession.updateSource({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			spellingSnapshot: disabledSpellingSnapshot,
		});
		expect(dynamicSession.getSnapshot()).toMatchObject({
			practiceKind: "flip",
			spellingEligible: false,
			isStartDisabled: false,
		});
		expect(store.getPreference(deck.id)).toBe("spelling");

		dynamicSession.updateSource({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
		});
		dynamicSession.act({ type: "set-kind", kind: "spelling" });
		expect(dynamicSession.start()).toEqual({
			mode: "spelling",
			deckId: "deck-1",
			selection: { kind: "range", startIndex: 5, endIndex: 8 },
		});
	});

	it("preserves independent flip and spelling drafts across mode switches", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
		});

		session.act({ type: "set-direction", direction: "reversed" });
		session.act({ type: "pick-count", count: 20 });
		session.act({ type: "set-kind", kind: "spelling" });
		session.act({ type: "set-selection-mode", mode: "range" });
		session.act({ type: "edit-range-start", value: "3" });
		session.act({ type: "edit-range-end", value: "15" });
		session.act({ type: "commit-range" });

		expect(session.getSnapshot()).toMatchObject({
			practiceKind: "spelling",
			selectionMode: "range",
			activeCount: 13,
			activeMinutes: 3, // round(13 * 12 / 60) = 3
		});

		session.act({ type: "set-kind", kind: "flip" });
		expect(session.getSnapshot()).toMatchObject({
			practiceKind: "flip",
			selectionMode: "random",
			direction: "reversed",
			count: 20,
			activeCount: 20,
			activeMinutes: 3,
		});
	});

	it("handles quick count, live custom count preview, commit, and start normalization", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
		});

		session.act({ type: "pick-count", count: 20 });
		expect(session.getSnapshot()).toMatchObject({
			count: 20,
			countInput: "20",
			showCustomEstimate: false,
		});

		session.act({ type: "edit-count", value: "35" });
		expect(session.getSnapshot()).toMatchObject({
			count: 35,
			countInput: "35",
			countMinutes: 4,
			showCustomEstimate: true,
		});

		session.act({ type: "edit-count", value: "200" });
		expect(session.getSnapshot()).toMatchObject({
			count: 100,
			countInput: "200",
		});

		session.act({ type: "commit-count" });
		expect(session.getSnapshot()).toMatchObject({
			count: 100,
			countInput: "100",
		});

		session.act({ type: "edit-count", value: "" });
		expect(session.start()).toEqual({
			mode: "practice",
			deckId: "deck-1",
			direction: "normal",
			selection: { kind: "random", questionCount: 1 },
		});
		expect(session.getSnapshot().countInput).toBe("1");
	});

	it.each(["flip", "spelling"] as const)(
		"unifies %s range input without clamping during typing, previews live, and commits on start",
		(kind) => {
			const session = new PracticeSetupSession({
				deck,
				plan: defaultPracticePlan,
				spellingPlan: defaultSpellingPlan,
				initialKind: kind,
			});

			session.act({ type: "set-selection-mode", mode: "range" });
			if (kind === "flip") {
				session.act({ type: "set-direction", direction: "reversed" });
			}

			// Re-typing 1-50/1-20 into 50-80 (or 30-35 for spelling max 40) must not rewrite inputs
			const targetStart = kind === "flip" ? "50" : "30";
			const targetEnd = kind === "flip" ? "80" : "35";
			session.act({ type: "edit-range-start", value: targetStart });
			expect(session.getSnapshot()).toMatchObject({
				rangeStartInput: targetStart,
				rangeStart: Number(targetStart),
				rangeEnd: Number(targetStart),
				rangeCount: 1,
			});

			session.act({ type: "edit-range-end", value: targetEnd });
			const expectedCount = Number(targetEnd) - Number(targetStart) + 1;
			expect(session.getSnapshot()).toMatchObject({
				rangeStartInput: targetStart,
				rangeEndInput: targetEnd,
				rangeStart: Number(targetStart),
				rangeEnd: Number(targetEnd),
				rangeCount: expectedCount,
				activeCount: expectedCount,
			});

			// Overshooting max in input is preserved until commit/start, where start() normalizes it
			session.act({ type: "edit-range-end", value: "200" });
			expect(session.getSnapshot().rangeEndInput).toBe("200");
			const expectedMax = kind === "flip" ? 100 : 40;
			expect(session.getSnapshot().rangeEnd).toBe(expectedMax);

			const request = session.start();
			expect(session.getSnapshot().rangeEndInput).toBe(String(expectedMax));
			expect(request).toEqual(
				kind === "flip"
					? {
							mode: "practice",
							deckId: "deck-1",
							direction: "reversed",
							selection: {
								kind: "range",
								startIndex: Number(targetStart),
								endIndex: expectedMax,
							},
						}
					: {
							mode: "spelling",
							deckId: "deck-1",
							selection: {
								kind: "range",
								startIndex: Number(targetStart),
								endIndex: expectedMax,
							},
						},
			);
		},
	);

	it("returns null from start when deck has no eligible cards", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: { ...defaultPracticePlan, maxQuestions: 0, initialQuestionCount: 0 },
		});

		expect(session.getSnapshot().isStartDisabled).toBe(true);
		expect(session.start()).toBeNull();
	});

	it("re-clamps limits on updateSource without losing draft or notifying on identical source", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
		});
		session.act({ type: "set-selection-mode", mode: "range" });
		session.act({ type: "set-direction", direction: "reversed" });
		session.act({ type: "edit-range-start", value: "5" });
		session.act({ type: "edit-range-end", value: "42" });
		session.act({ type: "commit-range" });

		const smaller = {
			deck: { ...deck, name: "Renamed" },
			plan: { ...defaultPracticePlan, maxQuestions: 20, maxRangeStart: 19 },
		};
		session.updateSource(smaller);

		expect(session.getSnapshot()).toMatchObject({
			deck: { name: "Renamed" },
			maxCount: 20,
			direction: "reversed",
			selectionMode: "range",
			rangeStart: 5,
			rangeEnd: 20,
			rangeStartInput: "5",
			rangeEndInput: "20",
		});
		expect(session.start()).toEqual({
			mode: "practice",
			deckId: "deck-1",
			direction: "reversed",
			selection: { kind: "range", startIndex: 5, endIndex: 20 },
		});

		const before = session.getSnapshot();
		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);
		session.updateSource({ ...smaller, plan: { ...smaller.plan } });
		expect(session.getSnapshot()).toBe(before);
		expect(listener).not.toHaveBeenCalled();

		session.act({ type: "set-direction", direction: "normal" });
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		session.act({ type: "pick-count", count: 10 });
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
