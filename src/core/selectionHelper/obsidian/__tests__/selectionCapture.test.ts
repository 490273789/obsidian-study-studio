import { describe, expect, it } from "vite-plus/test";
import { captureSelection, hasMatchingElement, toHostCoordinates } from "../selectionCapture";

function input(type = "text") {
	const control = {
		nodeType: 1,
		value: "hello world",
		selectionStart: 6,
		selectionEnd: 11,
		closest: (selector: string) =>
			selector === "input, textarea" ? control : type === "password" ? control : null,
		getBoundingClientRect: () => ({ left: 10, bottom: 40 }),
	};
	return control;
}
describe("selection capture", () => {
	it.each(["text", "textarea"])("reads %s selected text and control geometry", (type) => {
		const control = input(type);
		expect(
			captureSelection({} as Document, control as unknown as EventTarget, { x: 0, y: 0 }),
		).toEqual({ text: "world", x: 10, y: 40 });
	});
	it("reads focused input when the drag ends outside the control", () => {
		const control = { ...input(), matches: () => true };
		const target = { nodeType: 1, closest: () => null };
		const doc = { activeElement: control } as unknown as Document;
		expect(captureSelection(doc, target as unknown as EventTarget, { x: 0, y: 0 })).toEqual({
			text: "world",
			x: 10,
			y: 40,
		});
	});

	it("excludes passwords and helper content at the actual selection origin", () => {
		expect(
			captureSelection({} as Document, input("password") as unknown as EventTarget, {
				x: 0,
				y: 0,
			}),
		).toBeNull();
		const anchor = { nodeType: 1, closest: () => ({}) };
		const doc = {
			defaultView: { getSelection: () => ({ anchorNode: anchor, toString: () => "secret" }) },
		};
		expect(captureSelection(doc as unknown as Document, null, { x: 0, y: 0 })).toBeNull();
	});
	it("converts nested frame coordinates including scale and border", () => {
		const host = {} as Document;
		const frame = {
			ownerDocument: host,
			offsetWidth: 100,
			offsetHeight: 100,
			clientLeft: 2,
			clientTop: 2,
			getBoundingClientRect: () => ({ left: 40, top: 60, width: 200, height: 200 }),
		};
		const child = { defaultView: { frameElement: frame } } as unknown as Document;
		expect(toHostCoordinates(child, host, { text: "hello", x: 10, y: 20 })).toEqual({
			text: "hello",
			x: 64,
			y: 104,
		});
		expect(
			toHostCoordinates({ defaultView: {} } as Document, host, { text: "hello", x: 0, y: 0 }),
		).toBeNull();
	});

	describe("hasMatchingElement", () => {
		it("detects direct tag matches case-insensitively", () => {
			const iframe = { nodeType: 1, tagName: "IFRAME" } as unknown as Node;
			const text = { nodeType: 3, tagName: undefined } as unknown as Node;
			expect(hasMatchingElement([text, iframe], "iframe")).toBe(true);
			expect(hasMatchingElement([text], "iframe")).toBe(false);
		});

		it("detects nested matching elements inside container nodes", () => {
			const container = {
				nodeType: 1,
				tagName: "DIV",
				querySelector: (selector: string) => (selector === "webview" ? {} : null),
			} as unknown as Node;
			const normalDiv = {
				nodeType: 1,
				tagName: "DIV",
				querySelector: () => null,
			} as unknown as Node;
			expect(hasMatchingElement([normalDiv, container], "webview")).toBe(true);
			expect(hasMatchingElement([normalDiv], "webview")).toBe(false);
		});
	});
});
