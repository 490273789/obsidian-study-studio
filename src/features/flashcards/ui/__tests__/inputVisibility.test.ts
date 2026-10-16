import { describe, expect, it, vi } from "vite-plus/test";
import { InputVisibility } from "../inputVisibility";

class Events extends EventTarget {
	emit(type: string, target?: TestElement): void {
		const event = new Event(type);
		if (target) Object.defineProperty(event, "target", { value: target });
		this.dispatchEvent(event);
	}
}

interface Work {
	callback: () => void;
	delay: number;
	cancelled: boolean;
}

class TestWindow extends Events {
	visualViewport: (Events & { offsetTop: number; height: number }) | null = Object.assign(
		new Events(),
		{ offsetTop: 0, height: 500 },
	);
	innerHeight = 800;
	scrollX = 0;
	scrollY = 0;
	readonly timers = new Map<number, Work>();
	readonly frames = new Map<number, Work>();
	private nextId = 1;
	scrollTo = vi.fn(() => {
		this.scrollX = 0;
		this.scrollY = 0;
	});
	setTimeout = (callback: () => void, delay: number): number => {
		const id = this.nextId++;
		this.timers.set(id, { callback, delay, cancelled: false });
		return id;
	};
	clearTimeout = vi.fn((id: number) => {
		const work = this.timers.get(id);
		if (work) work.cancelled = true;
	});
	requestAnimationFrame = (callback: () => void): number => {
		const id = this.nextId++;
		this.frames.set(id, { callback, delay: 0, cancelled: false });
		return id;
	};
	cancelAnimationFrame = vi.fn((id: number) => {
		const work = this.frames.get(id);
		if (work) work.cancelled = true;
	});
	runTimers(delay: number): void {
		this.run(this.timers, delay);
	}
	runFrames(): void {
		this.run(this.frames, 0);
	}
	private run(queue: Map<number, Work>, delay: number): void {
		// oxlint-disable-next-line unicorn/no-useless-spread -- Callbacks may schedule the next frame; each batch only delivers work already queued.
		for (const [id, work] of [...queue]) {
			if (work.delay !== delay) continue;
			queue.delete(id);
			if (!work.cancelled) work.callback();
		}
	}
}

class TestDocument extends Events {
	readonly defaultView = new TestWindow();
	readonly body = new TestElement(this, "BODY");
	readonly documentElement = new TestElement(this, "HTML");
	activeElement = this.body;
	focused = true;
	modal: TestElement | null = null;
	hasFocus(): boolean {
		return this.focused;
	}
	querySelector(): TestElement | null {
		return this.modal;
	}
}

