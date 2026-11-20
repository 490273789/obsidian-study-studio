import { describe, expect, it, vi } from "vite-plus/test";
import { Component } from "obsidian";
import { renderMarkdownWithLifecycle } from "../MarkdownContent";

vi.mock("obsidian", () => {
	class MockComponent {
		load = vi.fn();
		unload = vi.fn();
	}
	return {
		Component: MockComponent,
	};
});

describe("renderMarkdownWithLifecycle", () => {
	it("keeps a superseded async render away from the current content and passes the note path", async () => {
		const makeTarget = () => ({ textContent: "", remove: vi.fn() });
		const previous = makeTarget();
		const current = makeTarget();
		const createElement = vi.fn().mockReturnValueOnce(previous).mockReturnValueOnce(current);
		const replaceChildren = vi.fn();
		const host = {
			ownerDocument: { createElement },
			replaceChildren,
		} as unknown as HTMLElement;
		let finishPrevious: () => void = () => {};
		const renderer = vi.fn((content: string, target: HTMLElement) => {
			if (content === "previous") {
				return new Promise<void>((resolve) => {
					finishPrevious = () => {
						target.textContent = content;
						resolve();
					};
				});
			}
			target.textContent = content;
			return Promise.resolve();
		});

		const stopPrevious = renderMarkdownWithLifecycle("previous", host, renderer, "Deck/a.md");
		stopPrevious?.();
		const stopCurrent = renderMarkdownWithLifecycle("current", host, renderer, "Deck/b.md");
		finishPrevious();
		await Promise.resolve();

		expect(renderer).toHaveBeenLastCalledWith(
			"current",
			current,
			expect.any(Component),
			"Deck/b.md",
		);
		expect(replaceChildren).toHaveBeenLastCalledWith(current);
		expect(previous.remove).toHaveBeenCalledOnce();
		expect(current.textContent).toBe("current");
		stopCurrent?.();
	});

	it("passes an isolated loaded Component to markdownRenderer and unloads it on cleanup", () => {
		const target = { remove: vi.fn() };
		const replaceChildren = vi.fn();
		const mockElement = {
			ownerDocument: { createElement: () => target },
			replaceChildren,
		} as unknown as HTMLElement;
		const markdownRenderer = vi.fn().mockResolvedValue(undefined);

		const cleanup = renderMarkdownWithLifecycle(
			"# Title",
			mockElement,
			markdownRenderer,
			"deck.md",
		);

		expect(replaceChildren).toHaveBeenCalledWith(target);
		expect(markdownRenderer).toHaveBeenCalledWith(
			"# Title",
			target,
			expect.any(Component),
			"deck.md",
		);

		const component = markdownRenderer.mock.calls[0]![2] as {
			load: ReturnType<typeof vi.fn>;
			unload: ReturnType<typeof vi.fn>;
		};
		const loadMock = component.load;
		const unloadMock = component.unload;
		expect(loadMock).toHaveBeenCalledTimes(1);
		expect(unloadMock).not.toHaveBeenCalled();

		expect(typeof cleanup).toBe("function");
		cleanup!();
		expect(unloadMock).toHaveBeenCalledTimes(1);
	});

	it("returns undefined when element is null", () => {
		const markdownRenderer = vi.fn();
		const cleanup = renderMarkdownWithLifecycle("# Title", null, markdownRenderer, "deck.md");
		expect(cleanup).toBeUndefined();
		expect(markdownRenderer).not.toHaveBeenCalled();
	});

	it("shows the Markdown source if Obsidian rendering rejects", async () => {
		const target = { textContent: "", remove: vi.fn() };
		const host = {
			ownerDocument: { createElement: () => target },
			replaceChildren: vi.fn(),
		} as unknown as HTMLElement;
		const error = new Error("render failed");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const cleanup = renderMarkdownWithLifecycle(
				"# Title",
				host,
				vi.fn().mockRejectedValue(error),
				"deck.md",
			);
			await Promise.resolve();

			expect(target.textContent).toBe("# Title");
			expect(log).toHaveBeenCalledWith("Failed to render flashcard Markdown:", error);
			cleanup?.();
		} finally {
			log.mockRestore();
		}
	});
});
