import type { SelectionCandidate } from "../domain/types";

export type WebviewSelectionStatus = "idle" | "available" | "unavailable";

interface WebviewElement extends HTMLElement {
	executeJavaScript(code: string): Promise<unknown>;
}

interface GuestEvent {
	sequence: number;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	altKey: boolean;
	shiftKey: boolean;
	ctrlOrMetaKey: boolean;
}

interface Source {
	element: WebviewElement;
	id: string;
	generation: number;
	sequence: number;
	ready: boolean;
	failed: boolean;
	busy: boolean;
	focused: boolean;
	cleanup: () => void;
}

interface WebviewSelectionOptions {
	document: Document;
	onSelection(candidate: SelectionCandidate): void;
	onDismiss(sourceId: string, generation: number): void;
	onStatus(status: WebviewSelectionStatus): void;
	isEnabled(): boolean;
}

let nextSource = 0;
const collectorKey = "__studyStudioSelectionCollector";
const removeCollector = `(() => { window.${collectorKey}?.dispose(); delete window.${collectorKey}; })()`;

// Fixed code only: no host objects, credentials, Node integration, or selected text
// are interpolated into the guest's JavaScript context.
const installCollector = `(() => {
	window.${collectorKey}?.dispose();
	let sequence = 0;
	let latest = null;
	const handlers = [];
	const record = (text, x, y, event) => {
		latest = { sequence: ++sequence, text, x, y, width: innerWidth, height: innerHeight,
			altKey: !!event?.altKey, shiftKey: !!event?.shiftKey,
			ctrlOrMetaKey: !!(event?.ctrlKey || event?.metaKey) };
	};
	const clear = () => record('', 0, 0);
	const capture = (event) => {
		const active = document.activeElement;
		let text = '', x = event?.clientX ?? 0, y = event?.clientY ?? 0;
		if (active?.matches('input,textarea')) {
			if (active.type === 'password') { clear(); return; }
			if (typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number') {
				text = active.value.slice(active.selectionStart, active.selectionEnd);
				const rect = active.getBoundingClientRect();
				if (rect) { x = rect.left; y = rect.bottom; }
			}
		} else {
			const selection = window.getSelection();
			text = selection?.toString() || '';
			const node = selection?.anchorNode;
			const element = node?.nodeType === 1 ? node : node?.parentElement;
			if (element?.closest?.('input[type=password],.fc-selection-popup-host,.fc-selection-popup-container')) { clear(); return; }
			if (selection?.rangeCount) {
				const rect = selection.getRangeAt(0).getBoundingClientRect();
				if (rect) { x = rect.left; y = rect.bottom; }
			}
		}
		record(text.trim().slice(0, 10000), x, y, event);
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
					latest.sequence++;
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
	bind('scroll', onScroll);
	bind('keydown', (event) => { if (event.key === 'Escape') clear(); });
	window.${collectorKey} = { read: () => latest, dispose: () => {
		for (const [type, callback] of handlers) document.removeEventListener(type, callback, true);
	} };
	return true;
})()`;
const readCollector = `window.${collectorKey}?.read() ?? null`;

