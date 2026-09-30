import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Language } from "../../shared/types";
import type { SelectionHelper } from "../domain/selectionHelper";
import { selectionHelperStrings } from "../strings/selectionPopup";
import { SelectionPopupHost } from "../ui/SelectionPopupHost";
import type { SelectionEmbeddedContentRenderer } from "../ui/types";

export interface SelectionListenerDeps {
	helper: SelectionHelper;
	getLanguage: () => Language;
	getTheme: () => "light" | "dark";
	renderEmbeddedContent?: SelectionEmbeddedContentRenderer;
}

export class SelectionListener {
	private containerEl: HTMLElement | null = null;
	private root: Root | null = null;
	private unbindListeners: (() => void) | null = null;
	private unsubscribe: (() => void) | null = null;
	private touchTimer: ReturnType<typeof setTimeout> | null = null;
	private touchContext: TouchEvent | null = null;
	private suppressMouseUntil = 0;
	private touchGesture: { startedAt: number; text: string; moved: boolean } | null = null;

	constructor(private readonly deps: SelectionListenerDeps) {}

	start(): void {
		if (this.unbindListeners || typeof document === "undefined") return;
		this.unsubscribe = this.deps.helper.subscribe(() => this.renderSnapshot());

		const handleMouseUp = (event: MouseEvent) => {
			if (Date.now() < this.suppressMouseUntil) return;
			this.touchContext = null;
			this.cancelTouchTimer();
			this.onMouseUp(event);
		};

		const handleMouseDown = (event: MouseEvent) => {
			if (Date.now() < this.suppressMouseUntil) return;
			this.touchContext = null;
			this.cancelTouchTimer();
			if (this.containerEl && !this.containerEl.contains(event.target as Node)) {
				this.deps.helper.dismiss();
			}
		};

		const handleScroll = (event: Event) => {
			if (!this.containerEl) return;
			if (!this.containerEl.contains(event.target as Node)) {
				this.deps.helper.dismiss();
			}
		};

		const handleTouchStart = (event: TouchEvent) => {
			this.cancelTouchTimer();
			this.touchContext = null;
			if (this.containerEl?.contains(event.target as Node)) {
				this.touchGesture = null;
				return;
			}
			const selection = document.defaultView?.getSelection() ?? window.getSelection();
			this.touchGesture = {
				startedAt: Date.now(),
				text: selection?.toString().trim() ?? "",
				moved: false,
			};
		};
		const handleTouchMove = () => {
			if (this.touchGesture) this.touchGesture.moved = true;
		};
		const handleTouchCancel = () => {
			this.touchGesture = null;
			this.touchContext = null;
			this.cancelTouchTimer();
		};
		const handleTouchEnd = (event: TouchEvent) => {
			const gesture = this.touchGesture;
			this.touchGesture = null;
			this.suppressMouseUntil = Date.now() + 800;
			if (this.containerEl?.contains(event.target as Node)) {
				this.cancelTouchTimer();
				this.touchContext = null;
				return;
			}
			// Short stationary taps dismiss; long presses and handle drags retain selection.
			if (
				gesture &&
				!gesture.moved &&
				Date.now() - gesture.startedAt < 350 &&
				this.deps.helper.getSnapshot().visible
			) {
				const selection = document.defaultView?.getSelection() ?? window.getSelection();
				const text = selection?.toString().trim() ?? "";
				const anchor = selection?.anchorNode;
				const targetEl =
					anchor?.nodeType === 1
						? (anchor as Element)
						: (anchor?.parentElement ?? (event.target as Element | null));
				if (
					!text ||
					text === gesture.text ||
					!targetEl?.closest?.(
						".workspace-leaf, .markdown-preview-view, .cm-editor, .markdown-source-view",
					)
				) {
					this.deps.helper.dismiss();
					return;
				}
			}
			this.touchContext = event;
			this.scheduleTouchSelection();
		};
		const handleSelectionChange = () => {
			if (this.touchContext) this.scheduleTouchSelection();
		};

		document.addEventListener("touchstart", handleTouchStart);
		document.addEventListener("touchmove", handleTouchMove);
		document.addEventListener("touchcancel", handleTouchCancel);
		document.addEventListener("touchend", handleTouchEnd);
		document.addEventListener("selectionchange", handleSelectionChange);
		document.addEventListener("mouseup", handleMouseUp);
		document.addEventListener("mousedown", handleMouseDown, true);
		document.addEventListener("scroll", handleScroll, true);

		this.unbindListeners = () => {
			document.removeEventListener("mouseup", handleMouseUp);
			document.removeEventListener("mousedown", handleMouseDown, true);
			document.removeEventListener("scroll", handleScroll, true);
			document.removeEventListener("touchstart", handleTouchStart);
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchcancel", handleTouchCancel);
			document.removeEventListener("touchend", handleTouchEnd);
			document.removeEventListener("selectionchange", handleSelectionChange);
			this.cancelTouchTimer();
			this.touchContext = null;
			this.deps.helper.dismiss();
		};
	}

