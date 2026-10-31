import { describe, expect, it, vi } from "vite-plus/test";
import {
	bindCardPresentationShortcuts,
	type CardShortcutIntent,
	type CardShortcutState,
} from "../cardPresentationShortcuts";

// Native EventTarget supplies cancellation/listener semantics; this small tree
// supplies only the DOM ownership, selectors and bubbling needed by the binding.
class TestElement extends EventTarget {
	readonly nodeType = 1;
	readonly attributes = new Map<string, string>();
	readonly children: TestElement[] = [];
	parentElement: TestElement | null = null;
	focusCount = 0;
	constructor(
		readonly ownerDocument: TestDocument,
		readonly tagName = "DIV",
	) {
		super();
	}
	get parentNode(): TestElement | null {
		return this.parentElement;
	}
	get isConnected(): boolean {
		return this.ownerDocument.body.contains(this);
	}
	get isContentEditable(): boolean {
		return (
			this.getAttribute("contenteditable") === "true" ||
			this.getAttribute("contenteditable") === "" ||
			(this.getAttribute("contenteditable") !== "false" &&
				(this.parentElement?.isContentEditable ?? false))
		);
	}
	append(child: TestElement): TestElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	remove(): void {
		if (this.parentElement) {
			this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
			this.parentElement = null;
		}
		if (this.contains(this.ownerDocument.activeElement)) {
			// Browser removal falls back to body without dispatching focusin.
			this.ownerDocument.activeElement = this.ownerDocument.body;
		}
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}
	contains(other: unknown): boolean {
		return other === this || this.children.some((child) => child.contains(other));
	}
	matches(selector: string): boolean {
		return selector.split(",").some((part) => {
			let candidate = part.trim();
			const excluded = [...candidate.matchAll(/:not\(([^)]+)\)/g)];
			if (excluded.some((match) => this.matches(match[1]!))) return false;
			candidate = candidate.replace(/:not\([^)]+\)/g, "");
			const tag = candidate.match(/^[a-z]+/i)?.[0];
			if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
			const classes = [...candidate.matchAll(/\.([\w-]+)/g)];
			if (
				classes.some(
					(match) => !(this.getAttribute("class") ?? "").split(" ").includes(match[1]!),
				)
			)
				return false;
			return [...candidate.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)].every(
				(match) =>
					match[2] === undefined
						? this.hasAttribute(match[1]!)
						: this.getAttribute(match[1]!) === match[2],
			);
		});
	}
	closest(selector: string): TestElement | null {
		return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
	}
	focus(): void {
		this.focusCount++;
		this.ownerDocument.activeElement = this;
		this.emit("focusin");
	}
	emit(type: string, properties: Record<string, unknown> = {}): Event {
		const event = new Event(type, { bubbles: true, cancelable: true });
		const path: TestElement[] = [this];
		for (let node: TestElement | null = this.parentElement; node; node = node.parentElement)
			path.push(node);
		Object.defineProperties(
			event,
			Object.fromEntries(
				Object.entries({
					composedPath: () => path,
					target: this,
					key: " ",
					code: "Space",
					repeat: false,
					isComposing: false,
					keyCode: 0,
					ctrlKey: false,
					altKey: false,
					metaKey: false,
					shiftKey: false,
					button: 0,
					...properties,
				}).map(([key, value]) => [key, { value }]),
			),
		);
		// The binding uses document capture for pointer ownership.
		if (type === "pointerdown" && this.isConnected) this.ownerDocument.dispatchEvent(event);
		for (const node of path) {
			node.dispatchEvent(event);
			if (event.cancelBubble) break;
		}
		if (type === "focusin" && this.isConnected && !event.cancelBubble)
			this.ownerDocument.dispatchEvent(event);
		return event;
	}
}

class TestMutationObserver {
	connected = false;
	root: TestElement | null = null;
	options: MutationObserverInit | null = null;
	constructor(private readonly callback: () => void) {}
	observe(root: TestElement, options: MutationObserverInit): void {
		this.root = root;
		this.options = options;
		this.connected = true;
	}
	disconnect(): void {
		this.connected = false;
	}
	flush(): void {
		if (this.connected) this.callback();
	}
}

