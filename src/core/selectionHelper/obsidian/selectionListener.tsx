import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Language } from "../../shared/types";
import type { SelectionHelper } from "../domain/selectionHelper";
import type { SelectionCandidate } from "../domain/types";
import { selectionHelperStrings } from "../strings/selectionPopup";
import { SelectionPopupHost } from "../ui/SelectionPopupHost";
import type { SelectionEmbeddedContentRenderer } from "../ui/types";
import {
	captureSelection,
	isAssistantElement,
	selectionOrigin,
	toHostCoordinates,
} from "./selectionCapture";

export interface SelectionListenerDeps {
	helper: SelectionHelper;
	getLanguage: () => Language;
	getTheme: () => "light" | "dark";
	document?: Document;
	isEnabled?: () => boolean;
	renderEmbeddedContent?: SelectionEmbeddedContentRenderer;
}

let nextSource = 0;
interface DocumentBinding {
	sourceId: string;
	dispose(): void;
}

/** One window host; all hosts share the single SelectionHelper interaction. */
export class SelectionListener {
	private containerEl: HTMLElement | null = null;
	private root: Root | null = null;
	private unsubscribe: (() => void) | null = null;
	private readonly bindings = new Map<Document, DocumentBinding>();
	private readonly sources = new Map<string, number>();
	private host: Document | null = null;
	private started = false;

	constructor(private readonly deps: SelectionListenerDeps) {}

	start(): void {
		if (this.started) return;
		const doc = this.deps.document ?? (typeof document === "undefined" ? null : document);
		if (!doc) return;
		this.started = true;
		this.host = doc;
		this.unsubscribe = this.deps.helper.subscribe(() => this.renderSnapshot());
		this.bindDocument(doc);
	}

	/** External adapters supply host-viewport coordinates and opaque source identity. */
	submit(candidate: SelectionCandidate): void {
		if (!this.started || this.deps.isEnabled?.() === false || !candidate.sourceId) return;
		this.sources.set(candidate.sourceId, candidate.generation ?? 0);
		this.deps.helper.handleSelection(candidate);
	}

	ownsSource(sourceId: string | undefined): boolean {
		return sourceId !== undefined && this.sources.has(sourceId);
	}

	dismiss(): void {
		if (this.ownsSource(this.deps.helper.getSnapshot().target?.sourceId)) {
			this.deps.helper.dismiss();
		}
	}

	refresh(): void {
		this.renderSnapshot();
	}

	stop(): void {
		this.started = false;
		for (const binding of this.bindings.values()) binding.dispose();
		this.bindings.clear();
		for (const [sourceId, generation] of this.sources) {
			this.deps.helper.invalidateSource(sourceId, generation + 1);
		}
		this.sources.clear();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.destroyPopup();
		this.host = null;
	}

