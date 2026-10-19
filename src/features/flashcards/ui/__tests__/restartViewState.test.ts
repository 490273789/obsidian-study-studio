import { describe, expect, it } from "vite-plus/test";
import { toRestartViewState } from "../restartViewState";

const DECK_ID = "notes/deck.md";

describe("toRestartViewState", () => {
	it("maps study-day practice setup defaults back to study-setup", () => {
		const viewState = toRestartViewState({
			mode: "practice",
			deckId: DECK_ID,
			direction: "reversed",
			selection: {
				kind: "study-day",
				dayIndex: 2,
				studyOrder: "sequential",
			},
		});

		expect(viewState).toEqual({
			type: "study-setup",
			deckId: DECK_ID,
			initialStudyOrder: "sequential",
			initialDirection: "reversed",
		});
	});

	it("maps study-day spelling setup defaults back to study-setup", () => {
		const viewState = toRestartViewState({
			mode: "spelling",
			deckId: DECK_ID,
			selection: {
				kind: "study-day",
				dayIndex: 1,
			},
		});

		expect(viewState).toEqual({
			type: "study-setup",
			deckId: DECK_ID,
		});
	});

	it("maps practice random count defaults to practice-setup", () => {
		const viewState = toRestartViewState({
			mode: "practice",
			deckId: DECK_ID,
			direction: "normal",
			selection: {
				kind: "random",
				questionCount: 50,
			},
		});

		expect(viewState).toEqual({
			type: "practice-setup",
			deckId: DECK_ID,
			initialSelection: { kind: "random", questionCount: 50 },
			initialDirection: "normal",
		});
	});

	it("maps practice range defaults to practice-setup", () => {
		const viewState = toRestartViewState({
			mode: "practice",
			deckId: DECK_ID,
			direction: "reversed",
			selection: {
				kind: "range",
				startIndex: 10,
				endIndex: 25,
			},
		});

		expect(viewState).toEqual({
			type: "practice-setup",
			deckId: DECK_ID,
			initialSelection: { kind: "range", startIndex: 10, endIndex: 25 },
			initialDirection: "reversed",
		});
	});

	it("maps spelling smart defaults to spelling-setup", () => {
		const viewState = toRestartViewState({
			mode: "spelling",
			deckId: DECK_ID,
			selection: {
				kind: "smart",
				questionCount: 20,
			},
		});

		expect(viewState).toEqual({
			type: "spelling-setup",
			deckId: DECK_ID,
			initialSelection: { kind: "smart", questionCount: 20 },
		});
	});

	it("maps study setup defaults to study-setup", () => {
		const viewState = toRestartViewState({
			mode: "study",
			deckId: DECK_ID,
			studyOrder: "random",
			direction: "reversed",
		});

		expect(viewState).toEqual({
			type: "study-setup",
			deckId: DECK_ID,
			initialStudyOrder: "random",
			initialDirection: "reversed",
		});
	});

	it("maps spelling range defaults to spelling-setup", () => {
		const viewState = toRestartViewState({
			mode: "spelling",
			deckId: DECK_ID,
			selection: {
				kind: "range",
				startIndex: 5,
				endIndex: 15,
			},
		});

		expect(viewState).toEqual({
			type: "spelling-setup",
			deckId: DECK_ID,
			initialSelection: { kind: "range", startIndex: 5, endIndex: 15 },
		});
	});
});
