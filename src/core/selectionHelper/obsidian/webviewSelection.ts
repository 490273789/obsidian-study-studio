import { isEnglishWordOrPhrase } from "../domain/selectionHelper";
import type { SelectionSource, SelectionSourceLease } from "../domain/types";

export type WebviewSelectionStatus = "idle" | "available" | "unavailable";

/** Guest selections never reach the host, so an embedded page is polled on a timer. */
const WEBVIEW_POLL_INTERVAL_MS = 150;

interface WebviewElement extends HTMLElement {
	executeJavaScript(code: string): Promise<unknown>;
}

interface GuestEvent {
	sequence: number;
	captureSequence: number;
	text: string;
	shouldDismiss?: boolean;
	reposition?: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
	altKey: boolean;
	shiftKey: boolean;
	ctrlOrMetaKey: boolean;
}

interface Page {
	lease: SelectionSourceLease;
	key: string;
	sequence: number;
	captureSequence: number;
	ready: boolean;
	failed: boolean;
	busy: boolean;
	manualRead: object | null;
	manualOrigin: boolean;
}

interface Source {
	element: WebviewElement;
	page: Page;
	cleanup: () => void;
}

interface WebviewSelectionOptions {
	document: Document;
	openSource(): SelectionSourceLease;
	interrupt(): void;
	isDictionaryPopup(): boolean;
	onStatus(status: WebviewSelectionStatus): void;
	isEnabled(): boolean;
	openDictionary?(
		source: SelectionSource,
		candidate?: { text: string; x: number; y: number },
	): void;
}

let nextPage = 0;
const collectorKey = "__studyStudioSelectionCollector";
const removeCollector = `(() => { window.${collectorKey}?.dispose(); delete window.${collectorKey}; delete window.${collectorKey}_manualOrigin; })()`;

// Fixed code only: no host objects, credentials, Node integration, or selected text
// are interpolated into the guest's JavaScript context.
const installCollector = `(() => {
	window.${collectorKey}?.dispose();
	let sequence = 0;
	let captureSequence = 0;
	let latest = null;
	let origin = null;
	let selectionIdentity = null;
	const handlers = [];
	const record = (text, x, y, event, shouldDismiss = false, reposition = false) => {
		if (text && !reposition) captureSequence++;
		latest = { sequence: ++sequence, captureSequence,
			text, shouldDismiss, reposition, x, y, width: innerWidth, height: innerHeight,
			altKey: !!event?.altKey, shiftKey: !!event?.shiftKey,
			ctrlOrMetaKey: !!(event?.ctrlKey || event?.metaKey) };
	};
	// Ordinary clears retain the displayed source node so later removal still expires it.
	const clear = () => { record('', 0, 0); };
	const close = () => { origin = null; selectionIdentity = null; record('', 0, 0, null, true); };
	const sameSelection = (a, b) => a && b && a.node === b.node &&
		a.focusNode === b.focusNode && a.start === b.start && a.end === b.end && a.text === b.text;
	// Losing focus suppresses selection replay, but the displayed snapshot still
	// needs its origin tracked. Preserve pending expiry events as well.
	const suppressSelection = () => { if (latest?.text) latest = null; };
	const capture = (event) => {
		if (!document.hasFocus()) return;
		const active = document.activeElement;
		let capturedOrigin = null;
		let identity = null;
		let text = '', x = event?.clientX ?? 0, y = event?.clientY ?? 0;
		if (active?.matches('input,textarea')) {
			if (active.type === 'password') { clear(); return; }
			capturedOrigin = active;
			if (typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number') {
				text = active.value.slice(active.selectionStart, active.selectionEnd);
				identity = { node: active, focusNode: active, start: active.selectionStart,
					end: active.selectionEnd, text: text.trim() };
				const rect = active.getBoundingClientRect();
				if (rect) { x = rect.left; y = rect.bottom; }
			}
		} else {
			const selection = window.getSelection();
			text = selection?.toString() || '';
			const node = selection?.anchorNode;
			capturedOrigin = node;
			identity = { node, focusNode: selection?.focusNode,
				start: selection?.anchorOffset, end: selection?.focusOffset, text: text.trim() };
			const element = node?.nodeType === 1 ? node : node?.parentElement;
			if (element?.closest?.('input[type=password],.fc-selection-popup-host,.fc-selection-popup-container')) { clear(); return; }
			if (selection?.rangeCount) {
				const rect = selection.getRangeAt(0).getBoundingClientRect();
				if (rect) { x = rect.left; y = rect.bottom; }
			}
		}
		const trimmed = text.trim().slice(0, 10000);
		const reposition = Boolean(trimmed && sameSelection(selectionIdentity, identity));
		if (trimmed) { origin = capturedOrigin; selectionIdentity = identity; }
		record(trimmed, x, y, event, false, reposition);
	};
	const onScroll = () => {
		if (!latest?.text) return;
		const selection = window.getSelection();
		const currentText = selection?.toString()?.trim() || '';
		if (currentText && currentText === latest.text && selection?.rangeCount) {
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			if (rect) {
				if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
					clear();
				} else {
					latest.x = rect.left;
					latest.y = rect.bottom;
					latest.reposition = true;
					latest.sequence = ++sequence;
				}
				return;
			}
		}
		clear();
	};
	const bind = (type, callback) => { document.addEventListener(type, callback, true); handlers.push([type, callback]); };
	bind('mouseup', capture);
	bind('dblclick', capture);
	bind('mousedown', clear);
	bind('blur', suppressSelection);
	bind('scroll', onScroll);
	bind('keydown', (event) => { if (event.key === 'Escape') close(); });
	window.${collectorKey} = { read: () => {
		if (origin?.isConnected === false) close();
		if (!document.hasFocus()) suppressSelection();
		return latest;
	}, dispose: () => {
		for (const [type, callback] of handlers) document.removeEventListener(type, callback, true);
	} };
	return true;
})()`;
const readCollector = `window.${collectorKey}?.read() ?? null`;
const readManualOrigin = `window.${collectorKey}_manualOrigin?.isConnected === false ? false : (${readCollector})`;

