import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineSandboxDocument, sandboxDocumentSource } from "../sandbox-document/document";
import { createDictionarySandboxHost } from "../sandbox-document/host";
import { prepareDictionarySandboxDocument } from "../sandbox-document/prepare";
import { createSandboxEnvelope } from "../sandbox-document/protocol";

function documentHandle(identity = "entry") {
	return defineSandboxDocument(
		identity,
		'<!doctype html><html data-obsidian-tools-dictionary-theme="light"><head></head><body>entry</body></html>',
	);
}

function harness() {
	const listeners = new Set<(event: MessageEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
			listeners.delete(listener),
	});
	const source = { postMessage: vi.fn() };
	const frame = {
		contentWindow: source,
		style: {},
		dataset: {},
		srcdoc: "",
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	} as unknown as HTMLIFrameElement;
	return {
		frame,
		listeners,
		source,
		send: (data: unknown, sender: unknown = source) => {
			for (const listener of listeners) listener({ data, source: sender } as MessageEvent);
		},
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("assistant sandbox close bridge", () => {
	it("seeds assistant mode and theme per host without changing the shared document", () => {
		const document = documentHandle();
		const h = harness();
		const host = createDictionarySandboxHost({
			initialTheme: "dark",
			openEntry: vi.fn(),
			onClose: vi.fn(),
		});
		host.register(h.frame, document);
		expect(h.frame.srcdoc).toContain('dictionary-theme="dark" style="color-scheme:dark"');
		expect(h.frame.srcdoc).toContain('dictionary-close-on-escape="true"');
		expect(sandboxDocumentSource(document, "light")).not.toContain("close-on-escape");
		host.setTheme("light");
		expect(h.source.postMessage).toHaveBeenLastCalledWith(
			createSandboxEnvelope("entry", "set-theme", { theme: "light" }),
			"*",
		);
		host.dispose();
	});

	it("accepts close only from the current frame, document, version and null payload", () => {
		const h = harness();
		const close = vi.fn();
		const host = createDictionarySandboxHost({ openEntry: vi.fn(), onClose: close });
		host.register(h.frame, documentHandle());
		const envelope = createSandboxEnvelope("entry", "request-close", null);
		h.send(envelope, {});
		h.send({ ...envelope, documentId: "other" });
		h.send({ ...envelope, version: 2 });
		h.send({ ...envelope, channel: "other" });
		h.send({ ...envelope, payload: {} });
		expect(close).not.toHaveBeenCalled();
		h.send(envelope);
		expect(close).toHaveBeenCalledTimes(1);
		host.register(h.frame, documentHandle("next"));
		h.send(envelope);
		expect(close).toHaveBeenCalledTimes(1);
		host.unregister(h.frame);
		h.send(createSandboxEnvelope("next", "request-close", null));
		expect(close).toHaveBeenCalledTimes(1);
		host.register(h.frame, documentHandle("next"));
		const lateListener = [...h.listeners][0]!;
		host.dispose();
		lateListener({
			data: createSandboxEnvelope("next", "request-close", null),
			source: h.source,
		} as unknown as MessageEvent);
		expect(close).toHaveBeenCalledTimes(1);
		expect(h.listeners.size).toBe(0);
	});

	it("leaves main dictionary close requests disabled", () => {
		const h = harness();
		const host = createDictionarySandboxHost({ openEntry: vi.fn() });
		host.register(h.frame, documentHandle());
		expect(h.frame.srcdoc).not.toContain("close-on-escape");
		h.send(createSandboxEnvelope("entry", "request-close", null));
		host.dispose();
	});

	it.each(["close", "unregister", "replace", "dispose"])("stops host audio on %s", (action) => {
		const h = harness();
		const pause = vi.fn();
		const audio = {
			pause,
			currentTime: 10,
			play: vi.fn(async () => undefined),
			addEventListener: vi.fn(),
		};
		vi.stubGlobal(
			"Audio",
			class {
				constructor() {
					return audio;
				}
			},
		);
		const host = createDictionarySandboxHost({ openEntry: vi.fn(), onClose: vi.fn() });
		host.register(h.frame, documentHandle());
		h.send(
			createSandboxEnvelope("entry", "play-audio", { src: "data:audio/mpeg;base64,YQ==" }),
		);
		if (action === "close") h.send(createSandboxEnvelope("entry", "request-close", null));
		if (action === "unregister") host.unregister(h.frame);
		if (action === "replace") host.register(h.frame, documentHandle("next"));
		if (action === "dispose") host.dispose();
		expect(pause).toHaveBeenCalledTimes(1);
		expect(audio.currentTime).toBe(0);
		host.dispose();
	});

	it.each([false, true])(
		"emits Escape only in assistant mode: %s, and leaves Enter untouched",
		async (assistant) => {
			// Empty parsed content exercises the real generated bootstrap without a browser dependency.
			vi.stubGlobal(
				"DOMParser",
				class {
					parseFromString() {
						return {
							querySelectorAll: () => [],
							body: { innerHTML: "", querySelectorAll: () => [] },
						};
					}
				},
			);
			const document = await prepareDictionarySandboxDocument("", async () => null);
			const source = sandboxDocumentSource(document, "dark", assistant);
			const script =
				/<script nonce="[^"]+">(if\(document\.documentElement[\s\S]*?)<\/script>/.exec(
					source,
				)?.[1];
			expect(script).toBeDefined();
			const listeners: Array<
				(event: { key: string; isComposing: boolean; preventDefault: () => void }) => void
			> = [];
			const postMessage = vi.fn();
			const doc = {
				documentElement: { getAttribute: () => (assistant ? "true" : null) },
				addEventListener: (_: string, listener: (typeof listeners)[number]) =>
					listeners.push(listener),
			};
			runInNewContext(script!, { document: doc, parent: { postMessage } });
			const preventDefault = vi.fn();
			for (const listener of listeners) {
				listener({ key: "Enter", isComposing: false, preventDefault });
				listener({ key: "Escape", isComposing: true, preventDefault });
			}
			expect(postMessage).not.toHaveBeenCalled();
			expect(preventDefault).not.toHaveBeenCalled();
			for (const listener of listeners)
				listener({ key: "Escape", isComposing: false, preventDefault });
			expect(postMessage).toHaveBeenCalledTimes(assistant ? 1 : 0);
			if (assistant)
				expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
					action: "request-close",
					payload: null,
					version: 1,
				});
		},
	);
});

