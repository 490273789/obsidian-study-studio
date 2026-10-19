import { describe, expect, it } from "vite-plus/test";
import { allowsBubbleKey } from "../SelectionBubble";

describe("selection bubble keyboard ownership", () => {
	it("leaves modified number keys to configurable Obsidian commands", () => {
		const bare = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
		expect(allowsBubbleKey(bare)).toBe(true);
		for (const modifier of ["ctrlKey", "altKey", "shiftKey", "metaKey"] as const) {
			expect(allowsBubbleKey({ ...bare, [modifier]: true })).toBe(false);
		}
	});
});
