import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SelectionHelper } from "../../domain/selectionHelper";
import type { SelectionLookupHandle } from "../../domain/types";
import { SelectionListener } from "../selectionListener";

const roots = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: roots.create }));

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	roots.create.mockReset();
});

function environment() {
	const handlers = new Map<string, (event: unknown) => void>();
	let text = "hello";
	let x = 32;
	const element = { nodeType: 1, closest: () => null };
	const popup = { contains: (node: unknown) => node === popup, remove: vi.fn(), className: "" };
	const addEventListener = vi.fn(
		(type: string, fn: (event: unknown) => void, _capture?: boolean) => handlers.set(type, fn),
	);
	const appendChild = vi.fn();
	const removeEventListener = vi.fn();
	const root = { render: vi.fn(), unmount: vi.fn() };
	roots.create.mockReturnValueOnce(root);
	const doc = {
		defaultView: {
			getSelection: () => ({
				toString: () => text,
				anchorNode: element,
				focusNode: element,
				rangeCount: 1,
				getRangeAt: () => ({
					commonAncestorContainer: element,
					getBoundingClientRect: () => ({ left: x, bottom: 64, width: 10, height: 10 }),
				}),
			}),
		},
		activeElement: null,
		addEventListener,
		removeEventListener,
		createElement: () => popup,
		body: { appendChild },
		querySelectorAll: () => [],
	} as unknown as Document;
	return {
		doc,
		appendChild,
		addEventListener,
		removeEventListener,
		root,
		popup,
		element,
		setText: (value: string) => {
			text = value;
		},
		setX: (value: number) => {
			x = value;
		},
		emit: (type: string, event: unknown = {}) => handlers.get(type)?.(event),
	};
}
function helper(modifier: "none" | "alt" = "none") {
	return new SelectionHelper({
		settings: () => ({
			enabled: true,
			modifier,
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		}),
		dictionary: { sources: () => [], startLookup: () => null, openInMainTab: async () => {} },
		translation: { available: () => true, openPrefilled: async () => {} },
	});
}
function dictionaryHelper() {
	const session: SelectionLookupHandle = {
		getSnapshot: () => ({
			query: "hello",
			activeSourceId: "dictionary",
			aiEngineName: "",
			status: "ready",
			sources: [],
		}),
		subscribe: () => () => {},
		send: async () => {},
		dispose: () => {},
	};
	return new SelectionHelper({
		settings: () => ({
			enabled: true,
			modifier: "none",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		}),
		dictionary: {
			sources: () => [{ id: "dictionary", label: "Dictionary", kind: "dictionary" }],
			startLookup: () => session,
			openInMainTab: async () => {},
		},
		translation: { available: () => true, openPrefilled: async () => {} },
	});
}
function listen(env: ReturnType<typeof environment>, shared = helper()) {
	const listener = new SelectionListener({
		document: env.doc,
		helper: shared,
		getLanguage: () => "zh",
		getTheme: () => "light",
	});
	listener.start();
	return listener;
}
function mouse(target: unknown) {
	return {
		target,
		clientX: 12,
		clientY: 24,
		altKey: false,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
	};
}
function touch(target: unknown) {
	return { target, changedTouches: [{ clientX: 5, clientY: 6 }] };
}