describe("stacked sandbox content fitting", () => {
	it("seeds fitting only for configured hosts and restores the original height", () => {
		const h = harness();
		h.frame.style.height = "77px";
		const document = documentHandle();
		const host = createDictionarySandboxHost({ openEntry: vi.fn(), fitContent: true });
		host.register(h.frame, document);
		expect(h.frame.srcdoc).toContain('dictionary-fit-content="true"');
		expect(h.frame.style.height).toBe("120px");
		expect(sandboxDocumentSource(document, "dark")).not.toContain("fit-content");
		h.send(createSandboxEnvelope("entry", "content-height", 800));
		expect(h.frame.style.height).toBe("800px");
		host.unregister(h.frame);
		expect(h.frame.style.height).toBe("77px");
		host.dispose();
		const normalHost = createDictionarySandboxHost({ openEntry: vi.fn() });
		normalHost.register(h.frame, document);
		h.send(createSandboxEnvelope("entry", "content-height", 800));
		expect(h.frame.style.height).toBe("77px");
		normalHost.dispose();
	});

	it("rejects invalid, spoofed and obsolete heights", () => {
		const h = harness();
		const host = createDictionarySandboxHost({ openEntry: vi.fn(), fitContent: true });
		host.register(h.frame, documentHandle());
		const envelope = createSandboxEnvelope("entry", "content-height", 600);
		for (const payload of [NaN, Infinity, -1, 0, 2.5, 8193, "600", null, { height: 600 }]) {
			h.send({ ...envelope, payload });
		}
		h.send(envelope, {});
		h.send({ ...envelope, documentId: "other" });
		h.send({ ...envelope, version: 2 });
		expect(h.frame.style.height).toBe("120px");
		h.send(envelope);
		expect(h.frame.style.height).toBe("600px");
		host.register(h.frame, documentHandle("next"));
		h.send(envelope);
		expect(h.frame.style.height).toBe("120px");
		host.unregister(h.frame);
		h.send(createSandboxEnvelope("next", "content-height", 900));
		expect(h.frame.style.height).toBe("");
		host.register(h.frame, documentHandle("next"));
		const lateListener = [...h.listeners][0]!;
		host.dispose();
		lateListener({
			data: createSandboxEnvelope("next", "content-height", 900),
			source: h.source,
		} as unknown as MessageEvent);
		expect(h.frame.style.height).toBe("");
	});

	it.each([false, true])(
		"coalesces content/image/font changes only in fit mode: %s",
		async (fitContent) => {
			vi.stubGlobal(
				"DOMParser",
				class {
					parseFromString() {
						return {
							querySelectorAll: () => [],
							body: { innerHTML: "", querySelectorAll: () => [] },
						};
					}
				},
			);
			const document = await prepareDictionarySandboxDocument("", async () => null);
			const source = sandboxDocumentSource(document, "dark", false, fitContent);
			const script =
				/<script nonce="[^"]+">(\(\(\)=>\{\nif\(document\.documentElement[\s\S]*?)<\/script>/.exec(
					source,
				)?.[1];
			expect(script).toBeDefined();
			expect(source).toContain(
				"height:auto!important;min-height:0!important;max-height:none!important",
			);
			const callbacks = new Map<string, () => void>();
			const frames = new Map<number, () => void>();
			let frameId = 0;
			let resizeCallback = () => {};
			let mutationCallback = () => {};
			const resizeDisconnect = vi.fn();
			const mutationDisconnect = vi.fn();
			vi.stubGlobal(
				"ResizeObserver",
				class {
					constructor(callback: () => void) {
						resizeCallback = callback;
					}
					observe() {}
					disconnect = resizeDisconnect;
				},
			);
			vi.stubGlobal(
				"MutationObserver",
				class {
					constructor(callback: () => void) {
						mutationCallback = callback;
					}
					observe() {}
					disconnect = mutationDisconnect;
				},
			);
			const postMessage = vi.fn();
			const setAttribute = vi.fn();
			const body = { scrollHeight: 300, getBoundingClientRect: () => ({ height: 300 }) };
			const doc = {
				body,
				readyState: "complete",
				documentElement: { getAttribute: () => (fitContent ? "true" : null), setAttribute },
				addEventListener: (name: string, callback: () => void) =>
					callbacks.set(name, callback),
				removeEventListener: vi.fn(),
				fonts: {
					addEventListener: (name: string, callback: () => void) =>
						callbacks.set(name, callback),
					removeEventListener: vi.fn(),
					ready: Promise.resolve(),
				},
			};
			runInNewContext(script!, {
				document: doc,
				parent: { postMessage },
				ResizeObserver,
				MutationObserver,
				getComputedStyle: () => ({ marginTop: "8px", marginBottom: "8px" }),
				requestAnimationFrame: (callback: () => void) => {
					frames.set(++frameId, callback);
					return frameId;
				},
				cancelAnimationFrame: (id: number) => frames.delete(id),
				addEventListener: (name: string, callback: () => void) =>
					callbacks.set(name, callback),
				removeEventListener: vi.fn(),
			});
			await Promise.resolve();
			callbacks.get("load")?.();
			resizeCallback();
			mutationCallback();
			callbacks.get("loadingdone")?.();
			expect(frames.size).toBe(fitContent ? 1 : 0);
			function flush() {
				const pending = [...frames.values()];
				frames.clear();
				for (const callback of pending) callback();
			}
			flush();
			expect(postMessage).toHaveBeenCalledTimes(fitContent ? 1 : 0);
			if (!fitContent) return;
			expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
				action: "content-height",
				payload: 316,
			});
			body.scrollHeight = 500;
			callbacks.get("load")?.();
			mutationCallback();
			flush();
			expect(postMessage.mock.calls[1]?.[0]).toMatchObject({ payload: 516 });
			resizeCallback();
			flush();
			expect(postMessage).toHaveBeenCalledTimes(2);
			body.scrollHeight = 2_000_000;
			callbacks.get("loadingdone")?.();
			flush();
			expect(postMessage.mock.calls[2]?.[0]).toMatchObject({ payload: 8192 });
			expect(setAttribute).toHaveBeenCalledWith(
				"data-obsidian-tools-dictionary-fit-bounded",
				"true",
			);
			mutationCallback();
			callbacks.get("pagehide")?.();
			expect(frames.size).toBe(0);
			expect(resizeDisconnect).toHaveBeenCalledOnce();
			expect(mutationDisconnect).toHaveBeenCalledOnce();
			resizeCallback();
			expect(frames.size).toBe(0);
		},
	);
});

