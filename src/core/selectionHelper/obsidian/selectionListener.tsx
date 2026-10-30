import { createRoot, type Root } from "react-dom/client";
import type { Language } from "../../shared/types";
import { isEnglishWordOrPhrase, type SelectionHelper } from "../domain/selectionHelper";
import type {
	SelectionLookupSlotRenderer,
	SelectionRead,
	SelectionSlotRenderer,
	SelectionSource,
	SelectionSourceLease,
} from "../domain/types";
import { selectionHelperStrings } from "../strings/selectionPopup";
import { SelectionPopupHost } from "../ui/SelectionPopupHost";
import {
	captureSelection,
	hasMatchingElement,
	isAssistantElement,
	selectionOrigin,
	toHostCoordinates,
} from "./selectionCapture";

interface SelectionListenerDeps {
	helper: SelectionHelper;
	getLanguage: () => Language;
	getTheme: () => "light" | "dark";
	document?: Document;
	owner?: object;
	isEnabled?: () => boolean;
	slots?: Record<string, SelectionSlotRenderer>;
	renderLookupSlot?: SelectionLookupSlotRenderer;
}

interface DocumentBinding {
	openDictionary(): boolean;
	dispose(): void;
}

/** One window host; all hosts share the single SelectionHelper interaction. */
export class SelectionListener {
	private containerEl: HTMLElement | null = null;
	private root: Root | null = null;
	private unsubscribe: (() => void) | null = null;
	private readonly bindings = new Map<Document, DocumentBinding>();
	private readonly owner: object;
	private host: Document | null = null;
	private started = false;
	private manualSource: SelectionSourceLease | null = null;

	constructor(private readonly deps: SelectionListenerDeps) {
		this.owner = deps.owner ?? {};
	}

	start(): void {
		if (this.started) return;
		const doc = this.deps.document ?? (typeof document === "undefined" ? null : document);
		if (!doc) return;
		this.started = true;
		this.host = doc;
		this.manualSource = this.deps.helper.openSource(this.owner);
		this.unsubscribe = this.deps.helper.subscribe(() => this.renderSnapshot());
		this.bindDocument(doc);
	}

	private ownsSource(source: SelectionSource | undefined): boolean {
		return this.deps.helper.ownsSource(this.owner, source);
	}

	dismiss(): void {
		this.deps.helper.dismiss(this.owner);
	}

	openDictionary(): void {
		if (!this.started || !this.manualSource) return;
		// Prefer the focused document/frame; never reuse a stale captured Range.
		const focused = [...this.bindings.entries()].find(
			([doc]) => !doc.activeElement?.matches?.("iframe") && doc.hasFocus?.(),
		);
		if (focused?.[1].openDictionary()) return;
		if (!focused && this.host && this.bindings.get(this.host)?.openDictionary()) return;
		this.openBlankDictionary();
	}

	openBlankDictionary(): void {
		if (this.started && this.manualSource)
			this.deps.helper.openDictionary(this.manualSource.reference);
	}

	refresh(): void {
		this.renderSnapshot();
	}

	stop(): void {
		this.started = false;
		this.manualSource?.dispose();
		this.manualSource = null;
		for (const binding of this.bindings.values()) binding.dispose();
		this.bindings.clear();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.destroyPopup();
		this.host = null;
	}

