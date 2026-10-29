import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SelectionHelper } from "../domain/selectionHelper";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import { SelectionBubble } from "./SelectionBubble";
import styles from "./SelectionPopup.module.scss";
import { PopupPlacementController, type PopupPositionSnapshot } from "./popupPlacementController";
import type { Language } from "../../shared/types";
import type { SelectionLookupSlotRenderer } from "../domain/types";

export interface SelectionPopupHostProps {
	helper: SelectionHelper;
	strings: SelectionHelperStrings;
	language: Language;
	theme: "dark" | "light";
	renderLookupSlot?: SelectionLookupSlotRenderer;
}

export const SelectionPopupHost: React.FC<SelectionPopupHostProps> = ({
	helper,
	strings,
	language: _language,
	theme: _theme,
	renderLookupSlot,
}) => {
	const subscribe = useCallback((listener: () => void) => helper.subscribe(listener), [helper]);
	const getSnapshot = useCallback(() => helper.getSnapshot(), [helper]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const target = state.target;
	const mode = state.mode;

	const rootRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<PopupPositionSnapshot>({
		left: 0,
		top: 0,
		maxWidth: 570,
		maxHeight: 420,
	});
	const controllerRef = useRef<PopupPlacementController | null>(null);
	const onHeaderPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>((event) => {
		controllerRef.current?.onHeaderPointerDown?.(event);
	}, []);

	useLayoutEffect(() => {
		const element = rootRef.current;
		const ownerWindow = element?.ownerDocument.defaultView;
		if (!element || !ownerWindow || !target) return;

		const controller = new PopupPlacementController({
			element,
			ownerWindow,
			target,
			mode,
			onPositionChange: (next) => {
				setPosition((current) =>
					current.left === next.left &&
					current.top === next.top &&
					current.maxWidth === next.maxWidth &&
					current.maxHeight === next.maxHeight
						? current
						: next,
				);
			},
		});

		controllerRef.current = controller;

		return () => {
			controllerRef.current = null;
			controller.dispose();
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
			) : (
				/* oxlint-disable-next-line react/refs -- Slot renderer receives pointerdown forwarder for dragging */
				renderLookupSlot?.({
					word: target.text,
					onClose: () => helper.dismiss(),
					onHeaderPointerDown,
					selectedDictionaries: helper.selectedDictionaries,
					dictionaryOrder: helper.dictionaryOrder,
					openMainShortcut: helper.openMainShortcut,
				})
			)}
		</div>
	);
};