class TestDocument extends EventTarget {
	readonly body = new TestElement(this, "BODY");
	activeElement: TestElement | null = this.body;
	readonly observers: TestMutationObserver[] = [];
	readonly defaultView: { MutationObserver: typeof TestMutationObserver } | null;
	constructor(withWindow = true) {
		super();
		const observers = this.observers;
		this.defaultView = withWindow
			? {
					MutationObserver: class extends TestMutationObserver {
						constructor(callback: () => void) {
							super(callback);
							observers.push(this);
						}
					},
				}
			: null;
	}
	flushMutations(): void {
		for (const observer of this.observers) observer.flush();
	}
	querySelector(selector: string): TestElement | null {
		const visit = (node: TestElement): TestElement | null => {
			if (node.matches(selector)) return node;
			for (const child of node.children) {
				const result = visit(child);
				if (result) return result;
			}
			return null;
		};
		return visit(this.body);
	}
}

function study(answerVisible = false): CardShortcutState & { mode: "study" } {
	return { mode: "study", answerVisible, canPrevious: true, busy: false };
}
function practice(answerVisible = false): CardShortcutState & { mode: "practice" } {
	return { mode: "practice", answerVisible, canPrevious: true, busy: false };
}
function challenge(
	questionMode: "normal" | "reversed" | "spelling" = "normal",
	phase: "question" | "feedback" = "question",
	answerVisible = false,
): CardShortcutState {
	return { mode: "challenge", questionMode, phase, answerVisible, busy: false };
}
function setup(initial: CardShortcutState = study(), doc = new TestDocument()) {
	const root = doc.body.append(new TestElement(doc));
	let state = initial;
	const intents: CardShortcutIntent[] = [];
	const bind = () =>
		bindCardPresentationShortcuts(
			root as unknown as HTMLElement,
			() => state,
			(intent) => intents.push(intent),
		);
	const cleanup = bind();
	return {
		doc,
		root,
		intents,
		cleanup,
		bind,
		setState: (next: CardShortcutState) => {
			state = next;
		},
	};
}
function key(root: TestElement, value: string, code = value): Event {
	return root.emit("keydown", { key: value, code });
}

const mappings: Array<[string, CardShortcutState, string, string, CardShortcutIntent]> = [];
for (const state of [study(), practice(), challenge(), challenge("reversed")]) {
	mappings.push([`${state.mode} reveals`, state, " ", "Space", { kind: "reveal" }]);
}
for (const rating of [1, 2, 3, 4, 5] as const) {
	for (const code of [`Digit${rating}`, `Numpad${rating}`]) {
		mappings.push([
			`study ${code}`,
			study(true),
			String(rating),
			code,
			{ kind: "rate", rating },
		]);
	}
}
mappings.push(["study Space", study(true), " ", "Space", { kind: "rate", rating: 3 }]);
for (const state of [
	practice(true),
	challenge("normal", "question", true),
	challenge("reversed", "question", true),
]) {
	for (const [value, code, correct] of [
		["1", "Digit1", false],
		["1", "Numpad1", false],
		["x", "KeyX", false],
		["2", "Digit2", true],
		["2", "Numpad2", true],
		["o", "KeyO", true],
		[" ", "Space", true],
	] as const)
		mappings.push([`${state.mode} ${code}`, state, value, code, { kind: "answer", correct }]);
}
for (const state of [study(true), practice(true)]) {
	for (const code of ["Digit6", "Numpad6"])
		mappings.push([`${state.mode} previous`, state, "6", code, { kind: "previous" }]);
}
for (const mode of ["normal", "reversed", "spelling"] as const) {
	for (const value of [" ", "Enter"])
		mappings.push([
			`${mode} feedback continues`,
			challenge(mode, "feedback"),
			value,
			value === " " ? "Space" : "Enter",
			{ kind: "continue" },
		]);
}

