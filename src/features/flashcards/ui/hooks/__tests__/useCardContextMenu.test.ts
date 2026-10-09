import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockAddItem, mockShowAtMouseEvent, mockNotice } = vi.hoisted(() => ({
	mockAddItem: vi.fn(),
	mockShowAtMouseEvent: vi.fn(),
	mockNotice: vi.fn(),
}));

vi.mock("obsidian", () => {
	class MockMenu {
		addItem = mockAddItem.mockImplementation((callback: (item: any) => void) => {
			const item = {
				setTitle: vi.fn().mockReturnThis(),
				setIcon: vi.fn().mockReturnThis(),
				onClick: vi.fn().mockImplementation((fn: () => void) => {
					(item as any)._clickHandler = fn;
					return item;
				}),
			};
			callback(item);
			return this;
		});
		showAtMouseEvent = mockShowAtMouseEvent.mockReturnThis();
	}

	class MockNotice {
		constructor(message: string) {
			mockNotice(message);
		}
	}

	return {
		Menu: MockMenu,
		Notice: MockNotice,
	};
});

import { extractCleanCardText, handleCardContextMenu } from "../useCardContextMenu";

describe("useCardContextMenu", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("extractCleanCardText", () => {
		it("extracts markdown element innerText or textContent when available", () => {
			const markdownEl = {
				classList: { contains: (cls: string) => cls === "flashcard-markdown" },
				textContent: "Markdown formatted content",
			};
			const cardEl = {
				querySelector: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-markdown") return markdownEl;
					return null;
				}),
				textContent: "问题 Markdown formatted content",
			} as unknown as HTMLElement;

			expect(extractCleanCardText(cardEl)).toBe("Markdown formatted content");
		});

		it("strips prefix label text from mock card element without markdown child", () => {
			const cardEl = {
				querySelector: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-label") return { textContent: "问题" };
					return null;
				}),
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

		it("strips suffix label text from mock card element without markdown child", () => {
			const cardEl = {
				querySelector: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-label") return { textContent: "答案" };
					return null;
				}),
				textContent: "教学卡片 答案",
			} as unknown as HTMLElement;

			expect(extractCleanCardText(cardEl)).toBe("教学卡片");
		});
	});

	describe("handleCardContextMenu", () => {
		it("creates menu and copies text when text selection exists", async () => {
			const copyFn = vi.fn().mockResolvedValue(true);
			const mockEvent = {
				target: {} as unknown as HTMLElement,
				currentTarget: {
					ownerDocument: {
						defaultView: {
							getSelection: () => ({
								toString: () => "selected text",
							}),
						},
					},
				} as unknown as HTMLElement,
				nativeEvent: { type: "contextmenu" } as MouseEvent,
				preventDefault: vi.fn(),
			};

			handleCardContextMenu(mockEvent, {
				t: (k) => k,
				copyText: copyFn,
			});

			expect(mockEvent.preventDefault).toHaveBeenCalled();
			expect(mockAddItem).toHaveBeenCalled();
			expect(mockShowAtMouseEvent).toHaveBeenCalledWith(mockEvent.nativeEvent);

			// Invoke the item click handler
			const itemCallback = mockAddItem.mock.calls[0]?.[0];
			expect(itemCallback).toBeDefined();
			let clickHandler: (() => Promise<void>) | null = null;
			const mockItem = {
				setTitle: vi.fn().mockReturnThis(),
				setIcon: vi.fn().mockReturnThis(),
				onClick: vi.fn().mockImplementation((fn: () => Promise<void>) => {
					clickHandler = fn;
					return mockItem;
				}),
			};
			itemCallback!(mockItem);
			expect(clickHandler).not.toBeNull();
			await clickHandler!();

			expect(copyFn).toHaveBeenCalledWith("selected text");
			expect(mockNotice).toHaveBeenCalledWith("notice.copied");
		});

		it("creates section copy and full card copy when right clicking section in stack", async () => {
			const copyFn = vi.fn().mockResolvedValue(true);

			const qMd = {
				classList: { contains: (cls: string) => cls === "flashcard-markdown" },
				textContent: "What is Obsidian?",
			};
			const question = {
				querySelector: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-markdown") return qMd;
					return null;
				}),
				textContent: "What is Obsidian?",
			};

			const aMd = {
				classList: { contains: (cls: string) => cls === "flashcard-markdown" },
				textContent: "A markdown note app",
			};
			const answer = {
				querySelector: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-markdown") return aMd;
					return null;
				}),
				textContent: "A markdown note app",
			};

			const stack = {
				querySelectorAll: vi.fn().mockReturnValue([question, answer]),
				closest: vi.fn().mockImplementation((sel: string) => {
					if (sel === ".flashcard-card-stack") return stack;
					return null;
				}),
			} as unknown as HTMLElement;

			const targetSection = {
				...question,
				closest: vi.fn().mockImplementation((sel: string) => {
					if (sel.includes("flashcard-question")) return question;
					return null;
				}),
			} as unknown as HTMLElement;

			const mockEvent = {
				target: targetSection,
				currentTarget: stack,
				nativeEvent: { type: "contextmenu" } as MouseEvent,
				preventDefault: vi.fn(),
			};

			handleCardContextMenu(mockEvent, {
				t: (k) => k,
				copyText: copyFn,
			});

			expect(mockEvent.preventDefault).toHaveBeenCalled();
			// Should offer: 1. copySection ("What is Obsidian?"), 2. copyAllCard ("What is Obsidian?\n\nA markdown note app")
			expect(mockAddItem).toHaveBeenCalledTimes(2);
		});
	});
});
