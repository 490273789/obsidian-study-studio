import { describe, expect, it, vi } from "vitest";
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
	it("passes an isolated loaded Component to markdownRenderer and unloads it on cleanup", () => {
		const mockElement = { innerHTML: "initial" } as HTMLElement;
		const markdownRenderer = vi.fn().mockResolvedValue(undefined);

		const cleanup = renderMarkdownWithLifecycle("# Title", mockElement, markdownRenderer);

		expect(mockElement.innerHTML).toBe("");
		expect(markdownRenderer).toHaveBeenCalledWith(
			"# Title",
			mockElement,
			expect.any(Component),
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
		const cleanup = renderMarkdownWithLifecycle("# Title", null, markdownRenderer);
		expect(cleanup).toBeUndefined();
		expect(markdownRenderer).not.toHaveBeenCalled();
	});
});
