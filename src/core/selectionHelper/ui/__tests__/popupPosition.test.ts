import { describe, expect, it } from "vitest";
import { popupPosition } from "../popupPosition";

describe("popupPosition", () => {
	it("uses measured size to place the popup above the selection near an edge", () => {
		expect(
			popupPosition(
				{ x: 900, y: 700 },
				{ width: 380, height: 420 },
				{
					left: 0,
					top: 0,
					width: 1000,
					height: 800,
				},
			),
		).toEqual({ left: 604, top: 268, maxWidth: 968, maxHeight: 768 });
	});

	it("clamps to an offset visual viewport after the mobile keyboard opens", () => {
		expect(
			popupPosition(
				{ x: 0, y: 400 },
				{ width: 380, height: 420 },
				{
					left: 10,
					top: 100,
					width: 320,
					height: 240,
				},
			),
		).toEqual({ left: 26, top: 116, maxWidth: 288, maxHeight: 208 });
	});
});