function guestEvent(value: unknown): GuestEvent | null {
	if (!value || typeof value !== "object") return null;
	const event = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(event.sequence) ||
		(event.sequence as number) < 1 ||
		!Number.isSafeInteger(event.captureSequence) ||
		(event.captureSequence as number) < 0 ||
		typeof event.text !== "string" ||
		event.text.length > 10000 ||
		![event.x, event.y, event.width, event.height].every(
			(item) => typeof item === "number" && Number.isFinite(item),
		) ||
		(event.width as number) <= 0 ||
		(event.height as number) <= 0 ||
		(event.shouldDismiss !== undefined && typeof event.shouldDismiss !== "boolean") ||
		(event.reposition !== undefined && typeof event.reposition !== "boolean") ||
		![event.altKey, event.shiftKey, event.ctrlOrMetaKey].every(
			(item) => typeof item === "boolean",
		)
	)
		return null;
	return event as unknown as GuestEvent;
}

/** Desktop compatibility seam; availability means API access, not real-device certification. */
export class WebviewSelectionAdapter {
	private readonly sources = new Map<Element, Source>();
	private observer: MutationObserver | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private docMouseDownHandler: ((event: MouseEvent) => void) | null = null;
	private docFocusInHandler: ((event: FocusEvent) => void) | null = null;
	private windowBlurHandler: (() => void) | null = null;
	private running = false;
	private enabled = false;
	private status: WebviewSelectionStatus = "idle";

