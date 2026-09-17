import { describe, expect, it } from "vitest";
import { videoPlayerStrings } from "../../strings/videoPlayer";
import { clampRect, computeDemotedDragStart, resizeFromLeft } from "../VideoPlayerView";
import type { FloatingRect } from "../../domain/types";

describe("floating player maximize & restore behavior", () => {
	it("has localized strings for maximize and restore actions in zh and en", () => {
		const zh = videoPlayerStrings("zh");
		expect(zh.maximize).toBe("最大化浮窗");
		expect(zh.restore).toBe("还原浮窗");

		const en = videoPlayerStrings("en");
		expect(en.maximize).toBe("Maximize floating player");
		expect(en.restore).toBe("Restore floating player");
	});

	it("clamps floating rect within minimum dimensions and edge gaps", () => {
		const viewport = { width: 1000, height: 800 };

		// Too small dimensions
		const smallRect: FloatingRect = { x: 0, y: 0, width: 100, height: 100 };
		const clampedSmall = clampRect(smallRect, viewport);
		expect(clampedSmall.width).toBe(320);
		expect(clampedSmall.height).toBe(240);
		expect(clampedSmall.x).toBe(16);
		expect(clampedSmall.y).toBe(16);

		// Out of bounds on right/bottom
		const outOfBoundsRect: FloatingRect = { x: 900, y: 700, width: 400, height: 300 };
		const clampedOutOfBounds = clampRect(outOfBoundsRect, viewport);
		expect(clampedOutOfBounds.x).toBe(1000 - 400 - 16);
		expect(clampedOutOfBounds.y).toBe(800 - 300 - 16);
	});

	it("computes demoted drag start centered around pointer ratio when dragging while maximized", () => {
		const viewport = { width: 1920, height: 1080 };
		const normal: FloatingRect = { x: 100, y: 100, width: 480, height: 320 };

		// Drag starting at middle of header bar (x = 960, y = 20)
		const centerStart = computeDemotedDragStart({ x: 960, y: 20 }, normal, viewport);
		expect(centerStart.width).toBe(480);
		expect(centerStart.height).toBe(320);
		// ratio = 960 / 1920 = 0.5; x = 960 - 0.5 * 480 = 720
		expect(centerStart.x).toBe(720);
		// y = clamp(20 - 18, 16, ...) = 16
		expect(centerStart.y).toBe(16);

		// Drag starting near left edge (x = 10, y = 20), clamped to EDGE_GAP 16
		const leftStart = computeDemotedDragStart({ x: 10, y: 20 }, normal, viewport);
		expect(leftStart.x).toBe(16);
		expect(leftStart.y).toBe(16);

		// Drag starting near right edge (x = 1900, y = 20)
		const rightStart = computeDemotedDragStart({ x: 1900, y: 20 }, normal, viewport);
		expect(rightStart.x).toBe(1920 - 480 - 16);
		expect(rightStart.y).toBe(16);
	});

	it("resizes from left handle while respecting minimum width and right bound", () => {
		const viewport = { width: 1000, height: 800 };
		const start: FloatingRect = { x: 400, y: 200, width: 400, height: 300 };

		// Drag left by 50px (expanding width)
		const expanded = resizeFromLeft(start, -50, 20, viewport);
		expect(expanded.x).toBe(350);
		expect(expanded.width).toBe(450);
		expect(expanded.height).toBe(320);

		// Drag right by 300px (exceeding minimum width 320)
		const shrank = resizeFromLeft(start, 300, 0, viewport);
		expect(shrank.width).toBe(320);
		expect(shrank.x).toBe(800 - 320);
	});
});
