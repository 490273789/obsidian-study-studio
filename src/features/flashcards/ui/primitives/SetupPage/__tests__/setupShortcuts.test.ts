import { describe, expect, it, vi } from "vite-plus/test";
import { handleSetupKeyDown } from "../setupShortcuts";

// An owning-document tree is explicit: the shortcut must not use global DOM
// constructors or consult a different Obsidian window's active element/dialog.
class TestElement {
	readonly nodeType = 1;
	parentElement: TestElement | null = null;
	isContentEditable = false;
	control: string | null = null;
	isConnected = true;
	hidden = false;
	constructor(readonly ownerDocument: TestDocument) {}
	contains(node: unknown): boolean {
		for (let current = node as TestElement | null; current; current = current.parentElement) {
			if (current === this) return true;
		}
		return false;
	}
	closest(): TestElement | null {
		return this.hidden ? this : null;
	}
	matches(selector: string): boolean {
		return selector.split(", ").some((candidate) => candidate === this.control);
	}
}
class TestDocument {
	activeElement: TestElement | null = null;
	modal: TestElement | null = null;
	querySelector(): TestElement | null {
		return this.modal;
	}
}
function harness() {
	const doc = new TestDocument();
	const root = new TestElement(doc);
	doc.activeElement = root;
	const start = vi.fn();
	function child(parent = root): TestElement {
		const node = new TestElement(doc);
		node.parentElement = parent;
		return node;
	}
	function key(
		properties: Partial<KeyboardEvent> = {},
		target: TestElement = root,
		disabled = false,
	): Event {
		const event = new Event("keydown", { cancelable: true });
		const path: TestElement[] = [];
		for (let current: TestElement | null = target; current; current = current.parentElement)
			path.push(current);
		Object.defineProperties(
			event,
			Object.fromEntries(
				Object.entries({
					key: " ",
					code: "Space",
					repeat: false,
					isComposing: false,
					keyCode: 0,
					ctrlKey: false,
					metaKey: false,
					shiftKey: false,
					altKey: false,
					target,
					composedPath: () => path,
					...properties,
				}).map(([name, value]) => [name, { value }]),
			),
		);
		handleSetupKeyDown(event as KeyboardEvent, root as unknown as HTMLElement, start, disabled);
		return event;
	}
	return { doc, root, start, child, key };
}

describe("setup start shortcut", () => {
	it("starts and prevents scrolling from the focused setup or ordinary content", () => {
		const h = harness();
		expect(h.key().defaultPrevented).toBe(true);
		const content = h.child();
		h.doc.activeElement = content;
		expect(h.key({}, content).defaultPrevented).toBe(true);
		expect(h.start).toHaveBeenCalledTimes(2);
	});
	it.each([
		"button",
		"input",
		"textarea",
		"select",
		"a[href]",
		"summary",
		'[role="button"]',
		'[tabindex]:not([tabindex="-1"])',
	])("leaves a %s and its descendants in control of Space", (selector) => {
		const h = harness();
		const control = h.child();
		control.control = selector;
		const icon = h.child(control);
		h.doc.activeElement = control;
		expect(h.key({}, icon).defaultPrevented).toBe(false);
		expect(h.start).not.toHaveBeenCalled();
	});
	it("ignores editable ancestors", () => {
		const h = harness();
		const editable = h.child();
		editable.isContentEditable = true;
		const text = h.child(editable);
		expect(h.key({}, text).defaultPrevented).toBe(false);
		expect(h.start).not.toHaveBeenCalled();
	});
	it.each([
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
		{ shiftKey: true },
		{ isComposing: true },
		{ keyCode: 229 },
		{ defaultPrevented: true },
		{ code: "Enter", key: "Enter" },
	])("ignores modified, composing, consumed or unrelated input %j", (properties) => {
		const h = harness();
		h.key(properties);
		expect(h.start).not.toHaveBeenCalled();
	});
	it("consumes repeated and disabled starts without dispatch", () => {
		const h = harness();
		expect(h.key({ repeat: true }).defaultPrevented).toBe(true);
		expect(h.key({}, h.root, true).defaultPrevented).toBe(true);
		expect(h.start).not.toHaveBeenCalled();
	});
	it("pauses for dialogs in the owning document", () => {
		const h = harness();
		h.doc.modal = h.child();
		expect(h.key().defaultPrevented).toBe(false);
		expect(h.start).not.toHaveBeenCalled();
		h.doc.modal = null;
		h.key();
		expect(h.start).toHaveBeenCalledOnce();
	});
	it("ignores a detached, hidden or unfocused setup", () => {
		const h = harness();
		h.root.isConnected = false;
		h.key();
		h.root.isConnected = true;
		h.root.hidden = true;
		h.key();
		h.root.hidden = false;
		h.doc.activeElement = new TestElement(h.doc);
		h.key();
		expect(h.start).not.toHaveBeenCalled();
	});
	it("does not let another document's focus start this setup", () => {
		const first = harness();
		const second = harness();
		first.doc.activeElement = second.root;
		first.key();
		expect(first.start).not.toHaveBeenCalled();
		second.key();
		expect(second.start).toHaveBeenCalledOnce();
	});
});
