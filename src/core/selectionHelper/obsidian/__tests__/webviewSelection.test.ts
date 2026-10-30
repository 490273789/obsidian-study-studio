import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SelectionHelper } from "../../domain/selectionHelper";
import type { SelectionTarget } from "../../domain/types";
import { WebviewSelectionAdapter } from "../webviewSelection";

function setup() {
	const handlers = new Map<string, () => void>();
	const hostHandlers = new Map<string, () => void>();
	const windowHandlers = new Map<string, () => void>();
	const executeJavaScript = vi.fn<(code: string) => Promise<unknown>>().mockResolvedValue(true);
	const element = {
		executeJavaScript,
		closest: () => null,
		addEventListener: (type: string, callback: () => void) => handlers.set(type, callback),
		removeEventListener: vi.fn(),
		getBoundingClientRect: () => ({
			left: 50,
			top: 100,
			width: 400,
			height: 300,
			right: 450,
			bottom: 400,
		}),
	};
	let elements = [element];
	let mutate = () => {};
	const document = {
		addEventListener: (type: string, callback: () => void) => hostHandlers.set(type, callback),
		removeEventListener: vi.fn(),
		querySelectorAll: () => elements,
		activeElement: element as object | null,
		hasFocus: vi.fn(() => true),
		visibilityState: "visible",
		defaultView: {
			MutationObserver: class {
				constructor(callback: () => void) {
					mutate = callback;
				}
				observe() {}
				disconnect() {}
			},
			innerWidth: 1000,
			innerHeight: 1000,
			addEventListener: (type: string, callback: () => void) =>
				windowHandlers.set(type, callback),
			removeEventListener: vi.fn(),
		},
	};
	const helper = new SelectionHelper({
		settings: () => ({
			enabled: true,
			modifier: "none",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		}),
		dictionary: {
			sources: () => [{ id: "local", label: "Local", kind: "dictionary" }],
		},
		translation: { available: () => true, openPrefilled: async () => {} },
	});
	const selections: SelectionTarget[] = [];
	helper.subscribe(() => {
		const snapshot = helper.getSnapshot();
		if (snapshot.target && snapshot.mode === "actions") selections.push(snapshot.target);
	});
	const onStatus = vi.fn();
	const isEnabled = vi.fn(() => true);
	let openShortcut = "Alt+1";
	const openSource = vi.fn(() => helper.openSource({}));
	const adapter = new WebviewSelectionAdapter({
		document: document as unknown as Document,
		openSource,
		openDictionary: (source, candidate) => helper.openDictionary(source, candidate),
		interrupt: () => helper.interrupt(),
		isDictionaryPopup: () => {
			const snapshot = helper.getSnapshot();
			return (
				snapshot.visible &&
				(snapshot.mode === "slot" || (snapshot.mode as string) === "dictionary")
			);
		},
		onStatus,
		isEnabled,
		getOpenShortcut: () => openShortcut,
	});
	return {
		adapter,
		document,
		element,
		handlers,
		hostHandlers,
		windowHandlers,
		executeJavaScript,
		helper,
		selections,
		onStatus,
		isEnabled,
		openSource,
		setOpenShortcut: (value: string) => {
			openShortcut = value;
			adapter.refreshShortcut();
		},
		remove: () => {
			elements = [];
			mutate();
		},
	};
}