	private bindDocument(doc: Document): void {
		if (this.bindings.has(doc)) return;
		const sourceId = `selection-document-${++nextSource}`;
		this.sources.set(sourceId, 0);
		let timer: ReturnType<typeof setTimeout> | null = null;
		let touchContext: TouchEvent | null = null;
		let touchGesture: { startedAt: number; text: string; moved: boolean } | null = null;
		let suppressMouseUntil = 0;
		let lastTouchSelection = "";
		let selectedNode: Node | null = null;
		const cleanups: (() => void)[] = [];
		const frames = new Map<HTMLIFrameElement, { doc: Document | null; remove(): void }>();
		const cancelTimer = () => {
			if (timer !== null) clearTimeout(timer);
			timer = null;
		};
		const internal = (target: EventTarget | null) =>
			isAssistantElement(target) || Boolean(this.containerEl?.contains(target as Node));
		const read = (target: EventTarget | null, x = 0, y = 0) => {
			const captured = captureSelection(doc, target, { x, y });
			return captured && this.host ? toHostCoordinates(doc, this.host, captured) : null;
		};
		const submit = (event: MouseEvent | TouchEvent, trigger: "mouse" | "touch") => {
			if (internal(event.target)) return;
			const mouse = event as MouseEvent;
			const touch = (event as TouchEvent).changedTouches?.[0];
			const selection = read(
				event.target,
				touch?.clientX ?? mouse.clientX ?? 0,
				touch?.clientY ?? mouse.clientY ?? 0,
			);
			if (!selection) return;
			if (trigger === "touch") {
				const signature = JSON.stringify(selection);
				if (
					signature === lastTouchSelection &&
					this.deps.helper.getSnapshot().visible &&
					this.deps.helper.getSnapshot().target?.sourceId === sourceId
				)
					return;
				lastTouchSelection = signature;
			}
			this.submit({
				...selection,
				sourceId,
				generation: 0,
				trigger,
				eligibleContext: true,
				altKey: Boolean(event.altKey),
				shiftKey: Boolean(event.shiftKey),
				ctrlOrMetaKey: Boolean(event.ctrlKey || event.metaKey),
			});
			if (this.deps.helper.getSnapshot().target?.sourceId === sourceId) {
				selectedNode = selectionOrigin(doc, event.target);
			}
		};
		const scheduleTouch = () => {
			cancelTimer();
			timer = setTimeout(() => {
				timer = null;
				if (touchContext && !touchGesture) submit(touchContext, "touch");
			}, 150);
		};
		const bind = <K extends keyof DocumentEventMap>(
			type: K,
			fn: (event: DocumentEventMap[K]) => void,
			capture = false,
		) => {
			doc.addEventListener(type, fn, capture);
			cleanups.push(() => doc.removeEventListener(type, fn, capture));
		};
		bind(
			"mouseup",
			(event) => {
				if (Date.now() < suppressMouseUntil) return;
				touchContext = null;
				cancelTimer();
				submit(event, "mouse");
			},
			true,
		);
		bind(
			"mousedown",
			(event) => {
				if (Date.now() < suppressMouseUntil || internal(event.target)) return;
				touchContext = null;
				cancelTimer();
				this.deps.helper.dismiss();
			},
			true,
		);
		bind(
			"scroll",
			(event) => {
				if (!internal(event.target)) this.dismiss();
			},
			true,
		);
		bind("keydown", (event) => {
			if (event.key === "Escape") this.dismiss();
		});
		bind("touchstart", (event) => {
			cancelTimer();
			touchContext = null;
			if (internal(event.target)) {
				touchGesture = null;
				return;
			}
			touchGesture = {
				startedAt: Date.now(),
				text: read(event.target)?.text ?? "",
				moved: false,
			};
			// Do not prevent default or focus anything: native menus and handles remain usable.
			this.deps.helper.dismiss();
		});
		bind("touchmove", () => {
			if (touchGesture) {
				touchGesture.moved = true;
				cancelTimer();
				this.dismiss();
			}
		});
		bind("touchcancel", () => {
			cancelTimer();
			touchContext = null;
			touchGesture = null;
		});
		bind("touchend", (event) => {
			const gesture = touchGesture;
			touchGesture = null;
			suppressMouseUntil = Date.now() + 800;
			if (internal(event.target)) return;
			const selected = read(event.target);
			if (
				gesture &&
				!gesture.moved &&
				Date.now() - gesture.startedAt < 350 &&
				selected?.text === gesture.text
			) {
				touchContext = null;
				return;
			}
			touchContext = event;
			scheduleTouch();
		});
		bind("selectionchange", () => {
			if (touchGesture) {
				this.dismiss();
				cancelTimer();
			} else if (touchContext) {
				const selection = read(touchContext.target);
				if (!selection || JSON.stringify(selection) === lastTouchSelection) return;
				// Native selection handles may emit selectionchange without touchstart.
				this.dismiss();
				scheduleTouch();
			}
		});

		const releaseDocument = (child: Document) => {
			const binding = this.bindings.get(child);
			if (!binding) return;
			this.bindings.delete(child);
			binding.dispose();
			this.sources.delete(binding.sourceId);
			this.deps.helper.invalidateSource(binding.sourceId, 1);
		};
		const scanFrames = () => {
			if (
				selectedNode?.isConnected === false &&
				this.deps.helper.getSnapshot().target?.sourceId === sourceId
			) {
				selectedNode = null;
				this.dismiss();
			}
			const present = new Set(doc.querySelectorAll<HTMLIFrameElement>("iframe"));
			for (const [frame, state] of frames) {
				if (present.has(frame)) continue;
				if (state.doc) releaseDocument(state.doc);
				state.remove();
				frames.delete(frame);
			}
			for (const frame of present) {
				if (isAssistantElement(frame) || frames.has(frame)) continue;
				const state = {
					doc: null as Document | null,
					remove: () => frame.removeEventListener("load", load),
				};
				const load = () => {
					if (state.doc) releaseDocument(state.doc);
					state.doc = null;
					try {
						const child = frame.contentDocument;
						if (child?.defaultView) {
							state.doc = child;
							this.bindDocument(child);
						}
					} catch {
						/* Cross-origin content needs its dedicated adapter. */
					}
				};
				frames.set(frame, state);
				frame.addEventListener("load", load);
				load();
			}
		};
		const Observer = (
			doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null
		)?.MutationObserver;
		const observer = Observer ? new Observer(scanFrames) : null;
		this.bindings.set(doc, {
			sourceId,
			dispose: () => {
				cancelTimer();
				touchContext = null;
				observer?.disconnect();
				for (const state of frames.values()) {
					state.remove();
					if (state.doc) releaseDocument(state.doc);
				}
				frames.clear();
				for (const cleanup of cleanups) cleanup();
			},
		});
		if (doc.body ?? doc.documentElement) {
			observer?.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
		}
		scanFrames();
	}

	private renderSnapshot(): void {
		const snapshot = this.deps.helper.getSnapshot();
		if (!snapshot.visible || !this.ownsSource(snapshot.target?.sourceId) || !this.host) {
			this.destroyPopup();
			return;
		}
		if (!this.containerEl) {
			this.containerEl = this.host.createElement("div");
			this.containerEl.className = "fc-selection-popup-container";
			this.host.body.appendChild(this.containerEl);
			this.root = createRoot(this.containerEl);
		}
		this.root?.render(
			<SelectionPopupHost
				helper={this.deps.helper}
				strings={selectionHelperStrings(this.deps.getLanguage())}
				theme={this.deps.getTheme()}
				renderEmbeddedContent={this.deps.renderEmbeddedContent}
			/>,
		);
	}

	private destroyPopup(): void {
		this.root?.unmount();
		this.root = null;
		this.containerEl?.remove();
		this.containerEl = null;
	}
}