describe("SelectionListener", () => {
	it("opens the large card directly from current selection, then blank after dismissal", () => {
		const env = environment();
		const shared = helper("alt");
		const listener = listen(env, shared);
		listener.openDictionary();
		expect(shared.getSnapshot()).toMatchObject({
			visible: true,
			mode: "dictionary",
			target: { text: "hello", x: 32, y: 64 },
		});
		env.setText("");
		const existing = shared.getSnapshot();
		listener.openDictionary();
		expect(shared.getSnapshot()).toBe(existing);
		shared.dismiss();
		listener.openDictionary();
		expect(shared.getSnapshot()).toMatchObject({
			mode: "dictionary",
			target: { text: "", trigger: "manual" },
		});
		listener.stop();
		expect(shared.getSnapshot().visible).toBe(false);
	});

	it("accepts selectable text on arbitrary pages and anchors to its range", () => {
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().target).toMatchObject({
			text: "hello",
			x: 32,
			y: 64,
			trigger: "mouse",
		});
		expect(env.appendChild).toHaveBeenCalledOnce();
		env.emit("mousedown", mouse(env.element));
		expect(shared.getSnapshot().visible).toBe(false);
		expect(env.root.unmount).toHaveBeenCalledOnce();
		listener.stop();
	});
	it("allows one popup across windows and closing an inactive window preserves it", () => {
		const first = environment();
		const second = environment();
		const shared = helper();
		const a = listen(first, shared);
		const b = listen(second, shared);
		first.emit("mouseup", mouse(first.element));
		second.setText("world");
		second.emit("mouseup", mouse(second.element));
		expect(first.root.unmount).toHaveBeenCalledOnce();
		expect(second.root.render).toHaveBeenCalled();
		a.stop();
		expect(shared.getSnapshot().target?.text).toBe("world");
		b.stop();
		expect(shared.getSnapshot().visible).toBe(false);
	});
	it("waits for long press and stable selection, ignores modifiers and synthetic mouse", () => {
		vi.useFakeTimers();
		const env = environment();
		const shared = helper("alt");
		const listener = listen(env, shared);
		env.emit("touchstart", touch(env.element));
		vi.advanceTimersByTime(400);
		env.emit("touchend", touch(env.element));
		vi.advanceTimersByTime(100);
		env.setText("world");
		env.emit("selectionchange");
		vi.advanceTimersByTime(149);
		expect(shared.getSnapshot().visible).toBe(false);
		vi.advanceTimersByTime(1);
		expect(shared.getSnapshot().target).toMatchObject({ text: "world", trigger: "touch" });
		env.setText("mouse");
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().target?.text).toBe("world");
		listener.stop();
	});
	it("hides during handle drag and accepts the same word at a different position", () => {
		vi.useFakeTimers();
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("touchend", touch(env.element));
		vi.advanceTimersByTime(150);
		env.emit("touchstart", touch(env.element));
		env.emit("touchmove", touch(env.element));
		expect(shared.getSnapshot().visible).toBe(false);
		env.setX(140);
		env.emit("selectionchange");
		vi.advanceTimersByTime(200);
		expect(shared.getSnapshot().visible).toBe(false);
		env.emit("touchend", touch(env.element));
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().target).toMatchObject({ text: "hello", x: 140 });
		listener.stop();
	});
	it("hides immediately when native handles only report selectionchange and waits for stability", () => {
		vi.useFakeTimers();
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("touchend", touch(env.element));
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().visible).toBe(true);
		env.emit("selectionchange");
		expect(shared.getSnapshot().visible).toBe(true);
		env.setX(100);
		env.emit("selectionchange");
		expect(shared.getSnapshot().visible).toBe(false);
		vi.advanceTimersByTime(100);
		env.setX(110);
		env.emit("selectionchange");
		vi.advanceTimersByTime(149);
		expect(shared.getSnapshot().visible).toBe(false);
		vi.advanceTimersByTime(1);
		expect(shared.getSnapshot().target?.x).toBe(110);
		listener.dismiss();
		env.emit("selectionchange");
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().visible).toBe(false);
		listener.stop();
	});

	it("rejects an earlier window's touch timer after another window selects", () => {
		vi.useFakeTimers();
		const first = environment();
		const second = environment();
		const shared = helper();
		const a = listen(first, shared);
		const b = listen(second, shared);
		first.emit("touchend", touch(first.element));
		second.setText("newer");
		second.emit("mouseup", mouse(second.element));
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().target?.text).toBe("newer");
		a.stop();
		b.stop();
	});

	it.each(["scroll", "Escape"])(
		"fences another window's pending touch on %s while keeping its visible popup",
		(action) => {
			vi.useFakeTimers();
			const first = environment();
			const second = environment();
			const shared = helper();
			const a = listen(first, shared);
			const b = listen(second, shared);
			const dismissFromSecond = () => {
				if (action === "scroll") second.emit("scroll", { target: second.element });
				else second.emit("keydown", { key: "Escape" });
			};
			first.emit("touchend", touch(first.element));
			dismissFromSecond();
			vi.advanceTimersByTime(150);
			expect(shared.getSnapshot().visible).toBe(false);
			first.emit("touchend", touch(first.element));
			vi.advanceTimersByTime(150);
			expect(shared.getSnapshot().target?.text).toBe("hello");
			dismissFromSecond();
			expect(shared.getSnapshot().visible).toBe(true);
			expect(shared.getSnapshot().target?.text).toBe("hello");
			a.stop();
			b.stop();
		},
	);

	it("dismisses pending work without closing another window's popup", () => {
		vi.useFakeTimers();
		const first = environment();
		const second = environment();
		const shared = helper();
		const a = listen(first, shared);
		const b = listen(second, shared);
		second.setText("current");
		second.emit("mouseup", mouse(second.element));
		first.emit("touchend", touch(first.element));
		a.dismiss();
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().target?.text).toBe("current");
		a.stop();
		b.stop();
	});

	it("keeps popup interactions open and dismisses source scrolling and Escape", () => {
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("mouseup", mouse(env.element));
		env.emit("touchstart", touch(env.popup));
		env.emit("touchmove", touch(env.popup));
		env.emit("scroll", { target: env.popup });
		expect(shared.getSnapshot().visible).toBe(true);
		env.emit("scroll", { target: env.element });
		expect(shared.getSnapshot().visible).toBe(false);
		env.emit("mouseup", mouse(env.element));
		env.emit("keydown", { key: "Escape" });
		expect(shared.getSnapshot().visible).toBe(false);
		listener.stop();
	});
	it("keeps the dictionary popup through outside gestures and replaces it on a new selection", () => {
		const env = environment();
		const shared = dictionaryHelper();
		const listener = listen(env, shared);
		env.emit("mouseup", mouse(env.element));
		shared.beginLookup();
		expect(shared.getSnapshot().mode).toBe("dictionary");

		env.emit("mousedown", mouse(env.element));
		env.setText("");
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot()).toMatchObject({ visible: true, mode: "dictionary" });
		env.setText("hello");
		env.emit("mousedown", mouse(env.element));
		env.emit("mouseup", mouse(env.element));
		env.emit("scroll", { target: env.element });
		env.emit("touchstart", touch(env.element));
		env.emit("touchmove", touch(env.element));
		expect(shared.getSnapshot()).toMatchObject({ visible: true, mode: "dictionary" });

		env.setText("world");
		env.setX(140);
		env.emit("mousedown", mouse(env.element));
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { text: "world", x: 140 },
		});
		listener.stop();
	});
	it("binds accessible frames and releases navigation and removed-frame sources", () => {
		const env = environment();
		const child = environment();
		const replacement = environment();
		const shared = helper();
		let scan!: () => void;
		Object.assign(env.doc.defaultView!, {
			MutationObserver: class {
				constructor(callback: () => void) {
					scan = callback;
				}
				observe() {}
				disconnect() {}
			},
		});
		const loads = new Map<string, () => void>();
		const frame = {
			nodeType: 1,
			closest: () => null,
			ownerDocument: env.doc,
			contentDocument: child.doc,
			offsetWidth: 100,
			offsetHeight: 100,
			clientLeft: 0,
			clientTop: 0,
			getBoundingClientRect: () => ({ left: 100, top: 200, width: 100, height: 100 }),
			addEventListener: (type: string, fn: () => void) => loads.set(type, fn),
			removeEventListener: vi.fn(),
		};
		Object.assign(child.doc.defaultView!, { frameElement: frame });
		Object.assign(replacement.doc.defaultView!, { frameElement: frame });
		let frames: unknown[] = [frame];
		Object.assign(env.doc, { querySelectorAll: () => frames });
		const listener = listen(env, shared);
		child.emit("mouseup", mouse(child.element));
		expect(shared.getSnapshot().target).toMatchObject({ text: "hello", x: 132, y: 264 });
		const retired = shared.getSnapshot().target!.source;
		frame.contentDocument = replacement.doc;
		loads.get("load")?.();
		expect(shared.getSnapshot().visible).toBe(false);
		child.emit("mouseup", mouse(child.element));
		expect(shared.getSnapshot().visible).toBe(false);
		replacement.setText("world");
		replacement.emit("mouseup", mouse(replacement.element));
		expect(shared.getSnapshot().target?.text).toBe("world");
		expect(shared.getSnapshot().target?.source).not.toBe(retired);
		frames = [];
		scan();
		expect(shared.getSnapshot().visible).toBe(false);
		expect(frame.removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
		frames = [frame];
		scan();
		replacement.emit("mouseup", mouse(replacement.element));
		env.setText("host");
		env.emit("mouseup", mouse(env.element));
		frames = [];
		scan();
		expect(shared.getSnapshot().target?.text).toBe("host");
		replacement.emit("mouseup", mouse(replacement.element));
		expect(shared.getSnapshot().target?.text).toBe("host");
		const staleLoad = loads.get("load");
		const beforeRemovalLoad = replacement.addEventListener.mock.calls.length;
		staleLoad?.();
		expect(replacement.addEventListener).toHaveBeenCalledTimes(beforeRemovalLoad);
		listener.stop();
		listener.start();
		const registrations = replacement.addEventListener.mock.calls.length;
		staleLoad?.();
		expect(replacement.addEventListener).toHaveBeenCalledTimes(registrations);
		listener.stop();
	});

	it("captures mouseup even when a child stops bubbling, and closes removed selection nodes", () => {
		const env = environment();
		const shared = helper();
		let mutation!: () => void;
		Object.assign(env.element, { isConnected: true });
		Object.assign(env.doc.defaultView!, {
			MutationObserver: class {
				constructor(callback: () => void) {
					mutation = callback;
				}
				observe() {}
				disconnect() {}
			},
		});
		const listener = listen(env, shared);
		// This is the capture registration, independent of bubble listeners in a PDF/plugin.
		const add = env.addEventListener;
		expect(
			add.mock.calls.some(([type, , capture]) => type === "mouseup" && capture === true),
		).toBe(true);
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().visible).toBe(true);
		Object.assign(env.element, { isConnected: false });
		mutation();
		expect(shared.getSnapshot().visible).toBe(false);
		listener.stop();
	});

	it("keeps editing and copying within a connected source and accepts it after removal", () => {
		const env = environment();
		const shared = helper();
		let mutation!: () => void;
		Object.assign(env.element, { isConnected: true });
		Object.assign(env.doc.defaultView!, {
			MutationObserver: class {
				constructor(callback: () => void) {
					mutation = callback;
				}
				observe() {}
				disconnect() {}
			},
		});
		const listener = listen(env, shared);
		env.emit("mouseup", mouse(env.element));
		const source = shared.getSnapshot().target?.source;
		env.setText("edited");
		mutation();
		env.emit("copy", { target: env.element });
		expect(shared.getSnapshot().visible).toBe(true);
		expect(shared.getSnapshot().target?.text).toBe("hello");
		Object.assign(env.element, { isConnected: false });
		mutation();
		expect(shared.getSnapshot().visible).toBe(false);
		Object.assign(env.element, { isConnected: true });
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().target?.text).toBe("edited");
		expect(shared.getSnapshot().target?.source).toBe(source);
		listener.stop();
	});

	it("opens a fresh document source when a window listener restarts", () => {
		vi.useFakeTimers();
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("mouseup", mouse(env.element));
		const previous = shared.getSnapshot().target?.source;
		env.emit("touchend", touch(env.element));
		listener.stop();
		listener.start();
		vi.advanceTimersByTime(150);
		expect(shared.getSnapshot().visible).toBe(false);
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().target?.source).not.toBe(previous);
		expect(shared.getSnapshot().visible).toBe(true);
		listener.stop();
	});

	it("cancels deferred work and rejects late external events after stop", () => {
		vi.useFakeTimers();
		const env = environment();
		const shared = helper();
		const listener = listen(env, shared);
		env.emit("touchend", touch(env.element));
		listener.stop();
		vi.advanceTimersByTime(150);
		env.emit("mouseup", mouse(env.element));
		expect(shared.getSnapshot().visible).toBe(false);
		expect(env.removeEventListener).toHaveBeenCalled();
	});
});
