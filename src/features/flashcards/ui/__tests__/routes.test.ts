import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ Component: class {}, Notice: class {} }));
import type { Deck } from "../../../../core/shared/types";
import type { DeckHome } from "../../domain/decks/deckHome";
import type { SessionLifecycleSnapshot } from "../../domain/sessions/sessionLifecycle";
import type { PresentedCard } from "../answerPresentationTransition";
import { ChallengeSetupModal } from "../views/Challenge";
import { CardView } from "../views/Card";
import { HomeRoute } from "../views/Home/HomeRoute";
import { StudySetup } from "../views/Study";
import { WordListView } from "../views/WordList";
import {
	challengeSetup,
	fromRestartOrigin,
	home,
	practiceSetup,
	resolvePage,
	spellingSetup,
	stats,
	studySetup,
	wordList,
	type FlashcardPageContext,
	type ViewState,
} from "../routes";

const deck = {
	id: "deck",
	name: "Deck",
	filePath: "deck.md",
	tag: "#单词",
	cards: [],
	studyCount: 0,
	lastStudied: null,
} as unknown as Deck;

function deckHomeWith(overrides: {
	deck?: Deck | undefined;
	studyPlan?: unknown;
	practicePlan?: unknown;
	spellingPlan?: unknown;
}): DeckHome {
	const studyPlan = "studyPlan" in overrides ? overrides.studyPlan : {};
	const practicePlan = "practicePlan" in overrides ? overrides.practicePlan : {};
	const spellingPlan = "spellingPlan" in overrides ? overrides.spellingPlan : {};
	return {
		getDeck: (id: string) => (id === "deck" ? overrides.deck : undefined),
		getStudySetupPlan: () => studyPlan ?? null,
		getPracticeSetupPlan: () => practicePlan ?? null,
		getSpellingSetupPlan: () => spellingPlan ?? null,
		getSnapshot: () => ({ decks: [], studyHistory: [], challenge: {} }),
	} as unknown as DeckHome;
}

const idle = { kind: "idle", reference: {}, lastEnd: null } as unknown as SessionLifecycleSnapshot;
const resultPractice = {
	kind: "result",
	mode: "practice",
} as unknown as SessionLifecycleSnapshot;
const activeStudy = {
	kind: "active",
	mode: "study",
	reference: { key: "study" },
} as unknown as SessionLifecycleSnapshot;

const presented: PresentedCard = {
	kind: "study",
	card: {
		identity: "card",
		currentDeckId: "deck",
		front: "front",
		back: "back",
		sourceFile: "deck.md",
		indexInFile: 0,
	},
	direction: "normal",
	encounterKey: "encounter",
	presentationKey: "presentation",
};

const context = {
	deckHome: deckHomeWith({ deck }),
	deckHomeOwnerId: "owner",
	shortcuts: [],
	wordLearningDecks: {},
	isNavigationBusy: false,
	onStartChallenge: () => {},
	onBackHome: () => {},
} as unknown as FlashcardPageContext;

function pageFor(
	viewState: ViewState,
	options: {
		lifecycle?: SessionLifecycleSnapshot;
		presentedCard?: PresentedCard | null;
		deckHome?: DeckHome;
	} = {},
) {
	return resolvePage({
		viewState,
		lifecycle: options.lifecycle ?? idle,
		presentedCard: options.presentedCard ?? null,
		deckHome: options.deckHome ?? deckHomeWith({ deck }),
	});
}

function elementType(node: React.ReactNode): unknown {
	return React.isValidElement(node) ? node.type : null;
}

