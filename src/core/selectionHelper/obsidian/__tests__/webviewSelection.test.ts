import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WebviewSelectionAdapter } from "../webviewSelection";

function setup() {
	const handlers = new Map<string, () => void>();
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
	const document = {
		querySelectorAll: () => elements,
		activeElement: element as object | null,
		hasFocus: vi.fn(() => true),
		visibilityState: "visible",
		defaultView: { innerWidth: 1000, innerHeight: 1000 },
	};
	const onSelection = vi.fn();
	const onDismiss = vi.fn();
	const onStatus = vi.fn();
	const isEnabled = vi.fn(() => true);
	const adapter = new WebviewSelectionAdapter({
		document: document as unknown as Document,
		onSelection,
		onDismiss,
		onStatus,
		isEnabled,
	});
	return {
		adapter,
		document,
		element,
		handlers,
		executeJavaScript,
		onSelection,
		onDismiss,
		onStatus,
		isEnabled,
		remove: () => {
			elements = [];
		},
	};
}

const event = {
	sequence: 1,
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

	it("reads focused webview selections and converts guest viewport coordinates", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		expect(env.onStatus).toHaveBeenCalledWith("available");
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "hello",
				x: 90,
				y: 180,
				trigger: "mouse",
				altKey: true,
				sourceId: expect.stringMatching(/^webview-/),
				generation: 0,
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onSelection).toHaveBeenCalledOnce();
		env.adapter.stop();
	});

	it("stops reading while unfocused, hidden, disabled, or another element is focused", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.document.hasFocus.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(300);
		env.document.hasFocus.mockReturnValue(true);
		env.document.visibilityState = "hidden";
		await vi.advanceTimersByTimeAsync(150);
		env.document.visibilityState = "visible";
		env.isEnabled.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(150);
		env.isEnabled.mockReturnValue(true);
		env.document.activeElement = null;
		await vi.advanceTimersByTimeAsync(150);
		expect(env.executeJavaScript).toHaveBeenCalledTimes(4);
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
		expect(env.onSelection).not.toHaveBeenCalled();
		env.executeJavaScript.mockResolvedValue(true);
		env.handlers.get("dom-ready")?.();
		await flush();
		env.executeJavaScript.mockResolvedValue(event);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onSelection).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }));
		env.adapter.stop();
	});

	it("dismisses only its source on guest clearing, failure, and teardown", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		env.executeJavaScript.mockResolvedValue({ ...event, text: "" });
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onDismiss).toHaveBeenCalledWith(expect.stringMatching(/^webview-/), 0);
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
		expect(env.onSelection).not.toHaveBeenCalled();
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
		expect(env.onSelection).not.toHaveBeenCalled();
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
		expect(env.onSelection).toHaveBeenCalledTimes(2);
		expect(env.onSelection).toHaveBeenLastCalledWith(
			expect.objectContaining({ generation: 1 }),
		);
		env.adapter.stop();
	});

	it("rejects a result completing after focus or visibility is lost", async () => {
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
		env.document.hasFocus.mockReturnValue(false);
		resolve(event);
		await flush();
		expect(env.onSelection).not.toHaveBeenCalled();
		env.document.hasFocus.mockReturnValue(true);
		env.executeJavaScript.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		await vi.advanceTimersByTimeAsync(150);
		env.document.visibilityState = "hidden";
		resolve(event);
		await flush();
		expect(env.onSelection).not.toHaveBeenCalled();
		env.adapter.stop();
	});

	it("removes disabled collectors and does not revive their cached event", async () => {
		const env = setup();
		env.adapter.start();
		await flush();
		const oldReadScript = env.executeJavaScript.mock.calls[0]![0];
		env.isEnabled.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.executeJavaScript).toHaveBeenLastCalledWith(
			expect.stringContaining("delete window."),
		);
		env.executeJavaScript.mockResolvedValue(true);
		env.isEnabled.mockReturnValue(true);
		await vi.advanceTimersByTimeAsync(150);
		const newInstall =
			env.executeJavaScript.mock.calls[env.executeJavaScript.mock.calls.length - 1]![0];
		expect(newInstall).not.toBe(oldReadScript);
		env.executeJavaScript.mockResolvedValue(null);
		await vi.advanceTimersByTimeAsync(150);
		expect(env.onSelection).not.toHaveBeenCalled();
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
		expect(env.onSelection).toHaveBeenCalledWith(
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
		const selection = {
			toString: () => "hello",
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
		expect(collector.read()).toMatchObject({ text: "hello", x: 20, y: 60 });

		// Scroll completely out of view
		rangeRect = { left: 20, bottom: -10, width: 100, height: 20 };
		handlers.get("scroll")?.({});
		expect(collector.read()).toMatchObject({ text: "" });

		env.adapter.stop();
	});
});