	private bindDocument(doc: Document): void {
		if (!this.started || this.bindings.has(doc)) return;
		const lease = this.deps.helper.openSource(this.owner);
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
		const handleOutsideInteraction = (ownerScoped = false) => {
			const snapshot = this.deps.helper.getSnapshot();
			if (
				snapshot.visible &&
				(snapshot.mode === "slot" || (snapshot.mode as string) === "dictionary")
			) {
				this.deps.helper.interrupt();
				return;
			}
			if (ownerScoped) this.dismiss();
			else this.deps.helper.dismiss();
		};
		const read = (target: EventTarget | null, x = 0, y = 0) => {
			const captured = captureSelection(doc, target, { x, y });
			return captured && this.host ? toHostCoordinates(doc, this.host, captured) : null;
		};
		const submit = (
			event: MouseEvent | TouchEvent,
			trigger: "mouse" | "touch",
			selectionRead?: SelectionRead,
		) => {
			if (!this.started || this.deps.isEnabled?.() === false || internal(event.target))
				return;
			const currentRead = selectionRead ?? lease.capture();
			if (!currentRead.isCurrent()) return;
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
					this.deps.helper.getSnapshot().target?.source === lease.reference
				)
					return;
				lastTouchSelection = signature;
			}
			const accepted = currentRead.submit({
				...selection,
				trigger,
				eligibleContext: true,
				altKey: Boolean(event.altKey),
				shiftKey: Boolean(event.shiftKey),
				ctrlOrMetaKey: Boolean(event.ctrlKey || event.metaKey),
			});
			if (accepted) {
				selectedNode = selectionOrigin(doc, event.target);
			}
		};
		const scheduleTouch = () => {
			cancelTimer();
			const selectionRead = lease.capture();
			timer = setTimeout(() => {
				timer = null;
				if (touchContext && !touchGesture) submit(touchContext, "touch", selectionRead);
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
				handleOutsideInteraction();
			},
			true,
		);
		bind(
			"scroll",
			(event) => {
				if (!internal(event.target)) handleOutsideInteraction(true);
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
			handleOutsideInteraction();
		});
		bind("touchmove", () => {
			if (touchGesture) {
				touchGesture.moved = true;
				cancelTimer();
				handleOutsideInteraction(true);
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
				handleOutsideInteraction(true);
				cancelTimer();
			} else if (touchContext) {
				const selection = read(touchContext.target);
				if (!selection || JSON.stringify(selection) === lastTouchSelection) return;
				// Native selection handles may emit selectionchange without touchstart.
				handleOutsideInteraction(true);
				scheduleTouch();
			}
		});

		const releaseDocument = (child: Document) => {
			const binding = this.bindings.get(child);
			if (!binding) return;
			this.bindings.delete(child);
			binding.dispose();
		};
		const scanFrames = () => {
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
					if (!lease.active || frames.get(frame) !== state) return;
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
		const onMutation = (mutations?: readonly MutationRecord[]) => {
			if (!lease.active) return;
			if (
				selectedNode?.isConnected === false &&
				this.deps.helper.getSnapshot().target?.source === lease.reference
			) {
				selectedNode = null;
				lease.dismiss();
			}
			if (mutations && mutations.length > 0) {
				let relevant = false;
				for (const mutation of mutations) {
					if (mutation.type === "childList") {
						if (frames.size > 0 && mutation.removedNodes.length > 0) {
							relevant = true;
							break;
						}
						if (
							mutation.addedNodes.length > 0 &&
							hasMatchingElement(mutation.addedNodes, "iframe")
						) {
							relevant = true;
							break;
						}
					}
				}
				if (!relevant) return;
			}
			scanFrames();
		};
		const Observer = (
			doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null
		)?.MutationObserver;
		const observer = Observer ? new Observer((mutations) => onMutation(mutations)) : null;
		this.bindings.set(doc, {
			openDictionary: () => {
				const selection = read(doc.activeElement);
				if (!selection?.text || !isEnglishWordOrPhrase(selection.text)) return false;
				selectedNode = selectionOrigin(doc, doc.activeElement);
				this.deps.helper.openDictionary(lease.reference, selection);
				return true;
			},
			dispose: () => {
				lease.dispose();
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
		if (!snapshot.visible || !this.ownsSource(snapshot.target?.source) || !this.host) {
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
				language={this.deps.getLanguage()}
				slots={this.deps.slots}
				renderLookupSlot={this.deps.renderLookupSlot}
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