	constructor(private readonly options: WebviewSelectionOptions) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.enabled = this.options.isEnabled();
		const doc = this.options.document;
		// Guest input never bubbles to the embedder. Host input only fences pending
		// reads; focus eligibility is determined in the guest document itself.
		const invalidatePendingRead = () => this.options.interrupt();
		this.docMouseDownHandler = invalidatePendingRead;
		this.docFocusInHandler = invalidatePendingRead;
		if (typeof doc.addEventListener === "function") {
			doc.addEventListener("mousedown", this.docMouseDownHandler, true);
			doc.addEventListener("focusin", this.docFocusInHandler, true);
		}
		const win = doc.defaultView;
		if (win?.addEventListener) {
			this.windowBlurHandler = invalidatePendingRead;
			win.addEventListener("blur", this.windowBlurHandler);
		}
		this.discover();
		const Observer = doc.defaultView?.MutationObserver;
		if (Observer) {
			this.observer = new Observer(() => this.discover());
			if (doc.body) {
				this.observer.observe(doc.body, { childList: true, subtree: true });
			}
		}
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.observer?.disconnect();
		this.observer = null;
		if (
			this.docMouseDownHandler &&
			typeof this.options.document.removeEventListener === "function"
		) {
			this.options.document.removeEventListener("mousedown", this.docMouseDownHandler, true);
			this.docMouseDownHandler = null;
		}
		if (
			this.docFocusInHandler &&
			typeof this.options.document.removeEventListener === "function"
		) {
			this.options.document.removeEventListener("focusin", this.docFocusInHandler, true);
			this.docFocusInHandler = null;
		}
		if (this.windowBlurHandler) {
			this.options.document.defaultView?.removeEventListener("blur", this.windowBlurHandler);
			this.windowBlurHandler = null;
		}
		for (const source of this.sources.values()) this.release(source);
		this.sources.clear();
		this.syncPolling();
		this.publishStatus();
	}

	/** Read the focused guest on explicit demand, even when automatic capture is off. */
	openDictionary(): boolean {
		if (!this.running || !this.options.openDictionary) return false;
		this.discover();
		const source = this.sources.get(this.options.document.activeElement as Element);
		if (!source || typeof source.element.executeJavaScript !== "function") return false;
		const page = source.page;
		if (!this.options.isDictionaryPopup()) page.manualOrigin = false;
		const read = page.lease.capture();
		const manualRead = {};
		page.manualRead = manualRead;
		void (async () => {
			let candidate: { text: string; x: number; y: number } | undefined;
			try {
				const result = await source.element.executeJavaScript(
					this.script(
						`(() => {
					const active = document.activeElement;
					if (active?.matches('input[type="password"]')) return null;
					const input = active?.matches('input,textarea') ? active : null;
					const selection = window.getSelection();
					const text = (input ? input.value.slice(input.selectionStart, input.selectionEnd) : selection?.toString() ?? '').trim();
					if (text && text.length <= 80 && !/[.!?;:\\n]/u.test(text) && text.split(/\\s+/u).length <= 3 && text.split(/\\s+/u).every(word => /^[A-Za-z][A-Za-z'-]*$/u.test(word))) {
						window.${collectorKey}_manualOrigin = input ?? selection?.anchorNode;
					}
					if (!text || text.length > 80) return null;
					const bounds = input ? input.getBoundingClientRect() : selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
					return { text, x: bounds?.left ?? 0, y: bounds?.bottom ?? 0 };
				})()`,
						page,
					),
				);
				if (result && typeof result === "object") {
					const value = result as Record<string, unknown>;
					const rect = this.visibleRect(source);
					if (
						typeof value.text === "string" &&
						value.text.length <= 80 &&
						typeof value.x === "number" &&
						Number.isFinite(value.x) &&
						typeof value.y === "number" &&
						Number.isFinite(value.y) &&
						rect
					) {
						candidate = {
							text: value.text,
							x: rect.left + value.x,
							y: rect.top + value.y,
						};
					}
				}
			} catch {
				// Unsupported guests still allow manual input in the lookup card.
			}
			if (page.manualRead === manualRead) page.manualRead = null;
			if (this.registered(source) && source.page === page && read.isCurrent()) {
				if (candidate && isEnglishWordOrPhrase(candidate.text)) page.manualOrigin = true;
				this.options.openDictionary?.(page.lease.reference, candidate);
			}
		})();
		return true;
	}

	private discover(): void {
		if (!this.running) return;
		const elements = new Set(Array.from(this.options.document.querySelectorAll("webview")));
		for (const [element, source] of this.sources) {
			if (!elements.has(element)) {
				this.release(source);
				this.sources.delete(element);
			}
		}
		for (const element of elements) {
			if (
				this.sources.has(element) ||
				element.closest(".fc-selection-popup-host,.fc-selection-popup-container")
			)
				continue;
			const source: Source = {
				element: element as WebviewElement,
				page: this.openPage(),
				cleanup: () => {},
			};
			const navigate = () => this.invalidate(source);
			const ready = () => {
				this.invalidate(source);
				void this.install(source);
			};
			element.addEventListener("did-start-loading", navigate);
			element.addEventListener("dom-ready", ready);
			element.addEventListener("did-navigate-in-page", ready);
			source.cleanup = () => {
				element.removeEventListener("did-start-loading", navigate);
				element.removeEventListener("dom-ready", ready);
				element.removeEventListener("did-navigate-in-page", ready);
			};
			this.sources.set(element, source);
			void this.install(source);
		}
		this.syncPolling();
		this.publishStatus();
	}

	private openPage(): Page {
		const lease = this.options.openSource();
		return {
			lease,
			key: `${collectorKey}_${lease.reference.id.replace(/[^A-Za-z0-9_]/g, "_")}_${++nextPage}`,
			sequence: 0,
			captureSequence: 0,
			ready: false,
			failed: false,
			busy: false,
			manualRead: null,
			manualOrigin: false,
		};
	}

	private registered(source: Source): boolean {
		return this.running && this.sources.get(source.element) === source;
	}

	private invalidate(source: Source): void {
		if (!this.registered(source)) return;
		this.disposePage(source, source.page);
		source.page = this.openPage();
		this.publishStatus();
	}

	private async install(source: Source): Promise<void> {
		if (!this.registered(source) || !this.enabled || !this.options.isEnabled()) return;
		const page = source.page;
		try {
			if (typeof source.element.executeJavaScript !== "function")
				throw new Error("Unavailable webview API");
			const installed = await source.element.executeJavaScript(
				this.script(installCollector, page),
			);
			if (!page.lease.active) {
				this.remove(source, page);
				return;
			}
			page.ready = installed === true;
			page.failed = !page.ready;
		} catch {
			if (!page.lease.active) return;
			page.failed = true;
		}
		this.publishStatus();
	}

	private poll(): void {
		if (!this.running) return;
		const document = this.options.document;
		const enabled = this.options.isEnabled();
		if (enabled !== this.enabled) {
			this.enabled = enabled;
			for (const source of this.sources.values()) {
				if (!source.page.manualOrigin && !source.page.manualRead) this.invalidate(source);
				if (enabled && !source.page.ready) void this.install(source);
			}
		}
		if (document.visibilityState === "hidden") return;
		for (const source of this.sources.values()) {
			if (
				(!source.page.ready && !source.page.manualOrigin) ||
				source.page.busy ||
				source.page.manualRead
			)
				continue;
			if (!this.options.isEnabled() && !source.page.manualOrigin) continue;
			if (!this.visibleRect(source)) continue;
			void this.read(source);
		}
	}

	private async read(source: Source): Promise<void> {
		const page = source.page;
		const read = page.lease.capture();
		page.busy = true;
		try {
			const result = await source.element.executeJavaScript(
				this.script(page.manualOrigin ? readManualOrigin : readCollector, page),
			);
			if (!page.lease.active || (!page.ready && !page.manualOrigin)) return;
			if (result === false && page.manualOrigin) {
				if (read.isCurrent()) {
					page.manualOrigin = false;
					read.dismiss();
				}
				return;
			}
			const event = guestEvent(result);
			if (!event || event.sequence <= page.sequence) return;
			// Consume rejected events too, so returning focus cannot revive them.
			page.sequence = event.sequence;
			const rect = this.visibleRect(source);
			if (
				!rect ||
				!this.options.isEnabled() ||
				this.options.document.visibilityState === "hidden"
			)
				return;
			if (!event.text.trim()) {
				if (event.shouldDismiss || !this.options.isDictionaryPopup()) read.dismiss();
				return;
			}
			// A scroll can follow a new capture before this poll consumes either event.
			const freshCapture = event.captureSequence > page.captureSequence;
			page.captureSequence = Math.max(page.captureSequence, event.captureSequence);
			if (event.reposition && !freshCapture && this.options.isDictionaryPopup()) return;
			read.submit({
				text: event.text,
				x: rect.left + (event.x * rect.width) / event.width,
				y: rect.top + (event.y * rect.height) / event.height,
				eligibleContext: true,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
				ctrlOrMetaKey: event.ctrlOrMetaKey,
				trigger: "mouse",
			});
		} catch {
			if (page.lease.active) {
				this.disposePage(source, page);
				page.ready = false;
				page.failed = true;
				this.publishStatus();
			}
		} finally {
			// A pending read belongs to its page, never to the replacement page.
			page.busy = false;
		}
	}

	private disposePage(source: Source, page: Page): void {
		page.lease.dispose();
		this.remove(source, page);
	}

	private release(source: Source): void {
		this.disposePage(source, source.page);
		source.cleanup();
	}

	/**
	 * A document without embedded webviews has nothing to poll, so the timer only
	 * runs while at least one source exists. `discover()` is still driven by the
	 * `MutationObserver`, which is what notices appearing and disappearing pages.
	 */
	private syncPolling(): void {
		const needed = this.running && this.sources.size > 0;
		if (needed === (this.timer !== null)) return;
		if (needed) {
			this.timer = setInterval(() => this.poll(), WEBVIEW_POLL_INTERVAL_MS);
			return;
		}
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}

	private script(template: string, page: Page): string {
		return template.replaceAll(collectorKey, page.key);
	}

	private visibleRect(source: Source): DOMRect | null {
		const rect = source.element.getBoundingClientRect();
		const window = this.options.document.defaultView;
		return rect.width > 0 &&
			rect.height > 0 &&
			rect.bottom > 0 &&
			rect.right > 0 &&
			rect.top < (window?.innerHeight ?? Infinity) &&
			rect.left < (window?.innerWidth ?? Infinity)
			? rect
			: null;
	}

	private remove(source: Source, page: Page): void {
		try {
			if (typeof source.element.executeJavaScript === "function") {
				void source.element
					.executeJavaScript(this.script(removeCollector, page))
					.catch(() => {});
			}
		} catch {
			// Detached webviews can reject synchronously; teardown must still finish.
		}
	}

	private publishStatus(): void {
		const sources = [...this.sources.values()];
		const next =
			!this.running || sources.length === 0
				? "idle"
				: sources.some((source) => source.page.failed)
					? "unavailable"
					: sources.some((source) => source.page.ready)
						? "available"
						: "idle";
		if (next !== this.status) {
			this.status = next;
			this.options.onStatus(next);
		}
	}
}