class TestElement {
	readonly nodeType = 1;
	isConnected = true;
	disabled = false;
	scrollTop = 0;
	bottom = 800;
	parent: TestElement | null = null;
	scroller = false;
	action = false;
	hidden = false;
	tabStop = false;
	readonly properties = new Map<string, string>();
	readonly style = {
		setProperty: (name: string, value: string) => this.properties.set(name, value),
		removeProperty: (name: string) => this.properties.delete(name),
	};
	constructor(
		readonly ownerDocument: TestDocument,
		readonly tagName = "DIV",
	) {}
	getBoundingClientRect(): { bottom: number } {
		return { bottom: this.bottom };
	}
	contains(target: TestElement): boolean {
		return target === this || (!!target.parent && this.contains(target.parent));
	}
	closest(selector: string): TestElement | null {
		const matches =
			selector === ".flashcard-content"
				? this.scroller
				: selector === "[data-session-input-action]"
					? this.action
					: selector.includes("[hidden]")
						? this.hidden
						: this.tabStop ||
							["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(this.tagName);
		return matches ? this : (this.parent?.closest(selector) ?? null);
	}
	focus = vi.fn((_options?: FocusOptions) => {
		this.ownerDocument.activeElement = this;
		this.ownerDocument.emit("focusin", this);
	});
	blur = vi.fn(() => {
		this.ownerDocument.activeElement = this.ownerDocument.body;
		this.ownerDocument.emit("focusout", this);
	});
	scrollBy = vi.fn((_options: ScrollToOptions) => {});
}

function fixture(focusOnEntry = false, document = new TestDocument()) {
	const owner = new InputVisibility(document as unknown as Document);
	const cleanup = owner.mount();
	const view = new TestElement(document);
	const scroller = new TestElement(document);
	scroller.scroller = true;
	scroller.parent = view;
	const input = new TestElement(document, "INPUT");
	input.parent = scroller;
	const open = (
		question = "one",
		replacement: TestElement | null = input,
		entry = focusOnEntry,
	) =>
		owner.open({
			view: view as unknown as HTMLElement,
			input: replacement as unknown as HTMLInputElement | null,
			question,
			focusOnEntry: entry,
		});
	const binding = open();
	return {
		owner,
		document,
		win: document.defaultView,
		view,
		scroller,
		input,
		binding,
		open,
		cleanup,
	};
}

function scrollRoot(document: TestDocument): void {
	document.defaultView.scrollX = 12;
	document.defaultView.scrollY = 40;
	document.body.scrollTop = 30;
	document.documentElement.scrollTop = 50;
}

function expectRootReset(document: TestDocument): void {
	expect(document.defaultView.scrollX).toBe(0);
	expect(document.defaultView.scrollY).toBe(0);
	expect(document.body.scrollTop).toBe(0);
	expect(document.documentElement.scrollTop).toBe(0);
}

describe("InputVisibility", () => {
	it("resets window, body and document scroll after global scrolling", () => {
		const f = fixture();
		scrollRoot(f.document);
		f.win.emit("scroll");
		expectRootReset(f.document);
		expect(f.win.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
	});

	it("repeats focus compatibility resets on the frame and at 50/200ms", () => {
		const f = fixture();
		f.input.focus();
		for (const run of [
			() => f.win.runFrames(),
			() => f.win.runTimers(50),
			() => f.win.runTimers(200),
		]) {
			scrollRoot(f.document);
			run();
			expectRootReset(f.document);
		}
	});

	it("fences even manually delivered compatibility callbacks after unmount", () => {
		const f = fixture();
		f.input.focus();
		const old = [...f.win.frames.values(), ...f.win.timers.values()];
		f.cleanup();
		scrollRoot(f.document);
		for (const work of old) work.callback();
		expect(f.win.scrollY).toBe(40);
		expect(f.document.body.scrollTop).toBe(30);
		expect(f.win.clearTimeout).toHaveBeenCalled();
		expect(f.win.cancelAnimationFrame).toHaveBeenCalled();
	});

	it("sets keyboard inset and scrolls only the local content with fresh viewport geometry", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		f.input.bottom = 620;
		f.binding.keepVisible();
		expect(f.view.properties.get("--fc-keyboard-inset")).toBe("300px");
		f.win.visualViewport!.offsetTop = 40;
		f.win.visualViewport!.height = 540;
		f.win.runFrames();
		expect(f.scroller.scrollBy).toHaveBeenCalledWith({ top: 56, behavior: "auto" });
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("uses innerHeight when visualViewport is unavailable", () => {
		const document = new TestDocument();
		document.defaultView.visualViewport = null;
		const f = fixture(false, document);
		f.document.activeElement = f.input;
		f.win.innerHeight = 600;
		f.input.bottom = 650;
		f.binding.keepVisible();
		f.win.runFrames();
		expect(f.view.properties.get("--fc-keyboard-inset")).toBe("200px");
		expect(f.scroller.scrollBy).toHaveBeenCalledWith({ top: 66, behavior: "auto" });
	});

	it("does not scroll content when the input already fits", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		f.input.bottom = 400;
		f.binding.keepVisible();
		f.win.runFrames();
		expect(f.scroller.scrollBy).not.toHaveBeenCalled();
	});

	it("viewport events preserve visibility without focusing input", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		f.win.visualViewport!.emit("resize");
		f.win.visualViewport!.emit("scroll");
		f.win.runFrames();
		expect(f.scroller.scrollBy).toHaveBeenCalledTimes(1);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it.each(["input", "submit"])("returns focus from the current %s interaction", (kind) => {
		const f = fixture();
		const action = new TestElement(f.document, "BUTTON");
		action.parent = f.view;
		action.action = true;
		f.document.activeElement = kind === "input" ? f.input : action;
		const token = f.binding.captureReturn();
		f.document.activeElement = f.document.body;
		token.focus();
		f.win.runTimers(0);
		expect(f.input.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(token.isCurrent()).toBe(true);
	});

	it.each(["focusin", "pointerdown"])(
		"permanently revokes a return after external %s even when input regains focus",
		(event) => {
			const f = fixture();
			f.document.activeElement = f.input;
			const token = f.binding.captureReturn();
			const external = new TestElement(f.document, "BUTTON");
			f.document.emit(event, external);
			f.document.activeElement = f.input;
			f.document.emit("focusin", f.input);
			f.document.activeElement = f.document.body;
			token.focus();
			f.win.runTimers(0);
			expect(f.input.focus).not.toHaveBeenCalled();
			expect(token.isCurrent()).toBe(true);
		},
	);

	it("revokes a return on window blur even after window focus returns", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		const token = f.binding.captureReturn();
		f.win.emit("blur");
		f.document.activeElement = f.document.body;
		token.focus();
		f.win.runTimers(0);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("revokes a pending focus through modal focus even after closing it", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		const token = f.binding.captureReturn();
		token.focus();
		const modalInput = new TestElement(f.document, "INPUT");
		f.document.modal = modalInput;
		f.document.emit("focusin", modalInput);
		f.document.modal = null;
		f.document.activeElement = f.document.body;
		f.win.runTimers(0);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it.each(["external-control", "modal", "hidden", "disabled", "window-unfocused"])(
		"entry does not steal focus with %s",
		(reason) => {
			const f = fixture();
			if (reason === "external-control")
				f.document.activeElement = new TestElement(f.document, "BUTTON");
			if (reason === "modal") f.document.modal = new TestElement(f.document);
			if (reason === "hidden") f.view.hidden = true;
			if (reason === "disabled") f.input.disabled = true;
			if (reason === "window-unfocused") f.document.focused = false;
			f.open("two", f.input, true);
			f.win.runTimers(0);
			expect(f.input.focus).not.toHaveBeenCalled();
		},
	);

	it("entry focus is scheduled and cancelled when its binding is disposed", () => {
		const f = fixture(true);
		const old = [...f.win.timers.values()];
		expect(f.input.focus).not.toHaveBeenCalled();
		f.binding.dispose();
		for (const work of old) work.callback();
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it.each(["input", "question", "unmount"])(
		"invalidates old tokens, focus and frames after %s replacement",
		(reason) => {
			const f = fixture();
			f.document.activeElement = f.input;
			const token = f.binding.captureReturn();
			token.focus();
			f.binding.keepVisible();
			const old = [...f.win.timers.values(), ...f.win.frames.values()];
			if (reason === "unmount") f.cleanup();
			else
				f.open(
					reason === "question" ? "two" : "one",
					reason === "input" ? new TestElement(f.document, "INPUT") : f.input,
				);
			for (const work of old) work.callback();
			token.focus();
			f.win.runTimers(0);
			expect(token.isCurrent()).toBe(false);
			expect(f.input.focus).not.toHaveBeenCalled();
			expect(f.scroller.scrollBy).not.toHaveBeenCalled();
			expect(f.view.properties.has("--fc-keyboard-inset")).toBe(false);
		},
	);

	it("invalidates detached input tokens", () => {
		const f = fixture();
		const token = f.binding.captureReturn();
		f.input.isConnected = false;
		token.focus();
		f.win.runTimers(0);
		expect(token.isCurrent()).toBe(false);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("supports setup cleanup setup and fences the first mount callbacks", () => {
		const f = fixture(true);
		const token = f.binding.captureReturn();
		const old = [...f.win.timers.values()];
		f.cleanup();
		const cleanup = f.owner.mount();
		f.open("two", f.input, true);
		for (const work of old) work.callback();
		expect(f.input.focus).not.toHaveBeenCalled();
		expect(token.isCurrent()).toBe(false);
		f.win.runTimers(0);
		expect(f.input.focus).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it("keeps scheduling and cancellation local to the owning window", () => {
		const a = fixture(true);
		const b = fixture(true);
		a.cleanup();
		expect(a.win.clearTimeout).toHaveBeenCalled();
		expect(b.win.clearTimeout).not.toHaveBeenCalled();
		a.win.runTimers(0);
		b.win.runTimers(0);
		expect(a.input.focus).not.toHaveBeenCalled();
		expect(b.input.focus).toHaveBeenCalledTimes(1);
		scrollRoot(a.document);
		scrollRoot(b.document);
		b.win.emit("scroll");
		expectRootReset(b.document);
		expect(a.win.scrollY).toBe(40);
	});

	it("focuses on entry only after the owning window runs its timer", () => {
		const f = fixture(true);
		expect(f.input.focus).not.toHaveBeenCalled();
		f.win.runTimers(0);
		expect(f.input.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("resets root scroll on focusout without restoring input focus", () => {
		const f = fixture();
		f.document.emit("focusout", f.input);
		scrollRoot(f.document);
		f.win.runFrames();
		expectRootReset(f.document);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("blur clears inset and fences pending focus and visibility work", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		f.binding.captureReturn().focus();
		f.binding.keepVisible();
		const old = [...f.win.timers.values(), ...f.win.frames.values()];
		f.binding.blur();
		for (const work of old) work.callback();
		expect(f.view.properties.has("--fc-keyboard-inset")).toBe(false);
		expect(f.input.focus).not.toHaveBeenCalled();
		expect(f.scroller.scrollBy).not.toHaveBeenCalled();
	});

	it("stops pending and viewport visibility work after an external pointer even while input remains active", () => {
		const f = fixture();
		f.document.activeElement = f.input;
		f.binding.keepVisible();
		const oldFrames = [...f.win.frames.values()];
		f.document.emit("pointerdown", new TestElement(f.document, "BUTTON"));
		expect(f.document.activeElement).toBe(f.input);
		expect(f.view.properties.has("--fc-keyboard-inset")).toBe(false);
		for (const work of oldFrames) work.callback();
		f.win.visualViewport!.emit("resize");
		f.win.runFrames();
		expect(f.scroller.scrollBy).not.toHaveBeenCalled();
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("respects an external pointer that leaves browser focus on body", () => {
		const f = fixture();
		f.document.emit("pointerdown", new TestElement(f.document, "BUTTON"));
		f.open("two", f.input, true);
		f.win.runTimers(0);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("does not allow a return captured from an external control to gain permission later", () => {
		const f = fixture();
		f.document.activeElement = new TestElement(f.document, "BUTTON");
		const token = f.binding.captureReturn();
		f.document.activeElement = f.document.body;
		token.focus();
		f.win.runTimers(0);
		expect(f.input.focus).not.toHaveBeenCalled();
	});

	it("allows a null input without scheduling focus or visibility work", () => {
		const f = fixture();
		const binding = f.open("two", null, true);
		binding.keepVisible();
		binding.captureReturn().focus();
		f.win.runTimers(0);
		f.win.runFrames();
		expect(f.input.focus).not.toHaveBeenCalled();
		expect(f.scroller.scrollBy).not.toHaveBeenCalled();
	});

	it.each(["view", "ancestor"] as const)(
		"keeps ordinary question content owned when %s has tabindex",
		(location) => {
			const f = fixture();
			const container = location === "view" ? f.view : new TestElement(f.document);
			container.tabStop = true;
			if (location === "ancestor") f.view.parent = container;
			const text = new TestElement(f.document);
			text.parent = f.scroller;
			f.document.activeElement = f.input;
			const token = f.binding.captureReturn();
			f.document.emit("pointerdown", text);
			f.document.activeElement = f.document.body;
			token.focus();
			f.win.runTimers(0);
			expect(f.input.focus).toHaveBeenCalledWith({ preventScroll: true });
		},
	);
});