function guestEvent(value: unknown): GuestEvent | null {
	if (!value || typeof value !== "object") return null;
	const event = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(event.sequence) ||
		(event.sequence as number) < 1 ||
		typeof event.text !== "string" ||
		event.text.length > 10000 ||
		![event.x, event.y, event.width, event.height].every(
			(item) => typeof item === "number" && Number.isFinite(item),
		) ||
		(event.width as number) <= 0 ||
		(event.height as number) <= 0 ||
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
	private windowFocusHandler: (() => void) | null = null;
	private windowBlurred = false;
	private running = false;
	private enabled = false;
	private status: WebviewSelectionStatus = "idle";

	constructor(private readonly options: WebviewSelectionOptions) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.enabled = this.options.isEnabled();
		this.windowBlurred = false;
		const doc = this.options.document;
		this.docMouseDownHandler = (event: MouseEvent) => {
			const target = event.target as
				| (Node & { closest?: (s: string) => Element | null })
				| null;
			const targetEl =
				target?.nodeType === 1
					? target
					: (target?.parentElement as Element | null | undefined);
			for (const source of this.sources.values()) {
				if (target && (target === source.element || source.element.contains?.(target))) {
					source.focused = true;
					this.windowBlurred = false;
				} else if (
					target &&
					!targetEl?.closest?.(".fc-selection-popup-container,.fc-selection-popup-host")
				) {
					source.focused = false;
				}
			}
		};
		this.docFocusInHandler = (event: FocusEvent) => {
			const target = event.target as
				| (Node & { closest?: (s: string) => Element | null })
				| null;
			const targetEl =
				target?.nodeType === 1
					? target
					: (target?.parentElement as Element | null | undefined);
			for (const source of this.sources.values()) {
				if (target && (target === source.element || source.element.contains?.(target))) {
					source.focused = true;
					this.windowBlurred = false;
				} else if (
					target &&
					!targetEl?.closest?.(".fc-selection-popup-container,.fc-selection-popup-host")
				) {
					source.focused = false;
				}
			}
		};
		if (typeof doc.addEventListener === "function") {
			doc.addEventListener("mousedown", this.docMouseDownHandler, true);
			doc.addEventListener("focusin", this.docFocusInHandler, true);
		}
		const win = doc.defaultView;
		if (win?.addEventListener) {
			this.windowBlurHandler = () => {
				this.windowBlurred = true;
				for (const source of this.sources.values()) {
					source.focused = false;
				}
			};
			this.windowFocusHandler = () => {
				this.windowBlurred = false;
			};
			win.addEventListener("blur", this.windowBlurHandler);
			win.addEventListener("focus", this.windowFocusHandler);
		}
		this.discover();
		const Observer = doc.defaultView?.MutationObserver;
		if (Observer) {
			this.observer = new Observer(() => this.discover());
			if (doc.body) {
				this.observer.observe(doc.body, { childList: true, subtree: true });
			}
		}
		this.timer = setInterval(() => this.poll(), 150);
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.observer?.disconnect();
		this.observer = null;
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
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
		if (this.windowFocusHandler) {
			this.options.document.defaultView?.removeEventListener(
				"focus",
				this.windowFocusHandler,
			);
			this.windowFocusHandler = null;
		}
		for (const source of this.sources.values()) this.release(source);
		this.sources.clear();
		this.publishStatus();
	}

	private discover(): void {
		if (!this.running) return;
		const elements = new Set(this.options.document.querySelectorAll("webview"));
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
				id: `webview-${++nextSource}`,
				generation: 0,
				sequence: 0,
				ready: false,
				failed: false,
				busy: false,
				focused: false,
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
		this.publishStatus();
	}

	private invalidate(source: Source): void {
		this.options.onDismiss(source.id, source.generation);
		this.remove(source, source.generation);
		source.generation++;
		source.sequence = 0;
		source.ready = false;
		source.failed = false;
		this.publishStatus();
	}

	private current(source: Source, generation: number): boolean {
		return (
			this.running &&
			this.sources.get(source.element) === source &&
			source.generation === generation
		);
	}

	private async install(source: Source): Promise<void> {
		if (!this.enabled || !this.options.isEnabled()) return;
		const generation = source.generation;
		try {
			if (typeof source.element.executeJavaScript !== "function")
				throw new Error("Unavailable webview API");
			const installed = await source.element.executeJavaScript(
				this.script(installCollector, source, generation),
			);
			if (!this.current(source, generation) || !this.options.isEnabled()) {
				this.remove(source, generation);
				return;
			}
			source.ready = installed === true;
			source.failed = !source.ready;
		} catch {
			if (!this.current(source, generation)) return;
			source.failed = true;
		}
		this.publishStatus();
	}

	private isActive(source: Source): boolean {
		if (source.focused) return true;
		const active = this.options.document.activeElement;
		if (!active) return false;
		if (active === source.element || source.element.contains(active)) return true;
		if (active !== this.options.document.body && active.contains(source.element)) return true;
		return false;
	}

	private hasFocus(source?: Source): boolean {
		if (this.options.document.hasFocus()) return true;
		return Boolean(source?.focused && !this.windowBlurred);
	}

	private poll(): void {
		const document = this.options.document;
		const enabled = this.options.isEnabled();
		if (enabled !== this.enabled) {
			this.enabled = enabled;
			for (const source of this.sources.values()) {
				this.invalidate(source);
				if (enabled) void this.install(source);
			}
		}
		if (!this.options.isEnabled() || document.visibilityState === "hidden") return;
		for (const source of this.sources.values()) {
			if (!source.ready || source.busy || !this.isActive(source) || !this.hasFocus(source))
				continue;
			if (!this.visibleRect(source)) continue;
			void this.read(source);
		}
	}

	private async read(source: Source): Promise<void> {
		const generation = source.generation;
		source.busy = true;
		try {
			const result = await source.element.executeJavaScript(
				this.script(readCollector, source, generation),
			);
			if (!this.current(source, generation) || !source.ready) return;
			const event = guestEvent(result);
			if (!event || event.sequence <= source.sequence) return;
			// Consume rejected events too, so returning focus cannot revive them.
			source.sequence = event.sequence;
			const rect = this.visibleRect(source);
			if (
				!rect ||
				!this.options.isEnabled() ||
				!this.hasFocus(source) ||
				this.options.document.visibilityState === "hidden" ||
				!this.isActive(source)
			)
				return;
			if (!event.text.trim()) {
				this.options.onDismiss(source.id, generation);
				return;
			}
			this.options.onSelection({
				text: event.text,
				x: rect.left + (event.x * rect.width) / event.width,
				y: rect.top + (event.y * rect.height) / event.height,
				eligibleContext: true,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
				ctrlOrMetaKey: event.ctrlOrMetaKey,
				trigger: "mouse",
				sourceId: source.id,
				generation,
			});
		} catch {
			if (this.current(source, generation)) {
				this.invalidate(source);
				source.failed = true;
				this.publishStatus();
			}
		} finally {
			source.busy = false;
		}
	}

	private release(source: Source): void {
		this.invalidate(source);
		source.cleanup();
	}

	private script(template: string, source: Source, generation: number): string {
		return template.replaceAll(
			collectorKey,
			`${collectorKey}_${source.id.replaceAll("-", "_")}_${generation}`,
		);
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

	private remove(source: Source, generation: number): void {
		try {
			if (typeof source.element.executeJavaScript === "function") {
				void source.element
					.executeJavaScript(this.script(removeCollector, source, generation))
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
				: sources.some((source) => source.failed)
					? "unavailable"
					: sources.some((source) => source.ready)
						? "available"
						: "idle";
		if (next !== this.status) {
			this.status = next;
			this.options.onStatus(next);
		}
	}
}
