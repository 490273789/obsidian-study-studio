/* oxlint-disable typescript/unbound-method */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import { PathInputSuggest } from "../pathInputSuggest";

const suggests: {
	setValue: (val: string) => void;
	close: () => void;
}[] = [];

vi.mock("obsidian", () => {
	class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {
			suggests.push(
				this as unknown as { setValue: (val: string) => void; close: () => void },
			);
		}
		setValue(_value: string): void {}
		getValue(): string {
			return "";
		}
		close(): void {}
	}
	return {
		AbstractInputSuggest,
	};
});

describe("PathInputSuggest", () => {
	beforeEach(() => {
		suggests.length = 0;
	});

	it("returns items from callback and renders item text", () => {
		const inputEl = {
			dispatchEvent: vi.fn(),
			focus: vi.fn(),
		} as unknown as HTMLInputElement;

		const getItems = vi.fn((query: string) => [`folder/${query}.md`]);
		const suggest = new PathInputSuggest({} as App, inputEl, getItems);

		// protected getSuggestions
		const result = (
			suggest as unknown as { getSuggestions: (q: string) => string[] }
		).getSuggestions("test");
		expect(getItems).toHaveBeenCalledWith("test");
		expect(result).toEqual(["folder/test.md"]);

		const el = {
			setText: vi.fn(),
		} as unknown as HTMLElement;
		suggest.renderSuggestion("folder/test.md", el);
		expect(el.setText).toHaveBeenCalledWith("folder/test.md");
	});

	it("selects suggestion by setting value, firing input event, notifying callback, closing and refocusing", () => {
		const events: Event[] = [];
		const inputEl = {
			dispatchEvent: vi.fn((evt: Event) => events.push(evt)),
			focus: vi.fn(),
		} as unknown as HTMLInputElement;

		const onSelected = vi.fn();
		const suggest = new PathInputSuggest({} as App, inputEl, () => [], onSelected);

		const setValueSpy = vi.spyOn(suggest, "setValue");
		const closeSpy = vi.spyOn(suggest, "close");

		suggest.selectSuggestion("target/path.md", {} as MouseEvent);

		expect(setValueSpy).toHaveBeenCalledWith("target/path.md");
		expect(inputEl.dispatchEvent).toHaveBeenCalledOnce();
		expect(events[0]?.type).toBe("input");
		expect(onSelected).toHaveBeenCalledWith("target/path.md");
		expect(closeSpy).toHaveBeenCalledOnce();
		expect(inputEl.focus).toHaveBeenCalledOnce();
	});
});
