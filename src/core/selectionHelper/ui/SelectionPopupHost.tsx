import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SelectionHelper } from "../domain/selectionHelper";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import { SelectionBubble } from "./SelectionBubble";
import { SelectionDictCard } from "./SelectionDictCard";
import styles from "./SelectionPopup.module.scss";
import { popupPosition, popupPositionAtAnchor } from "./popupPosition";
import type { Language } from "../../shared/types";
import type { SelectionResultContentRenderer } from "./types";

export interface SelectionPopupHostProps {
	helper: SelectionHelper;
	strings: SelectionHelperStrings;
	language: Language;
	theme: "dark" | "light";
	renderResultContent?: SelectionResultContentRenderer;
}

export const SelectionPopupHost: React.FC<SelectionPopupHostProps> = ({
	helper,
	strings,
	language,
	theme,
	renderResultContent,
}) => {
	const subscribe = useCallback((listener: () => void) => helper.subscribe(listener), [helper]);
	const getSnapshot = useCallback(() => helper.getSnapshot(), [helper]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const target = state.target;
	const mode = state.mode;

	const rootRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 570, maxHeight: 420 });
	const startDragRef = useRef<React.PointerEventHandler<HTMLElement> | null>(null);
	const onHeaderPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
		(event) => startDragRef.current?.(event),
		[],
	);

	useLayoutEffect(() => {
		const element = rootRef.current;
		const ownerWindow = element?.ownerDocument.defaultView;
		if (!element || !ownerWindow || !target) return;
		// A target is one captured selection; dictionary navigation retains it.
		let manualPosition: { left: number; top: number } | null = null;
		let placedCorner: { left: number; top: number } | null = null;
		let currentPosition = { left: 0, top: 0 };
		let drag: {
			pointerId: number;
			header: HTMLElement;
			x: number;
			y: number;
			left: number;
			top: number;
		} | null = null;
		const measure = (reason: "initial" | "content" | "viewport" | "drag") => {
			const viewport = ownerWindow.visualViewport;
			const visibleArea = {
				left: viewport?.offsetLeft ?? 0,
				top: viewport?.offsetTop ?? 0,
				width: viewport?.width ?? ownerWindow.innerWidth,
				height: viewport?.height ?? ownerWindow.innerHeight,
			};
			const next =
				mode === "dictionary" && reason === "content" && placedCorner
					? popupPositionAtAnchor(placedCorner, visibleArea)
					: popupPosition(
							target,
							{ width: element.offsetWidth, height: element.offsetHeight },
							visibleArea,
							manualPosition ?? placedCorner,
						);
			currentPosition = next;
			if (mode === "dictionary") placedCorner = { left: next.left, top: next.top };
			if (manualPosition) manualPosition = { left: next.left, top: next.top };
			setPosition((current) =>
				current.left === next.left &&
				current.top === next.top &&
				current.maxWidth === next.maxWidth &&
				current.maxHeight === next.maxHeight
					? current
					: next,
			);
		};
		const finishDrag = () => {
			const previous = drag;
			drag = null;
			if (!previous) return;
			previous.header.style.cursor = "";
			previous.header.removeEventListener("lostpointercapture", finishDrag);
			if (previous.header.hasPointerCapture?.(previous.pointerId)) {
				previous.header.releasePointerCapture(previous.pointerId);
			}
		};
		const moveDrag = (event: PointerEvent) => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			event.preventDefault();
			manualPosition = {
				left: drag.left + event.clientX - drag.x,
				top: drag.top + event.clientY - drag.y,
			};
			measure("drag");
		};
		const endDrag = (event: PointerEvent) => {
			if (event.pointerId === drag?.pointerId) finishDrag();
		};
		if (mode === "dictionary") {
			startDragRef.current = (event) => {
				if (drag || event.button !== 0 || !event.isPrimary) return;
				const header = event.currentTarget;
				const targetElement = event.target as HTMLElement;
				if (
					targetElement.closest(
						"button,a,input,textarea,select,[role='tablist'],[role='button']",
					)
				)
					return;
				event.preventDefault();
				drag = {
					pointerId: event.pointerId,
					header,
					x: event.clientX,
					y: event.clientY,
					left: currentPosition.left,
					top: currentPosition.top,
				};
				header.style.cursor = "grabbing";
				header.addEventListener("lostpointercapture", finishDrag);
				header.setPointerCapture(event.pointerId);
			};
			ownerWindow.addEventListener("pointermove", moveDrag, { passive: false });
			ownerWindow.addEventListener("pointerup", endDrag);
			ownerWindow.addEventListener("pointercancel", endDrag);
			ownerWindow.addEventListener("blur", finishDrag);
		}
		const Observer = (ownerWindow as Window & { ResizeObserver?: typeof ResizeObserver })
			.ResizeObserver;
		const observer = Observer ? new Observer(() => measure("content")) : null;
		observer?.observe(element);
		const measureViewport = () => measure("viewport");
		ownerWindow.addEventListener("resize", measureViewport);
		ownerWindow.visualViewport?.addEventListener("resize", measureViewport);
		ownerWindow.visualViewport?.addEventListener("scroll", measureViewport);
		measure("initial");
		return () => {
			startDragRef.current = null;
			finishDrag();
			ownerWindow.removeEventListener("pointermove", moveDrag);
			ownerWindow.removeEventListener("pointerup", endDrag);
			ownerWindow.removeEventListener("pointercancel", endDrag);
			ownerWindow.removeEventListener("blur", finishDrag);
			observer?.disconnect();
			ownerWindow.removeEventListener("resize", measureViewport);
			ownerWindow.visualViewport?.removeEventListener("resize", measureViewport);
			ownerWindow.visualViewport?.removeEventListener("scroll", measureViewport);
		};
	}, [target, mode]);

	if (!target) return null;

	return (
		<div
			ref={rootRef}
			className={styles.root}
			style={
				{
					left: position.left,
					top: position.top,
					maxWidth: position.maxWidth,
					"--fc-selection-max-height": `${position.maxHeight}px`,
					"--fc-selection-max-width": `${position.maxWidth}px`,
				} as React.CSSProperties
			}
		>
			{mode === "actions" ? (
				<SelectionBubble
					canLookup={state.canLookup}
					canTranslate={state.canTranslate}
					strings={strings}
					onLookup={() => helper.beginLookup()}
					onTranslate={() => void helper.translate()}
					onClose={() => helper.dismiss()}
				/>
			) : state.lookup && state.session ? (
				<SelectionDictCard
					query={state.lookup.query}
					lookup={state.lookup}
					session={state.session}
					theme={theme}
					language={language}
					renderResultContent={renderResultContent}
					strings={strings}
					onOpenInMainTab={() => void helper.openDictionaryInMainTab()}
					onFavorite={
						helper.canFavorite ? (word) => void helper.openFavorite(word) : undefined
					}
					onClose={() => helper.dismiss()}
					onHeaderPointerDown={onHeaderPointerDown}
				/>
			) : null}
		</div>
	);
};