const event = {
	sequence: 1,
	captureSequence: 1,
	text: "hello",
	x: 20,
	y: 40,
	width: 200,
	height: 150,
	altKey: true,
	shiftKey: false,
	ctrlOrMetaKey: false,
};
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("WebviewSelectionAdapter", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("reads the focused guest explicitly while automatic capture is disabled", async () => {
		const env = setup();
		env.isEnabled.mockReturnValue(false);
		env.adapter.start();
		env.executeJavaScript.mockResolvedValue({ text: "hello", x: 5, y: 6 });
		expect(env.adapter.openDictionary()).toBe(true);
		await flush();
		expect(env.helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			target: { text: "hello", x: 55, y: 106 },
		});
		env.adapter.stop();
	});

	it("expires an explicitly selected guest node while automatic capture stays disabled", async () => {
		const env = setup();
		env.isEnabled.mockReturnValue(false);
		env.adapter.start();
		const origin = { isConnected: true, nodeType: 1, closest: () => null };
		const guest = { window: {} as Record<string, unknown>, document: { activeElement: null } };
		Object.assign(guest.window, {
			getSelection: () => ({
				anchorNode: origin,
				toString: () => "hello",
				rangeCount: 1,
				getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 5, bottom: 6 }) }),
			}),
		});
		env.executeJavaScript.mockImplementation(async (code) => runInNewContext(code, guest));
		expect(env.adapter.openDictionary()).toBe(true);
		await flush();
		expect(env.helper.getSnapshot().visible).toBe(true);
		origin.isConnected = false;
		vi.advanceTimersByTime(150);
		await flush();
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.adapter.stop();
	});

	it("discards an explicit guest read after a user dismissal", async () => {
		const env = setup();
		env.isEnabled.mockReturnValue(false);
		env.adapter.start();
		let finish!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		env.adapter.openDictionary();
		env.helper.dismiss();
		finish({ text: "late", x: 5, y: 6 });
		await flush();
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.adapter.stop();
	});

	it("captures guest-only mouse events when the embedder loses focus to Web viewer", async () => {
		const env = setup();
		const handlers = new Map<string, (event: unknown) => void>();
		const guest = {
			window: {
				getSelection: () => ({
					toString: () => "hello",
					rangeCount: 1,
					getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 20, bottom: 40 }) }),
				}),
			},
			innerWidth: 200,
			innerHeight: 150,
			document: {
				activeElement: null,
				hasFocus: vi.fn(() => true),
				addEventListener: (type: string, callback: (event: unknown) => void) =>
					handlers.set(type, callback),
				removeEventListener: vi.fn(),
			},
		};
		env.executeJavaScript.mockImplementation(async (code) => runInNewContext(code, guest));
		// Electron moves focus into the guest, whose input events never bubble to the host.
		env.document.hasFocus.mockReturnValue(false);
		env.adapter.start();
		await flush();
		handlers.get("mouseup")?.({ clientX: 20, clientY: 40, altKey: true });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target).toEqual(
			expect.objectContaining({ text: "hello", x: 90, y: 180 }),
		);
		guest.document.hasFocus.mockReturnValue(false);
		handlers.get("mouseup")?.({ clientX: 20, clientY: 40 });
		await vi.advanceTimersByTimeAsync(150);
		guest.document.hasFocus.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(150);
		// Unfocused guest events are neither sent nor replayed on returning focus.
		expect(env.selections).toHaveLength(1);
		env.adapter.stop();
	});

	it.each([true, false])(
		"opens the lookup assistant with Option+1 while a web page has focus (automatic capture: %s)",
		async (enabled) => {
			const env = setup();
			env.isEnabled.mockReturnValue(enabled);
			const handlers = new Map<string, (event: unknown) => void>();
			const guest = {
				window: {
					getSelection: () => ({
						toString: () => "hello",
						anchorNode: { isConnected: true },
						rangeCount: 1,
						getRangeAt: () => ({
							getBoundingClientRect: () => ({ left: 20, bottom: 40 }),
						}),
					}),
				},
				innerWidth: 200,
				innerHeight: 150,
				document: {
					activeElement: null,
					hasFocus: vi.fn(() => true),
					addEventListener: (type: string, callback: (event: unknown) => void) =>
						handlers.set(type, callback),
					removeEventListener: vi.fn(),
				},
			};
			env.executeJavaScript.mockImplementation(async (code) => runInNewContext(code, guest));
			env.document.hasFocus.mockReturnValue(false);
			env.adapter.start();
			await flush();
			const keydown = {
				key: "¡",
				code: "Digit1",
				altKey: true,
				ctrlKey: false,
				shiftKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
				stopImmediatePropagation: vi.fn(),
			};
			handlers.get("keydown")?.(keydown);
			await vi.advanceTimersByTimeAsync(150);
			expect(keydown.preventDefault).toHaveBeenCalledOnce();
			expect(keydown.stopImmediatePropagation).toHaveBeenCalledOnce();
			expect(env.helper.getSnapshot()).toMatchObject({
				visible: true,
				mode: "slot",
				target: { text: "hello", x: 70, y: 140 },
			});
			env.helper.dismiss();
			env.setOpenShortcut("Ctrl+K");
			await flush();
			keydown.preventDefault.mockClear();
			handlers.get("keydown")?.(keydown);
			await vi.advanceTimersByTimeAsync(150);
			expect(keydown.preventDefault).not.toHaveBeenCalled();
			expect(env.helper.getSnapshot().visible).toBe(false);
			const reboundKeydown = {
				...keydown,
				key: "k",
				code: "KeyK",
				altKey: false,
				ctrlKey: true,
				preventDefault: vi.fn(),
			};
			handlers.get("keydown")?.(reboundKeydown);
			await vi.advanceTimersByTimeAsync(150);
			expect(reboundKeydown.preventDefault).toHaveBeenCalledOnce();
			expect(env.helper.getSnapshot().visible).toBe(true);
			env.helper.dismiss();
			handlers.get("keydown")?.(reboundKeydown);
			guest.document.hasFocus.mockReturnValue(false);
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().visible).toBe(false);
			env.adapter.stop();
		},
	);

	it.each(["host interaction", "webview focus change"])(
		"discards a pending web shortcut after %s",
		async (interruption) => {
			const env = setup();
			env.adapter.start();
			await flush();
			let finish!: (value: unknown) => void;
			env.executeJavaScript.mockReturnValueOnce(
				new Promise((resolve) => {
					finish = resolve;
				}),
			);
			await vi.advanceTimersByTimeAsync(150);
			if (interruption === "host interaction") env.hostHandlers.get("mousedown")?.();
			else env.document.activeElement = null;
			finish({ ...event, text: "", openAssistant: true });
			await flush();
			expect(env.helper.getSnapshot().visible).toBe(false);
			env.adapter.stop();
		},
	);

	it("reads focused webview selections and converts guest viewport coordinates", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		expect(env.onStatus).toHaveBeenCalledWith("available");
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target).toEqual(
			expect.objectContaining({
				text: "hello",
				x: 90,
				y: 180,
				trigger: "mouse",
				source: expect.objectContaining({ id: expect.any(String) }),
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.selections).toHaveLength(1);
		env.adapter.stop();
	});

	it("skips hidden webviews and ignores automatic selections when disabled", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.document.visibilityState = "hidden";
		await vi.advanceTimersByTimeAsync(150);
		expect(env.executeJavaScript).toHaveBeenCalledOnce();
		env.document.visibilityState = "visible";
		env.isEnabled.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(150);
		const disabledCalls = env.executeJavaScript.mock.calls.length;
		await vi.advanceTimersByTimeAsync(300);
		expect(env.executeJavaScript.mock.calls.length).toBeGreaterThan(disabledCalls);
		expect(env.selections).toHaveLength(0);
		env.isEnabled.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.executeJavaScript.mock.calls.length).toBeGreaterThan(disabledCalls);
		env.adapter.stop();
	});

	it("keeps reads single-flight and discards a result arriving after navigation", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		let resolve!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(450);
		expect(env.executeJavaScript).toHaveBeenCalledTimes(2);
		env.handlers.get("did-start-loading")?.();
		resolve(event);
		await flush();
		expect(env.selections).toHaveLength(0);
		env.executeJavaScript.mockResolvedValue(true);
		env.handlers.get("dom-ready")?.();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target?.text).toBe("hello");
		env.adapter.stop();
	});

	it("dismisses only its source on guest clearing, failure, and teardown", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue({ ...event, text: "" });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.executeJavaScript.mockRejectedValueOnce(new Error("guest gone"));
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onStatus).toHaveBeenCalledWith("unavailable");
		env.executeJavaScript.mockResolvedValue(true);
		env.adapter.stop();
		await flush();
		expect(env.element.removeEventListener).toHaveBeenCalledTimes(3);
		expect(env.executeJavaScript).toHaveBeenLastCalledWith(
			expect.stringContaining("delete window."),
		);
		expect(env.onStatus).toHaveBeenLastCalledWith("idle");
	});

	it("rejects malformed and unbounded guest data", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		for (const result of [
			{ ...event, x: NaN },
			{ ...event, text: "a".repeat(10001) },
			{ ...event, sequence: -1 },
			{ ...event, altKey: "true" },
			{ ...event, width: 0 },
		]) {
			env.executeJavaScript.mockResolvedValue(result);
			await vi.advanceTimersByTimeAsync(150);
		}
		expect(env.selections).toHaveLength(0);
		env.adapter.stop();
	});

	it("ignores pending reads after stop", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		let resolve!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		env.adapter.stop();
		resolve(event);
		await flush();
		expect(env.selections).toHaveLength(0);
	});

	it("guest collector extracts inputs and excludes passwords", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		const handlers = new Map<string, (event: unknown) => void>();
		const input = {
			type: "text",
			value: "hello world",
			selectionStart: 6,
			selectionEnd: 11,
			matches: () => true,
			getBoundingClientRect: () => ({ left: 12, bottom: 34 }),
		};
		const guest = {
			window: {} as Record<string, { read(): unknown }>,
			innerWidth: 800,
			innerHeight: 600,
			document: {
				activeElement: input,
				hasFocus: () => true,
				addEventListener: (type: string, listener: (event: unknown) => void) =>
					handlers.set(type, listener),
				removeEventListener: vi.fn(),
			},
		};
		runInNewContext(env.executeJavaScript.mock.calls[0]![0], guest);
		handlers.get("mouseup")?.({ clientX: 0, clientY: 0, shiftKey: true });
		expect(Object.values(guest.window)[0]!.read()).toMatchObject({
			text: "world",
			x: 12,
			y: 34,
			shiftKey: true,
		});
		input.type = "password";
		handlers.get("mouseup")?.({ clientX: 0, clientY: 0 });
		expect(Object.values(guest.window)[0]!.read()).toMatchObject({ text: "" });
		env.adapter.stop();
	});

	it("reinstalls and resets sequence on same-document navigation", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.executeJavaScript.mockResolvedValue(true);
		env.handlers.get("did-navigate-in-page")?.();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.selections).toHaveLength(2);
		expect(env.helper.getSnapshot().target).toEqual(expect.objectContaining({ text: "hello" }));
		env.adapter.stop();
	});

	it.each(["window blur", "host mousedown", "host focusin"])(
		"rejects a result completing after %s or visibility loss",
		async (interruption) => {
			const env = setup();
			env.adapter.start();
			await flush();
			let resolve!: (value: unknown) => void;
			env.executeJavaScript.mockReturnValueOnce(
				new Promise((done) => {
					resolve = done;
				}),
			);
			await vi.advanceTimersByTimeAsync(150);
			if (interruption === "window blur") env.windowHandlers.get("blur")?.();
			else
				env.hostHandlers.get(
					interruption === "host mousedown" ? "mousedown" : "focusin",
				)?.();
			resolve(event);
			await flush();
			expect(env.selections).toHaveLength(0);
			env.executeJavaScript.mockResolvedValue(event);
			await vi.advanceTimersByTimeAsync(150);
			expect(env.selections).toHaveLength(0);
			env.executeJavaScript.mockReturnValueOnce(
				new Promise((done) => {
					resolve = done;
				}),
			);
			await vi.advanceTimersByTimeAsync(150);
			env.document.visibilityState = "hidden";
			resolve({ ...event, sequence: 2 });
			await flush();
			expect(env.selections).toHaveLength(0);
			env.adapter.stop();
		},
	);

	it("replaces disabled collectors and does not revive their cached event", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		const oldReadScript = env.executeJavaScript.mock.calls[0]![0];
		env.isEnabled.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(150);
		expect(
			env.executeJavaScript.mock.calls.some(([code]) => code.includes("delete window.")),
		).toBe(true);
		env.executeJavaScript.mockResolvedValue(true);
		env.isEnabled.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(150);
		const newInstall =
			env.executeJavaScript.mock.calls[env.executeJavaScript.mock.calls.length - 1]![0];
		expect(newInstall).not.toBe(oldReadScript);
		env.executeJavaScript.mockResolvedValue(null);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.selections).toHaveLength(0);
		env.adapter.stop();
	});

	it("cleans an installation that completes after stop", async () => {
		const env = setup();
		let resolve!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		env.adapter.start();
		env.adapter.stop();
		const callsBefore = env.executeJavaScript.mock.calls.length;
		resolve(true);
		await flush();
		expect(env.executeJavaScript).toHaveBeenCalledTimes(callsBefore + 1);
		expect(env.executeJavaScript).toHaveBeenLastCalledWith(
			expect.stringContaining("delete window."),
		);
	});

	it("reports unavailable when the compatibility API cannot install", async () => {
		const env = setup();
		env.executeJavaScript.mockRejectedValue(new Error("not supported"));
		env.adapter.start();
		await flush();
		expect(env.onStatus).toHaveBeenCalledWith("unavailable");
		await vi.advanceTimersByTimeAsync(450);
		expect(env.executeJavaScript).toHaveBeenCalledOnce();
		env.adapter.stop();
	});

	it("reads selection when webview is focused even if document.hasFocus is false in Electron", async () => {
		const docHandlers = new Map<string, (e: any) => void>();
		const env = setup();
		(env.document as any).addEventListener = (type: string, fn: any) =>
			docHandlers.set(type, fn);
		(env.document as any).removeEventListener = vi.fn();
		env.adapter.start();
		await flush();

		// Simulate user clicking on the webview element
		docHandlers.get("mousedown")?.({ target: env.element });
		env.document.hasFocus.mockReturnValue(false);
		env.executeJavaScript.mockResolvedValue(event);

		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target).toEqual(
			expect.objectContaining({
				text: "hello",
				x: 90,
				y: 180,
			}),
		);
		env.adapter.stop();
	});

	it("guest collector preserves selection and updates coordinates on scroll within viewport", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		const handlers = new Map<string, (e: any) => void>();
		let rangeRect = { left: 20, bottom: 40, width: 100, height: 20 };
		const range = {
			getBoundingClientRect: () => rangeRect,
		};
		let selectionText = "hello";
		const selection = {
			toString: () => selectionText,
			rangeCount: 1,
			getRangeAt: () => range,
			anchorNode: { nodeType: 1, parentElement: null, closest: () => null },
		};
		const guest = {
			window: {
				getSelection: () => selection,
			} as Record<string, any>,
			innerWidth: 800,
			innerHeight: 600,
			document: {
				activeElement: null,
				hasFocus: () => true,
				addEventListener: (type: string, listener: any) => handlers.set(type, listener),
				removeEventListener: vi.fn(),
			},
		};
		runInNewContext(env.executeJavaScript.mock.calls[0]![0], guest);
		handlers.get("mouseup")?.({ clientX: 20, clientY: 40 });
		const collector = Object.values(guest.window).find(
			(val) => val && typeof val === "object" && typeof val.read === "function",
		)!;
		expect(collector.read()).toMatchObject({ text: "hello", x: 20, y: 40 });

		// Scroll slightly down
		rangeRect = { left: 20, bottom: 60, width: 100, height: 20 };
		handlers.get("scroll")?.({});
		expect(collector.read()).toMatchObject({
			text: "hello",
			x: 20,
			y: 60,
			reposition: true,
		});
		const afterScroll = collector.read().sequence;
		handlers.get("mouseup")?.({ clientX: 20, clientY: 60 });
		expect(collector.read().sequence).toBeGreaterThan(afterScroll);
		expect(collector.read()).toMatchObject({ captureSequence: 1, reposition: true });
		selectionText = "world";
		handlers.get("mouseup")?.({ clientX: 20, clientY: 60 });
		handlers.get("scroll")?.({});
		expect(collector.read()).toMatchObject({
			text: "world",
			captureSequence: 2,
			reposition: true,
		});

		// Scroll completely out of view
		rangeRect = { left: 20, bottom: -10, width: 100, height: 20 };
		handlers.get("scroll")?.({});
		expect(collector.read()).toMatchObject({ text: "", shouldDismiss: false });
		handlers.get("keydown")?.({ key: "Escape" });
		expect(collector.read()).toMatchObject({ text: "", shouldDismiss: true });

		env.adapter.stop();
	});
	it.each(["another window", "DOM selection"])(
		"consumes a pending guest event superseded by %s without replay",
		async () => {
			const env = setup();
			env.adapter.start();
			await flush();
			let resolve!: (value: unknown) => void;
			env.executeJavaScript.mockReturnValueOnce(
				new Promise((done) => {
					resolve = done;
				}),
			);
			await vi.advanceTimersByTimeAsync(150);
			const other = env.helper.openSource({});
			other.capture().submit({ ...event, text: "new", eligibleContext: true });
			resolve(event);
			await flush();
			expect(env.helper.getSnapshot().target?.text).toBe("new");
			env.executeJavaScript.mockResolvedValue(event);
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().target?.text).toBe("new");
			env.executeJavaScript.mockResolvedValue({ ...event, sequence: 2, text: "fresh" });
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().target?.text).toBe("fresh");
			env.adapter.stop();
		},
	);

	it("does not revive a pending read after helper dismissal and releases lookup", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		let resolve!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.dismiss();
		resolve({ ...event, sequence: 2 });
		await flush();
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.executeJavaScript.mockResolvedValue({ ...event, sequence: 2 });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.adapter.stop();
	});

	it("lets a new page read while an old page hangs and preserves new single-flight state", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		let resolveOld!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolveOld = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		env.executeJavaScript.mockResolvedValue(true);
		env.handlers.get("dom-ready")?.();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		const target = env.helper.getSnapshot().target;
		expect(target?.text).toBe("hello");
		let resolveNew!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolveNew = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		resolveOld({ ...event, text: "", sequence: 2 });
		await flush();
		expect(env.helper.getSnapshot().target).toBe(target);
		const calls = env.executeJavaScript.mock.calls.length;
		await vi.advanceTimersByTimeAsync(450);
		expect(env.executeJavaScript).toHaveBeenCalledTimes(calls);
		resolveNew({ ...event, text: "new", sequence: 2 });
		await flush();
		expect(env.helper.getSnapshot().target?.text).toBe("new");
		env.adapter.stop();
	});

	it("keeps installation alive across host interaction and cleans only an obsolete page key", async () => {
		const env = setup();
		let resolveOld!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolveOld = done;
			}),
		);
		env.adapter.start();
		const oldKey = env.executeJavaScript.mock.calls[0]![0].match(
			/window\.(__studyStudioSelectionCollector_\w+)/,
		)![1];
		env.executeJavaScript.mockResolvedValue(true);
		env.handlers.get("dom-ready")?.();
		await flush();
		env.hostHandlers.get("mousedown")?.();
		resolveOld(true);
		await flush();
		expect(env.executeJavaScript).toHaveBeenLastCalledWith(
			expect.stringContaining(`delete window.${oldKey}`),
		);
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target?.text).toBe("hello");
		env.adapter.stop();
	});
	it("keeps an owned lookup after a guest clears its selection", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		env.executeJavaScript.mockResolvedValue({ ...event, sequence: 2, text: "" });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot()).toMatchObject({ visible: true, mode: "slot" });
		env.executeJavaScript.mockResolvedValue({ ...event, sequence: 3, text: "world" });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { text: "world" },
		});
		env.adapter.stop();
	});
	it("keeps the dictionary popup when guest scrolling only repositions its selection", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		env.executeJavaScript.mockResolvedValue({
			...event,
			sequence: 2,
			y: 80,
			reposition: true,
		});
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot()).toMatchObject({ visible: true, mode: "slot" });
		env.adapter.stop();
	});
	it("accepts a new guest selection even if it scrolls before the next poll", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		env.executeJavaScript.mockResolvedValue({
			...event,
			sequence: 3,
			captureSequence: 2,
			text: "world",
			y: 80,
			reposition: true,
		});
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { text: "world" },
		});
		env.adapter.stop();
	});
	it("closes the dictionary popup when the guest reports Escape", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		env.executeJavaScript.mockResolvedValue({
			...event,
			sequence: 2,
			text: "",
			shouldDismiss: true,
		});
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.adapter.stop();
	});
	it.each(["failure", "stop"])("releases an owned lookup on %s", async (reason) => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		if (reason === "stop") env.adapter.stop();
		else {
			env.executeJavaScript.mockRejectedValueOnce(new Error("gone"));
			await vi.advanceTimersByTimeAsync(150);
		}
		expect(env.helper.getSnapshot().visible).toBe(false);
		env.adapter.stop();
	});

	it("finishes a pending installation across a host interruption", async () => {
		const env = setup();
		let resolve!: (value: unknown) => void;
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		env.adapter.start();
		env.hostHandlers.get("focusin")?.();
		resolve(true);
		await flush();
		expect(env.onStatus).toHaveBeenLastCalledWith("available");
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target?.text).toBe("hello");
		env.adapter.stop();
	});
	it.each(["stop", "remove", "restart"])(
		"ignores released source callbacks after %s",
		async (release) => {
			const env = setup();
			env.adapter.start();
			await flush();
			const oldReady = env.handlers.get("dom-ready")!;
			const oldNavigate = env.handlers.get("did-start-loading")!;
			if (release === "remove") env.remove();
			else env.adapter.stop();
			if (release === "restart") {
				env.adapter.start();
				await flush();
			}
			const calls = env.executeJavaScript.mock.calls.length;
			const sources = env.openSource.mock.calls.length;
			oldReady();
			oldNavigate();
			await flush();
			expect(env.executeJavaScript).toHaveBeenCalledTimes(calls);
			expect(env.openSource).toHaveBeenCalledTimes(sources);
			expect(env.helper.getSnapshot().visible).toBe(false);
			if (release === "restart") {
				env.executeJavaScript.mockResolvedValue(event);
				await vi.advanceTimersByTimeAsync(150);
				expect(env.helper.getSnapshot().target?.text).toBe("hello");
			}
			env.adapter.stop();
		},
	);

	it("ignores a queued poll after stop", async () => {
		const interval = vi.spyOn(globalThis, "setInterval");
		const env = setup();
		env.adapter.start();
		await flush();
		const queuedPoll = interval.mock.calls[interval.mock.calls.length - 1]![0] as () => void;
		env.adapter.stop();
		const calls = env.executeJavaScript.mock.calls.length;
		const sourceCalls = env.openSource.mock.calls.length;
		env.isEnabled.mockClear();
		queuedPoll();
		expect(env.isEnabled).not.toHaveBeenCalled();
		expect(env.executeJavaScript).toHaveBeenCalledTimes(calls);
		expect(env.openSource).toHaveBeenCalledTimes(sourceCalls);
		interval.mockRestore();
	});

	it("backs off polling interval on window blur and wakes up on window focus or host input", async () => {
		const intervalSpy = vi.spyOn(globalThis, "setInterval");
		const env = setup();
		env.adapter.start();
		await flush();

		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 150);

		// Window loses focus -> interval increases to 1000ms
		env.windowHandlers.get("blur")?.();
		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 1000);

		// Window regains focus -> wakes up to 150ms
		env.windowHandlers.get("focus")?.();
		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 150);

		// Blur again, then user clicks in host -> wakes up to 150ms
		env.windowHandlers.get("blur")?.();
		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 1000);
		env.hostHandlers.get("mousedown")?.();
		expect(intervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 150);

		env.adapter.stop();
		intervalSpy.mockRestore();
	});

	it.each(
		["DOM", "input"].flatMap((kind) =>
			["focused", "unfocused", "blurred", "refocused"].map((focus) => ({ kind, focus })),
		),
	)(
		"dismisses a disconnected guest $kind origin when $focus while preserving snapshots",
		async ({ kind, focus }) => {
			const env = setup();
			const handlers = new Map<string, (event: unknown) => void>();
			const origin = {
				isConnected: true,
				nodeType: 1,
				closest: () => null,
				matches: () => true,
				type: "text",
				value: "hello",
				textContent: "hello",
				selectionStart: 0,
				selectionEnd: 5,
				getBoundingClientRect: () => ({ left: 20, bottom: 40 }),
			};
			let selectedText = "hello";
			const guest = {
				window: {
					getSelection: () => ({
						toString: () => selectedText,
						anchorNode: origin,
						rangeCount: 1,
						getRangeAt: () => ({
							getBoundingClientRect: () => ({ left: 20, bottom: 40 }),
						}),
					}),
				} as Record<string, any>,
				innerWidth: 200,
				innerHeight: 150,
				document: {
					activeElement: kind === "input" ? origin : null,
					hasFocus: vi.fn(() => true),
					addEventListener: (type: string, callback: (event: unknown) => void) =>
						handlers.set(type, callback),
					removeEventListener: vi.fn(),
				},
			};
			env.executeJavaScript.mockImplementation(async (code) => runInNewContext(code, guest));
			env.adapter.start();
			await flush();
			handlers.get("mouseup")?.({});
			const collector = Object.values(guest.window).find(
				(value) => typeof value?.read === "function",
			)!;
			const initial = { ...collector.read() };
			await vi.advanceTimersByTimeAsync(150);
			env.helper.beginLookup();
			origin.value = "changed";
			origin.textContent = "changed";
			selectedText = "changed";
			expect(collector.read()).toMatchObject(initial);
			selectedText = "";
			handlers.get("copy")?.({});
			expect(collector.read()).toMatchObject(initial);
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().target?.text).toBe("hello");
			if (focus !== "focused") {
				guest.document.hasFocus.mockReturnValue(false);
				if (focus === "blurred" || focus === "refocused") handlers.get("blur")?.({});
				env.hostHandlers.get("focusin")?.();
				await vi.advanceTimersByTimeAsync(150);
				if (focus === "refocused") {
					guest.document.hasFocus.mockReturnValue(true);
					await vi.advanceTimersByTimeAsync(150);
				}
				expect(env.helper.getSnapshot().mode).toBe("slot");
				expect(env.helper.getSnapshot().target?.text).toBe("hello");
				expect(env.selections).toHaveLength(1);
			}
			handlers.get("mousedown")?.({});
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().mode).toBe("slot");
			origin.isConnected = false;
			const cleared = collector.read();
			expect(cleared.text).toBe("");
			expect(cleared.sequence).toBeGreaterThan(initial.sequence);
			if (focus === "blurred") handlers.get("blur")?.({});
			expect(collector.read().sequence).toBe(cleared.sequence);
			await vi.advanceTimersByTimeAsync(150);
			expect(env.helper.getSnapshot().visible).toBe(false);
			env.adapter.stop();
		},
	);

	it("does not let a pending disconnected guest origin dismiss a newer source", async () => {
		const env = setup();
		const handlers = new Map<string, (event: unknown) => void>();
		const origin = { isConnected: true, nodeType: 1, closest: () => null };
		const guest = {
			window: {
				getSelection: () => ({
					toString: () => "hello",
					anchorNode: origin,
					rangeCount: 1,
					getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 20, bottom: 40 }) }),
				}),
			},
			innerWidth: 200,
			innerHeight: 150,
			document: {
				activeElement: null,
				hasFocus: () => true,
				addEventListener: (type: string, callback: (event: unknown) => void) =>
					handlers.set(type, callback),
				removeEventListener: vi.fn(),
			},
		};
		env.executeJavaScript.mockImplementation(async (code) => runInNewContext(code, guest));
		env.adapter.start();
		await flush();
		handlers.get("mouseup")?.({});
		await vi.advanceTimersByTimeAsync(150);
		env.helper.beginLookup();
		let resolve!: () => void;
		env.executeJavaScript.mockImplementationOnce(
			(code) =>
				new Promise((done) => {
					resolve = () => done(runInNewContext(code, guest));
				}),
		);
		await vi.advanceTimersByTimeAsync(150);
		origin.isConnected = false;
		env.helper
			.openSource({})
			.capture()
			.submit({ ...event, text: "new", eligibleContext: true });
		env.helper.beginLookup();
		resolve();
		await flush();
		expect(env.helper.getSnapshot().target?.text).toBe("new");
		expect(env.helper.getSnapshot().mode).toBe("slot");
		await vi.advanceTimersByTimeAsync(150);
		expect(env.helper.getSnapshot().target?.text).toBe("new");
		env.adapter.stop();
	});
});
