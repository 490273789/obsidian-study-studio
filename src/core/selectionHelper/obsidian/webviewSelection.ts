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
	const mouseup = (event) => {
		const active = document.activeElement;
		let text = '', x = event.clientX, y = event.clientY;
		if (active?.matches('input,textarea')) {
			if (active.type === 'password') { clear(); return; }
			if (typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number') {
				text = active.value.slice(active.selectionStart, active.selectionEnd);
				const rect = active.getBoundingClientRect(); x = rect.left; y = rect.bottom;
			}
		} else {
			const selection = window.getSelection();
			text = selection?.toString() || '';
			const node = selection?.anchorNode;
			const element = node?.nodeType === 1 ? node : node?.parentElement;
			if (element?.closest('input[type=password],.fc-selection-popup-host,.fc-selection-popup-container')) { clear(); return; }
			if (selection?.rangeCount) {
				const rect = selection.getRangeAt(0).getBoundingClientRect();
				x = rect.left; y = rect.bottom;
			}
		}
		record(text.trim().slice(0, 10000), x, y, event);
	};
	const bind = (type, callback) => { document.addEventListener(type, callback, true); handlers.push([type, callback]); };
	bind('mouseup', mouseup); bind('mousedown', clear); bind('scroll', clear);
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
	private running = false;
	private enabled = false;
	private status: WebviewSelectionStatus = "idle";

	constructor(private readonly options: WebviewSelectionOptions) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.enabled = this.options.isEnabled();
		this.discover();
		const Observer = this.options.document.defaultView?.MutationObserver;
		if (Observer) {
			this.observer = new Observer(() => this.discover());
			this.observer.observe(this.options.document.body, { childList: true, subtree: true });
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
		if (
			!this.options.isEnabled() ||
			document.visibilityState === "hidden" ||
			!document.hasFocus()
		)
			return;
		for (const source of this.sources.values()) {
			if (!source.ready || source.busy || document.activeElement !== source.element) continue;
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
				!this.options.document.hasFocus() ||
				this.options.document.visibilityState === "hidden" ||
				this.options.document.activeElement !== source.element
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
