import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SelectionHelper } from "../../domain/selectionHelper";
import { SelectionListener } from "../selectionListener";

const rootSpies = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));

vi.mock("react-dom/client", () => ({
	createRoot: () => rootSpies,
}));

describe("SelectionListener", () => {
	let addEventListenerSpy: ReturnType<typeof vi.fn>;
	let removeEventListenerSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		rootSpies.render.mockReset();
		rootSpies.unmount.mockReset();
		addEventListenerSpy = vi.fn();
		removeEventListenerSpy = vi.fn();

		vi.stubGlobal("document", {
			addEventListener: addEventListenerSpy,
			removeEventListener: removeEventListenerSpy,
			createElement: vi.fn(() => ({
				className: "",
				contains: vi.fn((node) => Boolean(node?.internal)),
				appendChild: vi.fn(),
				remove: vi.fn(),
			})),
			body: { appendChild: vi.fn() },
		});
	});

	it("passes note selections to the deep module and unmounts on outside input", () => {
		const handlers = new Map<string, (event: MouseEvent) => void>();
		addEventListenerSpy.mockImplementation((type, listener) => {
			handlers.set(type, listener);
		});
		vi.stubGlobal("window", {
			getSelection: () => ({ toString: () => "hello" }),
		});
		const helper = new SelectionHelper({
			settings: () => ({ enabled: true, modifier: "none", selectedDictionaries: [] }),
			dictionary: {
				sources: () => [{ id: "youdao", label: "有道", kind: "dictionary" }],
				startLookup: () => null,
				openInMainTab: vi.fn().mockResolvedValue(undefined),
			},
			translation: {
				available: () => true,
				openPrefilled: vi.fn().mockResolvedValue(undefined),
			},
		});
		const listener = new SelectionListener({
			helper,
			getTheme: () => "light",
			getLanguage: () => "zh",
		});
		listener.start();

		handlers.get("mouseup")?.({
			target: { closest: () => ({}) },
			clientX: 12,
			clientY: 24,
			altKey: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
		} as unknown as MouseEvent);

		expect(helper.getSnapshot().target?.text).toBe("hello");
		expect(rootSpies.render).toHaveBeenCalledOnce();

		handlers.get("mousedown")?.({ target: {} } as MouseEvent);
		expect(helper.getSnapshot().visible).toBe(false);
		expect(rootSpies.unmount).toHaveBeenCalledOnce();
		listener.stop();
	});

	it("debounces touch selection changes, positions by the range, and ignores synthetic mouse", () => {
		vi.useFakeTimers();
		const handlers = new Map<string, (event?: unknown) => void>();
		addEventListenerSpy.mockImplementation((type, listener) => handlers.set(type, listener));
		let text = "hello";
		const target = { closest: () => ({}) };
		vi.stubGlobal("window", {
			getSelection: () => ({
				toString: () => text,
				anchorNode: { nodeType: 1, ...target },
				rangeCount: 1,
				getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 32, bottom: 64 }) }),
			}),
		});
		const helper = createHelper();
		const handleSelection = vi.spyOn(helper, "handleSelection");
		const listener = new SelectionListener({
			helper,
			getTheme: () => "light",
			getLanguage: () => "zh",
		});
		listener.start();
		handlers.get("touchend")?.({ target, changedTouches: [{ clientX: 5, clientY: 6 }] });
		vi.advanceTimersByTime(100);
		text = "world";
		handlers.get("selectionchange")?.();
		vi.advanceTimersByTime(149);
		expect(handleSelection).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(helper.getSnapshot().target).toMatchObject({ text: "world", x: 32, y: 64 });
		handlers.get("mouseup")?.({ target, clientX: 5, clientY: 6 });
		handlers.get("selectionchange")?.();
		vi.advanceTimersByTime(150);
		expect(handleSelection).toHaveBeenCalledOnce();
		listener.stop();
	});

	it("keeps internal touch and scrolling open, and cancels pending touch work on stop", () => {
		vi.useFakeTimers();
		const handlers = new Map<string, (event?: unknown) => void>();
		addEventListenerSpy.mockImplementation((type, listener) => handlers.set(type, listener));
		vi.stubGlobal("window", { getSelection: () => ({ toString: () => "hello" }) });
		const helper = createHelper();
		const listener = new SelectionListener({
			helper,
			getTheme: () => "light",
			getLanguage: () => "zh",
		});
		listener.start();
		helper.handleSelection({
			text: "hello",
			x: 0,
			y: 0,
			eligibleContext: true,
			altKey: false,
			shiftKey: false,
			ctrlOrMetaKey: false,
		});
		handlers.get("touchend")?.({ target: { internal: true } });
		handlers.get("scroll")?.({ target: { internal: true } });
		vi.advanceTimersByTime(150);
		expect(helper.getSnapshot().visible).toBe(true);
		handlers.get("touchend")?.({ target: { closest: () => ({}) }, changedTouches: [] });
		listener.stop();
		vi.advanceTimersByTime(150);
		expect(helper.getSnapshot().visible).toBe(false);
		expect(removeEventListenerSpy).toHaveBeenCalledWith("touchend", expect.any(Function));
		expect(removeEventListenerSpy).toHaveBeenCalledWith(
			"selectionchange",
			expect.any(Function),
		);
	});

	it("applies existing modifier eligibility to touch selections", () => {
		vi.useFakeTimers();
		const handlers = new Map<string, (event?: unknown) => void>();
		addEventListenerSpy.mockImplementation((type, listener) => handlers.set(type, listener));
		vi.stubGlobal("window", { getSelection: () => ({ toString: () => "hello" }) });
		const helper = createHelper("alt");
		const listener = new SelectionListener({
			helper,
			getTheme: () => "light",
			getLanguage: () => "zh",
		});
		listener.start();
		const event = { target: { closest: () => ({}) }, changedTouches: [], altKey: false };
		handlers.get("touchend")?.(event);
		vi.advanceTimersByTime(150);
		expect(helper.getSnapshot().visible).toBe(false);
		handlers.get("touchend")?.({ ...event, altKey: true });
		vi.advanceTimersByTime(150);
		expect(helper.getSnapshot().visible).toBe(true);
		listener.stop();
	});

	it.each(["retained", "cleared", "ineligible"])(
		"dismisses an external mobile tap with %s selection",
		(selectionState) => {
			vi.useFakeTimers();
			const handlers = new Map<string, (event?: unknown) => void>();
			addEventListenerSpy.mockImplementation((type, listener) =>
				handlers.set(type, listener),
			);
			let text = "hello";
			let eligible = true;
			vi.stubGlobal("window", {
				getSelection: () => ({
					toString: () => text,
					anchorNode: { nodeType: 1, closest: () => (eligible ? {} : null) },
				}),
			});
			const helper = createHelper();
			const listener = new SelectionListener({
				helper,
				getTheme: () => "light",
				getLanguage: () => "zh",
			});
			listener.start();
			helper.handleSelection({
				text: "hello",
				x: 0,
				y: 0,
				eligibleContext: true,
				altKey: false,
				shiftKey: false,
				ctrlOrMetaKey: false,
			});
			const event = { target: { closest: () => null }, changedTouches: [] };
			handlers.get("touchstart")?.(event);
			vi.advanceTimersByTime(50);
			if (selectionState === "cleared") text = "";
			if (selectionState === "ineligible") {
				text = "toolbar";
				eligible = false;
			}
			handlers.get("touchend")?.(event);
			expect(helper.getSnapshot().visible).toBe(false);
			handlers.get("selectionchange")?.();
			vi.advanceTimersByTime(200);
			expect(helper.getSnapshot().visible).toBe(false);
			listener.stop();
		},
	);

	it.each(["longpress", "handle-drag"])(
		"preserves %s selection adjustments and skips unchanged queries",
		(gesture) => {
			vi.useFakeTimers();
			const handlers = new Map<string, (event?: unknown) => void>();
			addEventListenerSpy.mockImplementation((type, listener) =>
				handlers.set(type, listener),
			);
			let text = "hello";
			const target = { closest: () => ({}) };
			vi.stubGlobal("window", {
				getSelection: () => ({
					toString: () => text,
					anchorNode: { nodeType: 1, ...target },
				}),
			});
			const helper = createHelper();
			const listener = new SelectionListener({
				helper,
				getTheme: () => "light",
				getLanguage: () => "zh",
			});
			listener.start();
			helper.handleSelection({
				text: "hello",
				x: 0,
				y: 0,
				eligibleContext: true,
				altKey: false,
				shiftKey: false,
				ctrlOrMetaKey: false,
			});
			const handleSelection = vi.spyOn(helper, "handleSelection");
			const event = { target, changedTouches: [] };
			handlers.get("touchstart")?.(event);
			if (gesture === "longpress") vi.advanceTimersByTime(400);
			else handlers.get("touchmove")?.(event);
			handlers.get("touchend")?.(event);
			vi.advanceTimersByTime(150);
			expect(helper.getSnapshot().visible).toBe(true);
			expect(handleSelection).not.toHaveBeenCalled();
			text = "world";
			handlers.get("selectionchange")?.();
			vi.advanceTimersByTime(150);
			expect(helper.getSnapshot().target?.text).toBe("world");
			expect(handleSelection).toHaveBeenCalledOnce();
			handlers.get("selectionchange")?.();
			vi.advanceTimersByTime(150);
			expect(handleSelection).toHaveBeenCalledOnce();
			listener.stop();
		},
	);

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("registers mouseup, mousedown, and scroll listeners on start", () => {
		const helper = new SelectionHelper({
			settings: () => ({ enabled: true, modifier: "none", selectedDictionaries: [] }),
			dictionary: {
				sources: () => [],
				startLookup: () => null,
				openInMainTab: vi.fn().mockResolvedValue(undefined),
			},
			translation: {
				available: () => false,
				openPrefilled: vi.fn().mockResolvedValue(undefined),
			},
		});
		const listener = new SelectionListener({
			helper,
			getTheme: () => "light",
			getLanguage: () => "zh",
		});

		listener.start();
		expect(addEventListenerSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
		expect(addEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function), true);
		expect(addEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);

		listener.stop();
		expect(removeEventListenerSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
		expect(removeEventListenerSpy).toHaveBeenCalledWith(
			"mousedown",
			expect.any(Function),
			true,
		);
		expect(removeEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
	});
});

function createHelper(modifier: "none" | "alt" = "none"): SelectionHelper {
	return new SelectionHelper({
		settings: () => ({ enabled: true, modifier, selectedDictionaries: [] }),
		dictionary: {
			sources: () => [{ id: "local", label: "本地", kind: "dictionary" }],
			startLookup: () => null,
			openInMainTab: vi.fn().mockResolvedValue(undefined),
		},
		translation: {
			available: () => false,
			openPrefilled: vi.fn().mockResolvedValue(undefined),
		},
	});
}
