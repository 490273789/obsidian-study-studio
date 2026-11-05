import { describe, expect, it } from "vite-plus/test";
import { PracticeSessionClock, practiceCompletion } from "../practiceSession";

const cues = [
	{ id: "a", text: "First", start: 0, end: 2 },
	{ id: "b", text: "Second", start: 2, end: 5 },
];

describe("practiceCompletion", () => {
	it("stays null while the last sentence has not been reached", () => {
		expect(
			practiceCompletion({
				cues,
				currentCueId: "a",
				currentTime: 1,
				duration: 5,
				offset: 0,
				marked: 0,
			}),
		).toBeNull();
	});

	it("reports the reached sentence, total and mark count at the end", () => {
		expect(
			practiceCompletion({
				cues,
				currentCueId: "b",
				currentTime: 5,
				duration: 5,
				offset: 0,
				marked: 2,
			}),
		).toEqual({ reached: 2, total: 2, marked: 2 });
	});

	it("applies the subtitle offset to the sentence boundary", () => {
		const input = {
			cues,
			currentCueId: "b",
			duration: null,
			offset: 0.5,
			marked: 0,
		};
		expect(practiceCompletion({ ...input, currentTime: 4.6 })).toBeNull();
		expect(practiceCompletion({ ...input, currentTime: 5.3 })).not.toBeNull();
	});

	it("treats a missing current sentence as the last one", () => {
		const completion = practiceCompletion({
			cues,
			currentCueId: null,
			currentTime: 5,
			duration: 5,
			offset: 0,
			marked: 0,
		});
		expect(completion?.reached).toBe(2);
	});

	it("has no completion without sentences", () => {
		expect(
			practiceCompletion({
				cues: [],
				currentCueId: null,
				currentTime: 0,
				duration: 0,
				offset: 0,
				marked: 0,
			}),
		).toBeNull();
	});
});

describe("PracticeSessionClock", () => {
	it("accumulates only playing time", () => {
		let now = 1_000;
		const clock = new PracticeSessionClock(() => now);
		clock.setPlaying(true);
		now = 4_000;
		expect(clock.elapsedMs()).toBe(3_000);
		clock.setPlaying(false);
		now = 9_000;
		expect(clock.elapsedMs()).toBe(3_000);
		clock.setPlaying(true);
		now = 11_000;
		expect(clock.elapsedMs()).toBe(5_000);
		clock.reset();
		expect(clock.elapsedMs()).toBe(0);
	});

	it("ignores repeated playing transitions", () => {
		let now = 0;
		const clock = new PracticeSessionClock(() => now);
		clock.setPlaying(true);
		clock.setPlaying(true);
		now = 2_000;
		expect(clock.elapsedMs()).toBe(2_000);
	});
});