	refresh(): void {
		this.renderSnapshot();
	}

	stop(): void {
		this.unbindListeners?.();
		this.unbindListeners = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.destroyPopup();
	}

	private onMouseUp(event: MouseEvent): void {
		if (this.containerEl && this.containerEl.contains(event.target as Node)) {
			return;
		}

		const selection = document.defaultView?.getSelection() ?? window.getSelection();
		const rawText = selection ? selection.toString() : "";
		const text = rawText.trim();
		const targetEl = event.target as HTMLElement | null;
		this.deps.helper.handleSelection({
			text,
			x: event.clientX,
			y: event.clientY,
			eligibleContext: Boolean(
				targetEl?.closest(
					".workspace-leaf, .markdown-preview-view, .cm-editor, .markdown-source-view",
				),
			),
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			ctrlOrMetaKey: event.ctrlKey || event.metaKey,
		});
	}

	private cancelTouchTimer(): void {
		if (this.touchTimer !== null) clearTimeout(this.touchTimer);
		this.touchTimer = null;
	}

	private scheduleTouchSelection(): void {
		this.cancelTouchTimer();
		this.touchTimer = setTimeout(() => {
			this.touchTimer = null;
			const event = this.touchContext;
			if (!event) return;
			const selection = document.defaultView?.getSelection() ?? window.getSelection();
			const anchor = selection?.anchorNode;
			if (anchor && this.containerEl?.contains(anchor)) return;
			const text = selection?.toString().trim() ?? "";
			if (text && this.deps.helper.getSnapshot().target?.text === text) return;
			const targetEl =
				anchor?.nodeType === 1
					? (anchor as Element)
					: (anchor?.parentElement ?? (event.target as Element | null));
			const bounds =
				selection && selection.rangeCount > 0
					? selection.getRangeAt(0).getBoundingClientRect()
					: null;
			const touch = event.changedTouches[0];
			this.deps.helper.handleSelection({
				text,
				x: bounds ? bounds.left : (touch?.clientX ?? 0),
				y: bounds ? bounds.bottom : (touch?.clientY ?? 0),
				eligibleContext: Boolean(
					targetEl?.closest?.(
						".workspace-leaf, .markdown-preview-view, .cm-editor, .markdown-source-view",
					),
				),
				altKey: event.altKey,
				shiftKey: event.shiftKey,
				ctrlOrMetaKey: event.ctrlKey || event.metaKey,
			});
		}, 150);
	}

	private renderSnapshot(): void {
		if (!this.deps.helper.getSnapshot().visible) {
			this.destroyPopup();
			return;
		}
		if (!this.containerEl) {
			this.containerEl = document.createElement("div");
			this.containerEl.className = "fc-selection-popup-container";
			document.body.appendChild(this.containerEl);
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
		this.cancelTouchTimer();
		this.touchContext = null;
		this.touchGesture = null;
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		if (this.containerEl) {
			this.containerEl.remove();
			this.containerEl = null;
		}
	}
}
