import { describe, expect, it, vi } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import type { PracticeSetupPlan, SpellingSetupPlan } from "../sessionPlanner";
import {
	createMemoryPracticePreferenceStore,
	estimateMinutes,
	PracticeSetupSession,
} from "../practiceSetupSession";

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

describe("estimateMinutes", () => {
	it("returns 0 for 0 or negative card counts", () => {
		expect(estimateMinutes(0, false)).toBe(0);
		expect(estimateMinutes(-5, true)).toBe(0);
	});

	it("estimates flip duration at 7.5s per card with minimum 1 minute", () => {
		// 1 card: 7.5s -> round(7.5/60) = 0, but max(1, ...) = 1 minute
		expect(estimateMinutes(1, false)).toBe(1);
		// 10 cards: 75s = 1.25m -> 1 minute
		expect(estimateMinutes(10, false)).toBe(1);
		// 20 cards: 150s = 2.5m -> 3 minutes (Math.round(2.5) = 3)
		expect(estimateMinutes(20, false)).toBe(3);
		// 100 cards: 750s = 12.5m -> 13 minutes
		expect(estimateMinutes(100, false)).toBe(13);
	});

	it("estimates spelling duration at 12s per card with minimum 1 minute", () => {
		// 1 card: 12s -> 1 minute
		expect(estimateMinutes(1, true)).toBe(1);
		// 5 cards: 60s -> 1 minute
		expect(estimateMinutes(5, true)).toBe(1);
		// 10 cards: 120s -> 2 minutes
		expect(estimateMinutes(10, true)).toBe(2);
		// 40 cards: 480s -> 8 minutes
		expect(estimateMinutes(40, true)).toBe(8);
	});
});

describe("PracticeSetupSession", () => {
	it("initializes with flip mode and correct default snapshot", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		const snapshot = session.getSnapshot();
		expect(snapshot.practiceKind).toBe("flip");
		expect(snapshot.isSpelling).toBe(false);
		expect(snapshot.direction).toBe("normal");
		expect(snapshot.selectionMode).toBe("random");
		expect(snapshot.questionCount).toBe(50);
		expect(snapshot.questionCountInput).toBe("50");
		expect(snapshot.activeCount).toBe(50);
		expect(snapshot.activeMinutes).toBe(estimateMinutes(50, false));
		expect(snapshot.isStartDisabled).toBe(false);
		expect(snapshot.showModeSelector).toBe(false);
		expect(snapshot.spellingEligible).toBe(false);
		expect(snapshot.quickQuestionCounts).toEqual([20, 50]);
	});

	it("persists practice kind preference across sessions", () => {
		const store = createMemoryPracticePreferenceStore();
		const session1 = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			preferenceStore: store,
		});

		expect(session1.getSnapshot().practiceKind).toBe("flip");
		session1.setPracticeKind("spelling");
		expect(session1.getSnapshot().practiceKind).toBe("spelling");
		expect(store.getPreference(deck.id)).toBe("spelling");

		// New session for same deck should recover persisted "spelling"
		const session2 = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			preferenceStore: store,
		});
		expect(session2.getSnapshot().practiceKind).toBe("spelling");
	});

	it("respects initialKind override regardless of store", () => {
		const store = createMemoryPracticePreferenceStore();
		store.setPreference(deck.id, "spelling");

		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			initialKind: "flip",
			preferenceStore: store,
		});
		expect(session.getSnapshot().practiceKind).toBe("flip");
	});

	it("handles quick question selection and custom input normalization", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		session.selectQuickQuestionCount(20);
		expect(session.getSnapshot().questionCount).toBe(20);
		expect(session.getSnapshot().questionCountInput).toBe("20");

		// Custom input while typing
		session.setQuestionCountInput("200");
		expect(session.getSnapshot().questionCount).toBe(100); // clamped to maxQuestions
		expect(session.getSnapshot().questionCountInput).toBe("200"); // raw input preserved

		// Blur commits normalized value
		session.commitQuestionCount();
		expect(session.getSnapshot().questionCount).toBe(100);
		expect(session.getSnapshot().questionCountInput).toBe("100");

		// Empty/invalid input commits to 1
		session.setQuestionCountInput("");
		session.commitQuestionCount();
		expect(session.getSnapshot().questionCount).toBe(1);
		expect(session.getSnapshot().questionCountInput).toBe("1");
	});

	it("handles range selection and normalization on blur", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		session.setSelectionMode("range");
		session.setDirection("reversed");
		session.setRangeStartInput("10");
		session.setRangeEndInput("200");

		session.commitRange();
		const snapshot = session.getSnapshot();
		expect(snapshot.rangeStart).toBe(10);
		expect(snapshot.rangeEnd).toBe(100);
		expect(snapshot.rangeStartInput).toBe("10");
		expect(snapshot.rangeEndInput).toBe("100");
		expect(snapshot.rangeQuestionCount).toBe(91);
		expect(snapshot.activeCount).toBe(91);

		const request = session.buildSessionStartRequest();
		expect(request).toEqual({
			mode: "practice",
			deckId: "deck-1",
			direction: "reversed",
			selection: { kind: "range", startIndex: 10, endIndex: 100 },
		});
	});

	it("handles spelling smart mode and range mode", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			spellingPlan: defaultSpellingPlan,
			initialKind: "spelling",
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		expect(session.getSnapshot().isSpelling).toBe(true);
		expect(session.getSnapshot().activeCount).toBe(20);

		// Select quick count (e.g. 10)
		session.selectQuickSpellingCount(10);
		expect(session.getSnapshot().spellingQuestionCount).toBe(10);
		expect(session.getSnapshot().activeCount).toBe(10);

		let onStart = vi.fn();
		expect(session.startSession(onStart)).toBe(true);
		expect(onStart).toHaveBeenCalledWith({
			mode: "spelling",
			deckId: "deck-1",
			selection: { kind: "smart", questionCount: 10 },
		});

		// Switch to range mode
		session.setSpellingMode("range");
		session.setSpellingRangeStartInput("5");
		session.setSpellingRangeEndInput("25");
		session.commitSpellingRange();

		const snapshot = session.getSnapshot();
		expect(snapshot.spellingRangeStart).toBe(5);
		expect(snapshot.spellingRangeEnd).toBe(25);
		expect(snapshot.spellingRangeCount).toBe(21);
		expect(snapshot.activeCount).toBe(21);

		onStart = vi.fn();
		expect(session.startSession(onStart)).toBe(true);
		expect(onStart).toHaveBeenCalledWith({
			mode: "spelling",
			deckId: "deck-1",
			selection: { kind: "range", startIndex: 5, endIndex: 25 },
		});
	});

	it("disables start session when card count is 0", () => {
		const emptyPlan: PracticeSetupPlan = {
			...defaultPracticePlan,
			maxQuestions: 0,
			initialQuestionCount: 0,
		};
		const session = new PracticeSetupSession({
			deck,
			plan: emptyPlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		expect(session.getSnapshot().isStartDisabled).toBe(true);
		expect(session.buildSessionStartRequest()).toBeNull();
		const onStart = vi.fn();
		expect(session.startSession(onStart)).toBe(false);
		expect(onStart).not.toHaveBeenCalled();
	});

	it("notifies subscribers when state changes", () => {
		const session = new PracticeSetupSession({
			deck,
			plan: defaultPracticePlan,
			preferenceStore: createMemoryPracticePreferenceStore(),
		});

		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);

		session.setDirection("reversed");
		expect(listener).toHaveBeenCalledTimes(1);

		session.selectQuickQuestionCount(20);
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		session.setDirection("normal");
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