describe("sandbox fit convergence", () => {
	it.each(["viewport-dependent", "huge", "fixed"] as const)(
		"bounds %s layout without losing access to overflowing content",
		async (layout) => {
			vi.stubGlobal(
				"DOMParser",
				class {
					parseFromString() {
						return {
							querySelectorAll: () => [],
							body: { innerHTML: "", querySelectorAll: () => [] },
						};
					}
				},
			);
			const document = await prepareDictionarySandboxDocument("", async () => null);
			const source = sandboxDocumentSource(document, "light", false, true);
			const script =
				/<script nonce="[^"]+">(\(\(\)=>\{\nif\(document\.documentElement[\s\S]*?)<\/script>/.exec(
					source,
				)?.[1];
			expect(script).toBeDefined();
			const attributes = new Map([["data-obsidian-tools-dictionary-fit-content", "true"]]);
			const callbacks = new Map<string, () => void>();
			const pending = new Map<number, () => void>();
			let nextFrame = 0;
			let viewportHeight = 120;
			let resize = () => {};
			const resizeDisconnect = vi.fn();
			const mutationDisconnect = vi.fn();
			const bodyHeight = () =>
				layout === "viewport-dependent" ? viewportHeight : layout === "huge" ? 10000 : 300;
			const postMessage = vi.fn((envelope: { payload: number }) => {
				viewportHeight = envelope.payload;
				// A .entry { min-height:100vh } body plus its 8px margins
				// grows after each iframe resize unless the bridge detects feedback.
				resize();
				callbacks.get("resize")?.();
			});
			runInNewContext(script!, {
				document: {
					readyState: "complete",
					documentElement: {
						getAttribute: (name: string) => attributes.get(name),
						setAttribute: (name: string, value: string) => attributes.set(name, value),
					},
					body: {
						get scrollHeight() {
							return bodyHeight();
						},
						getBoundingClientRect: () => ({ height: bodyHeight() }),
					},
					addEventListener: (name: string, callback: () => void) =>
						callbacks.set(name, callback),
					removeEventListener: vi.fn(),
				},
				parent: { postMessage },
				getComputedStyle: () => ({ marginTop: "8px", marginBottom: "8px" }),
				ResizeObserver: class {
					constructor(callback: () => void) {
						resize = callback;
					}
					observe() {}
					disconnect = resizeDisconnect;
				},
				MutationObserver: class {
					observe() {}
					disconnect = mutationDisconnect;
				},
				requestAnimationFrame: (callback: () => void) => {
					pending.set(++nextFrame, callback);
					return nextFrame;
				},
				cancelAnimationFrame: (id: number) => pending.delete(id),
				addEventListener: (name: string, callback: () => void) =>
					callbacks.set(name, callback),
				removeEventListener: vi.fn(),
			});
			for (let round = 0; round < 20 && pending.size; round++) {
				const frames = [...pending.values()];
				pending.clear();
				for (const callback of frames) callback();
			}
			expect(pending.size).toBe(0);
			expect(viewportHeight).toBeLessThanOrEqual(8192);
			expect(postMessage.mock.calls.length).toBeLessThanOrEqual(8);
			if (layout === "fixed") {
				expect(postMessage).toHaveBeenCalledOnce();
				expect(viewportHeight).toBe(316);
				expect(attributes.has("data-obsidian-tools-dictionary-fit-bounded")).toBe(false);
				expect(resizeDisconnect).not.toHaveBeenCalled();
			} else {
				expect(attributes.get("data-obsidian-tools-dictionary-fit-bounded")).toBe("true");
				expect(resizeDisconnect).toHaveBeenCalledOnce();
				expect(mutationDisconnect).toHaveBeenCalledOnce();
				expect(source).toContain(
					'html[data-obsidian-tools-dictionary-fit-bounded="true"]{overflow-y:auto!important}',
				);
				expect(source).toContain(
					'html[data-obsidian-tools-dictionary-fit-bounded="true"] body{overflow-y:visible!important}',
				);
				if (layout === "huge") expect(viewportHeight).toBe(8192);
				if (layout === "viewport-dependent") expect(postMessage).toHaveBeenCalledTimes(8);
				resize();
				callbacks.get("load")?.();
				expect(pending.size).toBe(0);
			}
			callbacks.get("pagehide")?.();
		},
	);
});
