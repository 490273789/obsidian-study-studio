import { describe, expect, it } from "vite-plus/test";
import type { ViewState } from "../../../../core/shared/types";
import {
	type PageLifecycle,
	PageTransitionTracker,
	pageDepthFor,
	pageKeyFor,
} from "../pageTransition";

const idle: PageLifecycle = { kind: "idle" };
const active = (mode: "study" | "practice" | "spelling" | "challenge"): PageLifecycle => ({
	kind: "active",
	mode,
});
const result = (mode: "study" | "practice" | "spelling" | "challenge"): PageLifecycle => ({
	kind: "result",
	mode,
});

const home: ViewState = { type: "home" };
const stats: ViewState = { type: "stats" };
const wordList: ViewState = { type: "word-list", deckId: "deck" };
const studySetup: ViewState = { type: "study-setup", deckId: "deck" };
const practiceSetup: ViewState = { type: "practice-setup", deckId: "deck" };
const spellingSetup: ViewState = { type: "spelling-setup", deckId: "deck" };
const challengeSetup: ViewState = { type: "challenge-setup" };

describe("pageKeyFor", () => {
	it("gives every deck route its own key and keeps the landing page stable", () => {
		expect(pageKeyFor(home, idle)).toBe("home");
		expect(pageKeyFor(challengeSetup, idle)).toBe("home");
		expect(pageKeyFor(stats, idle)).toBe("stats");
		expect(pageKeyFor(wordList, idle)).toBe("word-list:deck");
		expect(pageKeyFor(studySetup, idle)).toBe("study-setup:deck");
		expect(pageKeyFor(practiceSetup, idle)).toBe("practice-setup:deck");
		expect(pageKeyFor(spellingSetup, idle)).toBe("spelling-setup:deck");
	});

	it("separates decks so switching between them replays the entrance", () => {
		expect(pageKeyFor({ type: "study-setup", deckId: "a" }, idle)).not.toBe(
			pageKeyFor({ type: "study-setup", deckId: "b" }, idle),
		);
	});

	it("names the presented session surface by lifecycle kind and mode", () => {
		expect(pageKeyFor(home, active("study"))).toBe("active:study");
		expect(pageKeyFor(home, active("practice"))).toBe("active:practice");
		expect(pageKeyFor(home, result("study"))).toBe("result:study");
	});

	it("keeps one key while a route or a lifecycle snapshot merely re-renders", () => {
		// The presented lifecycle lags a live answer transition; the key must not
		// change until the presented page itself changes.
		expect(pageKeyFor(studySetup, idle)).toBe(pageKeyFor(studySetup, idle));
		expect(pageKeyFor(home, active("study"))).toBe(pageKeyFor(home, active("study")));
	});
});

describe("pageDepthFor", () => {
	it("ranks the landing page, interior routes, and session surfaces", () => {
		expect(pageDepthFor(home, idle)).toBe(0);
		expect(pageDepthFor(challengeSetup, idle)).toBe(0);
		expect(pageDepthFor(stats, idle)).toBe(1);
		expect(pageDepthFor(wordList, idle)).toBe(1);
		expect(pageDepthFor(studySetup, idle)).toBe(1);
		expect(pageDepthFor(home, active("study"))).toBe(2);
		expect(pageDepthFor(home, result("study"))).toBe(2);
	});
});

describe("PageTransitionTracker", () => {
	it("mounts the first page without claiming a direction", () => {
		const tracker = new PageTransitionTracker();
		expect(tracker.resolve(home, idle)).toEqual({
			key: "home",
			depth: 0,
			direction: "replace",
		});
	});

	it("reports going deeper as forward and coming back as backward", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home, idle);

		expect(tracker.resolve(stats, idle).direction).toBe("forward");
		expect(tracker.resolve(home, idle).direction).toBe("backward");
	});

	it("walks the whole study flow: home → setup → session → result → home", () => {
		const tracker = new PageTransitionTracker();
		expect(tracker.resolve(home, idle).direction).toBe("replace");
		expect(tracker.resolve(studySetup, idle).direction).toBe("forward");
		expect(tracker.resolve(home, active("study")).direction).toBe("forward");
		expect(tracker.resolve(home, result("study")).direction).toBe("replace");
		expect(tracker.resolve(home, idle).direction).toBe("backward");
	});

	it("fades when a sibling route replaces the current page", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(studySetup, idle);

		expect(tracker.resolve(practiceSetup, idle).direction).toBe("replace");
		expect(tracker.resolve(wordList, idle).direction).toBe("replace");
	});

	it("does not re-announce the page when only the lifecycle revision moves", () => {
		const tracker = new PageTransitionTracker();
		const first = tracker.resolve(home, active("study"));

		// Card progress presents a new snapshot with the same session surface.
		expect(tracker.resolve(home, active("study"))).toBe(first);
	});

	it("keeps the challenge setup overlay on the landing page it covers", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home, idle);

		expect(tracker.resolve(challengeSetup, idle)).toEqual({
			key: "home",
			depth: 0,
			direction: "replace",
		});
	});

	it("treats a restart from the result page as a replacement, not a step back", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home, active("study"));
		tracker.resolve(home, result("study"));

		expect(tracker.resolve(home, active("study")).direction).toBe("replace");
	});

	it("walks back from a session result to the landing page", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home, active("practice"));
		tracker.resolve(home, result("practice"));

		expect(tracker.resolve(home, idle).direction).toBe("backward");
	});
});
