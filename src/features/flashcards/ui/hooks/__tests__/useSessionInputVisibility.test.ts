import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSessionInputVisibility } from "../useSessionInputVisibility";
import type { InputBinding, InputRegistration } from "../../inputVisibility";

// Only the React adapter is simulated; geometry and focus sequences exercise
// the real module in inputVisibility.test.ts.
const hooks = vi.hoisted(() => ({
	effects: [] as (() => void | (() => void))[],
	ref: { current: null as unknown },
	visibility: { open: vi.fn<(registration: InputRegistration) => InputBinding>() },
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useContext: () => hooks.visibility,
	useRef: () => hooks.ref,
	useCallback: (callback: unknown) => callback,
	useLayoutEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
beforeEach(() => {
	hooks.effects = [];
	hooks.ref.current = null;
	hooks.visibility.open.mockReset();
});

function fixture() {
	const bindings: InputBinding[] = [];
	hooks.visibility.open.mockImplementation(() => {
		const binding = {
			keepVisible: vi.fn(),
			blur: vi.fn(),
			dispose: vi.fn(),
			captureReturn: vi.fn(() => ({ isCurrent: () => true, focus: vi.fn() })),
		};
		bindings.push(binding);
		return binding;
	});
	const inputRef = { current: {} as HTMLInputElement | null };
	const viewRef = { current: {} as HTMLDivElement | null };
	let cleanup: void | (() => void);
	function render(question = "question", focusOnEntry = true, commit = true) {
		hooks.effects = [];
		const actions = useSessionInputVisibility(inputRef, viewRef, question, focusOnEntry);
		if (commit) {
			hooks.effects[0]!();
			if (!cleanup) cleanup = hooks.effects[1]!();
		}
		return actions;
	}
	return { inputRef, viewRef, bindings, render, unmount: () => cleanup?.() };
}

describe("session input React adapter", () => {
	it("registers committed elements and keeps the lease through unrelated renders", () => {
		const f = fixture();
		const actions = f.render();
		f.render();
		expect(hooks.visibility.open).toHaveBeenCalledExactlyOnceWith({
			input: f.inputRef.current,
			view: f.viewRef.current,
			question: "question",
			focusOnEntry: true,
		});
		actions.keepInputVisible();
		actions.handleInputBlur();
		const captured = actions.captureReturn();
		expect(captured.isCurrent()).toBe(true);
		expect(f.bindings[0]!.keepVisible).toHaveBeenCalledOnce();
		expect(f.bindings[0]!.blur).toHaveBeenCalledOnce();
		expect(f.bindings[0]!.captureReturn).toHaveBeenCalledOnce();
	});

	it("releases the old lease when the question or actual input is replaced", () => {
		const f = fixture();
		f.render();
		f.render("next");
		expect(f.bindings[0]!.dispose).toHaveBeenCalledOnce();
		f.inputRef.current = {} as HTMLInputElement;
		f.render("next");
		expect(f.bindings[1]!.dispose).toHaveBeenCalledOnce();
		expect(hooks.visibility.open).toHaveBeenCalledTimes(3);
	});

	it("does not register speculative renders, and forwards the absence of a question input", () => {
		const f = fixture();
		f.render("speculative", true, false);
		expect(hooks.visibility.open).not.toHaveBeenCalled();
		f.inputRef.current = null;
		f.render("feedback", false);
		expect(hooks.visibility.open).toHaveBeenCalledWith({
			input: null,
			view: f.viewRef.current,
			question: "feedback",
			focusOnEntry: false,
		});
	});

	it("releases on root removal and unmount, and stops forwarding old handlers", () => {
		const f = fixture();
		const actions = f.render();
		f.viewRef.current = null;
		f.render();
		expect(f.bindings[0]!.dispose).toHaveBeenCalledOnce();
		f.unmount();
		actions.keepInputVisible();
		actions.handleInputBlur();
		expect(actions.captureReturn().isCurrent()).toBe(false);
		expect(f.bindings[0]!.keepVisible).not.toHaveBeenCalled();
		expect(f.bindings[0]!.blur).not.toHaveBeenCalled();
	});
});
