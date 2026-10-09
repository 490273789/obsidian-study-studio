import { describe, expect, it, vi } from "vite-plus/test";
import { extractCleanCardText } from "../useCardContextMenu";

vi.mock("obsidian", () => ({
	Menu: class {
		addItem = vi.fn().mockReturnThis();
		showAtMouseEvent = vi.fn().mockReturnThis();
	},
	Notice: vi.fn(),
}));

describe("useCardContextMenu", () => {
	describe("extractCleanCardText", () => {
		it("strips prefix label text from card element", () => {
			const cardEl = {
				querySelector: vi.fn().mockReturnValue({ textContent: "问题" }),
				textContent: "问题 flash card",
			} as unknown as HTMLElement;

			expect(extractCleanCardText(cardEl)).toBe("flash card");
		});

		it("returns full text when no label is present", () => {
			const cardEl = {
				querySelector: vi.fn().mockReturnValue(null),
				textContent: "   flash card   ",
			} as unknown as HTMLElement;

			expect(extractCleanCardText(cardEl)).toBe("flash card");
		});

		it("strips suffix label text from card element", () => {
			const cardEl = {
				querySelector: vi.fn().mockReturnValue({ textContent: "答案" }),
				textContent: "教学卡片 答案",
			} as unknown as HTMLElement;

			expect(extractCleanCardText(cardEl)).toBe("教学卡片");
		});
	});
});
