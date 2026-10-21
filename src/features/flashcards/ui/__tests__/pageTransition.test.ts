import { describe, expect, it } from "vite-plus/test";
import { PageTransitionTracker, type PageIdentity } from "../pageTransition";

const home: PageIdentity = { key: "home", depth: 0 };
const stats: PageIdentity = { key: "stats", depth: 1 };
const studySetup: PageIdentity = { key: "study-setup:deck", depth: 1 };
const practiceSetup: PageIdentity = { key: "practice-setup:deck", depth: 1 };
const wordList: PageIdentity = { key: "word-list:deck", depth: 1 };
const activeStudy: PageIdentity = { key: "active:study", depth: 2 };
const resultStudy: PageIdentity = { key: "result:study", depth: 2 };

describe("PageTransitionTracker", () => {
	it("mounts the first page without claiming a direction", () => {
		const tracker = new PageTransitionTracker();
		expect(tracker.resolve(home)).toEqual({
			key: "home",
			depth: 0,
			direction: "replace",
		});
	});

	it("reports going deeper as forward and coming back as backward", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home);

		expect(tracker.resolve(stats).direction).toBe("forward");
		expect(tracker.resolve(home).direction).toBe("backward");
	});

	it("walks the whole study flow: home → setup → session → result → home", () => {
		const tracker = new PageTransitionTracker();
		expect(tracker.resolve(home).direction).toBe("replace");
		expect(tracker.resolve(studySetup).direction).toBe("forward");
		expect(tracker.resolve(activeStudy).direction).toBe("forward");
		expect(tracker.resolve(resultStudy).direction).toBe("replace");
		expect(tracker.resolve(home).direction).toBe("backward");
	});

	it("fades when a sibling route replaces the current page", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(studySetup);

		expect(tracker.resolve(practiceSetup).direction).toBe("replace");
		expect(tracker.resolve(wordList).direction).toBe("replace");
	});

	it("does not re-announce the page for the same identity", () => {
		const tracker = new PageTransitionTracker();
		const first = tracker.resolve(activeStudy);

		expect(tracker.resolve({ ...activeStudy })).toBe(first);
	});

	it("keeps the challenge setup overlay on the landing page it covers", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(home);

		expect(tracker.resolve({ key: "home", depth: 0 })).toEqual({
			key: "home",
			depth: 0,
			direction: "replace",
		});
	});

	it("treats a restart from the result page as a replacement, not a step back", () => {
		const tracker = new PageTransitionTracker();
		tracker.resolve(activeStudy);
		tracker.resolve(resultStudy);

		expect(tracker.resolve(activeStudy).direction).toBe("replace");
	});
});
