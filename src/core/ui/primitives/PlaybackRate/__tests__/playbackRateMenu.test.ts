import { describe, expect, it } from "vite-plus/test";
import {
	computePlaybackRatePopoverPosition,
	formatPlaybackRate,
	nextPlaybackRateIndex,
} from "../playbackRateMenu";

const VIEWPORT = { width: 800, height: 720 } as const;
const POPOVER = { width: 220, height: 120 } as const;

describe("playback rate popover geometry", () => {
	it("formats rates with a multiplication sign", () => {
		expect(formatPlaybackRate(1)).toBe("1×");
		expect(formatPlaybackRate(1.5)).toBe("1.5×");
	});

	it("prefers the space above the trigger", () => {
		const position = computePlaybackRatePopoverPosition({
			anchor: { top: 500, left: 100, width: 60, height: 30 },
			popover: POPOVER,
			viewport: VIEWPORT,
		});
		expect(position).toEqual({ top: 372, left: 20, placement: "top" });
	});

	it("flips below the trigger when the space above is too small", () => {
		const position = computePlaybackRatePopoverPosition({
			anchor: { top: 60, left: 100, width: 60, height: 30 },
			popover: POPOVER,
			viewport: VIEWPORT,
		});
		expect(position).toEqual({ top: 98, left: 20, placement: "bottom" });
	});

	it("uses the larger side and clamps inside the viewport when neither side fits", () => {
		const position = computePlaybackRatePopoverPosition({
			anchor: { top: 70, left: 100, width: 60, height: 20 },
			popover: POPOVER,
			viewport: { width: 800, height: 160 },
		});
		expect(position).toEqual({ top: 8, left: 20, placement: "top" });
	});

	it("honours start and end alignment within the viewport edges", () => {
		const start = computePlaybackRatePopoverPosition({
			anchor: { top: 500, left: 0, width: 60, height: 30 },
			popover: POPOVER,
			viewport: VIEWPORT,
			align: "start",
		});
		expect(start.left).toBe(8);

		const end = computePlaybackRatePopoverPosition({
			anchor: { top: 500, left: 700, width: 100, height: 30 },
			popover: POPOVER,
			viewport: VIEWPORT,
			align: "end",
		});
		expect(end.left).toBe(572);
	});

	it("keeps the left margin when the viewport is narrower than the popover", () => {
		const position = computePlaybackRatePopoverPosition({
			anchor: { top: 500, left: 10, width: 60, height: 30 },
			popover: POPOVER,
			viewport: { width: 150, height: 720 },
		});
		expect(position.left).toBe(8);
	});
});

describe("playback rate option navigation", () => {
	it("wraps arrow navigation at both ends", () => {
		expect(nextPlaybackRateIndex(0, "ArrowDown", 5)).toBe(1);
		expect(nextPlaybackRateIndex(4, "ArrowDown", 5)).toBe(0);
		expect(nextPlaybackRateIndex(0, "ArrowUp", 5)).toBe(4);
		expect(nextPlaybackRateIndex(3, "ArrowLeft", 5)).toBe(2);
		expect(nextPlaybackRateIndex(3, "ArrowRight", 5)).toBe(4);
	});

	it("jumps to the ends with Home and End", () => {
		expect(nextPlaybackRateIndex(3, "Home", 5)).toBe(0);
		expect(nextPlaybackRateIndex(3, "End", 5)).toBe(4);
	});

	it("enters the list from the container and ignores unrelated keys", () => {
		expect(nextPlaybackRateIndex(-1, "ArrowDown", 5)).toBe(0);
		expect(nextPlaybackRateIndex(-1, "ArrowUp", 5)).toBe(4);
		expect(nextPlaybackRateIndex(2, "Enter", 5)).toBeNull();
		expect(nextPlaybackRateIndex(2, "ArrowDown", 0)).toBeNull();
	});
});
