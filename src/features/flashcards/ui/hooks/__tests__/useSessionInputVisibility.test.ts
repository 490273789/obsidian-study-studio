import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSessionInputVisibility } from "../useSessionInputVisibility";

const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("react", () => ({
	useRef: (current: unknown) => ({ current }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));
beforeEach(() => effects.splice(0));

function fixture() {
	let callback: FrameRequestCallback | undefined;
	const viewport = {
		offsetTop: 0,
		height: 400,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
	const ownerWindow = {
		innerHeight: 800,
		visualViewport: viewport,
		requestAnimationFrame: vi.fn((next: FrameRequestCallback) => {
			callback = next;
			return 7;
		}),
		cancelAnimationFrame: vi.fn(),
	};
	const scroller = { getBoundingClientRect: () => ({ bottom: 600 }), scrollBy: vi.fn() };
	const document = { defaultView: ownerWindow, activeElement: null as unknown };
	const input = {
		ownerDocument: document,
		closest: () => scroller,
		getBoundingClientRect: () => ({ bottom: 500 }),
	};
	document.activeElement = input;
	const view = {
		getBoundingClientRect: () => ({ bottom: 700 }),
		style: { setProperty: vi.fn(), removeProperty: vi.fn() },
	};
	const inputRef = { current: input as unknown as HTMLInputElement | null };
	const viewRef = { current: view as unknown as HTMLDivElement | null };
	return {
		inputRef,
		viewRef,
		input,
		view,
		document,
		ownerWindow,
		viewport,
		scroller,
		flush: () => callback?.(0),
	};
}

describe("session input visibility", () => {
	it("reserves the owning panel's keyboard overlap and scrolls its input into view", () => {
		const f = fixture();
		const actions = useSessionInputVisibility(f.inputRef, f.viewRef);
		actions.keepInputVisible();
		expect(f.view.style.setProperty).toHaveBeenCalledWith("--fc-keyboard-inset", "300px");
		f.flush();
		expect(f.scroller.scrollBy).toHaveBeenCalledWith({ top: 116, behavior: "auto" });
	});
	it("does not scroll after focus leaves or the input is replaced", () => {
		const f = fixture();
		const actions = useSessionInputVisibility(f.inputRef, f.viewRef);
		actions.keepInputVisible();
		f.inputRef.current = null;
		f.flush();
		expect(f.scroller.scrollBy).not.toHaveBeenCalled();
		f.document.activeElement = null;
		actions.keepInputVisible();
		expect(f.ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});
	it("cancels superseded frames and releases viewport listeners and inset on cleanup", () => {
		const f = fixture();
		const actions = useSessionInputVisibility(f.inputRef, f.viewRef);
		const cleanup = effects[0]!();
		actions.keepInputVisible();
		actions.keepInputVisible();
		expect(f.ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(7);
		actions.handleInputBlur();
		expect(f.view.style.removeProperty).toHaveBeenCalledWith("--fc-keyboard-inset");
		if (typeof cleanup === "function") cleanup();
		expect(f.viewport.removeEventListener).toHaveBeenCalledWith(
			"resize",
			actions.keepInputVisible,
		);
		expect(f.viewport.removeEventListener).toHaveBeenCalledWith(
			"scroll",
			actions.keepInputVisible,
		);
	});
});