describe("card presentation shortcuts", () => {
	it.each(mappings)("%s", (_name, state, value, code, intent) => {
		const test = setup(state);
		const event = key(test.root, value, code);
		expect(event.defaultPrevented).toBe(true);
		expect(test.intents).toEqual([intent]);
		test.cleanup();
	});

	it.each(mappings)(
		"consumes busy and repeated %s without dispatch",
		(_name, state, value, code) => {
			const test = setup({ ...state, busy: true });
			test.root.focus();
			expect(key(test.root, value, code).defaultPrevented).toBe(true);
			test.setState({ ...state, busy: false });
			expect(
				test.root.emit("keydown", { key: value, code, repeat: true }).defaultPrevented,
			).toBe(true);
			expect(test.intents).toEqual([]);
		},
	);

	it("reads current state for every event without rebinding", () => {
		const test = setup();
		key(test.root, " ", "Space");
		test.setState(study(true));
		key(test.root, "3", "Digit3");
		test.setState(challenge("spelling", "feedback"));
		key(test.root, "Enter");
		expect(test.intents).toEqual([
			{ kind: "reveal" },
			{ kind: "rate", rating: 3 },
			{ kind: "continue" },
		]);
	});

	it.each([
		[study(), "1", "Digit1"],
		[practice(), "x", "KeyX"],
		[challenge("spelling"), " ", "Space"],
		[challenge("spelling"), "Enter", "Enter"],
		[challenge("normal", "question", true), "6", "Digit6"],
		[challenge("normal", "feedback"), "1", "Digit1"],
		[study(true), "Enter", "Enter"],
		[study(true), "z", "KeyZ"],
	] as const)("passes unmapped keys through: %j %s", (state, value, code) => {
		const test = setup(state);
		test.root.focus();
		expect(key(test.root, value, code).defaultPrevented).toBe(false);
		expect(test.intents).toEqual([]);
	});

	it("consumes recognized busy/repeated/unavailable actions without dispatching or stopping propagation", () => {
		const test = setup({ ...study(), busy: true });
		let bubbled = 0;
		test.doc.body.addEventListener("keydown", () => {
			bubbled++;
		});
		expect(key(test.root, " ", "Space").defaultPrevented).toBe(true);
		test.setState(study());
		expect(test.root.emit("keydown", { repeat: true }).defaultPrevented).toBe(true);
		test.setState({ ...study(true), canPrevious: false });
		expect(key(test.root, "6", "Digit6").defaultPrevented).toBe(true);
		expect(key(test.root, "z", "KeyZ").defaultPrevented).toBe(false);
		expect(test.intents).toEqual([]);
		expect(bubbled).toBe(4);
	});

	it.each(["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"])(
		"preserves %s events",
		(flag) => {
			const test = setup();
			expect(test.root.emit("keydown", { [flag]: true }).defaultPrevented).toBe(false);
			expect(test.intents).toEqual([]);
		},
	);
	it("preserves IME keyCode 229 and already prevented events", () => {
		const test = setup();
		expect(test.root.emit("keydown", { keyCode: 229 }).defaultPrevented).toBe(false);
		const child = test.root.append(new TestElement(test.doc));
		child.addEventListener("keydown", (event) => event.preventDefault());
		expect(child.emit("keydown").defaultPrevented).toBe(true);
		expect(test.intents).toEqual([]);
	});

	it.each([
		["INPUT", {}],
		["TEXTAREA", {}],
		["SELECT", {}],
		["BUTTON", {}],
		["A", { href: "/" }],
		["SUMMARY", {}],
		["DIV", { role: "button" }],
		["DIV", { role: "textbox" }],
		["DIV", { contenteditable: "true" }],
	] as Array<[string, Record<string, string>]>)(
		"preserves keys and pointer focus inside nested %s controls",
		(tag, attributes) => {
			const test = setup();
			const control = test.root.append(new TestElement(test.doc, tag));
			for (const [name, value] of Object.entries(attributes))
				control.setAttribute(name, value);
			const child = control.append(new TestElement(test.doc, "SPAN"));
			control.focus();
			expect(child.emit("keydown").defaultPrevented).toBe(false);
			child.emit("pointerdown");
			expect(test.doc.activeElement).toBe(control);
			expect(test.intents).toEqual([]);
		},
	);

	it("focuses its root initially and on ordinary primary pointer interaction", () => {
		const test = setup();
		expect(test.doc.activeElement).toBe(test.root);
		const outside = test.doc.body.append(new TestElement(test.doc));
		outside.focus();
		const child = test.root.append(new TestElement(test.doc, "SPAN"));
		child.emit("pointerdown", { button: 2 });
		expect(test.doc.activeElement).toBe(outside);
		child.emit("pointerdown");
		expect(test.doc.activeElement).toBe(test.root);
		expect(child.emit("keydown").defaultPrevented).toBe(true);
		expect(test.intents).toEqual([{ kind: "reveal" }]);
	});

	it("does not steal existing outside or spelling-question focus", () => {
		const doc = new TestDocument();
		const outside = doc.body.append(new TestElement(doc, "INPUT"));
		outside.focus();
		const first = setup(study(), doc);
		expect(doc.activeElement).toBe(outside);
		const spelling = setup(challenge("spelling"));
		expect(spelling.doc.activeElement).toBe(spelling.doc.body);
		spelling.root.emit("pointerdown");
		expect(spelling.doc.activeElement).toBe(spelling.doc.body);
		first.cleanup();
	});

	it("isolates roots and uses the owning document for focus", () => {
		const first = setup();
		const second = setup(study(), first.doc);
		expect(first.doc.activeElement).toBe(first.root);
		expect(second.root.emit("keydown").defaultPrevented).toBe(false);
		expect(first.doc.body.emit("keydown").defaultPrevented).toBe(false);
		second.root.focus();
		expect(first.root.emit("keydown").defaultPrevented).toBe(false);
		expect(second.root.emit("keydown").defaultPrevented).toBe(true);
		expect(first.intents).toEqual([]);
		expect(second.intents).toEqual([{ kind: "reveal" }]);
		const otherDocument = setup();
		expect(otherDocument.root.emit("keydown").defaultPrevented).toBe(true);
	});

	it.each([
		["DIALOG", { open: "" }],
		["DIV", { "aria-modal": "true" }],
		["DIV", { class: "modal-container" }],
	] as Array<[string, Record<string, string>]>)(
		"blocks keys and focus changes while %s modal is present",
		(tag, attributes) => {
			const test = setup();
			const modal = test.doc.body.append(new TestElement(test.doc, tag));
			for (const [name, value] of Object.entries(attributes)) modal.setAttribute(name, value);
			expect(test.root.emit("keydown").defaultPrevented).toBe(false);
			modal.focus();
			test.root.emit("pointerdown");
			expect(test.doc.activeElement).toBe(modal);
			expect(test.intents).toEqual([]);
		},
	);
	it("ignores hidden aria-modal overlays and other documents' modals", () => {
		const test = setup();
		const modal = test.doc.body.append(new TestElement(test.doc));
		modal.setAttribute("aria-modal", "true");
		modal.setAttribute("aria-hidden", "true");
		expect(test.root.emit("keydown").defaultPrevented).toBe(true);
		const other = setup();
		modal.setAttribute("aria-hidden", "false");
		expect(other.root.emit("keydown").defaultPrevented).toBe(true);
	});
	it.each(["hidden", "inert", "aria-hidden"])("blocks roots within %s ancestors", (attribute) => {
		const test = setup();
		test.doc.body.setAttribute(attribute, attribute === "aria-hidden" ? "true" : "");
		expect(test.root.emit("keydown").defaultPrevented).toBe(false);
		expect(test.intents).toEqual([]);
	});

	it("restores absent tabindex and releases both listeners across setup/cleanup/setup", () => {
		const test = setup();
		expect(test.root.getAttribute("tabindex")).toBe("-1");
		test.cleanup();
		expect(test.root.hasAttribute("tabindex")).toBe(false);
		expect(test.root.emit("keydown").defaultPrevented).toBe(false);
		test.doc.body.focus();
		test.root.emit("pointerdown");
		expect(test.doc.activeElement).toBe(test.doc.body);
		const cleanup = test.bind();
		expect(test.root.emit("keydown").defaultPrevented).toBe(true);
		expect(test.intents).toEqual([{ kind: "reveal" }]);
		cleanup();
		expect(test.root.hasAttribute("tabindex")).toBe(false);
	});
	it.each([
		[study(), study(true), "3", "Digit3", { kind: "rate", rating: 3 }],
		[study(true), study(), " ", "Space", { kind: "reveal" }],
	] as Array<[CardShortcutState, CardShortcutState, string, string, CardShortcutIntent]>)(
		"restores focus after a focused presentation button is removed: %j",
		(initial, next, value, code, expected) => {
			const test = setup(initial);
			const button = test.root.append(new TestElement(test.doc, "BUTTON"));
			button.focus();
			button.remove();
			test.setState(next);
			expect(test.doc.activeElement).toBe(test.doc.body);
			expect(key(test.root, value, code).defaultPrevented).toBe(false);
			test.doc.flushMutations();
			expect(test.doc.activeElement).toBe(test.root);
			expect(key(test.root, value, code).defaultPrevented).toBe(true);
			expect(test.intents).toEqual([expected]);
		},
	);

	it.each(["input-focus", "outside-pointer"] as const)(
		"relinquishes removed-button focus after %s",
		(interaction) => {
			const test = setup();
			const button = test.root.append(new TestElement(test.doc, "BUTTON"));
			button.focus();
			const outside = test.doc.body.append(
				new TestElement(test.doc, interaction === "input-focus" ? "INPUT" : "SPAN"),
			);
			if (interaction === "input-focus") outside.focus();
			else outside.emit("pointerdown");
			button.remove();
			// Also check the asynchronous case where the external input later vanishes.
			if (interaction === "input-focus") outside.remove();
			expect(test.doc.activeElement).toBe(test.doc.body);
			test.doc.flushMutations();
			expect(test.doc.activeElement).toBe(test.doc.body);
			expect(test.root.emit("keydown").defaultPrevented).toBe(false);
			expect(test.intents).toEqual([]);
		},
	);

	it.each(["modal", "spelling"] as const)(
		"does not restore removed-button focus during %s",
		(blocker) => {
			const test = setup();
			const button = test.root.append(new TestElement(test.doc, "BUTTON"));
			button.focus();
			button.remove();
			if (blocker === "modal") {
				const modal = test.doc.body.append(new TestElement(test.doc, "DIALOG"));
				modal.setAttribute("open", "");
			} else test.setState(challenge("spelling"));
			test.doc.flushMutations();
			expect(test.doc.activeElement).toBe(test.doc.body);
			expect(test.intents).toEqual([]);
		},
	);

	it("disconnects mutation observation and removes document listeners on cleanup", () => {
		const doc = new TestDocument();
		const add = vi.spyOn(doc, "addEventListener");
		const remove = vi.spyOn(doc, "removeEventListener");
		const test = setup(study(), doc);
		const observer = doc.observers[0]!;
		expect(observer.root).toBe(test.root);
		expect(observer.options).toEqual({ childList: true, subtree: true });
		const button = test.root.append(new TestElement(doc, "BUTTON"));
		button.focus();
		test.cleanup();
		expect(observer.connected).toBe(false);
		for (const [type, listener, options] of add.mock.calls) {
			if (options === undefined) expect(remove).toHaveBeenCalledWith(type, listener);
			else expect(remove).toHaveBeenCalledWith(type, listener, options);
		}
		expect(remove).toHaveBeenCalledTimes(2);
		button.remove();
		doc.flushMutations();
		expect(doc.activeElement).toBe(doc.body);
		expect(test.root.emit("keydown").defaultPrevented).toBe(false);
	});

	it("keeps basic shortcuts usable without a document window", () => {
		const test = setup(study(), new TestDocument(false));
		expect(test.doc.activeElement).toBe(test.root);
		expect(test.root.emit("keydown").defaultPrevented).toBe(true);
		expect(test.intents).toEqual([{ kind: "reveal" }]);
		expect(test.doc.observers).toEqual([]);
		test.cleanup();
	});

	it("does not handle detached roots", () => {
		const test = setup();
		test.doc.body.children.splice(test.doc.body.children.indexOf(test.root), 1);
		test.root.parentElement = null;
		expect(test.root.emit("keydown").defaultPrevented).toBe(false);
		test.doc.body.focus();
		test.root.emit("pointerdown");
		expect(test.doc.activeElement).toBe(test.doc.body);
		expect(test.intents).toEqual([]);
	});

	it("initially focuses when no element is active and preserves an inner input on rebind", () => {
		const doc = new TestDocument();
		doc.activeElement = null;
		const test = setup(study(), doc);
		expect(doc.activeElement).toBe(test.root);
		test.cleanup();
		const input = test.root.append(new TestElement(doc, "INPUT"));
		input.focus();
		const cleanup = test.bind();
		expect(doc.activeElement).toBe(input);
		cleanup();
		cleanup();
		expect(test.root.hasAttribute("tabindex")).toBe(false);
	});

	it("preserves an existing tabindex on binding and cleanup", () => {
		const test = setup();
		test.cleanup();
		test.root.setAttribute("tabindex", "0");
		const cleanup = test.bind();
		expect(test.root.getAttribute("tabindex")).toBe("0");
		cleanup();
		expect(test.root.getAttribute("tabindex")).toBe("0");
	});
});