describe("route constructors", () => {
	it("freezes every non-session route and keeps its payload", () => {
		expect(home()).toEqual({ type: "home" });
		expect(stats()).toEqual({ type: "stats" });
		expect(challengeSetup()).toEqual({ type: "challenge-setup" });
		expect(wordList("deck")).toEqual({ type: "word-list", deckId: "deck" });
		const setup = studySetup("deck", {
			initialStudyOrder: "random",
			initialDirection: "reversed",
		});
		expect(setup).toEqual({
			type: "study-setup",
			deckId: "deck",
			initialStudyOrder: "random",
			initialDirection: "reversed",
		});
		expect(Object.isFrozen(setup)).toBe(true);

		const practice = practiceSetup("deck", {
			initialSelection: { kind: "random", questionCount: 3 },
			initialDirection: "normal",
		});
		expect(Object.isFrozen(practice)).toBe(true);
		if (practice.type !== "practice-setup") throw new Error("Expected practice setup");
		expect(Object.isFrozen(practice.initialSelection)).toBe(true);
	});

	it("maps restart provenance onto the same route vocabulary", () => {
		expect(
			fromRestartOrigin({
				mode: "challenge",
			} as never),
		).toEqual({ type: "challenge-setup" });
		expect(
			fromRestartOrigin({
				mode: "study",
				deckId: "deck",
				studyOrder: "random",
				direction: "reversed",
			} as never),
		).toEqual({
			type: "study-setup",
			deckId: "deck",
			initialStudyOrder: "random",
			initialDirection: "reversed",
		});
		expect(
			fromRestartOrigin({
				mode: "practice",
				deckId: "deck",
				direction: "normal",
				selection: { kind: "study-day", dayIndex: 1, studyOrder: "sequential" },
			} as never),
		).toEqual({
			type: "study-setup",
			deckId: "deck",
			initialStudyOrder: "sequential",
			initialDirection: "normal",
		});
		expect(
			fromRestartOrigin({
				mode: "spelling",
				deckId: "deck",
				selection: { kind: "random", questionCount: 5 },
			} as never),
		).toEqual({
			type: "spelling-setup",
			deckId: "deck",
			initialSelection: { kind: "random", questionCount: 5 },
		});
	});
});

describe("resolvePage", () => {
	it("gives every route its key, depth, and page component", () => {
		expect(pageFor(home())).toMatchObject({ key: "home", depth: 0 });
		expect(pageFor(stats())).toMatchObject({ key: "stats", depth: 1 });
		expect(pageFor(wordList("deck"))).toMatchObject({ key: "word-list:deck", depth: 1 });
		expect(pageFor(studySetup("deck"))).toMatchObject({
			key: "study-setup:deck",
			depth: 1,
		});
		expect(pageFor(practiceSetup("deck"))).toMatchObject({
			key: "practice-setup:deck",
			depth: 1,
		});
		expect(pageFor(spellingSetup("deck"))).toMatchObject({
			key: "spelling-setup:deck",
			depth: 1,
		});
		expect(pageFor(challengeSetup())).toMatchObject({ key: "home", depth: 0 });
	});

	it("resolves the component for home, word list, and setup pages", () => {
		expect(elementType(pageFor(home()).render(context))).toBe(HomeRoute);
		expect(elementType(pageFor(wordList("deck")).render(context))).toBe(WordListView);
		const studyNode = pageFor(studySetup("deck")).render(context);
		const wrapper = studyNode as React.ReactElement<{ children: () => React.ReactNode }>;
		expect(elementType(wrapper.props.children())).toBe(StudySetup);
	});

	it("renders the challenge setup as the landing page plus its overlay", () => {
		const node = pageFor(challengeSetup()).render(context) as React.ReactElement<{
			children: React.ReactNode[];
		}>;
		const children = React.Children.toArray(node.props.children);
		expect(elementType(children[0])).toBe(HomeRoute);
		const overlay = children[1] as React.ReactElement<{
			children: (snapshot: unknown) => React.ReactNode;
		}>;
		expect(elementType(overlay.props.children({ challenge: {} }))).toBe(ChallengeSetupModal);
	});

	it("falls back to home when the deck or plan is missing", () => {
		expect(pageFor(wordList("missing"))).toMatchObject({ key: "home", depth: 0 });
		expect(
			pageFor(studySetup("deck"), {
				deckHome: deckHomeWith({ deck, studyPlan: null }),
			}),
		).toMatchObject({ key: "home", depth: 0 });
	});

	it("lets active and result surfaces win over the resting route", () => {
		expect(pageFor(home(), { lifecycle: activeStudy, presentedCard: presented })).toMatchObject(
			{ key: "active:study", depth: 2 },
		);
		expect(pageFor(home(), { lifecycle: activeStudy, presentedCard: null })).toMatchObject({
			key: "home",
			depth: 0,
		});
		expect(pageFor(studySetup("deck"), { lifecycle: resultPractice })).toMatchObject({
			key: "result:practice",
			depth: 2,
		});
	});

	it("renders the active study surface from the presented card", () => {
		const page = pageFor(home(), {
			lifecycle: activeStudy,
			presentedCard: presented,
		});
		expect(elementType(page.render(context))).toBe(CardView);
	});
});
